import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMessage,
  dotStuff,
  encodeHeader,
  mailAddressError,
  sendMail,
  SmtpError,
  verifySmtp,
  type MailMessage,
  type SmtpServer,
} from '../server/smtp.js';
import { fakeSmtp, type FakeSmtpOptions } from './helpers/smtp.js';

const image = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 fausse image', 'binary');

const message: MailMessage = {
  from: { name: 'Cornelius', address: 'cornelius@example.test' },
  to: { name: 'Baptiste', address: 'baptiste@example.test' },
  subject: 'Image de Cornelius : un phare dans la brume',
  text: 'Voici l’image demandée au miroir.\n.\nBonne journée.',
  attachments: [
    { filename: 'phare dans la brume.webp', contentType: 'image/webp', content: image },
  ],
};

async function serve(t: test.TestContext, options: FakeSmtpOptions) {
  const smtp = await fakeSmtp(options);
  t.after(() => smtp.close());
  const server: SmtpServer = {
    host: '127.0.0.1',
    port: smtp.port,
    security: options.security,
    username: smtp.username,
    password: smtp.password,
    ca: smtp.ca,
  };
  return { smtp, server };
}

/** Corps et pièces jointes du message reçu, décodés. */
function parts(data: string) {
  const boundary = /boundary="([^"]+)"/u.exec(data)?.[1];
  assert.ok(boundary, 'message multipart attendu');
  return data
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [head = '', body = ''] = part.replace(/^\r\n/u, '').split('\r\n\r\n');
      return { head, content: Buffer.from(body.replace(/\r\n/gu, ''), 'base64') };
    });
}

test('TLS direct : message, en-têtes et pièce jointe intacts', async (t) => {
  const { smtp, server } = await serve(t, { security: 'tls' });
  const sent = await sendMail(server, message, { now: () => Date.parse('2026-10-23T08:00:00Z') });
  assert.equal(smtp.messages.length, 1);
  const received = smtp.messages[0]!;
  assert.equal(received.from, 'cornelius@example.test');
  assert.deepEqual(received.to, ['baptiste@example.test']);
  assert.match(received.data, new RegExp(`Message-ID: <${sent.messageId}>`, 'u'));
  assert.match(received.data, /^Date: Fri, 23 Oct 2026 08:00:00 \+0000$/mu);
  assert.match(received.data, /^To: "Baptiste" <baptiste@example\.test>$/mu);
  assert.match(received.data, /^Subject: Image de Cornelius : un phare dans la brume$/mu);
  const [text, attachment] = parts(received.data);
  assert.equal(text!.content.toString('utf8'), message.text.replace(/\n/gu, '\r\n'));
  assert.match(attachment!.head, /filename="phare-dans-la-brume\.webp"/u);
  assert.match(attachment!.head, /^Content-Type: image\/webp/u);
  assert.deepEqual(attachment!.content, image);
  // Le mot de passe ne passe qu'une fois, encodé, sur la connexion chiffrée.
  assert.ok(smtp.commands.includes('AUTH PLAIN ***'));
});

test('STARTTLS sur le port de soumission, connexion par AUTH LOGIN', async (t) => {
  const { smtp, server } = await serve(t, { security: 'starttls', auth: ['LOGIN'] });
  await sendMail(server, message);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual(smtp.commands.filter((line) => !line.startsWith('EHLO')).slice(0, 2), [
    'STARTTLS',
    'AUTH LOGIN',
  ]);
});

test('vérification sans envoi, et erreurs qui disent quoi corriger', async (t) => {
  const { smtp, server } = await serve(t, { security: 'tls' });
  await verifySmtp(server);
  assert.equal(smtp.messages.length, 0);
  await assert.rejects(
    verifySmtp({ ...server, password: 'autre-mot-de-passe' }),
    (error: SmtpError) =>
      error.code === 'auth' && /mot de passe d’application/u.test(error.message),
  );
  // Certificat inconnu : aucune connexion à un serveur non vérifié.
  await assert.rejects(
    verifySmtp({ ...server, ca: undefined }),
    (error: SmtpError) => error.code === 'tls' && /Certificat/u.test(error.message),
  );
  // Mauvais mode : du TLS direct vers un port qui attend STARTTLS.
  const plain = await serve(t, { security: 'starttls' });
  await assert.rejects(
    verifySmtp({ ...plain.server, security: 'tls' }),
    (error: SmtpError) => error.code === 'tls',
  );
  const closed = { ...server, port: 1 };
  await assert.rejects(verifySmtp(closed), (error: SmtpError) => error.code === 'unreachable');
});

test('STARTTLS : une réponse glissée en clair derrière le 220 est ignorée', async (t) => {
  // Sans purge, cette fausse réponse serait lue comme celle du EHLO chiffré : plus aucun
  // mécanisme de connexion annoncé, et l’envoi échouerait (ou suivrait les choix de l’intrus).
  const { smtp, server } = await serve(t, {
    security: 'starttls',
    injectAfterStarttls: '250-intrus.example.test\r\n250 SIZE 1\r\n',
  });
  await sendMail(server, message);
  assert.equal(smtp.messages.length, 1);
});

test('STARTTLS absent : jamais de mot de passe en clair', async (t) => {
  const { smtp, server } = await serve(t, { security: 'starttls', starttls: false });
  await assert.rejects(
    verifySmtp(server),
    (error: SmtpError) => error.code === 'tls' && /STARTTLS/u.test(error.message),
  );
  assert.equal(
    smtp.commands.some((line) => line.startsWith('AUTH')),
    false,
  );
});

test('destinataire refusé, message trop lourd, serveur muet', async (t) => {
  const refused = await serve(t, { security: 'tls', rejectRecipient: true });
  await assert.rejects(
    sendMail(refused.server, message),
    (error: SmtpError) => error.code === 'rejected' && !error.uncertain,
  );
  const small = await serve(t, { security: 'tls', size: 200 });
  await assert.rejects(
    sendMail(small.server, message),
    (error: SmtpError) => error.code === 'too_large',
  );
  assert.equal(
    small.smtp.commands.some((line) => line.startsWith('MAIL')),
    false,
  );
  const silent = await serve(t, { security: 'starttls', silent: true });
  await assert.rejects(
    verifySmtp({ ...silent.server, port: silent.server.port }, { greetingMs: 100 }),
    (error: SmtpError) => error.code === 'timeout',
  );
});

test('connexion coupée après le message : envoi incertain, à ne pas répéter', async (t) => {
  const { server } = await serve(t, { security: 'tls', dropAfterData: true });
  await assert.rejects(sendMail(server, message), (error: SmtpError) => error.uncertain);
});

test('annulation avant l’envoi', async (t) => {
  const { smtp, server } = await serve(t, { security: 'tls' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    sendMail(server, message, { signal: controller.signal }),
    (error: SmtpError) => error.code === 'cancelled',
  );
  assert.equal(smtp.messages.length, 0);
});

test('composition : en-têtes encodés, sans injection, points doublés', () => {
  assert.equal(encodeHeader('Bonjour'), 'Bonjour');
  const encoded = encodeHeader('Image pour Léa : « le château » '.repeat(3));
  for (const word of encoded.split('\r\n ')) assert.ok(word.length <= 75, word);
  const decoded = encoded
    .split('\r\n ')
    .map((word) => Buffer.from(/=\?UTF-8\?B\?(.*)\?=/u.exec(word)![1]!, 'base64'))
    .reduce((all, part) => Buffer.concat([all, part]), Buffer.alloc(0))
    .toString('utf8');
  assert.equal(decoded, 'Image pour Léa : « le château » '.repeat(3).trim());
  const raw = buildMessage(
    { ...message, subject: 'Salut\r\nBcc: espion@example.test', attachments: [] },
    { messageId: 'id@example.test', date: 0 },
  );
  assert.doesNotMatch(raw, /^Bcc:/mu);
  assert.match(raw, /^Subject: Salut Bcc: espion@example\.test$/mu);
  assert.equal(dotStuff('.début\r\n.\r\nfin'), '..début\r\n..\r\nfin');
});

test('adresses : forme simple et ASCII seulement', () => {
  assert.equal(mailAddressError('baptiste@example.fr'), null);
  assert.equal(mailAddressError(' lea.poulain+miroir@exemple.co.uk '), null);
  for (const bad of ['', 'baptiste', 'a@b', 'a b@example.fr', 'é@example.fr', '<a@b.fr>', 42])
    assert.notEqual(mailAddressError(bad), null, String(bad));
});
