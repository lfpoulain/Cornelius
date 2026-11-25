import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { playerOutput, type PlayerContext } from '../../shared/player';
import type { MirrorState } from '../../shared/types';
import { request } from '../api';
import { reportDiagnostic } from '../diagnostics';
import { id3Title } from './id3';
import { audioPreferences } from './preferences';

/** Durée des fondus de volume : ni claquement à la baisse, ni retour brutal. */
const FADE_MS = 300;

function report(id: string, status: 'playing' | 'error' | 'ended', reason?: string) {
  void request('/api/player/status', {
    method: 'POST',
    body: JSON.stringify(reason ? { id, status, reason: reason.slice(0, 300) } : { id, status }),
  }).catch(() => {});
}

/** Raison lisible d'un échec de l'élément audio, sans adresse. */
function failureReason(audio: HTMLAudioElement): string {
  switch (audio.error?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Le flux s’est interrompu.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Format audio illisible par le miroir.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Flux refusé ou format non pris en charge.';
    default:
      return 'Le flux ne répond pas.';
  }
}

/** Raison d'un échec fatal de hls.js : celle du serveur s'il l'a dite, sinon le genre d'échec. */
function hlsFailureReason(data: { type: string; networkDetails?: unknown }): string {
  const xhr = data.networkDetails as
    { responseType?: string; responseText?: string; response?: unknown } | undefined;
  try {
    // Une liste se lit en texte ; un morceau en ArrayBuffer (responseText y est interdit).
    const text =
      xhr?.response instanceof ArrayBuffer
        ? new TextDecoder().decode(xhr.response)
        : !xhr?.responseType || xhr.responseType === 'text'
          ? (xhr?.responseText ?? '')
          : '';
    const error = (JSON.parse(text) as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  } catch {
    // Pas de réponse lisible du serveur.
  }
  return data.type === 'mediaError'
    ? 'Format audio illisible par le miroir.'
    : 'Le flux s’est interrompu.';
}

/**
 * Lecture HLS : hls.js, chargé seulement pour un flux HLS, lit la liste réécrite par le
 * serveur (`/api/player/<id>/hls`) ; chaque adresse qu'elle nomme est un jeton du serveur.
 * Sans travailleur (la CSP n'ouvre pas `worker-src blob:`), sans faible latence. Les titres
 * ID3 portés par les morceaux sont remontés avec leur instant de lecture.
 */
async function attachHls(
  element: HTMLAudioElement,
  source: string,
  handlers: { fatal(reason: string): void; title(pts: number, text: string): void },
): Promise<Hls | null> {
  const { default: HlsPlayer } = await import('hls.js');
  if (!HlsPlayer.isSupported()) {
    // Safari et iOS lisent le HLS eux-mêmes, sur la même liste réécrite.
    if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = source;
    else handlers.fatal('Ce navigateur ne lit pas les flux HLS.');
    return null;
  }
  const hls = new HlsPlayer({
    enableWorker: false,
    lowLatencyMode: false,
    enableID3MetadataCues: false,
    backBufferLength: 30,
  });
  let recovered = false;
  let started = false;
  let unreadable = 0;
  element.addEventListener('playing', () => (started = true), { once: true });
  hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      // Morceaux que le décodeur rejette l'un après l'autre (octets qui ne sont pas de
      // l'audio) : hls.js les saute sans fin. Trois avant le premier son suffisent.
      if (!started && data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR && ++unreadable >= 3) {
        hls.stopLoad();
        handlers.fatal('Format audio illisible par le miroir.');
      }
      return;
    }
    // Une erreur de décodage se rattrape une fois, comme le recommande hls.js.
    if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR && !recovered) {
      recovered = true;
      hls.recoverMediaError();
      return;
    }
    handlers.fatal(hlsFailureReason(data));
  });
  hls.on(HlsPlayer.Events.FRAG_PARSING_METADATA, (_event, data) => {
    for (const sample of data.samples) {
      const text = id3Title(sample.data);
      if (text) handlers.title(Number.isFinite(sample.pts) ? sample.pts : 0, text);
    }
  });
  hls.loadSource(source);
  hls.attachMedia(element);
  return hls;
}

/** Ce qui coupe ou baisse le son, lu dans l'état diffusé. */
export function playerContext(state: MirrorState | null): PlayerContext {
  const session = state?.session;
  // La conversation d'un satellite se tient ailleurs : le miroir garde son volume.
  const conversation =
    !!session && !session.satellite && ['connecting', 'ready', 'closing'].includes(session.phase);
  return {
    conversation,
    speaking: conversation && state?.voice.phase === 'speaking',
    alarm: (state?.alarms?.ringing.length ?? 0) > 0,
  };
}

/**
 * Lecteur du miroir : un élément audio sur le flux relayé par le serveur (même origine, flux
 * direct, ou HLS lu par hls.js),
 * dans la sortie choisie pour la voix. Le volume suit la conversation : baissé quand
 * Cornelius écoute, coupé quand il parle ; un fichier se met en pause. Monté avec le miroir,
 * indépendamment de ce qui est affiché (écran de veille compris).
 */
export function usePlayer(state: MirrorState | null) {
  const player = state?.player ?? null;
  const id = player?.id ?? null;
  const format = player?.format ?? 'direct';
  // Titre en cours lu dans le flux (ID3 d'un flux HLS), pour la lecture `id` seulement.
  const [nowTitle, setNowTitle] = useState<{ id: string; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fade = useRef<ReturnType<typeof setInterval> | null>(null);
  const context = playerContext(state);
  const output = player ? playerOutput(player.kind, player.volume, context) : null;
  // Lu par l'accusé : un fichier demandé pendant une conversation attend en pause.
  const held = useRef(true);
  held.current = output?.paused ?? true;

  // Nouvelle lecture : nouvel élément, accusé au serveur une seule fois.
  useEffect(() => {
    if (!id) return;
    const element = new Audio();
    element.preload = 'auto';
    element.volume = 0;
    // Dans la page, masqué : le volume réel se lit dans les outils du navigateur et les tests.
    element.className = 'mirror-player-audio';
    element.hidden = true;
    document.body.append(element);
    audio.current = element;
    let acknowledged = false;
    const onPlaying = () => {
      if (acknowledged) return;
      acknowledged = true;
      report(id, 'playing');
    };
    // Un fichier tenu en pause (conversation, alarme) ne joue pas encore : qu'il soit lisible
    // suffit à l'accusé, sinon l'outil attendrait la fin de la conversation.
    const onCanPlay = () => {
      if (held.current) onPlaying();
    };
    const onError = () => {
      reportDiagnostic('warn', 'lecteur audio', new Error(failureReason(element)));
      report(id, 'error', failureReason(element));
    };
    const onEnded = () => report(id, 'ended');
    element.addEventListener('playing', onPlaying);
    element.addEventListener('canplay', onCanPlay);
    element.addEventListener('error', onError);
    element.addEventListener('ended', onEnded);
    const { speaker } = audioPreferences();
    const sink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    // La sortie se change aussi en cours de lecture : la source part tout de suite.
    if (speaker && sink.setSinkId) void sink.setSinkId(speaker).catch(() => {});
    const base = `/api/player/${encodeURIComponent(id)}`;
    let hls: Hls | null = null;
    let closed = false;
    // Titres ID3 en attente : chacun s'affiche quand la lecture atteint son instant.
    const titles: { pts: number; text: string }[] = [];
    const onTimeUpdate = () => {
      let latest: string | null = null;
      while (titles.length && titles[0]!.pts <= element.currentTime + 0.25)
        latest = titles.shift()!.text;
      if (latest !== null) setNowTitle({ id, text: latest });
    };
    if (format === 'hls') {
      element.addEventListener('timeupdate', onTimeUpdate);
      void attachHls(element, `${base}/hls`, {
        fatal(reason) {
          if (closed) return;
          reportDiagnostic('warn', 'lecteur audio', new Error(reason));
          report(id, 'error', reason);
        },
        title(pts, text) {
          titles.push({ pts, text });
          titles.sort((a, b) => a.pts - b.pts);
          if (titles.length > 20) titles.splice(0, titles.length - 20);
          onTimeUpdate();
        },
      })
        .then((instance) => {
          if (closed) instance?.destroy();
          else hls = instance;
        })
        .catch(() => {
          if (!closed) report(id, 'error', 'Le lecteur HLS n’a pas pu se charger.');
        });
    } else element.src = `${base}/stream`;
    return () => {
      closed = true;
      hls?.destroy();
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('canplay', onCanPlay);
      element.removeEventListener('error', onError);
      element.removeEventListener('ended', onEnded);
      element.pause();
      element.removeAttribute('src');
      element.load();
      element.remove();
      if (audio.current === element) audio.current = null;
    };
  }, [id, format]);

  const gain = output?.gain ?? 0;
  const paused = output?.paused ?? true;
  // Volume et pause selon la conversation, avec un fondu.
  useEffect(() => {
    const element = audio.current;
    if (!element || !id) return;
    if (fade.current) clearInterval(fade.current);
    const from = element.volume;
    const target = paused ? 0 : gain;
    const started = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - started) / FADE_MS);
      element.volume = Math.min(1, Math.max(0, from + (target - from) * progress));
      if (progress < 1) return;
      if (fade.current) clearInterval(fade.current);
      fade.current = null;
      if (paused) element.pause();
    };
    if (!paused && element.paused)
      void element.play().catch((error: unknown) => {
        // Sans geste sur la page (« Activer la voix »), le navigateur refuse le son.
        if ((error as { name?: string }).name === 'NotAllowedError')
          report(
            id,
            'error',
            'Son bloqué par le navigateur : touchez le miroir ou activez la voix.',
          );
      });
    fade.current = setInterval(step, 30);
    step();
    return () => {
      if (fade.current) clearInterval(fade.current);
      fade.current = null;
    };
    // L'élément change avec `id` : les deux effets se suivent dans l'ordre.
  }, [id, gain, paused]);

  return { player, context, nowTitle: nowTitle && nowTitle.id === id ? nowTitle.text : null };
}

/** Bouton « Arrêter » du miroir. */
export function stopPlayer() {
  return request('/api/player/stop', { method: 'POST', body: '{}' }).catch(() => {});
}
