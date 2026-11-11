import { createHash } from 'node:crypto';
import {
  AddonCollectError,
  toolResult,
  type ActionRun,
  type AddonHttpClient,
  type HttpActionDefinition,
  type ToolResult,
} from '../shared/addons.js';
import type { DiagnosticLog } from './logs.js';
import type { ActionRepository } from './storage.js';

export interface ActionToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ActionRunInput {
  actionRef: string;
  profileId: string | null;
  interactionId: string | null;
  callId: string | null;
  confirmationId: string | null;
  signal: AbortSignal;
}

const confirmationMs = 120_000;
/** Valeurs d'en-tête ou de corps de la forme `${secret:NOM}` : le secret reste hors base. */
const secretReference = /\$\{secret:([A-Za-z0-9_]+)\}/gu;

function confirmationHash(action: HttpActionDefinition, input: ActionRunInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        actionId: action.id,
        profileId: input.profileId,
        interactionId: input.interactionId,
        method: action.method,
        url: action.url,
        headers: Object.entries(action.headers).sort(([a], [b]) => a.localeCompare(b)),
        body: action.body,
      }),
    )
    .digest('hex');
}

const secretEnvPrefix = 'CORNELIUS_SECRET_';

/** Jetons connus + variables CORNELIUS_SECRET_<NOM>, référencées par `${secret:NOM}`. */
export function actionSecrets(
  tokens: Record<string, string | undefined>,
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const secrets: Record<string, string | undefined> = { ...tokens };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(secretEnvPrefix) && key.length > secretEnvPrefix.length && value)
      secrets[key.slice(secretEnvPrefix.length)] = value;
  }
  return secrets;
}

/**
 * Exécuteur d'actions HTTP. La destination vient toujours de l'admin ;
 * le modèle ne fournit ni URL, ni en-tête, ni corps.
 */
export class ActionExecutor {
  constructor(
    private readonly actions: ActionRepository,
    private readonly http: AddonHttpClient,
    private readonly logs?: DiagnosticLog,
    private readonly now: () => number = Date.now,
    private readonly secrets:
      Record<string, string | undefined> | (() => Record<string, string | undefined>) = {},
  ) {}

  private secretValues(): Record<string, string | undefined> {
    return typeof this.secrets === 'function' ? this.secrets() : this.secrets;
  }

  private resolveSecrets(value: string): string {
    return value.replace(secretReference, (_match, name: string) => {
      const secret = this.secretValues()[name];
      if (!secret || !secret.trim())
        throw new AddonCollectError('config_invalid', `Secret « ${name} » introuvable.`, false);
      return secret;
    });
  }

  private resolveHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, this.resolveSecrets(value)]),
    );
  }

  tools(profileId: string | null = null): ActionToolDescriptor[] {
    const allowed = this.actions.actionsFor(profileId).filter((action) => action.enabled);
    const commands = allowed.map(
      (action) => `${action.ref} (${action.label} — ${action.description.slice(0, 160)})`,
    );
    // Propriétaire non résolu (session anonyme du mode 1) : l'identité et ses commandes
    // suivent après reconnaissance, une négation prématurée serait contredite.
    const listing = commands.length
      ? ` Commandes autorisées : ${commands.join(' | ')}.`
      : profileId === null
        ? ''
        : ' Aucune commande n’est autorisée pour ce profil.';
    return [
      {
        name: 'http__send',
        description:
          'Déclencher une commande HTTP déjà enregistrée par son identifiant exact (`actionRef`), sans jamais l’inventer.' +
          listing +
          ' Quand la confirmation est exigée, demander l’accord à l’utilisateur, le faire valider dans l’administration, puis rappeler avec l’identifiant de confirmation.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['actionRef', 'confirmationId'],
          properties: {
            actionRef: { type: 'string', minLength: 1, maxLength: 64 },
            confirmationId: { type: ['string', 'null'] },
          },
        },
      },
    ];
  }

  /** Nom d'outil Live réservé aux actions HTTP. */
  handles(name: string): boolean {
    return name === 'http__send';
  }

  /** Test de destination depuis l'admin : un seul envoi, aucun journal d'exécution. */
  async test(action: HttpActionDefinition): Promise<{
    status: 'succeeded' | 'failed' | 'unknown';
    responseStatus: number | null;
    summary: string;
  }> {
    try {
      const response = await this.http.fetch({
        url: action.url,
        method: action.method,
        headers: this.resolveHeaders(action.headers),
        body: action.method === 'POST' ? this.resolveSecrets(action.body ?? '') : undefined,
      });
      if (response.status >= 200 && response.status < 300)
        return {
          status: 'succeeded',
          responseStatus: response.status,
          summary: 'Destination joignable.',
        };
      if (response.status >= 500)
        return {
          status: 'unknown',
          responseStatus: response.status,
          summary: `La destination a répondu ${response.status} : résultat incertain.`,
        };
      return {
        status: 'failed',
        responseStatus: response.status,
        summary: `La destination a refusé la requête (${response.status}).`,
      };
    } catch (error) {
      const code = error instanceof AddonCollectError ? error.code : null;
      // Secret manquant ou requête refusée avant l'envoi : le message dit quoi corriger.
      if (code === 'config_invalid' || code === 'invalid_params')
        return { status: 'failed', responseStatus: null, summary: (error as Error).message };
      if (code === 'unavailable')
        return {
          status: 'failed',
          responseStatus: null,
          summary: 'Destination injoignable : vérifiez l’adresse et que l’appareil est allumé.',
        };
      return {
        status: 'unknown',
        responseStatus: null,
        summary:
          code === 'timeout'
            ? 'Aucune réponse dans le délai : résultat incertain.'
            : 'Connexion interrompue avant la réponse : résultat incertain.',
      };
    }
  }

  /** Secrets `${secret:NOM}` cités par la commande et absents du serveur (jamais leur valeur). */
  missingSecrets(action: Pick<HttpActionDefinition, 'headers' | 'body'>): string[] {
    const names = new Set<string>();
    for (const value of [...Object.values(action.headers), action.body ?? ''])
      for (const match of value.matchAll(secretReference)) names.add(match[1]!);
    const secrets = this.secretValues();
    return [...names].filter((name) => !secrets[name]?.trim());
  }

  private authorize(
    actionRef: string,
    profileId: string | null,
  ): { action: HttpActionDefinition } | ToolResult {
    const action = this.actions
      .actionsFor(profileId)
      .find((candidate) => candidate.enabled && candidate.ref === actionRef);
    if (!action)
      return toolResult('failed', `Action « ${actionRef} » inconnue pour ce profil.`, {
        error: {
          code: 'not_found',
          message: 'Action inconnue ou non autorisée.',
          retryable: false,
        },
      });
    return { action };
  }

  async run(input: ActionRunInput): Promise<ToolResult> {
    if (input.signal.aborted)
      return toolResult('cancelled', 'Interaction terminée ; action annulée.');
    this.actions.purgeConfirmations(this.now());
    const resolved = this.authorize(input.actionRef, input.profileId);
    if (!('action' in resolved)) return resolved;
    const { action } = resolved;

    // Le rejeu restitue le résultat enregistré, sans demander ni consommer un nouvel accord.
    const idempotencyKey = JSON.stringify([
      input.profileId,
      input.interactionId,
      input.callId,
      action.id,
    ]);
    const existing = this.actions.findRun(action.id, idempotencyKey);
    if (existing) return this.fromRun(existing, action);

    if (action.confirmation === 'required' && !input.confirmationId) {
      const confirmationId = this.actions.createConfirmation({
        actionId: action.id,
        profileId: input.profileId,
        interactionId: input.interactionId,
        params: {},
        paramsHash: confirmationHash(action, input),
        expiresAt: this.now() + confirmationMs,
      });
      return toolResult(
        'pending_confirmation',
        `Action « ${action.label} » en attente de validation dans l’administration.`,
        { result: { confirmationId, actionRef: action.ref, label: action.label } },
      );
    }

    if (input.confirmationId) {
      const confirmation = this.actions.getConfirmation(input.confirmationId);
      const valid =
        confirmation !== null &&
        confirmation.actionId === action.id &&
        confirmation.profileId === input.profileId &&
        confirmation.paramsHash === confirmationHash(action, input) &&
        confirmation.expiresAt > this.now();
      if (!valid) {
        // Ne supprime que la confirmation de cette action ; une confirmation étrangère reste intacte.
        if (
          confirmation &&
          confirmation.actionId === action.id &&
          confirmation.profileId === input.profileId
        )
          this.actions.deleteConfirmation(input.confirmationId);
        return toolResult('cancelled', 'Confirmation expirée ou invalide ; action annulée.', {
          error: { code: 'invalid_params', message: 'Confirmation invalide.', retryable: false },
        });
      }
      // La validation vient d'un canal authentifié (administration), jamais du modèle.
      if (confirmation.approvedAt === null)
        return toolResult(
          'failed',
          `Action « ${action.label} » non validée : confirmez-la dans l’administration.`,
          {
            error: {
              code: 'forbidden',
              message: 'Confirmation non approuvée.',
              retryable: false,
            },
          },
        );
      this.actions.deleteConfirmation(input.confirmationId);
    }

    let headers: Record<string, string>;
    let body: string | undefined;
    try {
      headers = this.resolveHeaders(action.headers);
      body = action.method === 'POST' ? this.resolveSecrets(action.body ?? '') : undefined;
    } catch (error) {
      this.logs?.write('warn', 'action', 'Action mal configurée', {
        actionRef: action.ref,
        code: error instanceof AddonCollectError ? error.code : 'config_invalid',
      });
      return toolResult('failed', `Action « ${action.label} » mal configurée.`, {
        error: {
          code: 'config_invalid',
          message: error instanceof Error ? error.message : 'Secret manquant.',
          retryable: false,
        },
      });
    }

    // L'exécution est enregistrée avant l'envoi : une réponse perdue devient « unknown ».
    const run = this.actions.createRun({
      actionId: action.id,
      profileId: input.profileId,
      interactionId: input.interactionId,
      idempotencyKey,
      status: 'unknown',
      requestSummary: `${action.method} ${action.label}`,
    });
    const startedAt = this.now();
    try {
      const response = await this.http.fetch({
        url: action.url,
        method: action.method,
        headers,
        body,
        signal: input.signal,
      });
      const responseSummary = response.text().slice(0, 200);
      if (response.status >= 200 && response.status < 300) {
        const finished = this.actions.finishRun(run.id, {
          status: 'succeeded',
          responseStatus: response.status,
          responseSummary,
        });
        this.logs?.write('info', 'action', 'Action HTTP terminée', {
          actionRef: action.ref,
          status: 'succeeded',
          responseStatus: response.status,
          durationMs: this.now() - startedAt,
        });
        return toolResult('succeeded', `Action « ${action.label} » réussie.`, {
          result: { label: action.label, status: response.status },
          actionRunId: finished.id,
        });
      }
      if (response.status >= 500) {
        const finished = this.actions.finishRun(run.id, {
          status: 'unknown',
          responseStatus: response.status,
          responseSummary,
          errorCode: 'upstream',
          errorMessage: `Statut ${response.status}.`,
        });
        this.logs?.write('warn', 'action', 'Résultat d’action incertain', {
          actionRef: action.ref,
          status: 'unknown',
          responseStatus: response.status,
        });
        return toolResult(
          'unknown',
          `Résultat incertain pour « ${action.label} ». Ne pas répéter automatiquement.`,
          {
            actionRunId: finished.id,
            error: { code: 'upstream', message: `Statut ${response.status}.`, retryable: false },
          },
        );
      }
      const code =
        response.status === 401
          ? 'auth'
          : response.status === 403
            ? 'forbidden'
            : response.status === 404
              ? 'not_found'
              : 'invalid_params';
      const finished = this.actions.finishRun(run.id, {
        status: 'failed',
        responseStatus: response.status,
        responseSummary,
        errorCode: code,
        errorMessage: `Statut ${response.status}.`,
      });
      this.logs?.write('warn', 'action', 'Action HTTP refusée', {
        actionRef: action.ref,
        status: 'failed',
        responseStatus: response.status,
      });
      return toolResult('failed', `Action « ${action.label} » refusée (${response.status}).`, {
        actionRunId: finished.id,
        error: { code, message: `Statut ${response.status}.`, retryable: false },
      });
    } catch (error) {
      const code = error instanceof AddonCollectError ? error.code : 'unavailable';
      // Requête invalide ou destination injoignable : rien n'est parti, l'échec est certain.
      if (
        error instanceof AddonCollectError &&
        !input.signal.aborted &&
        (code === 'invalid_params' || code === 'unavailable')
      ) {
        const reason = code === 'invalid_params' ? 'requête invalide' : 'destination injoignable';
        const finished = this.actions.finishRun(run.id, {
          status: 'failed',
          errorCode: code,
          errorMessage: error.message,
        });
        this.logs?.write('warn', 'action', 'Action HTTP non envoyée', {
          actionRef: action.ref,
          status: 'failed',
          code,
        });
        return toolResult('failed', `Action « ${action.label} » non envoyée : ${reason}.`, {
          actionRunId: finished.id,
          error: { code, message: error.message, retryable: false },
        });
      }
      const finished = this.actions.finishRun(run.id, {
        status: 'unknown',
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : 'Erreur inconnue.',
      });
      this.logs?.write('warn', 'action', 'Résultat d’action incertain', {
        actionRef: action.ref,
        status: 'unknown',
        code,
        timeout: code === 'timeout',
      });
      return toolResult(
        'unknown',
        `Résultat incertain pour « ${action.label} ». Ne pas répéter automatiquement.`,
        {
          actionRunId: finished.id,
          error: { code, message: 'Réponse perdue ou délai dépassé.', retryable: false },
        },
      );
    }
  }

  private fromRun(run: ActionRun, action: HttpActionDefinition): ToolResult {
    const { status, responseStatus, errorMessage } = run;
    const extra: Partial<ToolResult> = {
      actionRunId: run.id,
      error: run.errorCode
        ? { code: run.errorCode, message: errorMessage ?? 'Échec.', retryable: false }
        : null,
    };
    if (status === 'succeeded')
      return toolResult('succeeded', `Action « ${action.label} » déjà exécutée.`, {
        ...extra,
        result: { label: action.label, status: responseStatus },
      });
    if (status === 'unknown')
      return toolResult(
        'unknown',
        `Résultat incertain pour « ${action.label} ». Ne pas répéter.`,
        extra,
      );
    if (status === 'failed')
      return toolResult('failed', `Action « ${action.label} » en échec.`, extra);
    return toolResult('cancelled', `Action « ${action.label} » annulée.`, extra);
  }
}
