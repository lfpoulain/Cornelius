import { useId } from 'react';
import { Mic, Play, Square, ShieldCheck, ShieldOff, ArrowRight } from 'lucide-react';
import type { DevicesStatus, MirrorCommand, MirrorState } from '../../../shared/types';
import { cameraWatchesInStandby, currentOpening } from '../../../shared/opening';
import {
  adminBlockers,
  adminWaiting,
  manualStartAllowed,
  type AdminBlockerId,
} from '../../../shared/readiness';
import type { RunAction } from './types';
import { isSessionActive, plural } from './format';
import { api } from '../../api';
import { activateMirror, activateMirrorLabel } from './activate-mirror';
import { phaseLabels } from '../Mirror';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import './SessionControls.css';

/**
 * Motifs qui tiennent à l’installation (clé, miroir, voix, service caméra, mot d’appel), par
 * opposition à l’attente ordinaire d’une personne devant le miroir.
 */
const SETUP_BLOCKERS: ReadonlySet<AdminBlockerId> = new Set([
  'openai-key',
  'mirror',
  'voice',
  'perception',
  'camera',
  'wake-word',
]);

/** Une ligne de la présence : `wide` occupe la largeur, `sentence` est une phrase entière. */
interface Indicator {
  label: string;
  value: string;
  ready: boolean;
  wide: boolean;
  sentence?: boolean;
}

const CAMERA_DOWN = 'Le service caméra (perception) n’est pas lancé ou la caméra est indisponible.';

export function SessionControls({
  state,
  status,
  busy,
  fresh,
  run,
  command,
  compact = false,
  remaining = 0,
  onShowStart,
}: {
  state: MirrorState;
  status: DevicesStatus | null;
  busy: boolean;
  fresh: boolean;
  run: RunAction;
  command(value: MirrorCommand, label: string): Promise<boolean>;
  /** Une seule ligne : état, motif, Démarrer ou Arrêter. */
  compact?: boolean;
  /** Étapes restantes de la mise en route. */
  remaining?: number;
  /** Absent sur la rubrique « Mise en route » elle-même. */
  onShowStart?: () => void;
}) {
  const motifId = useId();
  const active = isSessionActive(state);
  const phase = state.session.phase;
  const blockers = adminBlockers(state, status);
  const setup = blockers.filter((blocker) => SETUP_BLOCKERS.has(blocker.id));
  const startable = manualStartAllowed(blockers);
  const tone: 'ok' | 'warning' | 'idle' = !fresh
    ? 'idle'
    : active
      ? 'ok'
      : state.openaiBlocked
        ? 'idle'
        : setup.length
          ? 'warning'
          : state.session.manualStop || phase === 'blocked'
            ? 'idle'
            : 'ok';
  let title: string;
  if (!fresh) title = 'État de la session inconnu';
  else if (active) title = phase === 'ready' ? 'Conversation en cours' : phaseLabels[phase];
  else if (state.openaiBlocked) title = 'Accès aux services IA bloqué';
  else if (setup.length) title = 'Configuration à terminer';
  else if (state.session.manualStop) title = 'Session arrêtée';
  else title = phase === 'idle' ? 'En veille attentive' : phaseLabels[phase];
  const badge = !fresh
    ? null
    : state.openaiBlocked
      ? 'Bloqué'
      : state.session.manualStop && !active
        ? 'Arrêtée'
        : phaseLabels[phase];
  let motif: string;
  if (!fresh) motif = 'En attente du serveur.';
  else if (active) motif = state.session.reason ?? 'La conversation suit votre présence.';
  else if (state.session.manualStop && !setup.length)
    motif = startable
      ? 'Arrêt manuel : utilisez Démarrer pour reprendre.'
      : 'Arrêt manuel. ' + adminWaiting(state, status);
  else motif = adminWaiting(state, status);
  // Sur « Mise en route » même, les étapes disent déjà quoi faire : le panneau ne les répète pas.
  if (fresh && !active && setup.length && remaining > 0 && !onShowStart)
    motif = 'Terminez les étapes ci-dessous pour pouvoir démarrer.';
  const showStart = fresh && setup.length > 0 && remaining > 0 && onShowStart;
  const startLink = showStart && (
    <a
      className="admin-session-start-link"
      href="#start"
      onClick={(event) => {
        event.preventDefault();
        onShowStart();
      }}
    >
      Voir la mise en route ({remaining})
      <ArrowRight aria-hidden="true" />
    </a>
  );

  const startButton = (
    <Button
      disabled={busy || !fresh || active || !startable}
      aria-describedby={motifId}
      onClick={() => {
        void command({ type: 'start' }, 'Démarrage automatique réactivé.');
      }}
    >
      <Play />
      Démarrer la session
    </Button>
  );
  const stopButton = (
    <Button
      variant="outline"
      disabled={busy || !fresh || !active || phase === 'closing'}
      onClick={() => {
        void command({ type: 'stop' }, 'Session arrêtée. Le démarrage automatique est suspendu.');
      }}
    >
      <Square />
      Arrêter la session
    </Button>
  );

  if (compact)
    return (
      <section
        className="admin-session"
        data-compact="true"
        data-tone={tone}
        aria-label="Conversation"
      >
        <div className="admin-session-top">
          <span
            className="admin-session-halo"
            data-active={tone === 'ok'}
            data-tone={tone}
            aria-hidden="true"
          />
          <div className="admin-session-line">
            <p className="admin-session-heading">{title}</p>
            <p className="admin-session-motif" id={motifId} title={motif}>
              {motif}
            </p>
            {startLink}
          </div>
          <div className="admin-session-actions">{active ? stopButton : startButton}</div>
        </div>
      </section>
    );

  const opening = currentOpening(state);
  // « Cornelius » pour tout le monde : la caméra dort jusqu’à la conversation.
  const cameraAsleep = !cameraWatchesInStandby(opening) && !active;
  const cameraDown = fresh && !cameraAsleep && state.presence.health !== 'ok';
  const names = (state.presence.recognizedProfileIds ?? [])
    .map((id) => state.profiles.find((profile) => profile.id === id)?.name)
    .filter(Boolean);
  // Une phrase, comme la caméra quand elle est indisponible : l’état et, s’il y a lieu, quoi faire.
  const microphone: Indicator = {
    label: 'Micro du miroir',
    value: !fresh
      ? 'Inconnu tant que le serveur ne répond pas.'
      : !state.browserConnected
        ? 'Miroir fermé : le micro se prépare à son ouverture.'
        : state.browserAudioReady === false
          ? 'À autoriser sur le miroir, avec « Activer la voix ».'
          : state.session.microphoneEnabled
            ? 'Actif : la conversation l’écoute.'
            : 'Prêt, en attente de la conversation.',
    ready: fresh && state.browserConnected && state.browserAudioReady !== false,
    wide: false,
    sentence: true,
  };
  const indicators: Indicator[] = !fresh
    ? [{ label: 'Devant le miroir', value: 'indisponible', ready: false, wide: false }, microphone]
    : cameraAsleep
      ? [
          { label: 'Devant le miroir', value: 'caméra en veille', ready: false, wide: false },
          {
            label: 'Mot d’appel',
            value: state.wakeWord.ready ? 'à l’écoute' : 'indisponible',
            ready: state.wakeWord.ready,
            wide: false,
          },
          microphone,
        ]
      : cameraDown
        ? [{ label: 'Caméra', value: CAMERA_DOWN, ready: false, wide: true }, microphone]
        : [
            {
              label: 'Devant le miroir',
              value: state.presence.peopleCount
                ? plural(state.presence.peopleCount, 'personne')
                : 'personne',
              ready: state.presence.peopleCount > 0,
              wide: false,
            },
            {
              label: 'Reconnue',
              value: names.join(', ') || 'non identifiée',
              ready: names.length > 0,
              wide: false,
            },
            {
              label: 'Engagée',
              value: state.presence.state === 'engaged' ? 'oui' : 'non',
              ready: state.presence.state === 'engaged',
              wide: false,
            },
            microphone,
          ];
  return (
    <section className="admin-session" data-tone={tone} aria-label="Conversation">
      <div className="admin-session-top">
        <div className="admin-session-summary">
          <span
            className="admin-session-halo"
            data-active={tone === 'ok'}
            data-tone={tone}
            aria-hidden="true"
          />
          <div className="admin-session-text">
            <div className="admin-session-title">
              <p className="admin-session-heading">{title}</p>
              {badge && (
                <Badge variant={phase === 'ready' && fresh ? 'secondary' : 'outline'}>
                  {badge}
                </Badge>
              )}
            </div>
            <p>
              <span id={motifId}>{motif}</span>
              {startLink && <> {startLink}</>}
            </p>
            {fresh &&
              state.session.reason &&
              state.session.reason !== motif &&
              (state.session.manualStop || !active) && (
                <p className="admin-session-reason" title={state.session.reason}>
                  {state.session.reason}
                </p>
              )}
          </div>
        </div>
        <div className="admin-session-actions">
          {startButton}
          {stopButton}
          {(!state.browserConnected || state.browserAudioReady === false) && (
            <Button
              variant="outline"
              disabled={busy || !fresh}
              onClick={() =>
                activateMirror({
                  openaiBlocked: state.openaiBlocked,
                  run,
                })
              }
            >
              <Mic />
              {activateMirrorLabel(state.openaiBlocked)}
              <ArrowRight />
            </Button>
          )}
          <Button
            variant="outline"
            className={state.openaiBlocked ? '' : 'admin-danger-button'}
            disabled={busy || !fresh}
            aria-pressed={state.openaiBlocked}
            onClick={() => {
              void run(
                state.openaiBlocked
                  ? 'Services IA autorisés. La conversation reprend automatiquement si le miroir est prêt.'
                  : 'Services IA bloqués.',
                () => api.blockOpenAI(!state.openaiBlocked),
              );
            }}
          >
            {state.openaiBlocked ? <ShieldCheck /> : <ShieldOff />}
            {state.openaiBlocked ? 'Autoriser les services IA' : 'Bloquer les services IA'}
          </Button>
        </div>
      </div>
      <dl className="admin-presence" aria-label="Présence devant le miroir">
        {indicators.map((item) => (
          <div
            key={item.label}
            className={
              item.wide
                ? 'admin-presence-wide'
                : item.sentence
                  ? 'admin-presence-sentence'
                  : undefined
            }
          >
            <span className="admin-dot" data-ready={item.ready} aria-hidden="true" />
            <div>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
