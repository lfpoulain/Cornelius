import { readFileSync } from 'node:fs';
import { toolFailure, toolResult, type ToolResult } from '../shared/addons.js';
import { MAIL_RECIPIENTS_MAX, type MailLastSend, type MailView } from '../shared/mail.js';
import { profileNameKey } from '../shared/profile-names.js';
import { stripAccents } from '../shared/text.js';
import type { DiagnosticLog } from './logs.js';
import type { MailRepository } from './mail-store.js';
import {
  sendMail,
  SmtpError,
  verifySmtp,
  type MailMessage,
  type SmtpOptions,
  type SmtpServer,
} from './smtp.js';

/** Images que l'on peut joindre : celles de la génération d'image, gardées en mémoire. */
export interface MailImageSource {
  attachment(
    profileId: string | null,
    input: { shownId: string | null; position: number | null; search: string | null },
  ): { image: { id: string; prompt: string; path: string } } | { summary: string };
}

export interface MailTransport {
  send(server: SmtpServer, message: MailMessage, options?: SmtpOptions): Promise<unknown>;
  verify(server: SmtpServer, options?: SmtpOptions): Promise<void>;
}

export interface MailRunInput {
  profileId: string | null;
  profileName: string | null;
  interactionId: string | null;
  callId: string | null;
  /** Image affichée sur le miroir à cet instant, s'il y en a une. */
  shownImageId: string | null;
}

interface MailArgs {
  recipient: string;
  image: boolean;
  position: number | null;
  search: string | null;
  subject: string | null;
  message: string | null;
}

const toolName = 'mail__send';
/** Envois au plus par heure glissante : une boucle ne remplit pas une boîte de réception. */
const hourlyLimit = 20;
const hourMs = 3_600_000;
const self = 'moi';

const clip = (text: string, max: number) => {
  const value = text.replace(/\s+/gu, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).trimEnd()}…`;
};

const slug = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40)
    .replace(/-+$/u, '');

function parseArgs(raw: unknown): MailArgs | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const args = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  const position = args.position;
  if (typeof args.recipient !== 'string' || typeof args.image !== 'boolean') return null;
  if (
    position !== null &&
    position !== undefined &&
    !(Number.isInteger(position) && (position as number) >= 1 && (position as number) <= 3)
  )
    return null;
  return {
    recipient: args.recipient.trim(),
    image: args.image,
    position: typeof position === 'number' ? position : null,
    search: text(args.search, 120),
    subject: text(args.subject, 120),
    message: text(args.message, 1500),
  };
}

/**
 * Envoi par e-mail, sur le téléphone d'une personne du foyer, d'une image créée par Cornelius
 * ou d'un court message. Les destinataires et le serveur viennent de l'administration : le
 * modèle ne choisit qu'un nom de la liste, jamais une adresse.
 */
export class Mailer {
  private sent: number[] = [];
  private recent = new Map<string, ToolResult>();
  private last: MailLastSend | null = null;

  constructor(
    private readonly store: MailRepository,
    private readonly password: () => string | undefined,
    private readonly images: MailImageSource | null,
    private readonly logs?: DiagnosticLog,
    private readonly now: () => number = Date.now,
    private readonly transport: MailTransport = { send: sendMail, verify: verifySmtp },
    /** Tests : autorité du faux serveur. */
    private readonly ca?: string,
  ) {}

  /** Ce qui manque pour envoyer, dans l'ordre où l'administration le règle. */
  missing(): string[] {
    const settings = this.store.settings();
    const missing: string[] = [];
    if (!settings.host) missing.push('le serveur SMTP');
    if (!settings.fromAddress) missing.push('l’adresse d’envoi');
    if (!this.password()) missing.push('le mot de passe');
    if (this.store.recipients().length === 0) missing.push('un destinataire');
    return missing;
  }

  ready(): boolean {
    return this.store.settings().enabled && this.missing().length === 0;
  }

  view(source: MailView['password']['source'], hint: string | null): MailView {
    return {
      settings: this.store.settings(),
      recipients: this.store.recipients(),
      password: { configured: !!this.password(), source, hint },
      ready: this.ready(),
      missing: this.missing(),
      lastSend: this.last,
    };
  }

  tools(profileId: string | null = null) {
    if (!this.ready()) return [];
    const recipients = this.store.recipients().slice(0, MAIL_RECIPIENTS_MAX);
    const names = recipients.map((recipient) => recipient.name);
    // Adresses de la personne qui parle, dans l'ordre de la liste : la première répond à « moi ».
    const mine = recipients.filter((r) => profileId !== null && r.profileId === profileId);
    return [
      {
        name: toolName,
        description:
          'Envoyer par e-mail, sur le téléphone d’une personne du foyer, une image créée par Cornelius ou un court message (« envoie-moi cette image », « envoie l’image du phare à Baptiste », « envoie-moi l’adresse »).' +
          ` Destinataires possibles : ${names.join(', ')}.` +
          (mine.length
            ? ` recipient « moi » : la personne qui parle (${mine[0]!.name}).` +
              (mine.length > 1
                ? ` Ses autres adresses, quand elle les nomme (« sur mon adresse du travail ») : ${mine
                    .slice(1)
                    .map((r) => r.name)
                    .join(', ')}.`
                : '')
            : ' recipient « moi » seulement si la personne qui parle a été reconnue et figure dans la liste ; sinon, demande à qui envoyer.') +
          ' image : true pour joindre une image ; position et search null pour celle affichée, position 1 pour la plus récente, 2 l’avant-dernière, ou search : quelques mots de son sujet. message : texte court de l’e-mail, ou null. subject : objet court, ou null.' +
          ' N’invente jamais d’adresse ni de destinataire. Un résultat unknown ne doit jamais être renvoyé automatiquement.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['recipient', 'image', 'position', 'search', 'subject', 'message'],
          properties: {
            recipient: { type: 'string', enum: [self, ...names] },
            image: { type: 'boolean' },
            position: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
            search: { type: ['string', 'null'], maxLength: 120 },
            subject: { type: ['string', 'null'], maxLength: 120 },
            message: { type: ['string', 'null'], maxLength: 1500 },
          },
        },
      },
    ];
  }

  handles(name: string): boolean {
    return name === toolName && this.ready();
  }

  private server(): SmtpServer {
    const settings = this.store.settings();
    return {
      host: settings.host,
      port: settings.port,
      security: settings.security,
      username: settings.username || settings.fromAddress,
      password: this.password() ?? '',
      ...(this.ca ? { ca: this.ca } : {}),
    };
  }

  async run(input: MailRunInput, raw: unknown): Promise<ToolResult> {
    if (!this.ready()) return toolFailure('L’envoi par e-mail n’est pas configuré.', 'forbidden');
    const args = parseArgs(raw);
    if (!args) return toolFailure('Demande d’envoi invalide.', 'invalid_params');
    // Le rejeu d'un même appel restitue son résultat : jamais deux e-mails pour une demande.
    const key = input.callId ? `${input.interactionId}:${input.callId}` : null;
    const replay = key ? this.recent.get(key) : undefined;
    if (replay) return replay;
    const result = await this.deliver(input, args);
    if (key) {
      this.recent.set(key, result);
      if (this.recent.size > 64) this.recent.delete(this.recent.keys().next().value!);
    }
    return result;
  }

  private async deliver(input: MailRunInput, args: MailArgs): Promise<ToolResult> {
    const recipients = this.store.recipients();
    const recipient =
      profileNameKey(args.recipient) === self
        ? input.profileId === null
          ? null
          : (recipients.find((r) => r.profileId === input.profileId) ?? null)
        : (recipients.find((r) => profileNameKey(r.name) === profileNameKey(args.recipient)) ??
          null);
    if (!recipient)
      return profileNameKey(args.recipient) === self
        ? toolFailure(
            input.profileId === null
              ? 'Je ne sais pas qui parle : demande à qui envoyer, par son prénom.'
              : `Aucune adresse e-mail pour ${input.profileName ?? 'cette personne'} : à ajouter dans l’administration, Modules → E-mail.`,
            'not_found',
          )
        : toolFailure(
            `« ${clip(args.recipient, 40)} » n’est pas dans la liste des destinataires.`,
            'not_found',
          );

    let attachment: { prompt: string; content: Buffer } | null = null;
    if (args.image) {
      const found = this.images?.attachment(input.profileId, {
        shownId: args.position === null && args.search === null ? input.shownImageId : null,
        position: args.position,
        search: args.search,
      }) ?? { summary: 'Aucune image à envoyer.' };
      if (!('image' in found)) return toolFailure(found.summary, 'not_found');
      try {
        attachment = { prompt: found.image.prompt, content: readFileSync(found.image.path) };
      } catch {
        return toolFailure('L’image n’est plus disponible.', 'not_found');
      }
    } else if (!args.message)
      return toolFailure(
        'Rien à envoyer : une image ou un message est nécessaire.',
        'invalid_params',
      );

    const now = this.now();
    this.sent = this.sent.filter((at) => at > now - hourMs);
    if (this.sent.length >= hourlyLimit)
      return toolFailure(
        'Trop d’e-mails envoyés cette dernière heure : réessaie un peu plus tard.',
        'rate_limited',
      );

    const settings = this.store.settings();
    const sender = input.profileName ?? 'quelqu’un de la maison';
    const text = [
      args.message,
      attachment ? `Image demandée au miroir : « ${clip(attachment.prompt, 300)} ».` : null,
      `Envoyé par Cornelius, le miroir de la maison, à la demande de ${sender}.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const subject =
      args.subject ??
      (attachment ? `Image de Cornelius : ${clip(attachment.prompt, 60)}` : 'Message de Cornelius');
    const message: MailMessage = {
      from: { name: settings.fromName || 'Cornelius', address: settings.fromAddress },
      to: { name: recipient.name, address: recipient.address },
      subject,
      text,
      attachments: attachment
        ? [
            {
              filename: `cornelius-${slug(attachment.prompt) || 'image'}.webp`,
              contentType: 'image/webp',
              content: attachment.content,
            },
          ]
        : [],
    };
    // Le message part même si la conversation se termine : l'envoi dure quelques secondes.
    this.sent.push(now);
    try {
      await this.transport.send(this.server(), message, { timeoutMs: 30_000 });
    } catch (error) {
      const smtp = error instanceof SmtpError ? error : null;
      const uncertain = smtp?.uncertain ?? false;
      if (!uncertain) this.sent.pop();
      this.logs?.write('warn', 'mail', uncertain ? 'E-mail incertain' : 'E-mail non envoyé', {
        recipient: recipient.name,
        image: !!attachment,
        code: smtp?.code ?? 'unknown',
      });
      const reason = smtp?.message ?? 'Erreur inconnue.';
      this.last = {
        at: now,
        status: uncertain ? 'unknown' : 'failed',
        recipient: recipient.name,
        summary: reason,
      };
      return uncertain
        ? toolResult(
            'unknown',
            `Envoi incertain à ${recipient.name} : le serveur n’a pas confirmé. Ne pas renvoyer ; vérifier la boîte de réception.`,
            { error: { code: smtp!.code, message: reason, retryable: false } },
          )
        : toolFailure(
            `E-mail non envoyé à ${recipient.name}. ${reason}`,
            smtp?.code ?? 'unavailable',
          );
    }
    this.logs?.write('info', 'mail', 'E-mail envoyé', {
      recipient: recipient.name,
      image: !!attachment,
      bytes: attachment?.content.length ?? 0,
      durationMs: this.now() - now,
    });
    const summary = `E-mail envoyé à ${recipient.name}${attachment ? ', avec l’image' : ''}.`;
    this.last = { at: now, status: 'sent', recipient: recipient.name, summary };
    return toolResult('succeeded', summary, {
      result: { recipient: recipient.name, image: !!attachment },
    });
  }

  /** Essai depuis l'administration : connexion seule, ou e-mail d'essai à un destinataire. */
  async test(recipientId: string | null): Promise<{ ok: boolean; summary: string }> {
    const settings = this.store.settings();
    const missing = this.missing().filter((item) => item !== 'un destinataire');
    if (missing.length) return { ok: false, summary: `À compléter : ${missing.join(', ')}.` };
    const recipient = recipientId ? this.store.recipient(recipientId) : null;
    if (recipientId && !recipient) return { ok: false, summary: 'Destinataire inconnu.' };
    try {
      if (!recipient) {
        await this.transport.verify(this.server(), { timeoutMs: 20_000 });
        return { ok: true, summary: 'Connexion réussie : le serveur accepte ce compte.' };
      }
      await this.transport.send(
        this.server(),
        {
          from: { name: settings.fromName || 'Cornelius', address: settings.fromAddress },
          to: { name: recipient.name, address: recipient.address },
          subject: 'Essai de Cornelius',
          text: `Bonjour ${recipient.name},\n\nCet e-mail d’essai vient de Cornelius, le miroir de la maison. Les images demandées au miroir arriveront ainsi.`,
        },
        { timeoutMs: 30_000 },
      );
      this.logs?.write('info', 'mail', 'E-mail d’essai envoyé', { recipient: recipient.name });
      return { ok: true, summary: `E-mail d’essai envoyé à ${recipient.name}.` };
    } catch (error) {
      const smtp = error instanceof SmtpError ? error : null;
      this.logs?.write('warn', 'mail', 'Essai d’envoi échoué', { code: smtp?.code ?? 'unknown' });
      return { ok: false, summary: smtp?.message ?? 'Échec de l’essai.' };
    }
  }
}
