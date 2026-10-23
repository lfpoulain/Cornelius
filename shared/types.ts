import type { CameraMode } from './camera.js';
import type { CardSettings } from './cards.js';
import type { PresenceTimings } from './presence-timings.js';
import type { DelegationMode } from './delegation.js';
import type { AdmissionSound } from './admission-sound.js';
import type { GreetingMode, SilenceClose } from './conversation.js';
import type { AddonIcon, AmbientDisplay, ModuleCard } from './addons.js';
import type { Opening } from './opening.js';
import type { ScreensaverState } from './screensaver.js';

export type { ModuleCard };

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

export type SessionPhase = 'idle' | 'connecting' | 'ready' | 'closing' | 'blocked';
/**
 * 1 : dès la détection ; 2 : à l'identification ; 3 : à l'engagement ; 4 : au mot d'appel, caméra
 * éteinte en veille (allumée pendant la conversation pour la reconnaissance ou la vision).
 */
export type SessionMode = 1 | 2 | 3 | 4;
export interface Scope {
  interactionId: string | null;
  profileEpoch: number;
  contextVersion: number;
}
export interface SessionState extends Scope {
  phase: SessionPhase;
  reason: string | null;
  mode: SessionMode;
  startedAt: number | null;
  readyAt: number | null;
  manualStop: boolean;
  microphoneEnabled: boolean;
  /** Conversation tenue par un satellite audio (pièce), et non par le miroir. */
  satellite?: { id: string; name: string } | null;
}
export interface PerceptionObservation {
  schemaVersion: 1;
  producerBootId: string;
  sequence: number;
  observedAt: number;
  health: 'ok' | 'unavailable';
  presence: boolean;
  engaged: boolean;
  people: { trackId: string; profileId: string | null }[];
}
export interface PresenceView {
  recognizedProfileIds?: string[];
  state: 'absent' | 'present' | 'engaged';
  health: 'ok' | 'unavailable';
  peopleCount: number;
  /** Personnes détectées, avec le profil reconnu et l'engagement retenu par le serveur. */
  people: { trackId: string; profileId: string | null; engaged: boolean }[];
  engagementId: string | null;
  observedAt: number | null;
}
export interface LunaCardRequest {
  schemaVersion: 1;
  cardType: 'luna';
  title: string;
  primaryValue: string | null;
  subtitle: string | null;
  description: string | null;
  items: { label: string; value: string }[];
  sources: string[];
}
export interface ImageCard {
  schemaVersion: 1;
  cardType: 'image';
  title: string;
  prompt: string;
  imageUrl: string;
  model: ImageGenerationModel | OpenAIImageModel;
  width: number;
  height: number;
  primaryValue: null;
  subtitle: null;
  description: null;
  items: [];
  sources: [];
}
export type CardContent = LunaCardRequest | ModuleCard | ImageCard;
export interface DisplayCard extends Scope {
  id: string;
  profileId: string | null;
  createdAt: number;
  expiresAt: number;
  content: CardContent;
  sources: { id: string; title: string; url?: string }[];
  stale?: boolean;
}
export interface VoiceActivity {
  phase: 'idle' | 'listening' | 'thinking' | 'speaking';
  startedAt: number;
  endsAt: number | null;
}
/**
 * Ce que le premier lancement doit encore configurer, diffusé au miroir comme à
 * l’administration. Seulement des booléens : jamais la clé ni un jeton.
 */
export interface MirrorSetup {
  /** OPENAI_API_KEY est renseignée dans .env (sa valeur n’est jamais diffusée). */
  openaiKey: boolean;
  /** Le service caméra (perception) est connecté au serveur. */
  perception: boolean;
}
export interface MirrorState {
  /** Absent des anciens serveurs : état de configuration inconnu. */
  setup?: MirrorSetup;
  openaiBlocked: boolean;
  privacyMode: boolean;
  advancedAudioBuffer: boolean;
  /** Taille de l’orbe sur le miroir, en pourcentage (100 : taille d’origine). Absent : 100. */
  orbScale?: number;
  /** Écran de veille (peintures et photos) ; absent des anciens serveurs : désactivé. */
  screensaver?: ScreensaverState;
  /** Voix de Cornelius (GPT-Live) ; absente des anciens serveurs. */
  speechVoice?: string;
  /** Module « Cartes » ; absent des anciens serveurs (3 cartes, raccourcies, 60 s). */
  cardSettings?: CardSettings;
  /** Absent des anciens serveurs : aucun son. */
  admissionSound?: AdmissionSound;
  /** Image en cours de création, signalée par un petit encart sur le miroir. */
  imageGeneration?: ImageGenerationActivity | null;
  delegationMode: DelegationMode;
  /** Outil de recherche web natif de la délégation (module « Web ») ; absent : activé. */
  webSearchEnabled?: boolean;
  /** Accueil parlé d’une personne reconnue ; absent : « Bonjour Prénom ». */
  greeting?: GreetingMode;
  /** Modes 1 et 3 : seule une personne reconnue ouvre une conversation. */
  knownPeopleOnly?: boolean;
  /** Modes caméra : fin de la conversation après ce silence, même devant le miroir. */
  silenceClose?: SilenceClose;
  /** Mode voix : la caméra s’allume au mot d’appel pour reconnaître la personne. */
  voiceRecognition?: boolean;
  /** Ouverture lue en deux questions : ce qui l’ouvre, et qui peut l’ouvrir. */
  opening?: Opening;
  wakeWord: { enabled: boolean; ready: boolean; detail: string | null };
  browserConnected: boolean;
  browserAudioReady?: boolean;
  session: SessionState;
  presence: PresenceView;
  activeProfile: Profile | null;
  selection: 'household' | 'automatic' | 'explicit';
  profiles: Profile[];
  cards: DisplayCard[];
  ambientDisplays: AmbientDisplay[];
  voice: VoiceActivity;
  /** Recherche web hébergée en cours pour la conversation Live active. */
  webSearchActive?: boolean;
  diagnostic: string | null;
}
export interface StateEvent extends Scope {
  schemaVersion: 1;
  type: 'state';
  bootId: string;
  sequence: number;
  sentAt: number;
  state: MirrorState;
}
export interface HeartbeatEvent {
  schemaVersion: 1;
  type: 'heartbeat';
  bootId: string;
  sequence: number;
  sentAt: number;
}
export interface CameraStatus {
  source?: import('./camera.js').CameraSource;
  devices: { id: string; label: string }[];
  selectedId: string | null;
  changing: boolean;
  error: string | null;
  /** Résolution et cadence demandées (absentes d’une ancienne perception). */
  mode?: CameraMode;
  /** Ce que la caméra a réellement accepté, mesuré sur l’image ; fps null si inconnu. */
  actual?: { width: number; height: number; fps: number | null } | null;
  /** Caméra éteinte par le mode d’ouverture (elle se rallume pour un réglage). */
  suspended?: boolean;
}
export type EnrollmentMode = 'replace' | 'add';
/**
 * saved : visage enregistré ; cancelled : annulé depuis l’administration (ou profil supprimé) ;
 * expired : temps écoulé ; rejected : vues refusées ou enregistrement interrompu.
 */
export type EnrollmentOutcome = 'saved' | 'cancelled' | 'expired' | 'rejected';
/** Fin du dernier enregistrement de visage, gardée quelques minutes pour l’administration. */
export interface EnrollmentResult {
  /** Identifiant de l’enregistrement : distingue deux résultats successifs du même profil. */
  id: string;
  profileId: string;
  mode: EnrollmentMode;
  outcome: EnrollmentOutcome;
  /** Phrase à afficher telle quelle, sans prénom. */
  message: string;
  at: number;
}

/** Scores de reconnaissance en direct, pour le test de l’administration. */
export interface RecognitionLive {
  observedAt: number;
  threshold: number;
  faces: {
    identity: string | null;
    usable: boolean;
    issue: string | null;
    /** Écart exigé entre les deux premiers profils (plus grand s’ils se ressemblent). */
    required: number | null;
    scores: { profileId: string; score: number }[];
  }[];
}

export interface EngagementSettings {
  poseTolerance: number;
  minFaceRatio: number;
}
export const VISION_MODES = ['off', 'scene', 'tool'] as const;
export type VisionMode = (typeof VISION_MODES)[number];
export type VisionTrigger = 'scene' | 'tool';
/** Modèles de description locaux téléchargeables ; `scene_model` en base et `--model`. */
export const VISION_MODELS = ['450m', '1.6b', '3b'] as const;
export type VisionModel = (typeof VISION_MODELS)[number];
export const VISION_MODEL_DEFAULT: VisionModel = '450m';
export const VISION_DEVICES = ['auto', 'gpu', 'cpu'] as const;
export type VisionDevice = (typeof VISION_DEVICES)[number];
export const VISION_DEVICE_DEFAULT: VisionDevice = 'auto';
export interface VisionEvent {
  requestId: string;
  interactionId: string | null;
  question: string | null;
  capturedAt: number | null;
  detail: string | null;
  /** Tous les fragments du contexte ont été acceptés par Live. */
  injection?: 'pending' | 'confirmed' | 'failed';
  at: number;
  trigger: VisionTrigger;
  status: 'ready' | 'failed' | 'unavailable' | 'replaced';
  durationMs: number | null;
  description: string | null;
}
export interface ModelDownload {
  state: 'missing' | 'present' | 'checking' | 'downloading' | 'ready' | 'failed';
  file: string | null;
  completed: number;
  files: number;
  received: number;
  total: number | null;
  error: string | null;
  /** Variante de graphes vérifiée ou en cours d’installation. */
  variant?: 'cpu' | 'gpu' | null;
}
export interface VisionStatus {
  downloads?: Record<VisionModel, ModelDownload>;
  mode: VisionMode;
  /** Modèle de description sélectionné (réglage admin persistant). */
  modelId: VisionModel;
  /** Calcul demandé : sélection automatique, GPU imposé ou CPU imposé. */
  device: VisionDevice;
  /** Modèle LFM effectivement chargé : 450m, 1.6b, 3b, ou absent. */
  model: 'unknown' | 'loading' | 'ready' | 'unavailable';
  /** « GPU CUDA », « GPU DirectML », « CPU »… renseigné par le worker après chargement. */
  provider: string | null;
  detail: string | null;
  lastDescription: string | null;
  lastAt: number | null;
  lastTrigger: VisionTrigger | null;
  /** Debug : demandes en attente, ajouts au contexte, latence et historique récent. */
  pending: number;
  appends: number;
  lastRequestAt: number | null;
  lastLatencyMs: number | null;
  history: VisionEvent[];
}
/** Clé OpenAI ou jeton d’un module, vu par l’administration : jamais sa valeur. */
export interface SecretView {
  group: 'providers' | 'modules';
  /** Icône déclarée par le module ; absente pour les clés du cœur. */
  icon?: AddonIcon;
  /** Variable du fichier .env qui sert aussi de nom, par exemple OPENAI_API_KEY. */
  env: string;
  label: string;
  /** Ce qui s’en sert : « Conversation et mémoire », ou le nom du module. */
  usedBy: string;
  url: string | null;
  note: string | null;
  configured: boolean;
  /** admin : saisie dans l’administration ; env : lue dans .env. */
  source: 'admin' | 'env' | null;
  /** Quatre derniers caractères, pour reconnaître la clé. */
  hint: string | null;
}

export interface NetworkStatus {
  /** Les autres appareils du réseau local peuvent ouvrir le miroir et l’administration. */
  lan: boolean;
  /** Adresses HTTPS à saisir sur un autre appareil. */
  urls: string[];
  /** Empreinte SHA-256 du certificat, pour le vérifier avant de l’accepter. */
  fingerprint: string | null;
  /** Empreinte de la clé publique, stable : celle que les satellites audio vérifient. */
  keyFingerprint?: string | null;
  /** Appareils du réseau autorisés comme miroir (absent des anciens serveurs). */
  trustedDevices?: number;
}

export interface DevicesStatus {
  presenceTimings?: PresenceTimings;
  apiConfigured: boolean;
  perceptionConfigured: boolean;
  /** CORNELIUS_ADMIN_PASSWORD vaut encore la valeur par défaut (sa valeur n’est jamais diffusée). */
  defaultPassword: boolean;
  /** Nombre de profils ayant un visage enregistré. */
  enrolledFaces: number;
  /** Accès depuis le réseau local (absent des anciens serveurs). */
  network?: NetworkStatus;
  imageGeneration?: ImageGenerationStatus;
  perception: {
    camera: CameraStatus;
    recognitionThreshold: number;
    engagement: EngagementSettings;
    connected: boolean;
    enrollingProfileId: string | null;
    /** « replace » : nouveau visage ; « add » : vues ajoutées au visage existant. */
    enrollmentMode?: EnrollmentMode | null;
    enrollmentProgress?: { step: number; collected: number; total: number; message: string } | null;
    /** Absent des anciens serveurs : la fin d’un enregistrement n’y est pas connue. */
    enrollmentResult?: EnrollmentResult | null;
    enrolledProfileIds: string[];
    /** Nombre de vues mémorisées et date du dernier enregistrement, par profil. */
    faces?: { profileId: string; views: number; enrolledAt: number }[];
    /** Profils que la caméra distingue mal (ressemblance entre leurs vues, de 0 à 1). */
    lookalikes?: { profileIds: [string, string]; similarity: number }[];
    diagnostic: string | null;
    vision: VisionStatus;
  };
}

export const IMAGE_GENERATION_MODELS = [
  'sdxl-turbo',
  'sana-sprint-0.6b',
  'flux2-klein-4b',
  'z-image-turbo',
] as const;
export type ImageGenerationModel = (typeof IMAGE_GENERATION_MODELS)[number];
export const IMAGE_GENERATION_MODEL_DEFAULT: ImageGenerationModel = 'flux2-klein-4b';
/** Où les images sont créées : sur ce PC, ou par l’API d’images d’OpenAI avec la même clé. */
export const IMAGE_GENERATION_PROVIDERS = ['local', 'openai'] as const;
export type ImageGenerationProvider = (typeof IMAGE_GENERATION_PROVIDERS)[number];
export const OPENAI_IMAGE_MODELS = [
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-1-mini',
] as const;
export type OpenAIImageModel = (typeof OPENAI_IMAGE_MODELS)[number];
export const OPENAI_IMAGE_MODEL_DEFAULT: OpenAIImageModel = 'gpt-image-2.5-flare';
export const OPENAI_IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type OpenAIImageQuality = (typeof OPENAI_IMAGE_QUALITIES)[number];
export const OPENAI_IMAGE_QUALITY_DEFAULT: OpenAIImageQuality = 'low';
export interface ImageGenerationActivity {
  kind: 'requested' | 'illustration';
  startedAt: number;
}
export interface ImageGenerationStatus {
  enabled: boolean;
  provider: ImageGenerationProvider;
  openaiModel: OpenAIImageModel;
  openaiQuality: OpenAIImageQuality;
  /** Raison pour laquelle OpenAI ne peut pas créer d’image (clé absente, connexions bloquées). */
  openaiUnavailable: string | null;
  /** Modèle chargé dès le démarrage du worker, avant la première conversation. */
  preload: boolean;
  /** Images demandées encore réaffichables (trois au plus, effacées au redémarrage). */
  storedImages: number;
  illustrateCards: boolean;
  configured: boolean;
  connected: boolean;
  busy: boolean;
  model: ImageGenerationModel;
  /** Nombre d’étapes SANA-Sprint ; 2 par défaut, 4 pour privilégier les détails. */
  sanaSteps: 2 | 4;
  loadedModel: ImageGenerationModel | null;
  device: string | null;
  detail: string | null;
  lastDurationMs: number | null;
  /** Installation locale de chaque modèle, pilotée depuis l’administration. */
  installations?: Record<ImageGenerationModel, ModelDownload>;
}
export interface DevicesEvent {
  schemaVersion: 1;
  type: 'devices';
  status: DevicesStatus;
}

export type ServerEvent =
  StateEvent | HeartbeatEvent | DevicesEvent | import('./camera.js').BrowserCameraConfig;

export type MirrorCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'select_profile'; profileId: string | null }
  | { type: 'dismiss_card'; cardId: string };
