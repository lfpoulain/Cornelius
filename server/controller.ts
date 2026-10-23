import { DEFAULT_CARD_SETTINGS, type CardSettings } from '../shared/cards.js';
import { DEFAULT_LIVE_VOICE, type LiveVoice } from '../shared/voices.js';
import { openingFromSettings, settingsForOpening, type Opening } from '../shared/opening.js';
import {
  DEFAULT_PRESENCE_TIMINGS,
  isPresenceTimings,
  type PresenceTimings,
} from '../shared/presence-timings.js';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_DELEGATION_MODE,
  isDelegationMode,
  type DelegationMode,
} from '../shared/delegation.js';
import {
  DEFAULT_ADMISSION_SOUND,
  isAdmissionSound,
  type AdmissionSound,
} from '../shared/admission-sound.js';
import {
  DEFAULT_GREETING_MODE,
  DEFAULT_SILENCE_CLOSE,
  isGreetingMode,
  isSilenceClose,
  type GreetingMode,
  type SilenceClose,
} from '../shared/conversation.js';
import { validators } from '../shared/validation.js';
import { validateObservation } from '../shared/commands.js';
import type {
  DisplayCard,
  ImageGenerationActivity,
  MirrorCommand,
  MirrorSetup,
  MirrorState,
  PerceptionObservation,
  Profile,
  Scope,
  SessionMode,
  SessionState,
  StateEvent,
  VoiceActivity,
} from '../shared/types.js';
import type { ProfileRepository } from './storage.js';

export interface SessionPreferencesStore {
  getPresenceTimings?(): PresenceTimings;
  setPresenceTimings?(settings: PresenceTimings): void;
  getOpenAIBlocked?(): boolean;
  getManualStop(): boolean;
  setManualStop(stopped: boolean): void;
  getPrivacyMode?(): boolean;
  setPrivacyMode?(enabled: boolean): void;
  getSessionMode?(): SessionMode;
  setSessionMode?(mode: SessionMode): void;
  getWakeWordEnabled?(): boolean;
  setWakeWordEnabled?(enabled: boolean): void;
  getAdvancedAudioBuffer?(): boolean;
  setAdvancedAudioBuffer?(enabled: boolean): void;
  getOrbScale?(): number;
  setOrbScale?(scale: number): void;
  getSpeechVoice?(): LiveVoice;
  setSpeechVoice?(voice: LiveVoice): void;
  getCardSettings?(): CardSettings;
  setCardSettings?(settings: CardSettings): void;
  getDelegationMode?(): DelegationMode;
  setDelegationMode?(mode: DelegationMode): void;
  getAdmissionSound?(): AdmissionSound;
  setAdmissionSound?(settings: AdmissionSound): void;
  getWebSearchEnabled?(): boolean;
  setWebSearchEnabled?(enabled: boolean): void;
  getGreetingMode?(): GreetingMode;
  setGreetingMode?(mode: GreetingMode): void;
  getKnownPeopleOnly?(): boolean;
  setKnownPeopleOnly?(enabled: boolean): void;
  getSilenceClose?(): SilenceClose;
  setSilenceClose?(settings: SilenceClose): void;
  getVoiceRecognition?(): boolean;
  setVoiceRecognition?(enabled: boolean): void;
}

export interface SessionTransport {
  unavailableReason?(): string | null;
  open(scope: Scope): void;
  close(interactionId: string): void;
  /** Session déjà ouverte : ajoute les informations personnelles sans la recréer (mode 1). */
  identify?(scope: Scope): void;
  /** Une admission est probable : préparer les connexions réseau, sans créer de session. */
  prewarm?(): void;
}

const limits = {
  sensorMs: 2000,
  browserMs: 5000,
  connectionMs: 5000,
  closeMs: 5000,
  // Lectures caméra ratées tolérées avant de déclarer la caméra indisponible.
  cameraFaultMs: 1000,
  // Images sans regard ignorées (clignement, flou) pendant la confirmation du regard.
  gazeFlickerMs: 300,
};
// Une deuxième personne doit être vue sur deux observations consécutives (mode vie privée).
const privacyConfirmFrames = 2;
const voiceOutputGraceMs = 900;
// Mode voix : délai laissé à la caméra pour reconnaître la personne après le mot d’appel.
const voiceIdentityWindowMs = 8000;

/**
 * Chemins d’ouverture : présence (automatic), bouton (manual), mot d’appel (wake), et reprise
 * de la même conversation après un changement de contexte (resume).
 */
type OpenSource = 'automatic' | 'manual' | 'wake' | 'resume' | 'satellite';
const satelliteMembersDiagnostic =
  'Satellite : l’ouverture est réservée aux membres reconnus, qu’un satellite ne peut pas voir.';
const unknownPersonDiagnostic =
  'Personne non reconnue : seules les personnes du foyer ouvrent une conversation.';

/** The sole authority for session admission, identity and display ownership. */
export class SessionController {
  readonly bootId = randomUUID();
  private mobile: import('../shared/mobile.js').MobileMirror | null = null;
  mobileMirror() { return this.mobile; }
  setMobileMirror(value: import('../shared/mobile.js').MobileMirror | null) {
    if (this.mobile?.generation === value?.generation) return;
    this.reopenAfterClose = null;
    this.close('Changement de miroir.');
    this.mobile = value;
    this.observation = this.rawObservation = null;
    this.resetPresence();
    this.changeProfile(null, 'household', false);
    this.setBrowserAudioReady(false);
    this.publish();
  }
  setMobileBackground(background: boolean) {
    if (!this.mobile || this.mobile.background === background) return;
    this.mobile = { ...this.mobile, background };
    this.rawObservation = null;
    if (background) {
      this.silenceSince = this.now();
      if (this.session.phase !== 'ready') this.close('Miroir en arrière-plan.');
    }
    this.publish();
  }
  private sequence = 0;
  private publishedState = '';
  private listeners = new Set<(event: StateEvent) => void>();
  private session: SessionState = {
    phase: 'idle',
    reason: null,
    mode: 3,
    interactionId: null,
    profileEpoch: 0,
    contextVersion: 0,
    startedAt: null,
    readyAt: null,
    manualStop: false,
    microphoneEnabled: false,
    satellite: null,
  };
  private profile: Profile | null = null;
  private selection: MirrorState['selection'] = 'household';
  private cards: DisplayCard[] = [];
  private ambientProjection: ((state: MirrorState) => MirrorState['ambientDisplays']) | null = null;

  setAmbientProjection(project: (state: MirrorState) => MirrorState['ambientDisplays']): void {
    this.ambientProjection = project;
  }
  private voice: VoiceActivity = { phase: 'idle', startedAt: 0, endsAt: null };
  private setup: MirrorSetup = { openaiKey: false, perception: false };

  /**
   * Configuration du premier lancement (clé présente, service de perception connecté), diffusée
   * au miroir comme à l’administration pour qu’aucun écran ne se dise prêt à tort.
   */
  setSetup(patch: Partial<MirrorSetup>): void {
    const next = { ...this.setup, ...patch };
    if (next.openaiKey === this.setup.openaiKey && next.perception === this.setup.perception)
      return;
    this.setup = next;
    this.publish();
  }
  private webSearchActive = false;
  private imageActivity: ImageGenerationActivity | null = null;
  private observation: PerceptionObservation | null = null;
  private rawObservation: PerceptionObservation | null = null;
  private perceptionListeners = new Set<() => void>();
  subscribePerception(listener: () => void): () => void {
    this.perceptionListeners.add(listener);
    return () => this.perceptionListeners.delete(listener);
  }
  memoryObservedAt(): number | null {
    return this.rawObservation?.observedAt ?? null;
  }
  memoryProfileId(): string | null {
    if (this.mobile?.background) return null;
    // Satellite : le profil rattaché à sa pièce (choisi dans l’administration), ou personne.
    if (this.satelliteSession()) return this.profile?.id ?? null;
    const input = this.rawObservation;
    if (
      !input ||
      input.health !== 'ok' ||
      !input.presence ||
      this.now() - input.observedAt >= limits.sensorMs ||
      input.people.length !== 1 ||
      !this.profile ||
      input.people[0]!.profileId !== this.profile.id
    )
      return null;
    return this.profile.id;
  }
  private retiredProducers = new Set<string>();
  // Visage suivi qui porte le profil automatique, et dernière fois qu’il a été reconnu.
  private profileTrackId: string | null = null;
  private profileSeenAt: number | null = null;
  private cameraFaultSince: number | null = null;
  private crowdedFrames = 0;
  // Fin prévue de la dernière activité vocale (personne ou Cornelius) de la session.
  private voiceActiveUntil = 0;
  private presentSince: number | null = null;
  private presenceStable = false;
  private absenceSince: number | null = null;
  private engagedSince: number | null = null;
  private disengagedSince: number | null = null;
  private engagementId: string | null = null;
  private reengagementRequired = false;
  private consumedTrigger: string | null = null;
  private browserAudioReady = true;
  private browserSeenAt: number | null = null;
  private closingAt: number | null = null;
  private started = false;
  private controlReady = false;
  /** Réouverture demandée à la fin de la clôture en cours, et par quel chemin. */
  private reopenAfterClose: OpenSource | null = null;
  private diagnostic: string | null = null;
  private handledCalls = new Set<string>();
  private privacyMode = false;
  private wakeWordEnabled = false;
  private advancedAudioBuffer = false;
  private orbScale = 100;
  private speechVoice: LiveVoice = DEFAULT_LIVE_VOICE;
  private cardSettings: CardSettings = { ...DEFAULT_CARD_SETTINGS };
  private admissionSound: AdmissionSound = { ...DEFAULT_ADMISSION_SOUND };
  private webSearch = true;
  private greeting: GreetingMode = DEFAULT_GREETING_MODE;
  private knownPeopleOnly = false;
  private silenceClose: SilenceClose = { ...DEFAULT_SILENCE_CLOSE };
  private voiceRecognition = false;
  // Fin sur silence devant le miroir : seul un regard détourné puis revenu rouvre la conversation.
  private gazeBreakRequired = false;
  // Mode voix : fin de la fenêtre pendant laquelle la caméra peut rattacher un profil.
  private voiceIdentityUntil: number | null = null;
  /** Première image de la caméra reçue depuis l’ouverture : le délai de reconnaissance part d’elle. */
  private voiceIdentityCameraSeen = false;
  private delegationMode = DEFAULT_DELEGATION_MODE;
  private wakeWordReady = false;
  private wakeWordDetail: string | null = 'Modèle Cornelius indisponible.';
  private silenceSince: number | null = null;
  private userSpeaking = false;
  private assistantBusy = false;
  private assistantOutputUntil: number | null = null;
  private timings: PresenceTimings = { ...DEFAULT_PRESENCE_TIMINGS };
  private engagementAt: number | null = null;
  private measuredPresence: number | null = null;
  private startupPresenceAt: number | null = null;
  private startupEngagementAt: number | null = null;
  private startupWakeAt: number | null = null;

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly transport: SessionTransport,
    private readonly now: () => number = Date.now,
    private readonly preferences?: SessionPreferencesStore,
    private readonly measure?: (name: string, details: Record<string, unknown>) => void,
  ) {
    this.session.manualStop = preferences?.getManualStop() ?? false;
    this.session.mode = preferences?.getSessionMode?.() ?? 3;
    this.privacyMode = preferences?.getPrivacyMode?.() ?? false;
    this.wakeWordEnabled =
      this.session.mode === 4 || (preferences?.getWakeWordEnabled?.() ?? false);
    if (this.session.mode === 4) preferences?.setWakeWordEnabled?.(true);
    this.advancedAudioBuffer = preferences?.getAdvancedAudioBuffer?.() ?? false;
    this.orbScale = preferences?.getOrbScale?.() ?? 100;
    this.speechVoice = preferences?.getSpeechVoice?.() ?? DEFAULT_LIVE_VOICE;
    this.cardSettings = preferences?.getCardSettings?.() ?? { ...DEFAULT_CARD_SETTINGS };
    this.admissionSound = { ...(preferences?.getAdmissionSound?.() ?? DEFAULT_ADMISSION_SOUND) };
    this.webSearch = preferences?.getWebSearchEnabled?.() ?? true;
    this.greeting = preferences?.getGreetingMode?.() ?? DEFAULT_GREETING_MODE;
    this.knownPeopleOnly = preferences?.getKnownPeopleOnly?.() ?? false;
    this.silenceClose = { ...(preferences?.getSilenceClose?.() ?? DEFAULT_SILENCE_CLOSE) };
    this.voiceRecognition = preferences?.getVoiceRecognition?.() ?? false;
    this.delegationMode = preferences?.getDelegationMode?.() ?? DEFAULT_DELEGATION_MODE;
    this.timings = { ...(preferences?.getPresenceTimings?.() ?? DEFAULT_PRESENCE_TIMINGS) };
  }

  subscribe(listener: (event: StateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  scope(): Scope {
    return {
      interactionId: this.session.interactionId,
      profileEpoch: this.session.profileEpoch,
      contextVersion: this.session.contextVersion,
    };
  }

  private current(scope: Scope): boolean {
    return (
      scope.interactionId !== null &&
      scope.interactionId === this.session.interactionId &&
      scope.profileEpoch === this.session.profileEpoch &&
      scope.contextVersion === this.session.contextVersion
    );
  }

  private sensorHealthy(): boolean {
    return (
      !!this.observation &&
      this.observation.health === 'ok' &&
      this.now() - this.observation.observedAt < limits.sensorMs
    );
  }

  private browserHealthy(): boolean {
    return this.browserSeenAt !== null && this.now() - this.browserSeenAt < limits.browserMs;
  }

  /** Regard affiché : lissé sur le délai de confirmation pour ne pas clignoter à chaque image. */
  private isEngaged(): boolean {
    if (!this.sensorHealthy() || this.engagementId === null) return false;
    if (this.observation?.engaged) return true;
    return (
      this.disengagedSince !== null && this.now() - this.disengagedSince < this.timings.engagementMs
    );
  }

  private absenceDelay(): number {
    // Une occultation perd à la fois le visage et le regard. Pendant une conversation, dans
    // tous les modes caméra, le profil et le cycle tiennent au moins le délai de désengagement.
    return ['connecting', 'ready'].includes(this.session.phase)
      ? Math.max(this.timings.absenceMs, this.timings.disengagementMs)
      : this.timings.absenceMs;
  }

  private absenceExpired(now: number): boolean {
    return this.absenceSince !== null && now - this.absenceSince >= this.absenceDelay();
  }

  /** Lecture légère de la session pour les chemins fréquents (audio, événements Live). */
  sessionState(): Readonly<SessionState> {
    return this.session;
  }

  isOpenAIBlocked(): boolean {
    return this.preferences?.getOpenAIBlocked?.() ?? false;
  }

  isBrowserConnected(): boolean {
    return this.browserHealthy();
  }

  isAdvancedAudioBuffer(): boolean {
    return this.advancedAudioBuffer;
  }

  isWebSearchEnabled(): boolean {
    return this.webSearch;
  }

  greetingMode(): GreetingMode {
    return this.greeting;
  }

  isVoiceRecognitionEnabled(): boolean {
    return this.voiceRecognition;
  }

  wakeWordState(): MirrorState['wakeWord'] {
    return {
      enabled: this.wakeWordEnabled,
      ready: this.wakeWordReady,
      detail: this.wakeWordDetail,
    };
  }

  /** La veille écoute « Cornelius » : un arrêt manuel ne l’éteint pas, le mot le lève. */
  isWakeListening(): boolean {
    return (
      this.wakeWordEnabled && this.wakeWordReady && ['idle', 'blocked'].includes(this.session.phase)
    );
  }

  /** Santé caméra et cycle de regard tels que publiés, sans projection complète de l’état. */
  presenceScope(): { healthy: boolean; engagementId: string | null } {
    // Mode voix : la caméra n’est saine que pendant une conversation qui l’a allumée.
    const healthy = this.sensorHealthy();
    return { healthy, engagementId: healthy ? this.engagementId : null };
  }

  snapshot(): StateEvent {
    const now = this.now();
    const healthy = this.sensorHealthy();
    const voice = this.session.mode === 4;
    // Mode voix : aucune minuterie de présence ; l’image courante suffit à l’affichage.
    const engaged = voice ? healthy && this.observation!.engaged : this.isEngaged();
    const visibleCards = this.cards.filter((card) => card.expiresAt > now && this.current(card));
    const state: MirrorState = {
      setup: { ...this.setup },
      openaiBlocked: this.isOpenAIBlocked(),
      privacyMode: this.privacyMode,
      advancedAudioBuffer: this.advancedAudioBuffer,
      orbScale: this.orbScale,
      speechVoice: this.speechVoice,
      cardSettings: { ...this.cardSettings },
      admissionSound: { ...this.admissionSound },
      delegationMode: this.delegationMode,
      webSearchEnabled: this.webSearch,
      greeting: this.greeting,
      knownPeopleOnly: this.knownPeopleOnly,
      silenceClose: { ...this.silenceClose },
      voiceRecognition: this.voiceRecognition,
      opening: this.opening(),
      wakeWord: {
        enabled: this.wakeWordEnabled,
        ready: this.wakeWordReady,
        detail: this.wakeWordDetail,
      },
      browserConnected: this.browserHealthy(),
      browserAudioReady: this.browserHealthy() && this.browserAudioReady,
      session: { ...this.session },
      presence: {
        state:
          healthy &&
          (voice
            ? this.observation!.presence
            : this.presentSince !== null && now - this.presentSince >= this.timings.presenceMs)
            ? engaged
              ? 'engaged'
              : 'present'
            : 'absent',
        health: healthy ? 'ok' : 'unavailable',
        peopleCount: healthy ? this.observation!.people.length : 0,
        recognizedProfileIds: healthy
          ? [
              ...new Set(
                this.observation!.people.flatMap((person) =>
                  person.profileId ? [person.profileId] : [],
                ),
              ),
            ]
          : [],
        // L'engagement est global : on l'attribue à la personne active, sinon à l'unique personne.
        people: healthy
          ? this.observation!.people.map((person) => ({
              trackId: person.trackId,
              profileId: person.profileId,
              engaged:
                engaged &&
                (this.profile
                  ? person.profileId === this.profile.id
                  : this.observation!.people.length === 1),
            }))
          : [],
        engagementId: healthy ? this.engagementId : null,
        observedAt: this.observation?.observedAt ?? null,
      },
      activeProfile: this.profile,
      selection: this.selection,
      profiles: this.profiles.list(),
      mobileMirror: this.mobile ? { ...this.mobile } : null,
      cards: visibleCards,
      ambientDisplays: [],
      voice: this.voice,
      webSearchActive: this.webSearchActive,
      imageGeneration: this.imageActivity ? { ...this.imageActivity } : null,
      diagnostic: this.diagnostic,
    };
    state.ambientDisplays = this.ambientProjection?.(state) ?? [];
    return structuredClone({
      schemaVersion: 1,
      type: 'state',
      bootId: this.bootId,
      sequence: this.sequence,
      sentAt: now,
      ...this.scope(),
      state,
    });
  }

  publish(): void {
    const event = this.snapshot();
    // Sensor timestamps change on every observation, without changing the displayed state.
    const signature = JSON.stringify({
      ...event.state,
      presence: { ...event.state.presence, observedAt: null },
    });
    if (signature === this.publishedState) return;
    this.publishedState = signature;
    event.sequence = ++this.sequence;
    for (const listener of this.listeners) listener(event);
  }

  keepalive() {
    return {
      schemaVersion: 1,
      type: 'heartbeat',
      bootId: this.bootId,
      sequence: this.sequence,
      sentAt: this.now(),
    } as const;
  }

  heartbeat(): void {
    this.browserSeenAt = this.now();
  }

  setBrowserAudioReady(ready: boolean): void {
    if (this.browserAudioReady === ready) return;
    this.browserAudioReady = ready;
    if (!ready) this.close('Préparation du microphone sur le miroir.');
    else this.resumeAutomatic();
    this.publish();
  }

  /**
   * Rouvre la conversation en cours avec un contexte à jour (outils, profil, réglages). C’est
   * la même conversation : elle reprend même quand le mot d’appel est exigé.
   */
  restart(reason: string): void {
    if (!['connecting', 'ready'].includes(this.session.phase)) return;
    this.reopenAfterClose = 'resume';
    this.close(reason);
  }

  /** « Démarrer » ou « Cornelius » : une demande explicite lève l’arrêt manuel. */
  private clearManualStop(): void {
    this.preferences?.setManualStop(false);
    this.session.manualStop = false;
    this.reengagementRequired = false;
  }

  /** Réarme l’admission après un déblocage ou une préparation, sans annuler un arrêt manuel. */
  resumeAutomatic(): void {
    this.consumedTrigger = null;
    if (this.session.phase === 'closing') this.reopenAfterClose ??= 'automatic';
    else this.maybeOpen();
    this.publish();
  }

  observe(input: PerceptionObservation): boolean {
    if (this.mobile?.background) return true;
    const now = this.now();
    if (
      !validateObservation(input) ||
      input.observedAt > now + 100 ||
      now - input.observedAt >= limits.sensorMs ||
      this.retiredProducers.has(input.producerBootId)
    )
      return false;
    const previous = this.observation;
    if (previous?.producerBootId === input.producerBootId && input.sequence <= previous.sequence)
      return false;
    // Conversation dans une autre pièce : ce que voit la caméra du miroir ne la concerne pas.
    // La présence reprend avec les observations suivantes, une fois la conversation finie.
    if (this.satelliteSession()) return true;
    if (this.session.mode === 4) {
      this.observeVoiceMode(input, previous, now);
      return true;
    }
    this.rawObservation = structuredClone(input);
    for (const listener of this.perceptionListeners) listener();
    if (previous && previous.producerBootId !== input.producerBootId) {
      this.retiredProducers.add(previous.producerBootId);
      this.resetPresence();
      this.close('Perception redémarrée.');
      this.changeProfile(null, 'household', false);
    }
    if (input.health !== 'ok') {
      this.cameraFaultSince ??= now;
      if (
        previous?.health === 'ok' &&
        previous.producerBootId === input.producerBootId &&
        now - this.cameraFaultSince < limits.cameraFaultMs
      ) {
        // Une lecture caméra ratée isolée ne retire ni la présence ni la conversation.
        this.observation = { ...previous, sequence: input.sequence };
        return true;
      }
      this.observation = structuredClone(input);
      this.resetPresence();
      this.close('Caméra indisponible.');
      this.changeProfile(null, 'household', false);
      this.publish();
      return true;
    }
    this.cameraFaultSince = null;
    // Une image sans détection ne doit pas éteindre l'orbe : on garde la dernière
    // observation complète pendant une courte grâce avant d'annoncer l'absence.
    if (input.presence) this.absenceSince = null;
    else if (previous?.presence || this.absenceSince !== null) this.absenceSince ??= now;
    else this.absenceSince = null;
    if (
      input.presence &&
      this.presentSince !== null &&
      now - this.presentSince >= this.timings.presenceMs
    )
      this.presenceStable = true;
    const held =
      this.presenceStable &&
      !input.presence &&
      previous !== null &&
      this.absenceSince !== null &&
      now - this.absenceSince < this.absenceDelay();
    this.observation = held
      ? {
          ...structuredClone(input),
          presence: true,
          engaged: previous!.engaged,
          people: previous!.people,
        }
      : structuredClone(input);
    if (this.observation.presence) this.presentSince ??= now;
    else {
      this.presentSince = null;
      this.presenceStable = false;
    }
    const stable = this.presentSince !== null && now - this.presentSince >= this.timings.presenceMs;
    // Le regard suit le signal réel ; le départ utilise son propre délai.
    if (input.presence && input.engaged && input.people.length > 0) {
      this.disengagedSince = null;
      // Après une fin sur silence, le regard qui n’a pas quitté le miroir ne compte pas.
      if (!this.gazeBreakRequired) {
        this.engagedSince ??= now;
        if (stable && now - this.engagedSince >= this.timings.engagementMs) {
          this.engagementId ??= randomUUID();
          this.engagementAt ??= now;
        }
      }
    } else {
      this.disengagedSince ??= now;
      // Une image isolée sans regard (clignement, flou) ne relance pas la confirmation.
      if (now - this.disengagedSince >= limits.gazeFlickerMs) {
        this.engagedSince = null;
        this.gazeBreakRequired = false;
      }
    }
    const people = this.observation.people;
    // Mode vie privée : une deuxième personne confirmée ferme la session immédiatement.
    this.crowdedFrames = this.privacyMode && people.length > 1 ? this.crowdedFrames + 1 : 0;
    if (
      this.crowdedFrames >= privacyConfirmFrames &&
      ['connecting', 'ready', 'closing'].includes(this.session.phase)
    ) {
      this.resetPresence();
      this.close('Mode vie privée : plusieurs personnes.');
    }
    if (this.absenceExpired(now)) this.departure();
    else if (this.selection !== 'explicit') this.selectProfile(people, stable, now);
    if (
      input.people.length > 0 &&
      this.session.phase === 'idle' &&
      !this.session.manualStop &&
      this.browserHealthy() &&
      this.browserAudioReady
    )
      this.transport.prewarm?.();
    this.maybeOpen();
    this.publish();
    return true;
  }

  /**
   * Mode voix : la caméra, allumée seulement pendant la conversation, sert la vision, la mémoire
   * et la reconnaissance au mot d’appel. Elle n’ouvre ni ne ferme jamais la conversation.
   */
  private observeVoiceMode(
    input: PerceptionObservation,
    previous: PerceptionObservation | null,
    now: number,
  ): void {
    if (previous && previous.producerBootId !== input.producerBootId) {
      // Chaque conversation rallume la caméra : les images d’avant ne reviennent jamais.
      this.retiredProducers.add(previous.producerBootId);
      if (this.retiredProducers.size > 64)
        this.retiredProducers.delete(this.retiredProducers.values().next().value!);
    }
    this.rawObservation = structuredClone(input);
    this.observation = structuredClone(input);
    for (const listener of this.perceptionListeners) listener();
    const running = ['connecting', 'ready'].includes(this.session.phase);
    const people = input.health === 'ok' ? input.people : [];
    // La caméra s’allume avec la conversation et met une à plusieurs secondes à démarrer :
    // le délai pour reconnaître la personne compte à partir de sa première image.
    if (
      running &&
      input.health === 'ok' &&
      this.voiceIdentityUntil !== null &&
      !this.voiceIdentityCameraSeen
    ) {
      this.voiceIdentityCameraSeen = true;
      this.voiceIdentityUntil = Math.max(this.voiceIdentityUntil, now + voiceIdentityWindowMs);
    }
    // Vie privée : une conversation rattachée à une personne se ferme devant plusieurs personnes.
    this.crowdedFrames =
      this.privacyMode && running && this.profile !== null && people.length > 1
        ? this.crowdedFrames + 1
        : 0;
    if (this.crowdedFrames >= privacyConfirmFrames) {
      this.crowdedFrames = 0;
      this.close('Mode vie privée : plusieurs personnes.');
    } else if (
      this.voiceRecognition &&
      running &&
      this.profile === null &&
      this.selection !== 'explicit' &&
      this.voiceIdentityUntil !== null &&
      now <= this.voiceIdentityUntil &&
      people.length === 1 &&
      people[0]!.profileId !== null
    ) {
      // Une seule personne, reconnue : ses sources, sa mémoire et ses agents rejoignent la session.
      const profile = this.profiles.get(people[0]!.profileId);
      if (profile) {
        this.voiceIdentityUntil = null;
        this.changeProfile(profile, 'automatic');
      }
    }
    this.publish();
  }

  /** Profil automatique : la personne reconnue, en tolérant un nouveau suivi du même visage. */
  private selectProfile(
    people: PerceptionObservation['people'],
    stable: boolean,
    now: number,
  ): void {
    const active = this.profile
      ? people.find((person) => person.profileId === this.profile!.id)
      : undefined;
    if (active) {
      // La première personne reconnue garde son profil, même si une deuxième apparaît.
      this.profileTrackId = active.trackId;
      this.profileSeenAt = now;
      return;
    }
    if (
      people.length === 0 ||
      // Le visage suivi a été perdu et un visage encore inconnu apparaît : la reconnaissance
      // a le délai de départ pour le confirmer avant que le profil soit retiré. Le même
      // suivi sans identité signifie au contraire une contradiction ou un maintien expiré.
      (this.profile !== null &&
        this.profileSeenAt !== null &&
        now - this.profileSeenAt < this.timings.absenceMs &&
        people.every(
          (person) => person.profileId === null && person.trackId !== this.profileTrackId,
        ))
    )
      return;
    if (people.length > 1) {
      this.changeProfile(null, 'household');
      return;
    }
    if (!stable) return;
    const person = people[0]!;
    const profile = person.profileId ? this.profiles.get(person.profileId) : null;
    this.changeProfile(profile, profile ? 'automatic' : 'household');
    if (profile) {
      this.profileTrackId = person.trackId;
      this.profileSeenAt = now;
    }
  }

  /** Départ confirmé : retire la présence et le profil, et ferme tous les modes caméra. */
  private departure(): void {
    if (this.rawObservation && !this.rawObservation.presence)
      this.observation = structuredClone(this.rawObservation);
    if (this.diagnostic === unknownPersonDiagnostic) this.diagnostic = null;
    this.resetPresence();
    this.close('Fin de présence.');
    this.changeProfile(null, 'household', false);
  }

  private resetPresence(): void {
    this.presentSince = null;
    this.presenceStable = false;
    this.measuredPresence = null;
    this.absenceSince = null;
    this.engagedSince = null;
    this.disengagedSince = null;
    this.engagementId = null;
    this.engagementAt = null;
    this.reengagementRequired = false;
    this.gazeBreakRequired = false;
    this.consumedTrigger = null;
    this.crowdedFrames = 0;
  }

  command(command: MirrorCommand): void {
    switch (command.type) {
      case 'start':
        if (['connecting', 'ready'].includes(this.session.phase)) break;
        this.clearManualStop();
        this.consumedTrigger = null;
        if (this.session.phase === 'closing') this.reopenAfterClose = 'manual';
        else this.maybeOpen('manual');
        break;
      case 'stop':
        this.session.manualStop = true;
        this.reopenAfterClose = null;
        this.close('Arrêt manuel.');
        this.preferences?.setManualStop(true);
        break;
      case 'select_profile': {
        const profile = command.profileId ? this.profiles.get(command.profileId) : null;
        if (command.profileId && !profile) throw new Error('Profil introuvable.');

        this.changeProfile(profile, 'explicit');
        this.maybeOpen();
        break;
      }
      case 'dismiss_card':
        this.cards = this.cards.filter((card) => card.id !== command.cardId);
        break;
    }
    this.publish();
  }

  private changeProfile(
    profile: Profile | null,
    selection: MirrorState['selection'],
    restart = true,
  ): void {
    this.selection = selection;
    if (this.profile?.id === profile?.id) return;
    this.profileTrackId = null;
    this.profileSeenAt = null;
    const running = ['connecting', 'ready', 'closing'].includes(this.session.phase);
    // Modes 1 et 4 : la session anonyme reste ouverte, on y ajoute les informations personnelles.
    const softIdentify =
      (this.session.mode === 1 || this.session.mode === 4) &&
      ['connecting', 'ready'].includes(this.session.phase) &&
      this.profile === null &&
      profile !== null &&
      selection === 'automatic';
    this.profile = profile;
    this.cards = [];
    if (softIdentify) {
      this.transport.identify?.(this.scope());
      return;
    }
    this.session.profileEpoch++;
    this.session.contextVersion++;
    if (running && restart) {
      // Une autre personne : la réouverture suit les règles d’ouverture, comme une arrivée.
      this.reopenAfterClose = 'automatic';
      this.close('Changement de profil.');
    }
  }

  agentsChanged(profileId: string): void {
    this.profileContextChanged(profileId, 'Connexion à l’agent modifiée.');
  }

  homeAssistantChanged(): void {
    this.profileContextChanged(null, 'Autorisations Home Assistant modifiées.');
  }

  personalContextChanged(profileId: string): void {
    this.profileContextChanged(profileId, 'Contexte personnel modifié.');
  }

  personalityChanged(profileId: string | null): void {
    this.profileContextChanged(profileId, 'Personnalisation de Cornelius modifiée.');
  }

  memoryChanged(profileId: string): void {
    this.profileContextChanged(profileId, 'Mémoire personnelle modifiée.');
  }

  private profileContextChanged(profileId: string | null, reason: string): void {
    if (profileId !== null && profileId !== this.profile?.id) return;
    this.session.contextVersion++;
    this.restart(reason);
    this.publish();
  }

  profilesChanged(): void {
    if (this.profile) {
      const current = this.profiles.get(this.profile.id);
      if (!current) this.changeProfile(null, 'household');
      else if (current.name !== this.profile.name) {
        this.profile = current;
        this.session.contextVersion++;
        this.cards = [];
        this.restart('Profil modifié.');
      }
    }
    this.publish();
  }

  getPresenceTimings(): PresenceTimings {
    return { ...this.timings };
  }

  setPresenceTimings(settings: PresenceTimings): void {
    if (!isPresenceTimings(settings)) throw new Error('Délais de présence invalides.');
    this.preferences?.setPresenceTimings?.(settings);
    this.timings = { ...settings };
    this.tick();
  }
  setPrivacyMode(enabled: boolean): void {
    this.privacyMode = enabled;
    this.preferences?.setPrivacyMode?.(enabled);
    // La vie privée s'applique tout de suite : une deuxième personne ferme la session.
    if (enabled && (this.observation?.people.length ?? 0) > 1)
      this.close('Mode vie privée : plusieurs personnes.');
    this.publish();
  }

  setSessionMode(mode: SessionMode): void {
    if (this.session.mode === mode) return;
    if (this.session.mode === 4 && mode !== 4) {
      // Les images d’une conversation vocale ne prolongent pas une présence en mode caméra.
      this.observation = null;
      this.rawObservation = null;
      this.voiceIdentityUntil = null;
    }
    this.session = { ...this.session, mode };
    this.preferences?.setSessionMode?.(mode);
    if (mode === 4) {
      if (!this.wakeWordEnabled) this.preferences?.setWakeWordEnabled?.(true);
      this.wakeWordEnabled = true;
      this.profile = null;
      this.selection = 'household';
      this.cards = [];
      this.session = {
        ...this.session,
        profileEpoch: this.session.profileEpoch + 1,
        contextVersion: this.session.contextVersion + 1,
      };
      this.observation = null;
      this.rawObservation = null;
      this.resetPresence();
    }
    this.reengagementRequired = false;
    this.consumedTrigger = null;
    if (['connecting', 'ready', 'closing'].includes(this.session.phase)) {
      this.reopenAfterClose = null;
      this.close('Mode de session modifié.');
    }
    this.publish();
  }

  setWakeWordEnabled(enabled: boolean): void {
    if (this.session.mode === 4 && !enabled) return;
    if (this.wakeWordEnabled === enabled) return;
    this.preferences?.setWakeWordEnabled?.(enabled);
    this.wakeWordEnabled = enabled;
    this.consumedTrigger = null;
    if (['connecting', 'ready', 'closing'].includes(this.session.phase)) {
      this.reopenAfterClose = null;
      this.close('Réglage du mot d’appel modifié.');
    } else this.maybeOpen();
    this.publish();
  }

  /** Module « Cartes » : s’applique aussitôt aux cartes affichées. */
  setCardSettings(settings: CardSettings): void {
    this.preferences?.setCardSettings?.(settings);
    this.cardSettings = { ...settings };
    this.cards = this.cards.slice(0, settings.maxCards);
    // Les cartes visibles prennent la nouvelle durée, comptée depuis leur apparition.
    for (const card of this.cards) card.expiresAt = card.createdAt + settings.lifetimeMs;
    this.publish();
  }

  /** Voix de la prochaine conversation : celle en cours garde la sienne (fixée à l’ouverture). */
  setSpeechVoice(voice: LiveVoice): void {
    if (this.speechVoice === voice) return;
    this.preferences?.setSpeechVoice?.(voice);
    this.speechVoice = voice;
    this.publish();
  }
  getSpeechVoice(): LiveVoice {
    return this.speechVoice;
  }

  setOrbScale(scale: number): void {
    if (this.orbScale === scale) return;
    this.preferences?.setOrbScale?.(scale);
    this.orbScale = scale;
    this.publish();
  }

  setAdvancedAudioBuffer(enabled: boolean): void {
    if (this.advancedAudioBuffer === enabled) return;
    this.preferences?.setAdvancedAudioBuffer?.(enabled);
    this.advancedAudioBuffer = enabled;
    this.publish();
  }

  setAdmissionSound(settings: AdmissionSound): void {
    if (!isAdmissionSound(settings)) throw new Error('Son d’ouverture invalide.');
    this.preferences?.setAdmissionSound?.(settings);
    this.admissionSound = { ...settings };
    this.publish();
  }

  /** Module « Web » : l’outil natif de la délégation est retiré ou rendu à la session suivante. */
  setWebSearchEnabled(enabled: boolean): void {
    if (this.webSearch === enabled) return;
    this.preferences?.setWebSearchEnabled?.(enabled);
    this.webSearch = enabled;
    // Les outils d’une session Live sont fixés à sa création : la rouvrir avec la nouvelle liste.
    this.session.contextVersion++;
    this.restart('Recherche web modifiée.');
    this.publish();
  }

  setGreetingMode(mode: GreetingMode): void {
    if (!isGreetingMode(mode)) throw new Error('Accueil invalide.');
    if (this.greeting === mode) return;
    this.preferences?.setGreetingMode?.(mode);
    this.greeting = mode;
    this.publish();
  }

  setKnownPeopleOnly(enabled: boolean): void {
    if (this.knownPeopleOnly === enabled) return;
    this.preferences?.setKnownPeopleOnly?.(enabled);
    this.knownPeopleOnly = enabled;
    this.consumedTrigger = null;
    if (this.diagnostic === unknownPersonDiagnostic) this.diagnostic = null;
    if (
      enabled &&
      this.session.mode !== 4 &&
      ['connecting', 'ready'].includes(this.session.phase) &&
      !this.knownPersonPresent()
    ) {
      this.reopenAfterClose = null;
      this.close('Ouverture réservée aux personnes reconnues.');
    } else this.maybeOpen();
    this.publish();
  }

  setSilenceClose(settings: SilenceClose): void {
    if (!isSilenceClose(settings)) throw new Error('Fermeture après silence invalide.');
    this.preferences?.setSilenceClose?.(settings);
    this.silenceClose = { ...settings };
    // Une conversation déjà prête démarre sa minuterie dès l’activation.
    if (
      settings.enabled &&
      this.session.phase === 'ready' &&
      this.silenceSince === null &&
      !this.userSpeaking &&
      !this.assistantBusy &&
      this.assistantOutputUntil === null
    )
      this.silenceSince = this.now();
    this.publish();
  }

  /**
   * Applique l’ouverture choisie (déclencheur et public) en une fois. L’ordre évite une
   * ouverture intermédiaire : le public est fixé avant que le mot d’appel ne soit retiré.
   */
  setOpening(opening: Opening): void {
    const target = settingsForOpening(opening);
    this.setSessionMode(target.mode);
    this.setKnownPeopleOnly(target.knownPeopleOnly);
    this.setVoiceRecognition(target.voiceRecognition);
    this.setWakeWordEnabled(target.wakeWord);
  }

  opening(): Opening {
    return openingFromSettings({
      mode: this.session.mode,
      knownPeopleOnly: this.knownPeopleOnly,
      wakeWord: this.wakeWordEnabled,
      voiceRecognition: this.voiceRecognition,
    });
  }

  setVoiceRecognition(enabled: boolean): void {
    if (this.voiceRecognition === enabled) return;
    this.preferences?.setVoiceRecognition?.(enabled);
    this.voiceRecognition = enabled;
    this.publish();
  }

  /** Une personne reconnue est devant le miroir et un profil est actif. */
  private knownPersonPresent(): boolean {
    return (
      this.profile !== null &&
      !!this.observation?.people.some((person) => person.profileId !== null)
    );
  }

  setDelegationMode(mode: DelegationMode): void {
    if (!isDelegationMode(mode)) throw new Error('Mode de délégation invalide.');
    if (this.delegationMode === mode) return;
    this.preferences?.setDelegationMode?.(mode);
    this.delegationMode = mode;
    // Live cannot change the delegated model in place. Retire old tool results too.
    this.session.contextVersion++;
    if (['connecting', 'ready', 'closing'].includes(this.session.phase)) {
      this.reopenAfterClose = null;
      this.close('Mode de délégation modifié.');
    }
    this.publish();
  }

  setWakeWordAvailability(ready: boolean, detail: string | null): void {
    if (this.wakeWordReady === ready && this.wakeWordDetail === detail) return;
    this.wakeWordReady = ready;
    this.wakeWordDetail = detail;
    this.publish();
  }

  wakeDetected(onAccepted?: () => void): boolean {
    if (!this.wakeWordEnabled || !this.wakeWordReady) return false;
    // Dire « Cornelius » est une demande explicite, comme « Démarrer » : elle lève l’arrêt
    // manuel. Sans cela, un arrêt depuis l’administration rendait le mot d’appel muet pour de
    // bon, y compris après redémarrage, sans aucun signe sur le miroir.
    if (this.session.manualStop && !['connecting', 'ready'].includes(this.session.phase))
      this.clearManualStop();
    const before = this.session.interactionId;
    const previousWakeAt = this.startupWakeAt;
    this.startupWakeAt = this.now();
    this.maybeOpen('wake');
    const accepted = this.session.phase === 'connecting' && this.session.interactionId !== before;
    if (accepted) {
      try {
        onAccepted?.();
      } catch {
        // A lost browser notification must not block the accepted session.
      }
    } else this.startupWakeAt = previousWakeAt;
    this.publish();
    return accepted;
  }

  /**
   * « Cornelius » entendu par un satellite : la conversation s’ouvre dans sa pièce, sans
   * navigateur ni caméra, au nom du profil rattaché au satellite, ou anonyme. Faux si une
   * conversation est déjà en cours, ou si l’ouverture est réservée aux membres du foyer et que
   * le satellite n’est rattaché à personne (il ne voit personne).
   */
  satelliteWake(satellite: { id: string; name: string; profileId?: string | null }): boolean {
    if (!this.isWakeListening()) return false;
    const profile = satellite.profileId ? this.profiles.get(satellite.profileId) : null;
    if ((this.session.mode === 2 || this.knownPeopleOnly) && !profile) {
      this.diagnostic = satelliteMembersDiagnostic;
      this.publish();
      return false;
    }
    if (this.session.manualStop) this.clearManualStop();
    const unavailable = this.transport.unavailableReason?.();
    if (unavailable) {
      this.session.phase = 'blocked';
      this.session.reason = unavailable;
      this.publish();
      return false;
    }
    if (this.diagnostic === satelliteMembersDiagnostic) this.diagnostic = null;
    this.startupWakeAt = this.now();
    this.changeProfile(profile, profile ? 'explicit' : 'household', false);
    this.admit('satellite', 'satellite:' + satellite.id, {
      id: satellite.id,
      name: satellite.name,
    });
    this.publish();
    return this.session.phase === 'connecting';
  }

  /** Le satellite de la conversation s’est déconnecté : elle s’arrête avec lui. */
  satelliteGone(id: string): void {
    if (this.session.satellite?.id !== id) return;
    this.close('Satellite déconnecté.');
    this.publish();
  }

  private satelliteSession(): boolean {
    return (
      !!this.session.satellite && ['connecting', 'ready', 'closing'].includes(this.session.phase)
    );
  }

  /** Clé du cycle d'ouverture propre au mode, pour ne pas rouvrir en boucle devant la même personne. */
  private triggerKey(source: OpenSource = 'automatic'): string | null {
    // Sans caméra en veille, seule une demande explicite (mot d’appel, bouton, reprise) ouvre.
    if (this.session.mode === 4)
      return source === 'automatic' ? null : source === 'wake' ? 'wakeword' : source;
    if (!this.sensorHealthy() || !this.observation?.presence) return null;
    if (this.observation.people.length === 0) return null;
    if (this.reengagementRequired && this.engagementId === null) return null;
    // Option « personnes reconnues » : un inconnu ne déclenche rien (le mode 2 l’exige déjà).
    if (this.knownPeopleOnly && !this.knownPersonPresent()) return null;
    if (this.session.mode === 1)
      return this.presentSince === null || this.now() - this.presentSince < this.timings.presenceMs
        ? null
        : `presence:${this.presentSince}`;
    if (this.session.mode === 2)
      return this.profile === null ||
        this.presentSince === null ||
        this.now() - this.presentSince < this.timings.presenceMs
        ? null
        : `identified:${this.profile.id}:${this.presentSince}`;
    return this.engagementId === null ? null : `engaged:${this.engagementId}`;
  }

  private maybeOpen(source: OpenSource = 'automatic'): void {
    if (this.mobile?.background) return;
    if (['connecting', 'ready', 'closing'].includes(this.session.phase) || this.session.manualStop)
      return;
    // Le mot d’appel est exigé (toujours vrai sans caméra en veille) : la présence seule n’ouvre pas.
    if (this.wakeWordEnabled && source === 'automatic') return;
    // La voix seule ne dispose pas d'une observation vidéo pour compter les personnes.
    if (this.session.mode !== 4 && this.privacyMode && (this.observation?.people.length ?? 0) > 1) {
      this.diagnostic = 'Mode vie privée : plusieurs personnes détectées.';
      return;
    }
    const trigger = this.triggerKey(source);
    if (
      this.knownPeopleOnly &&
      this.session.mode !== 4 &&
      this.sensorHealthy() &&
      (this.observation?.people.length ?? 0) > 0
    ) {
      if (!this.knownPersonPresent()) this.diagnostic = unknownPersonDiagnostic;
      else if (this.diagnostic === unknownPersonDiagnostic) this.diagnostic = null;
    }
    if (trigger === null || (source === 'automatic' && this.consumedTrigger === trigger)) return;
    if (!this.browserHealthy()) {
      this.diagnostic = 'Ouvrez le miroir pour démarrer une session.';
      return;
    }
    if (!this.browserAudioReady) {
      this.diagnostic = 'Activez la voix sur le miroir pour autoriser le microphone et le son.';
      return;
    }
    const unavailable = this.transport.unavailableReason?.();
    if (unavailable) {
      this.session.phase = 'blocked';
      this.session.reason = unavailable;
      return;
    }
    this.admit(source, trigger);
  }

  /** Ouvre la conversation : nouvelle interaction, transport ouvert (miroir ou satellite). */
  private admit(
    source: OpenSource,
    trigger: string,
    satellite: { id: string; name: string } | null = null,
  ): void {
    const id = randomUUID();
    if (source !== 'wake' && source !== 'satellite') this.startupWakeAt = null;
    // Only the first admission in this presence cycle measures detection latency.
    // A manual restart or profile change must not reuse an old detection timestamp.
    // Un satellite ne dépend pas de la présence devant le miroir : son cycle reste intact.
    this.startupPresenceAt =
      !satellite && this.measuredPresence !== this.presentSince ? this.presentSince : null;
    this.startupEngagementAt = this.startupPresenceAt !== null ? this.engagementAt : null;
    if (!satellite) {
      this.measuredPresence = this.presentSince;
      this.consumedTrigger = trigger;
      this.reengagementRequired = false;
    }
    if (this.startupPresenceAt !== null)
      this.measure?.('detection_admission', {
        durationMs: this.now() - this.startupPresenceAt,
        interactionId: id,
        mode: this.session.mode,
      });
    this.diagnostic = null;
    this.handledCalls.clear();
    this.webSearchActive = false;
    this.measure?.('ouverture', {
      interactionId: id,
      mode: this.session.mode,
      source,
      trigger,
      peopleCount: this.observation?.people.length ?? 0,
      recognized: this.observation?.people.filter((person) => person.profileId).length ?? 0,
      selection: this.selection,
      profileId: this.profile?.id ?? null,
      ...(satellite ? { satellite: satellite.name } : {}),
    });
    this.session = {
      ...this.session,
      phase: 'connecting',
      reason: null,
      interactionId: id,
      startedAt: this.now(),
      readyAt: null,
      microphoneEnabled: false,
      contextVersion: this.session.contextVersion + 1,
      satellite,
    };
    this.started = false;
    this.controlReady = false;
    this.voiceActiveUntil = 0;
    this.resetSilence();
    // Mode voix : la caméra s’allume avec la conversation et peut reconnaître la personne.
    this.voiceIdentityUntil =
      this.session.mode === 4 && this.voiceRecognition && !satellite
        ? this.now() + voiceIdentityWindowMs
        : null;
    this.voiceIdentityCameraSeen = false;
    try {
      this.transport.open(this.scope());
    } catch {
      this.close('Connexion indisponible.');
    }
  }

  sessionStarted(scope: Scope): void {
    if (!this.current(scope) || this.session.phase !== 'connecting') return;
    this.started = true;
    this.markReady();
  }

  controlAttached(scope: Scope): void {
    if (!this.current(scope) || this.session.phase !== 'connecting') return;
    this.controlReady = true;
    this.markReady();
  }

  private markReady(): void {
    // A callback may arrive after a deadline but before the scheduled watchdog.
    this.tick();
    if (this.session.phase !== 'connecting') return;
    if (this.started && this.controlReady) {
      this.session.phase = 'ready';
      this.session.readyAt = this.now();
      this.session.microphoneEnabled = true;
      if (this.silenceTracking()) this.silenceSince = this.session.readyAt;
      const details = { interactionId: this.session.interactionId, mode: this.session.mode };
      this.measure?.('admission_pret', {
        ...details,
        durationMs: this.session.readyAt - this.session.startedAt!,
      });
      if (this.startupWakeAt !== null)
        this.measure?.('wake_pret', {
          ...details,
          durationMs: this.session.readyAt - this.startupWakeAt,
        });
      this.startupWakeAt = null;
      if (this.startupPresenceAt !== null)
        this.measure?.('detection_pret', {
          ...details,
          durationMs: this.session.readyAt - this.startupPresenceAt,
        });
      if (this.startupEngagementAt !== null)
        this.measure?.('engagement_pret', {
          ...details,
          durationMs: this.session.readyAt - this.startupEngagementAt,
        });
    }
    this.publish();
  }

  private resetSilence(): void {
    this.silenceSince = null;
    this.userSpeaking = false;
    this.assistantBusy = false;
    this.assistantOutputUntil = null;
  }

  close(reason: string): void {
    this.resetSilence();
    if (this.voice.phase !== 'idle')
      this.voice = { phase: 'idle', startedAt: this.now(), endsAt: null };
    this.cards = [];
    this.webSearchActive = false;
    this.session.microphoneEnabled = false;
    if (!['connecting', 'ready'].includes(this.session.phase)) return;
    this.session.phase = 'closing';
    this.session.reason = reason;
    this.closingAt = this.now();
    try {
      this.transport.close(this.session.interactionId!);
    } catch {
      /* The close watchdog releases the local session if acknowledgement is lost. */
    }
  }

  sessionClosed(interactionId: string): void {
    if (interactionId !== this.session.interactionId) return;
    const seconds = Math.ceil((this.now() - (this.session.startedAt ?? this.now())) / 1000);
    this.measure?.('cloture', {
      seconds,
      reason: this.session.reason,
      interactionId,
    });
    this.release();
    this.publish();
  }

  /** Retour au repos après la clôture confirmée ou abandonnée ; relance si elle était demandée. */
  private release(reason?: string): void {
    const released = this.session.satellite;
    this.voice = { phase: 'idle', startedAt: this.now(), endsAt: null };
    this.resetSilence();
    this.session = {
      ...this.session,
      phase: 'idle',
      ...(reason ? { reason } : {}),
      interactionId: null,
      startedAt: null,
      readyAt: null,
      microphoneEnabled: false,
      satellite: null,
    };
    this.cards = [];
    this.webSearchActive = false;
    this.closingAt = null;
    this.voiceIdentityUntil = null;
    // Une conversation de satellite ne se rouvre pas d’elle-même : « Cornelius » suffit.
    const reopen = released ? null : this.reopenAfterClose;
    this.reopenAfterClose = null;
    // Mode voix : sans caméra en veille, rien ne prouve que la personne est encore là, sauf
    // quand la même conversation reprend avec un contexte à jour.
    // Le profil d’un satellite rattaché ne vaut que pour sa conversation.
    if (
      released ||
      (this.session.mode === 4 && this.selection === 'automatic' && reopen !== 'resume')
    )
      this.changeProfile(null, 'household', false);
    if (reopen) {
      this.consumedTrigger = null;
      this.maybeOpen(reopen);
    }
  }

  /** Image en cours de création, signalée par un encart sur le miroir (pas une carte). */
  setImageActivity(activity: ImageGenerationActivity | null): void {
    this.imageActivity = activity ? { ...activity } : null;
    this.publish();
  }

  setWebSearchActive(scope: Scope, active: boolean): boolean {
    if (!this.current(scope) || this.webSearchActive === active) return false;
    this.webSearchActive = active;
    this.publish();
    return true;
  }

  showCard(
    scope: Scope,
    callId: string,
    content: unknown,
    validUntil: number,
    replace = false,
  ): boolean {
    if (!validators.lunaCard(content)) {
      this.diagnostic = 'Résultat refusé : périmé, déjà traité ou hors du profil actif.';
      this.publish();
      return false;
    }
    return this.pushCard(scope, callId, content, validUntil, replace);
  }

  showImageCard(scope: Scope, callId: string, content: unknown, validUntil: number): boolean {
    if (!validators.imageCard(content)) {
      this.diagnostic = 'Résultat refusé : image générée invalide.';
      this.publish();
      return false;
    }
    return this.pushCard(scope, callId, content, validUntil, false, []);
  }

  /** Une illustration est liée à la carte principale qui l’a déclenchée. */
  showIllustrationCard(
    scope: Scope,
    callId: string,
    sourceCardId: string,
    content: unknown,
    validUntil: number,
  ): boolean {
    if (!validators.imageCard(content)) return false;
    return this.pushCard(scope, callId, content, validUntil, false, [], undefined, sourceCardId);
  }

  holdCardForIllustration(scope: Scope, cardId: string, until: number): number | null {
    if (!this.current(scope) || this.session.phase !== 'ready' || !Number.isFinite(until))
      return null;
    const card = this.cards[0];
    if (!card || card.id !== cardId || card.expiresAt <= this.now()) return null;
    const originalExpiry = card.expiresAt;
    card.expiresAt = Math.max(card.expiresAt, until);
    this.publish();
    return originalExpiry;
  }

  releaseCardIllustration(scope: Scope, cardId: string, originalExpiry: number, shown: boolean) {
    if (!this.current(scope)) return;
    const card = this.cards.find((entry) => entry.id === cardId);
    if (!card) return;
    card.expiresAt = shown
      ? Math.max(originalExpiry, this.now() + this.cardSettings.lifetimeMs)
      : originalExpiry;
    this.publish();
  }

  /** Retire une carte de la conversation en cours (doublon d’une carte de module). */
  removeCard(scope: Scope, cardId: string): boolean {
    if (!this.current(scope)) return false;
    const remaining = this.cards.filter((card) => card.id !== cardId);
    if (remaining.length === this.cards.length) return false;
    this.cards = remaining;
    this.publish();
    return true;
  }

  /** Citations OpenAI, rattachées uniquement à la carte de cette délégation. */
  setCardWebSources(scope: Scope, cardId: string, sources: DisplayCard['sources']): void {
    if (!this.current(scope) || this.session.phase !== 'ready') return;
    const card = this.cards.find((entry) => entry.id === cardId && entry.expiresAt > this.now());
    if (!card || !this.current(card)) return;
    card.sources = [...card.sources.filter((source) => !source.url), ...sources];
    this.publish();
  }

  /** Carte spécialisée remplie depuis un snapshot : la nouvelle carte remplace la même source. */
  showModuleCard(
    scope: Scope,
    callId: string,
    content: unknown,
    validUntil: number,
    sourceTitles: Record<string, string> = {},
  ): boolean {
    if (!validators.moduleCard(content)) {
      this.diagnostic = 'Résultat refusé : carte de module invalide.';
      this.publish();
      return false;
    }
    const key = `${content.addonId}::${content.instanceRef ?? ''}`;
    return this.pushCard(
      scope,
      callId,
      content,
      validUntil,
      false,
      content.sources.map((id) => ({ id, title: sourceTitles[id] ?? id })),
      (card) =>
        card.content.cardType === 'module' &&
        `${card.content.addonId}::${card.content.instanceRef ?? ''}` === key,
    );
  }

  private pushCard(
    scope: Scope,
    callId: string,
    content: unknown,
    validUntil: number,
    replace: boolean,
    sources?: { id: string; title: string }[],
    supersedes?: (card: DisplayCard) => boolean,
    afterCardId?: string,
  ): boolean {
    const contentSources =
      content !== null &&
      typeof content === 'object' &&
      'sources' in content &&
      Array.isArray((content as { sources?: unknown }).sources)
        ? ((content as { sources: string[] }).sources ?? [])
        : [];
    if (
      !this.current(scope) ||
      // Voix seule : la conversation d’un satellite n’affiche rien sur le miroir.
      this.session.satellite ||
      this.session.phase !== 'ready' ||
      this.handledCalls.has(callId) ||
      !Number.isFinite(validUntil) ||
      validUntil <= this.now() ||
      (afterCardId !== undefined &&
        (this.cards[0]?.id !== afterCardId || this.cards[0].expiresAt <= this.now()))
    ) {
      this.diagnostic = 'Résultat refusé : périmé, déjà traité ou hors du profil actif.';
      this.publish();
      return false;
    }
    this.handledCalls.add(callId);
    if (this.handledCalls.size > 256) {
      this.close('Limite d’outils atteinte.');
      this.publish();
      return false;
    }
    const remaining = supersedes ? this.cards.filter((card) => !supersedes(card)) : this.cards;
    const card: DisplayCard = {
      id: randomUUID(),
      ...scope,
      profileId: this.profile?.id ?? null,
      createdAt: this.now(),
      expiresAt: Math.min(validUntil, this.now() + this.cardSettings.lifetimeMs),
      content: structuredClone(content) as DisplayCard['content'],
      sources: sources ?? contentSources.map((id) => ({ id, title: id })),
      ...(content !== null &&
      typeof content === 'object' &&
      'stale' in content &&
      typeof (content as { stale: unknown }).stale === 'boolean'
        ? { stale: (content as { stale: boolean }).stale }
        : {}),
    };
    this.cards = afterCardId
      ? [remaining[0]!, card, ...remaining.slice(1)].slice(0, this.cardSettings.maxCards)
      : [card, ...(replace ? [] : remaining)].slice(0, this.cardSettings.maxCards);
    this.diagnostic = null;
    this.publish();
    return true;
  }

  /** Minuterie de silence : toujours en mode voix, sur option dans les modes caméra. */
  silenceTracking(): boolean {
    return !!this.mobile?.background || this.session.mode === 4 || this.silenceClose.enabled || this.satelliteSession();
  }

  private silenceDelay(): number {
    return this.mobile?.background && !this.silenceClose.enabled ? 20_000 : this.silenceClose.delayMs;
  }

  /** Parole locale détectée (VAD) : le silence ne compte qu’après la fin de la phrase. */
  setUserSpeech(scope: Scope, speaking: boolean): boolean {
    if (!this.current(scope) || this.session.phase !== 'ready' || !this.silenceTracking())
      return false;
    if (this.userSpeaking === speaking) return true;
    this.userSpeaking = speaking;
    if (speaking) this.silenceSince = null;
    else if (!this.assistantBusy && this.assistantOutputUntil === null)
      this.silenceSince = this.now();
    return true;
  }

  setAssistantBusy(scope: Scope, busy: boolean): boolean {
    if (!this.current(scope) || this.session.phase !== 'ready' || !this.silenceTracking())
      return false;
    if (this.assistantBusy === busy) return true;
    this.assistantBusy = busy;
    if (!busy && !this.userSpeaking && this.assistantOutputUntil === null)
      this.silenceSince = this.now();
    return true;
  }

  /** The Live sideband streams silence too, so only audible output extends this hold. */
  noteAssistantOutput(scope: Scope): boolean {
    if (!this.current(scope) || this.session.phase !== 'ready' || !this.silenceTracking())
      return false;
    this.assistantOutputUntil = this.now() + voiceOutputGraceMs;
    this.silenceSince = null;
    return true;
  }

  /** Transcription de la personne : preuve de parole même si le VAD local est muet. */
  noteUserTranscript(scope: Scope): boolean {
    if (!this.current(scope) || this.session.phase !== 'ready' || !this.silenceTracking())
      return false;
    if (!this.userSpeaking && !this.assistantBusy && this.assistantOutputUntil === null)
      this.silenceSince = this.now();
    return true;
  }

  setVoiceActivity(scope: Scope, phase: VoiceActivity['phase'], durationMs = 0): boolean {
    // Revalidate admission before an asynchronous turn can animate the mirror.
    this.tick();
    if (!this.current(scope) || this.session.phase !== 'ready') return false;
    if (
      phase !== 'idle' &&
      (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 15_000)
    )
      return false;
    const now = this.now();
    this.voice = { phase, startedAt: now, endsAt: phase === 'idle' ? null : now + durationMs };
    if (phase !== 'idle') this.voiceActiveUntil = Math.max(this.voiceActiveUntil, now + durationMs);
    this.publish();
    return true;
  }

  private silenceExpired(now: number): boolean {
    return (
      this.session.phase === 'ready' &&
      this.silenceTracking() &&
      !this.userSpeaking &&
      !this.assistantBusy &&
      this.assistantOutputUntil === null &&
      this.silenceSince !== null &&
      now - this.silenceSince >= this.silenceDelay()
    );
  }

  /**
   * Fin sur silence alors que la personne reste devant le miroir. Avec le mot d’appel, dire
   * « Cornelius » suffit à rouvrir ; sinon il faut détourner le regard puis regarder à nouveau
   * le miroir (ou partir et revenir), pour ne pas rouvrir en boucle devant le même visage.
   */
  private closeAfterSilence(): void {
    if (!this.wakeWordEnabled) {
      this.engagedSince = null;
      this.engagementId = null;
      this.engagementAt = null;
      this.reengagementRequired = true;
      this.gazeBreakRequired = true;
      this.consumedTrigger = null;
    }
    this.close('Fin de conversation après silence.');
  }

  tick(): void {
    const now = this.now();
    if (this.assistantOutputUntil !== null && now >= this.assistantOutputUntil) {
      const outputEndedAt = this.assistantOutputUntil - voiceOutputGraceMs;
      this.assistantOutputUntil = null;
      if (!this.userSpeaking && !this.assistantBusy) this.silenceSince = outputEndedAt;
    }
    // Satellite : ni caméra ni navigateur dans sa pièce, seul le silence termine la conversation.
    if (this.satelliteSession() || this.mobile?.background) {
      if (this.silenceExpired(now)) this.close('Fin de conversation après silence.');
    } else if (this.session.mode === 4) {
      if (this.silenceExpired(now)) this.close('Fin de conversation après silence.');
    } else {
      if (!this.sensorHealthy()) {
        this.resetPresence();
        this.close('Perception sans nouvelles observations.');
        this.changeProfile(null, 'household', false);
      }
      if (this.absenceExpired(now)) this.departure();
      else if (
        // Seul le mode « Engagement » ouvre sur le regard : lui seul se termine à sa perte.
        // La parole de la personne ou de Cornelius repousse cette fin.
        this.session.mode === 3 &&
        this.rawObservation?.presence &&
        this.engagementId !== null &&
        this.disengagedSince !== null &&
        now - Math.max(this.disengagedSince, this.voiceActiveUntil) >= this.timings.disengagementMs
      ) {
        // La personne est toujours là : seule la conversation se termine.
        this.engagedSince = null;
        this.engagementId = null;
        this.engagementAt = null;
        this.reengagementRequired = true;
        this.consumedTrigger = null;
        this.close('Fin d’engagement.');
      } else if (this.silenceExpired(now)) this.closeAfterSilence();
    }
    if (!this.satelliteSession() && !this.browserHealthy())
      this.close('Le navigateur ne répond plus.');
    if (
      this.session.phase === 'connecting' &&
      now - this.session.startedAt! >= limits.connectionMs
    ) {
      this.close('Connexion trop longue. Réessayez.');
    }
    if (this.voice.endsAt !== null && this.voice.endsAt <= now) {
      this.voice = { phase: 'idle', startedAt: now, endsAt: null };
    }
    if (this.session.phase === 'closing' && now - this.closingAt! >= limits.closeMs) {
      // No acknowledgement from the provider: release the session locally and stay available.
      this.release('Clôture non confirmée.');
    }
    this.cards = this.cards.filter((card) => card.expiresAt > now && this.current(card));
    this.publish();
  }
}
