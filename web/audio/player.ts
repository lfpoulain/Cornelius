import { useEffect, useRef } from 'react';
import { playerOutput, type PlayerContext } from '../../shared/player';
import type { MirrorState } from '../../shared/types';
import { request } from '../api';
import { reportDiagnostic } from '../diagnostics';
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
 * Lecteur du miroir : un élément audio sur le flux relayé par le serveur (même origine),
 * dans la sortie choisie pour la voix. Le volume suit la conversation : baissé quand
 * Cornelius écoute, coupé quand il parle ; un fichier se met en pause. Monté avec le miroir,
 * indépendamment de ce qui est affiché (écran de veille compris).
 */
export function usePlayer(state: MirrorState | null) {
  const player = state?.player ?? null;
  const id = player?.id ?? null;
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
    element.src = `/api/player/${encodeURIComponent(id)}/stream`;
    return () => {
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
  }, [id]);

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

  return { player, context };
}

/** Bouton « Arrêter » du miroir. */
export function stopPlayer() {
  return request('/api/player/stop', { method: 'POST', body: '{}' }).catch(() => {});
}
