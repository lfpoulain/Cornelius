import { cameraWatchesInStandby, currentOpening, type Opening } from './opening.js';
import type { CameraStatus, DevicesStatus, MirrorState, VisionMode } from './types.js';

/**
 * Préparation du miroir, calculée à partir de l’état diffusé par le serveur :
 * - la liste de l’administration : ce qui reste à faire avant une première conversation ;
 * - la raison principale affichée sur le miroir quand Cornelius ne répond pas ;
 * - les motifs, dans l’ordre, qui empêchent l’administration de démarrer une session.
 *
 * Fonctions pures, sans DOM ni serveur. Elles ne reçoivent aucun secret : seulement des
 * booléens (clé présente, mot de passe par défaut) et des compteurs. Les textes du miroir ne
 * citent jamais un prénom : l’écran est visible de tous.
 */

export const READINESS_IDS = [
  'openai-key',
  'perception',
  'camera',
  'mirror',
  'voice',
  'faces',
  'wake-word',
  'admin-password',
  'openai-blocked',
] as const;
export type ReadinessId = (typeof READINESS_IDS)[number];

/**
 * done : fait ; todo : à faire ; blocked : attend d’abord une autre étape de la liste ;
 * optional : inutile avec les réglages actuels.
 */
export type ReadinessStatus = 'done' | 'todo' | 'blocked' | 'optional';

/**
 * Où agir : une rubrique de l’administration (voice, camera, profiles, diagnostic…), le miroir
 * lui-même, ou un document du dépôt.
 */
export type ReadinessAction =
  { kind: 'section'; section: string } | { kind: 'mirror' } | { kind: 'doc'; path: string };

export interface ReadinessItem {
  id: ReadinessId;
  status: ReadinessStatus;
  title: string;
  detail: string;
  action?: ReadinessAction;
}

/** Ce que la liste lit des périphériques : un `DevicesStatus` complet convient. */
export interface ReadinessDevices {
  apiConfigured: boolean;
  perception: {
    connected: boolean;
    camera: Pick<CameraStatus, 'devices' | 'selectedId' | 'error'>;
    vision?: { mode: VisionMode };
  };
}

export interface ReadinessInput {
  state: MirrorState;
  /** null tant que l’administration n’a pas reçu l’état des périphériques. */
  devices: ReadinessDevices | null;
  /** CORNELIUS_ADMIN_PASSWORD vaut encore la valeur par défaut. */
  defaultPassword: boolean;
  /** Profils ayant un visage enregistré. */
  enrolledFaces: number;
}

const restart =
  'relancez Cornelius avec scripts/start.sh (scripts/start.ps1 sous Windows), qui démarre aussi ce service';

/**
 * La caméra sert-elle avec cette ouverture ? Elle veille sauf pour « Cornelius » ouvert à tout
 * le monde ; elle s’allume alors pendant la conversation pour la reconnaissance ou la vision.
 * Sans état de la vision (`undefined`), elle est supposée active, comme par défaut.
 */
export function needsCamera(opening: Opening, vision?: VisionMode): boolean {
  return cameraWatchesInStandby(opening) || opening.recognizeVoice || vision !== 'off';
}

/** Liste de préparation, dans l’ordre où les étapes se font au premier lancement. */
export function readinessChecklist(input: ReadinessInput): ReadinessItem[] {
  const { state, devices, defaultPassword, enrolledFaces } = input;
  const opening = currentOpening(state);
  const openaiKey =
    devices?.apiConfigured ?? state.setup?.voiceKey ?? state.setup?.openaiKey ?? false;
  const perception = devices?.perception.connected ?? state.setup?.perception ?? false;
  const voice = opening.trigger === 'voice' || state.wakeWord.enabled;
  const camera = needsCamera(opening, devices?.perception.vision?.mode);
  return [
    openaiKey
      ? {
          id: 'openai-key',
          status: 'done',
          title: state.voiceProvider === 'mistral' ? 'Clé Mistral' : 'Clé OpenAI',
          detail: 'Renseignée. Elle reste sur cet ordinateur.',
        }
      : {
          id: 'openai-key',
          status: 'todo',
          title: state.voiceProvider === 'mistral' ? 'Clé Mistral' : 'Clé OpenAI',
          detail:
            'Sans elle, Cornelius ne peut pas parler. Collez-la plus bas, dans « Clés et jetons » : elle compte tout de suite.',
          action: { kind: 'doc', path: 'docs/installation/premier-demarrage.md' },
        },
    perceptionItem(perception, camera),
    cameraItem(devices, perception, camera),
    state.browserConnected
      ? {
          id: 'mirror',
          status: 'done',
          title: 'Miroir ouvert',
          detail: 'Le miroir est affiché dans un navigateur.',
        }
      : {
          id: 'mirror',
          status: 'todo',
          title: 'Miroir ouvert',
          detail: 'Ouvrez la page du miroir dans un navigateur, sur l’écran du miroir.',
          action: { kind: 'mirror' },
        },
    !state.browserConnected
      ? {
          id: 'voice',
          status: 'blocked',
          title: 'Voix activée sur le miroir',
          detail: 'Possible une fois le miroir ouvert.',
          action: { kind: 'mirror' },
        }
      : state.browserAudioReady === false
        ? {
            id: 'voice',
            status: 'todo',
            title: 'Voix activée sur le miroir',
            detail:
              'Touchez « Activer la voix » sur le miroir pour autoriser le microphone et le son.',
            action: { kind: 'mirror' },
          }
        : {
            id: 'voice',
            status: 'done',
            title: 'Voix activée sur le miroir',
            detail: 'Microphone et son autorisés.',
          },
    facesItem(opening, perception, enrolledFaces, state.profiles.length),
    wakeWordItem(state, voice, perception),
    defaultPassword
      ? {
          id: 'admin-password',
          status: 'todo',
          title: 'Mot de passe administrateur',
          detail:
            'Le mot de passe de départ est encore utilisé. Changez-le plus bas, dans la carte « Mot de passe administrateur ».',
        }
      : {
          id: 'admin-password',
          status: 'done',
          title: 'Mot de passe administrateur',
          detail: 'Mot de passe personnalisé.',
        },
    state.openaiBlocked
      ? {
          id: 'openai-blocked',
          status: 'todo',
          title: 'Accès aux services IA',
          detail:
            'Bloqué depuis l’administration : autorisez les services IA pour permettre la conversation.',
        }
      : {
          id: 'openai-blocked',
          status: 'done',
          title: 'Accès aux services IA',
          detail: 'Autorisé.',
        },
  ];
}

/** Plus rien à faire : chaque étape est faite ou inutile avec les réglages actuels. */
export function readinessComplete(items: readonly ReadinessItem[]): boolean {
  return items.every((item) => item.status === 'done' || item.status === 'optional');
}

function perceptionItem(connected: boolean, camera: boolean): ReadinessItem {
  const title = 'Service caméra (perception)';
  if (connected) return { id: 'perception', status: 'done', title, detail: 'Lancé et connecté.' };
  // Le mot d’appel est reconnu par ce même service : il reste nécessaire caméra éteinte.
  return {
    id: 'perception',
    status: 'todo',
    title,
    detail: camera
      ? `Arrêté : ${restart}. En cas d’échec, la raison est dans data/run/logs/perception.err.log.`
      : `Arrêté. Il entend aussi le mot « Cornelius », même caméra éteinte : ${restart}.`,
    action: { kind: 'section', section: 'diagnostic' },
  };
}

function cameraItem(
  devices: ReadinessDevices | null,
  perception: boolean,
  needed: boolean,
): ReadinessItem {
  const title = 'Caméra choisie';
  const action = { kind: 'section', section: 'camera' } as const;
  if (!needed)
    return {
      id: 'camera',
      status: 'optional',
      title,
      detail:
        'Pas nécessaire avec « Cornelius » ouvert à tout le monde, sans reconnaissance ni vision locale.',
      action,
    };
  if (!perception)
    return {
      id: 'camera',
      status: 'blocked',
      title,
      detail: 'Possible une fois le service caméra (perception) lancé.',
    };
  if (!devices)
    return { id: 'camera', status: 'blocked', title, detail: 'Lecture des caméras en cours.' };
  const { error, selectedId, devices: available } = devices.perception.camera;
  if (error) return { id: 'camera', status: 'todo', title, detail: error, action };
  if (selectedId === null)
    return {
      id: 'camera',
      status: 'todo',
      title,
      detail: available.length
        ? 'Choisissez la caméra du miroir.'
        : 'Aucune caméra détectée : branchez-la, puis actualisez la liste.',
      action,
    };
  return {
    id: 'camera',
    status: 'done',
    title,
    detail: available.find((device) => device.id === selectedId)?.label || 'Caméra choisie.',
  };
}

function facesItem(
  opening: Opening,
  perception: boolean,
  count: number,
  profiles: number,
): ReadinessItem {
  const title = 'Visage enregistré';
  const action = { kind: 'section', section: 'profiles' } as const;
  if (count > 0)
    return {
      id: 'faces',
      status: 'done',
      title,
      detail: count > 1 ? `${count} visages enregistrés.` : '1 visage enregistré.',
    };
  if (opening.audience === 'everyone')
    return {
      id: 'faces',
      status: 'optional',
      title,
      detail: 'Un visage enregistré permet l’accueil par le prénom.',
      action,
    };
  if (!perception)
    return {
      id: 'faces',
      status: 'blocked',
      title,
      detail:
        'La conversation est réservée aux membres du foyer : enregistrez un visage une fois le service caméra (perception) lancé.',
    };
  return {
    id: 'faces',
    status: 'todo',
    title,
    detail: profiles
      ? 'La conversation est réservée aux membres du foyer : enregistrez au moins un visage.'
      : 'La conversation est réservée aux membres du foyer : ajoutez une personne, puis enregistrez son visage.',
    action,
  };
}

function wakeWordItem(state: MirrorState, needed: boolean, perception: boolean): ReadinessItem {
  const title = 'Mot d’appel « Cornelius »';
  if (!needed)
    return {
      id: 'wake-word',
      status: 'optional',
      title,
      detail: 'Pas nécessaire : la conversation ne s’ouvre pas au mot « Cornelius ».',
    };
  if (state.wakeWord.ready)
    return { id: 'wake-word', status: 'done', title, detail: 'Modèle local prêt.' };
  if (!perception)
    return {
      id: 'wake-word',
      status: 'blocked',
      title,
      detail: 'Le modèle se charge une fois le service caméra (perception) lancé.',
    };
  return {
    id: 'wake-word',
    status: 'todo',
    title,
    detail:
      state.wakeWord.detail ??
      'Modèle introuvable : placez-le dans models/cornelius.onnx, puis relancez Cornelius.',
    action: { kind: 'doc', path: 'docs/fonctionnalites/mot-d-appel.md' },
  };
}

export type MirrorBlockerId =
  | 'connection'
  | 'openai-key'
  | 'openai-blocked'
  | 'manual-stop'
  | 'voice'
  | 'perception'
  | 'camera'
  | 'privacy'
  | 'wake-word'
  | 'session';

export interface MirrorBlocker {
  /** Permet à l’écran de taire un motif qu’il montre déjà (bouton « Activer la voix »). */
  id: MirrorBlockerId;
  reason: string;
}

/**
 * Raison principale pour laquelle Cornelius ne répond pas, en une phrase courte lisible par
 * tous devant le miroir. null : rien ne bloque, Cornelius attend simplement son déclencheur.
 * Priorité reprise du résumé de l’administration (SessionControls).
 */
export function mirrorBlocker(
  state: MirrorState,
  connection: { fresh: boolean },
): MirrorBlocker | null {
  if (!connection.fresh)
    return { id: 'connection', reason: 'Connexion au serveur interrompue, reconnexion en cours.' };
  if (['connecting', 'ready', 'closing'].includes(state.session.phase)) return null;
  if (state.setup?.openaiKey === false)
    return {
      id: 'openai-key',
      reason: 'Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur.',
    };
  if (state.openaiBlocked)
    return {
      id: 'openai-blocked',
      reason: 'Accès aux services IA bloqué depuis l’administration.',
    };
  const wakeReady = state.wakeWord.enabled && state.wakeWord.ready;
  if (state.session.manualStop)
    return {
      id: 'manual-stop',
      // Le mot d’appel lève un arrêt manuel, comme « Démarrer » dans l’administration.
      reason: wakeReady
        ? 'Conversation arrêtée depuis l’administration : dites « Cornelius » pour reprendre.'
        : 'Conversation arrêtée depuis l’administration.',
    };
  if (state.browserAudioReady === false)
    return { id: 'voice', reason: 'Touchez « Activer la voix » pour autoriser le microphone.' };
  const opening = currentOpening(state);
  // Le service de perception porte la caméra et le mot d’appel : il sert dans tous les cas.
  if (state.setup?.perception === false)
    return {
      id: 'perception',
      reason: cameraWatchesInStandby(opening)
        ? 'Service caméra arrêté : relancez Cornelius sur cet ordinateur.'
        : 'Écoute du mot « Cornelius » arrêtée : relancez Cornelius sur cet ordinateur.',
    };
  if (state.session.mode !== 4) {
    if (state.presence.health !== 'ok')
      return {
        id: 'camera',
        reason: 'Caméra du miroir indisponible : vérifiez-la dans l’administration.',
      };
    if (state.privacyMode && state.presence.peopleCount > 1)
      return {
        id: 'privacy',
        reason: 'Conversation en pause : plusieurs personnes devant le miroir.',
      };
  }
  if (state.wakeWord.enabled && !state.wakeWord.ready)
    return {
      id: 'wake-word',
      reason: 'Mot d’appel indisponible : son modèle n’est pas prêt sur cet ordinateur.',
    };
  if (state.session.phase === 'blocked')
    // Le motif serveur peut être technique : l’écran du miroir garde une phrase courante,
    // le détail reste dans l’administration.
    return {
      id: 'session',
      reason: 'Cornelius est momentanément indisponible : voir l’administration.',
    };
  return null;
}

export type AdminBlockerId =
  | 'openai-key'
  | 'openai-blocked'
  | 'mirror'
  | 'voice'
  | 'perception'
  | 'camera'
  | 'privacy'
  | 'recognition'
  | 'engagement'
  | 'presence'
  | 'wake-word';

export interface AdminBlocker {
  id: AdminBlockerId;
  reason: string;
  /** Vrai : « Démarrer la session » reste possible, seul le démarrage automatique attend. */
  manualStart: boolean;
}

/**
 * Motifs qui empêchent de démarrer, du plus fondamental au plus circonstanciel. Le premier
 * est celui à afficher ; la session démarre à la main quand tous laissent `manualStart`.
 * L’arrêt manuel n’en fait pas partie : « Démarrer » en est justement le remède.
 */
export function adminBlockers(
  state: MirrorState,
  devices: Pick<DevicesStatus, 'apiConfigured'> | null = null,
): AdminBlocker[] {
  const blockers: AdminBlocker[] = [];
  const add = (id: AdminBlockerId, reason: string, manualStart = false) =>
    blockers.push({ id, reason, manualStart });
  if (!(state.setup?.voiceKey ?? state.setup?.openaiKey ?? devices?.apiConfigured ?? false))
    add(
      'openai-key',
      'Clé du fournisseur vocal absente : ajoutez-la dans Mise en route, carte « Clés et jetons ».',
    );
  if (state.openaiBlocked)
    add('openai-blocked', 'Autorisez les services IA pour permettre la conversation.');
  if (!state.browserConnected) add('mirror', 'Ouvrez le miroir pour démarrer automatiquement.');
  else if (state.browserAudioReady === false)
    add('voice', 'Autorisez le microphone et le son sur le miroir.');
  const perceptionDown = state.setup?.perception === false;
  if (state.session.mode === 4) {
    // Démarrer reste possible sans mot d’appel : la caméra n’est pas exigée à la voix.
    if (perceptionDown)
      add(
        'perception',
        'Service caméra (perception) arrêté : le mot « Cornelius » ne peut pas être entendu.',
        true,
      );
    else if (!state.wakeWord.ready)
      add('wake-word', state.wakeWord.detail ?? 'Modèle du mot d’appel indisponible.', true);
    return blockers;
  }
  if (state.presence.health !== 'ok') {
    // Sans caméra, présence, reconnaissance et regard ne peuvent pas être évalués.
    if (perceptionDown)
      add('perception', 'Service caméra (perception) arrêté : relancez Cornelius.');
    else add('camera', 'Caméra indisponible : vérifiez-la dans Caméra et reconnaissance.');
    return blockers;
  }
  if (state.privacyMode && state.presence.peopleCount > 1)
    add('privacy', 'Mode vie privée : plusieurs personnes sont présentes.');
  if (state.session.mode === 2 && !state.activeProfile)
    add('recognition', 'En attente d’une personne reconnue.');
  else if (state.session.mode === 3 && state.presence.state !== 'engaged')
    add('engagement', 'En attente d’une personne qui regarde le miroir.');
  else if (state.presence.state === 'absent')
    add('presence', 'En attente d’une personne devant le miroir.');
  if (state.wakeWord.enabled && !state.wakeWord.ready)
    add('wake-word', state.wakeWord.detail ?? 'Modèle du mot d’appel indisponible.', true);
  return blockers;
}

/** La session peut-elle démarrer à la main malgré ces motifs ? */
export function manualStartAllowed(blockers: readonly AdminBlocker[]): boolean {
  return blockers.every((blocker) => blocker.manualStart);
}

/** Ligne d’attente de l’administration : le premier motif, sinon ce qu’attend Cornelius. */
export function adminWaiting(
  state: MirrorState,
  devices: Pick<DevicesStatus, 'apiConfigured'> | null = null,
): string {
  const [first] = adminBlockers(state, devices);
  if (first) return first.reason;
  return state.wakeWord.enabled
    ? 'En attente du mot d’appel « Cornelius ».'
    : 'Démarrage automatique selon l’ouverture choisie.';
}
