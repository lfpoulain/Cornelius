import { once } from 'node:events';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { createSecureContext, createServer as createTlsServer, TLSSocket } from 'node:tls';
import { generate } from 'selfsigned';

export interface FakeSmtpOptions {
  security: 'tls' | 'starttls';
  username?: string;
  password?: string;
  auth?: ('PLAIN' | 'LOGIN')[];
  /** Taille annoncée (extension SIZE). */
  size?: number;
  /** STARTTLS annoncé (oui par défaut en mode starttls). */
  starttls?: boolean;
  rejectRecipient?: boolean;
  /** Coupe la connexion après le message, sans confirmer : envoi incertain. */
  dropAfterData?: boolean;
  /** Texte en clair glissé juste derrière le 220 de STARTTLS, comme le ferait un intrus. */
  injectAfterStarttls?: string;
  /** N'envoie jamais d'accueil. */
  silent?: boolean;
}

export interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
}

/** Faux serveur SMTP local, chiffré par un certificat jetable pour 127.0.0.1. */
export async function fakeSmtp(options: FakeSmtpOptions) {
  const username = options.username ?? 'cornelius@example.test';
  const password = options.password ?? 'mot-de-passe-app';
  const mechanisms = options.auth ?? ['PLAIN', 'LOGIN'];
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  const context = createSecureContext({ key: pems.private, cert: pems.cert });
  const messages: ReceivedMail[] = [];
  const commands: string[] = [];
  const sockets = new Set<Socket>();

  const converse = (socket: Socket, secure: boolean) => {
    let buffer = '';
    let authed = false;
    let pending: ((line: string) => void) | null = null;
    let data: string[] | null = null;
    let envelope: { from: string; to: string[] } = { from: '', to: [] };
    const send = (...lines: string[]) => socket.write(lines.map((line) => `${line}\r\n`).join(''));
    const check = (user: string, pass: string) => {
      authed = user === username && pass === password;
      send(authed ? '235 Authentifié' : '535 Identifiants refusés');
    };
    const decode = (text: string) => Buffer.from(text, 'base64').toString('utf8');
    const onLine = (line: string) => {
      if (data) {
        if (line !== '.') {
          data.push(line.startsWith('..') ? line.slice(1) : line);
          return;
        }
        const text = data.join('\r\n');
        data = null;
        if (options.dropAfterData) {
          socket.destroy();
          return;
        }
        messages.push({ ...envelope, data: text });
        send('250 Message accepté');
        return;
      }
      if (pending) {
        const next = pending;
        pending = null;
        next(line);
        return;
      }
      commands.push(line.startsWith('AUTH PLAIN ') ? 'AUTH PLAIN ***' : line);
      const verb = line.split(' ')[0]!.toUpperCase();
      if (verb === 'EHLO') {
        const lines = ['fake.example.test'];
        if (!secure && options.security === 'starttls' && options.starttls !== false)
          lines.push('STARTTLS');
        if (secure) lines.push(`AUTH ${mechanisms.join(' ')}`);
        if (options.size) lines.push(`SIZE ${options.size}`);
        lines.push('8BITMIME');
        send(...lines.map((text, i) => `250${i === lines.length - 1 ? ' ' : '-'}${text}`));
      } else if (verb === 'STARTTLS') {
        socket.write('220 On passe en TLS\r\n' + (options.injectAfterStarttls ?? ''));
        socket.removeAllListeners('data');
        const upgraded = new TLSSocket(socket, { isServer: true, secureContext: context });
        sockets.add(upgraded);
        upgraded.on('error', () => undefined);
        converse(upgraded, true);
      } else if (verb === 'AUTH') {
        const [, mechanism, initial] = line.split(' ');
        if (mechanism === 'PLAIN' && initial) {
          const [, user = '', pass = ''] = decode(initial).split('\u0000');
          check(user, pass);
        } else if (mechanism === 'LOGIN') {
          send('334 VXNlcm5hbWU6');
          pending = (user) => {
            send('334 UGFzc3dvcmQ6');
            pending = (pass) => check(decode(user), decode(pass));
          };
        } else send('504 Mécanisme inconnu');
      } else if (verb === 'MAIL') {
        if (!authed) send('530 Authentification requise');
        else {
          envelope = { from: /<([^>]*)>/u.exec(line)?.[1] ?? '', to: [] };
          send('250 OK');
        }
      } else if (verb === 'RCPT') {
        if (options.rejectRecipient) send('550 Destinataire inconnu');
        else {
          envelope.to.push(/<([^>]*)>/u.exec(line)?.[1] ?? '');
          send('250 OK');
        }
      } else if (verb === 'DATA') {
        data = [];
        send('354 Fin par un point seul');
      } else if (verb === 'QUIT') {
        send('221 Au revoir');
        socket.end();
      } else send('500 Commande inconnue');
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        onLine(line);
      }
    });
  };

  const accept = (socket: Socket, secure: boolean) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    if (options.silent) return;
    socket.write('220 fake.example.test ESMTP\r\n');
    converse(socket, secure);
  };
  const server =
    options.security === 'tls'
      ? createTlsServer({ key: pems.private, cert: pems.cert }, (socket) => accept(socket, true))
      : createNetServer((socket) => accept(socket, false));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as AddressInfo).port,
    ca: pems.cert,
    username,
    password,
    messages,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}
