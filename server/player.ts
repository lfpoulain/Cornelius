import { randomUUID } from 'node:crypto';
import { toolFailure, toolResult, type AddonPlayback, type ToolResult } from '../shared/addons.js';
import {
  PLAYER_VOLUME_DEFAULT,
  PLAYER_VOLUME_MAX,
  PLAYER_VOLUME_STEP,
  type PlayerMirrorState,
} from '../shared/player.js';
import type { DiagnosticLog } from './logs.js';

export const PLAYER_CONTROL_TOOL = 'player__control';

export const playerControlTool = {
  name: PLAYER_CONTROL_TOOL,
  description:
    'Commander ce qui joue sur le miroir (radio, podcast, son lancé par un module). action : stop pour « arrête la musique », « coupe la radio » ; resume pour « remets la radio », « reprends » (relance la dernière lecture) ; volume pour « plus fort », « moins fort », « mets le son à 4 ». Pour volume : level de 0 à 10 pour une valeur dite, sinon null ; change louder ou quieter, sinon null ; exactement l’un des deux. Pour stop et resume, level et change à null. Redis le niveau renvoyé, sur 10. Sans carte.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'level', 'change'],
    properties: {
      action: { type: 'string', enum: ['stop', 'resume', 'volume'] },
      level: { anyOf: [{ type: 'integer', minimum: 0, maximum: 10 }, { type: 'null' }] },
      change: { anyOf: [{ type: 'string', enum: ['louder', 'quieter'] }, { type: 'null' }] },
    },
  } as Record<string, unknown>,
};

/** Une demande de lecture, avec le module qui l'a rendue. */
export interface PlayRequest extends AddonPlayback {
  addonId: string;
  instanceRef: string | null;
}

/** Pourquoi une lecture s'arrête, tel que le journal le dit. */
export type StopCause =
  'voix' | 'miroir' | 'déconnexion' | 'administration' | 'nouvelle lecture' | 'fin' | 'erreur';

interface Current {
  id: string;
  request: PlayRequest;
  status: PlayerMirrorState['status'];
  startedAt: number;
  /** Appels d'outil qui attendent l'accusé du miroir. */
  waiters: ((outcome: 'playing' | { error: string }) => void)[];
}

export interface PlayerOptions {
  logs?: DiagnosticLog;
  now?: () => number;
  /** Le miroir est-il là pour jouer ? */
  mirrorConnected: () => boolean;
  /** Délai d'attente de l'accusé du miroir (8 secondes). */
  ackTimeoutMs?: number;
  /**
   * Le module et la source d'une lecture passée sont-ils toujours actifs ? Lu avant de la
   * reprendre ; absent : toujours vrai.
   */
  available?: (request: PlayRequest) => boolean;
}

/** Hôte seul : l'adresse complète d'un flux peut porter un jeton, elle ne va pas au journal. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Flux HLS : une adresse dont le chemin finit par `.m3u8` (paramètres non compris). */
export function isHlsAddress(url: string): boolean {
  try {
    return /\.m3u8$/iu.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Raison d'échec dite par le miroir, ramenée à un texte court et sans adresse. */
function reasonOf(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/https?:\/\/\S+/gu, '…').trim() : '';
  return text.slice(0, 160) || 'Le flux ne répond pas.';
}

/**
 * Le lecteur du miroir : une lecture à la fois, en mémoire. Le miroir lit le flux relayé par
 * le serveur et accuse réception ; arrêt, reprise et volume sont communs à tous les modules.
 */
export class Player {
  private current: Current | null = null;
  private last: PlayRequest | null = null;
  private volume = PLAYER_VOLUME_DEFAULT;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly options: PlayerOptions) {
    this.now = options.now ?? Date.now;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  mirrorView(): PlayerMirrorState | null {
    const current = this.current;
    if (!current) return null;
    return {
      id: current.id,
      title: current.request.title,
      subtitle: current.request.subtitle,
      image: current.request.imageUrl !== null,
      kind: current.request.kind,
      format: isHlsAddress(current.request.url) ? 'hls' : 'direct',
      status: current.status,
      volume: this.volume,
    };
  }

  /** Lecture en cours si `id` est la sienne : seule celle-là est relayée. */
  playing(id: string): PlayRequest | null {
    return this.current?.id === id ? this.current.request : null;
  }

  playingAnything(): boolean {
    return this.current !== null;
  }

  /**
   * Lance une lecture sur le miroir (elle remplace la précédente) et attend que le miroir
   * l'entende : `succeeded` s'il joue, `failed` s'il n'y arrive pas, `unknown` sans réponse.
   */
  async play(request: PlayRequest, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.options.mirrorConnected())
      return toolFailure('Le miroir n’est pas connecté : rien ne peut jouer.', 'unavailable', true);
    if (this.current) this.finish('nouvelle lecture');
    const current: Current = {
      id: randomUUID(),
      request,
      status: 'loading',
      startedAt: this.now(),
      waiters: [],
    };
    this.current = current;
    this.last = request;
    this.options.logs?.write('info', 'player', 'Lecture demandée', {
      addonId: request.addonId,
      instanceRef: request.instanceRef,
      host: hostOf(request.url),
      kind: request.kind,
    });
    this.changed();
    const outcome = await new Promise<'playing' | { error: string } | 'timeout' | 'aborted'>(
      (resolve) => {
        const timer = setTimeout(() => resolve('timeout'), this.options.ackTimeoutMs ?? 8_000);
        const abort = () => resolve('aborted');
        signal?.addEventListener('abort', abort, { once: true });
        current.waiters.push((value) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          resolve(value);
        });
      },
    );
    const what = request.title;
    if (outcome === 'playing')
      return toolResult('succeeded', `${what} joue sur le miroir.`, {
        result: { title: what, volume: this.volume },
      });
    if (outcome === 'timeout' || outcome === 'aborted')
      return toolResult('unknown', `Lecture de ${what} demandée au miroir, sans confirmation.`, {
        result: { title: what, volume: this.volume },
        error: {
          code: 'timeout',
          message: 'Le miroir n’a pas confirmé la lecture.',
          retryable: true,
        },
      });
    return toolFailure(`${what} ne peut pas être lu : ${outcome.error}`, 'unavailable', true);
  }

  /** Accusé du miroir pour la lecture `id` ; une lecture remplacée entre-temps est ignorée. */
  report(id: string, status: 'playing' | 'error' | 'ended', reason?: unknown): boolean {
    const current = this.current;
    if (!current || current.id !== id) return false;
    if (status === 'playing') {
      if (current.status !== 'playing') {
        current.status = 'playing';
        this.options.logs?.write('info', 'player', 'Lecture commencée', {
          addonId: current.request.addonId,
          host: hostOf(current.request.url),
          delayMs: this.now() - current.startedAt,
        });
        this.changed();
      }
      this.settle(current, 'playing');
      return true;
    }
    if (status === 'ended') {
      this.finish('fin');
      return true;
    }
    const error = reasonOf(reason);
    this.options.logs?.write('warn', 'player', 'Lecture impossible', {
      addonId: current.request.addonId,
      host: hostOf(current.request.url),
      reason: error,
    });
    this.settle(current, { error });
    this.finish('erreur');
    return true;
  }

  private settle(current: Current, outcome: 'playing' | { error: string }) {
    const waiters = current.waiters.splice(0);
    for (const waiter of waiters) waiter(outcome);
  }

  /** Arrête ce qui joue ; faux si rien ne jouait. */
  stop(cause: StopCause): boolean {
    if (!this.current) return false;
    this.finish(cause);
    return true;
  }

  private finish(cause: StopCause) {
    const current = this.current;
    if (!current) return;
    this.current = null;
    this.settle(current, { error: 'Lecture interrompue.' });
    this.options.logs?.write('info', 'player', 'Lecture arrêtée', {
      addonId: current.request.addonId,
      cause,
      durationMs: this.now() - current.startedAt,
    });
    this.changed();
  }

  /** Outil commun `player__control`, sur le miroir, quel que soit le module qui joue. */
  async control(args: unknown, signal?: AbortSignal): Promise<ToolResult> {
    const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    const action = input.action;
    if (action === 'stop') {
      const title = this.current?.request.title;
      if (!this.stop('voix')) return toolResult('succeeded', 'Rien ne joue sur le miroir.');
      return toolResult('succeeded', `${title} est arrêté.`);
    }
    if (action === 'resume') {
      if (this.current)
        return toolResult('succeeded', `${this.current.request.title} joue déjà.`, {
          result: { volume: this.volume },
        });
      if (!this.last) return toolFailure('Rien à reprendre : aucune lecture récente.', 'not_found');
      // Une source désactivée ou supprimée depuis ne rejoue pas son dernier flux.
      if (this.options.available && !this.options.available(this.last)) {
        this.last = null;
        return toolFailure(
          'Rien à reprendre : la source de la dernière lecture n’est plus active.',
          'not_found',
        );
      }
      return this.play(this.last, signal);
    }
    if (action === 'volume') {
      const level = input.level;
      const change = input.change;
      let next: number;
      if (Number.isInteger(level) && (level as number) >= 0 && (level as number) <= 10)
        next = level as number;
      else if (change === 'louder' || change === 'quieter')
        next = this.volume + (change === 'louder' ? PLAYER_VOLUME_STEP : -PLAYER_VOLUME_STEP);
      else
        return toolFailure(
          'Volume : un niveau de 0 à 10, ou plus fort ou moins fort.',
          'invalid_params',
        );
      this.volume = Math.min(PLAYER_VOLUME_MAX, Math.max(0, next));
      this.changed();
      return toolResult('succeeded', `Volume de la lecture : ${this.volume} sur 10.`, {
        result: { volume: this.volume },
      });
    }
    return toolFailure('Commande de lecture inconnue.', 'invalid_params');
  }
}
