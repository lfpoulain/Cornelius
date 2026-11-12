import { randomUUID } from 'node:crypto';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { connect as tlsConnect } from 'node:tls';

/**
 * Client SMTP minimal, sans dépendance : un message, un destinataire, des pièces jointes.
 * Chiffrement obligatoire (TLS direct ou STARTTLS), authentification PLAIN ou LOGIN. Le mot de
 * passe n'est jamais écrit ailleurs que sur la connexion chiffrée.
 */

export type SmtpSecurity = 'tls' | 'starttls';

export interface SmtpServer {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  /** Autorité de certification supplémentaire (tests : certificat du faux serveur). */
  ca?: string | Buffer;
}

export interface MailAddress {
  name: string | null;
  address: string;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMessage {
  from: MailAddress;
  to: MailAddress;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export type SmtpErrorCode =
  'unreachable' | 'tls' | 'auth' | 'rejected' | 'too_large' | 'timeout' | 'cancelled' | 'protocol';

export class SmtpError extends Error {
  constructor(
    readonly code: SmtpErrorCode,
    message: string,
    /** Le message a pu partir avant l'erreur : ne pas le renvoyer automatiquement. */
    readonly uncertain = false,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

export interface SmtpOptions {
  signal?: AbortSignal;
  /** Délai total de l'échange (30 s par défaut). */
  timeoutMs?: number;
  /** Délai d'accueil du serveur (10 s par défaut). */
  greetingMs?: number;
  now?: () => number;
}

/** Adresse acceptée : ASCII, sans espace ni chevron, un seul @, domaine avec un point. */
export function mailAddressError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Adresse e-mail attendue.';
  const address = value.trim();
  if (address.length > 254) return 'Adresse trop longue.';
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/u.test(address))
    return 'Adresse e-mail invalide (forme prenom@exemple.fr).';
  return null;
}

/** Nom de machine annoncé au serveur : le nom local s'il ressemble à un domaine. */
function clientName(): string {
  const name = hostname();
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/u.test(name) ? name : '[127.0.0.1]';
}

// --- Composition du message ------------------------------------------------------------------

const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim();

/** En-tête en ASCII tel quel, sinon en mots encodés (RFC 2047) de 75 caractères au plus. */
export function encodeHeader(text: string): string {
  const value = clean(text);
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString('base64')}?=`).join('\r\n ');
}

function formatAddress({ name, address }: MailAddress): string {
  const label = name ? clean(name) : '';
  if (!label) return `<${address}>`;
  if (/^[\x20-\x7e]*$/u.test(label))
    return `"${label.replace(/["\\]/gu, (c) => `\\${c}`)}" <${address}>`;
  return `${encodeHeader(label)} <${address}>`;
}

const base64Lines = (content: Buffer) =>
  (content.toString('base64').match(/.{1,76}/gu) ?? []).join('\r\n');

const safeFilename = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .slice(0, 80) || 'piece-jointe';

/** Message MIME complet, lignes en CRLF, corps et pièces jointes en base64. */
export function buildMessage(
  message: MailMessage,
  { messageId, date }: { messageId: string; date: number },
): string {
  const headers = [
    `From: ${formatAddress(message.from)}`,
    `To: ${formatAddress(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date(date).toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
  ];
  const text = Buffer.from(message.text.replace(/\r?\n/gu, '\r\n'));
  const attachments = message.attachments ?? [];
  if (attachments.length === 0)
    return [
      ...headers,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(text),
    ].join('\r\n');
  const boundary = `cornelius-${randomUUID()}`;
  const parts = [
    [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(text),
    ],
    ...attachments.map((attachment) => {
      const filename = safeFilename(attachment.filename);
      return [
        `Content-Type: ${attachment.contentType}; name="${filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${filename}"`,
        '',
        base64Lines(attachment.content),
      ];
    }),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts.flatMap((part) => [`--${boundary}`, ...part]),
    `--${boundary}--`,
  ].join('\r\n');
}

/** Un point en début de ligne est doublé : seule la ligne « . » termine le message. */
export const dotStuff = (data: string) => data.replace(/(^|\r\n)\./gu, '$1..');

// --- Conversation avec le serveur ------------------------------------------------------------

interface Reply {
  code: number;
  text: string;
}

function networkError(error: NodeJS.ErrnoException): SmtpError {
  const code = error.code ?? '';
  if (/CERT|SELF_SIGNED|UNABLE_TO|ALTNAME/u.test(code))
    return new SmtpError(
      'tls',
      'Certificat du serveur SMTP refusé : vérifier l’adresse du serveur.',
    );
  if (code.startsWith('ERR_SSL') || code === 'EPROTO')
    return new SmtpError(
      'tls',
      'Connexion chiffrée impossible : vérifier le chiffrement (465 : TLS, 587 : STARTTLS).',
    );
  return new SmtpError(
    'unreachable',
    'Serveur SMTP injoignable : vérifier son adresse, son port et la connexion à Internet.',
  );
}

/** Lit les réponses du serveur (lignes « 250-… » puis « 250 … »), une à la fois. */
class Session {
  private buffer = Buffer.alloc(0);
  private lines: string[] = [];
  private replies: Reply[] = [];
  private waiter: { resolve(reply: Reply): void; reject(error: Error): void } | null = null;
  failure: Error | null = null;
  private readonly onData = (chunk: Buffer) => this.receive(chunk);
  private readonly onError = (error: Error) => this.fail(networkError(error));
  private readonly onClose = () =>
    this.fail(new SmtpError('unreachable', 'Connexion fermée par le serveur SMTP.'));

  constructor(public socket: Socket) {
    this.attach(socket);
  }

  attach(socket: Socket) {
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  /**
   * Oublie tout ce qui a été lu en clair. Avant STARTTLS, n’importe qui sur le chemin peut
   * glisser des réponses derrière le 220 : gardées, elles seraient lues comme la réponse
   * au EHLO chiffré et pourraient, par exemple, changer les mécanismes de connexion annoncés.
   */
  discardPlaintext() {
    this.buffer = Buffer.alloc(0);
    this.lines = [];
    this.replies = [];
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 64 * 1024) {
      this.fail(new SmtpError('protocol', 'Réponse du serveur SMTP trop longue.'));
      return;
    }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.subarray(0, end).toString('utf8').replace(/\r$/u, '');
      this.buffer = this.buffer.subarray(end + 1);
      const match = /^(\d{3})([ -])(.*)$/u.exec(line);
      if (!match) {
        this.fail(new SmtpError('protocol', 'Réponse du serveur SMTP illisible.'));
        return;
      }
      this.lines.push(match[3]!);
      if (match[2] === ' ') {
        const reply = { code: Number(match[1]), text: this.lines.join('\n') };
        this.lines = [];
        if (this.waiter) {
          const { resolve } = this.waiter;
          this.waiter = null;
          resolve(reply);
        } else this.replies.push(reply);
      }
    }
  }

  fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.socket.destroy();
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(error);
    }
  }

  next(): Promise<Reply> {
    const ready = this.replies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => (this.waiter = { resolve, reject }));
  }

  write(data: string) {
    if (!this.failure) this.socket.write(data);
  }

  async command(line: string, expected: number[], error: () => SmtpError): Promise<Reply> {
    this.write(`${line}\r\n`);
    const reply = await this.next();
    if (!expected.includes(reply.code)) throw error();
    return reply;
  }
}

interface Capabilities {
  starttls: boolean;
  auth: Set<string>;
  size: number | null;
}

function capabilities(reply: Reply): Capabilities {
  const result: Capabilities = { starttls: false, auth: new Set(), size: null };
  for (const line of reply.text.split('\n').slice(1)) {
    const [keyword = '', ...params] = line.trim().split(/[\s=]+/u);
    const name = keyword.toUpperCase();
    if (name === 'STARTTLS') result.starttls = true;
    if (name === 'AUTH') for (const mechanism of params) result.auth.add(mechanism.toUpperCase());
    if (name === 'SIZE' && Number(params[0]) > 0) result.size = Number(params[0]);
  }
  return result;
}

const protocolError = (what: string) => () =>
  new SmtpError('protocol', `Réponse inattendue du serveur SMTP (${what}).`);

const authError = () =>
  new SmtpError(
    'auth',
    'Identifiant ou mot de passe SMTP refusé. Avec Gmail ou iCloud, il faut un mot de passe d’application.',
  );

async function ehlo(session: Session): Promise<Capabilities> {
  return capabilities(await session.command(`EHLO ${clientName()}`, [250], protocolError('EHLO')));
}

function upgrade(socket: Socket, server: SmtpServer): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect(
      {
        socket,
        servername: isIP(server.host) ? undefined : server.host,
        ca: server.ca,
        minVersion: 'TLSv1.2',
      },
      () => {
        secure.off('error', onError);
        resolve(secure);
      },
    );
    const onError = (error: Error) => reject(networkError(error));
    secure.once('error', onError);
  });
}

async function authenticate(session: Session, server: SmtpServer, caps: Capabilities) {
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  if (caps.auth.has('PLAIN')) {
    await session.command(
      `AUTH PLAIN ${b64(`\u0000${server.username}\u0000${server.password}`)}`,
      [235],
      authError,
    );
    return;
  }
  if (caps.auth.has('LOGIN')) {
    await session.command('AUTH LOGIN', [334], authError);
    await session.command(b64(server.username), [334], authError);
    await session.command(b64(server.password), [235], authError);
    return;
  }
  throw new SmtpError(
    'auth',
    'Le serveur SMTP ne propose pas de connexion par mot de passe (AUTH PLAIN ou LOGIN).',
  );
}

/**
 * Ouvre une session chiffrée et authentifiée, puis exécute `work`. Le délai total couvre tout
 * l'échange ; la connexion est fermée par QUIT après un succès, coupée sinon.
 */
async function withSession<T>(
  server: SmtpServer,
  options: SmtpOptions,
  work: (session: Session, caps: Capabilities) => Promise<T>,
): Promise<T> {
  if (options.signal?.aborted) throw new SmtpError('cancelled', 'Envoi annulé.');
  const raw =
    server.security === 'tls'
      ? tlsConnect({
          host: server.host,
          port: server.port,
          servername: isIP(server.host) ? undefined : server.host,
          ca: server.ca,
          minVersion: 'TLSv1.2',
        })
      : netConnect({ host: server.host, port: server.port });
  const session = new Session(raw);
  const timer = setTimeout(
    () => session.fail(new SmtpError('timeout', 'Le serveur SMTP ne répond pas dans le délai.')),
    options.timeoutMs ?? 30_000,
  );
  const abort = () => session.fail(new SmtpError('cancelled', 'Envoi annulé.'));
  options.signal?.addEventListener('abort', abort, { once: true });
  let done = false;
  try {
    const greeting = setTimeout(
      () =>
        session.fail(
          new SmtpError(
            'timeout',
            server.security === 'starttls' && server.port === 465
              ? 'Le serveur SMTP ne répond pas : sur le port 465, choisir le chiffrement TLS.'
              : 'Le serveur SMTP ne répond pas.',
          ),
        ),
      options.greetingMs ?? 10_000,
    );
    let welcome: Reply;
    try {
      welcome = await session.next();
    } finally {
      clearTimeout(greeting);
    }
    if (welcome.code !== 220) throw protocolError('accueil')();
    let caps = await ehlo(session);
    if (server.security === 'starttls') {
      if (!caps.starttls)
        throw new SmtpError(
          'tls',
          'Le serveur SMTP ne propose pas STARTTLS : choisir le chiffrement TLS (port 465).',
        );
      await session.command('STARTTLS', [220], protocolError('STARTTLS'));
      session.detach();
      // La socket d'origine ne sert plus qu'au transport chiffré : ses erreurs passent par TLS.
      raw.on('error', () => undefined);
      const secure = await upgrade(raw, server).catch((error: unknown) => {
        throw session.failure ?? error;
      });
      session.discardPlaintext();
      session.attach(secure);
      caps = await ehlo(session);
    }
    await authenticate(session, server, caps);
    const result = await work(session, caps);
    done = true;
    const socket = session.socket;
    session.detach();
    socket.on('error', () => undefined);
    socket.end('QUIT\r\n');
    setTimeout(() => socket.destroy(), 2000).unref();
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (!done) session.socket.destroy();
  }
}

/** Vérifie l'adresse, le chiffrement et l'identifiant, sans rien envoyer. */
export async function verifySmtp(server: SmtpServer, options: SmtpOptions = {}): Promise<void> {
  await withSession(server, options, async () => undefined);
}

/** Envoie un message. Une `SmtpError` avec `uncertain` signale un envoi peut-être parti. */
export async function sendMail(
  server: SmtpServer,
  message: MailMessage,
  options: SmtpOptions = {},
): Promise<{ messageId: string }> {
  const domain = message.from.address.split('@')[1] ?? 'cornelius.local';
  const messageId = `${randomUUID()}@${domain}`;
  const data = dotStuff(buildMessage(message, { messageId, date: (options.now ?? Date.now)() }));
  return withSession(server, options, async (session, caps) => {
    if (caps.size !== null && Buffer.byteLength(data) > caps.size)
      throw new SmtpError(
        'too_large',
        `Message trop lourd pour le serveur SMTP (${Math.max(1, Math.floor(caps.size / 1_048_576))} Mo au plus).`,
      );
    await session.command(
      `MAIL FROM:<${message.from.address}>`,
      [250],
      () =>
        new SmtpError(
          'rejected',
          'Adresse d’envoi refusée par le serveur SMTP : elle doit être celle du compte.',
        ),
    );
    await session.command(
      `RCPT TO:<${message.to.address}>`,
      [250, 251],
      () => new SmtpError('rejected', 'Adresse du destinataire refusée par le serveur SMTP.'),
    );
    await session.command('DATA', [354], protocolError('DATA'));
    session.write(`${data}\r\n.\r\n`);
    let reply: Reply;
    try {
      reply = await session.next();
    } catch (error) {
      const code = error instanceof SmtpError ? error.code : 'unreachable';
      throw new SmtpError(
        code,
        'Envoi incertain : le serveur SMTP n’a pas confirmé la réception du message.',
        true,
      );
    }
    if (reply.code === 552)
      throw new SmtpError('too_large', 'Message trop lourd pour le serveur SMTP.');
    if (reply.code !== 250)
      throw new SmtpError('rejected', `Message refusé par le serveur SMTP (${reply.code}).`);
    return { messageId };
  });
}
