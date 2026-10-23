import type {
  DevicesStatus,
  EngagementSettings,
  EnrollmentMode,
  EnrollmentOutcome,
  EnrollmentResult,
  PerceptionObservation,
  RecognitionLive,
} from '../shared/types.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { WebSocket } from 'ws';
import type { SessionController } from './controller.js';
import { CameraBridge } from './camera.js';
import type { CameraMode } from '../shared/camera.js';
import { validateObservation } from '../shared/commands.js';

const MAX_NEW_VIEWS = 12;
const MAX_VIEWS = 36;
const ENROLLMENT_MS = 90_000;
/** Durée pendant laquelle l’administration retrouve la fin du dernier enregistrement. */
const ENROLLMENT_RESULT_MS = 10 * 60_000;
const RETRY = 'Recommencez seul, face à la caméra, bien éclairé.';
// Flux de veille simultanés : le miroir et les satellites (un octet d’emplacement par trame).
const MAX_WAKE_STREAMS = 16;
export const ENROLLMENT_MESSAGES = {
  saved: 'Visage mémorisé.',
  cancelled: 'Enregistrement annulé.',
  expired: 'Temps écoulé : recommencez seul, face à la caméra, bien éclairé.',
  invalid: 'Visage non retenu : les vues reçues étaient inutilisables. ' + RETRY,
  mixed: 'Visage non retenu : les vues ne montraient pas toutes la même personne. ' + RETRY,
  different:
    'Visage non retenu : il ne ressemble pas assez au visage déjà mémorisé pour cette personne. ' +
    RETRY,
  perception:
    'Enregistrement interrompu : le service caméra (perception) s’est arrêté. Recommencez une fois Cornelius relancé.',
  camera: 'Enregistrement interrompu : la caméra s’est éteinte.',
} as const;

function dot(first: number[], second: number[]): number {
  return first.reduce((sum, value, index) => sum + value * (second[index] ?? 0), 0);
}

/**
 * Ressemblance entre profils, calculée comme le worker (moyenne des trois paires de vues les
 * plus proches). Au-delà de 0,30, la reconnaissance exige un écart de score plus net.
 */
export function lookalikes(
  profiles: { profileId: string; templates: number[][] }[],
): { profileIds: [string, string]; similarity: number }[] {
  const pairs: { profileIds: [string, string]; similarity: number }[] = [];
  profiles.forEach((first, index) => {
    for (const second of profiles.slice(index + 1)) {
      const scores = first.templates
        .flatMap((a) => second.templates.map((b) => dot(a, b)))
        .sort((a, b) => b - a)
        .slice(0, 3);
      const similarity = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      if (similarity >= 0.3)
        pairs.push({
          profileIds: [first.profileId, second.profileId],
          similarity: Math.round(similarity * 100) / 100,
        });
    }
  });
  return pairs.sort((a, b) => b.similarity - a.similarity);
}

/** Pont vers l’analyse de scène, branché après la création des deux services. */
export interface VisionPort {
  attach(send: (event: unknown) => void): void;
  receive(event: { type?: string }): boolean;
  onWorkerConnected(): void;
  onWorkerDisconnected(): void;
  snapshot(): DevicesStatus['perception']['vision'];
}

export class PerceptionBridge {
  readonly camera: CameraBridge;
  private worker: WebSocket | null = null;
  private mobileGeneration: string | null = null;
  private mobileSnapshot: (() => void) | null = null;
  onMobileSnapshot(callback: () => void) {
    this.mobileSnapshot = callback;
  }
  mobileCameraEnabled() {
    return this.wantsCamera();
  }
  setMobileSource(generation: string | null) {
    this.mobileGeneration = generation;
    this.send({ type: 'camera_source', generation });
    this.cameraApplied = null;
    this.syncCamera();
  }
  mobileFrame(generation: string, jpeg: Buffer) {
    if (
      this.mobileGeneration !== generation ||
      !this.wantsCamera() ||
      !this.worker ||
      this.worker.bufferedAmount > 256_000
    )
      return;
    const header = Buffer.from('C' + generation + '\n');
    this.worker.send(Buffer.concat([header, jpeg]));
  }
  private vision: VisionPort | null = null;
  // Profils existants : une observation ne peut pas attribuer un profil supprimé ou inventé.
  private knownProfiles = new Set<string>();
  private enrollment: {
    id: string;
    profileId: string;
    expiresAt: number;
    mode: EnrollmentMode;
  } | null = null;
  private result: EnrollmentResult | null = null;
  private live: { value: RecognitionLive; receivedAt: number } | null = null;
  private liveRequestedAt = 0;
  private lookalikes: NonNullable<DevicesStatus['perception']['lookalikes']> = [];
  private progress: DevicesStatus['perception']['enrollmentProgress'] = null;
  private audioInteraction: string | null = null;
  private wakeStreams = new Map<string, { slot: number; detected: (score: number) => void }>();
  private wakeReady = false;
  private lastVadAt = 0;
  private diagnostic: string | null = null;
  private recognitionThreshold: number;
  private engagement: EngagementSettings;
  // Caméra voulue : toujours en mode caméra ; en mode voix, seulement pendant une conversation.
  private cameraPolicy: () => boolean = () => this.controller.sessionState().mode !== 4;
  private cameraApplied: boolean | null = null;
  /** Réglage en cours dans l’administration : caméra allumée jusqu’à cette date. */
  private cameraHoldUntil = 0;
  constructor(
    private db: DatabaseSync,
    private controller: SessionController,
    private changed: () => void,
    private now = Date.now,
  ) {
    this.camera = new CameraBridge(db, changed, now);
    this.engagement = JSON.parse(
      String(
        db.prepare('SELECT engagement_settings FROM camera_preferences WHERE id = 1').get()
          ?.engagement_settings,
      ),
    );
    this.recognitionThreshold = Number(
      db.prepare('SELECT recognition_threshold FROM camera_preferences WHERE id = 1').get()
        ?.recognition_threshold,
    );
  }
  snapshot() {
    return {
      recognitionThreshold: this.recognitionThreshold,
      engagement: { ...this.engagement },
      camera: this.camera.snapshot(),
      connected: this.worker?.readyState === 1,
      enrollingProfileId: this.enrollment?.profileId ?? null,
      enrollmentMode: this.enrollment?.mode ?? null,
      enrollmentProgress: this.enrollment ? this.progress : null,
      enrollmentResult: this.result ? { ...this.result } : null,
      enrolledProfileIds: this.db
        .prepare('SELECT profile_id FROM profile_faces')
        .all()
        .map((row) => String(row.profile_id)),
      faces: this.db
        .prepare('SELECT profile_id, templates, enrolled_at FROM profile_faces')
        .all()
        .map((row) => ({
          profileId: String(row.profile_id),
          views: Math.max(1, (JSON.parse(String(row.templates)) as unknown[]).length),
          enrolledAt: Number(row.enrolled_at),
        })),
      lookalikes: this.lookalikes.map((pair) => ({ ...pair })),
      diagnostic: this.diagnostic,
      vision: this.visionSnapshot(),
    };
  }
  private visionSnapshot(): DevicesStatus['perception']['vision'] {
    return (
      this.vision?.snapshot() ?? {
        mode: 'scene',
        modelId: '450m',
        device: 'auto',
        model: 'unknown',
        provider: null,
        detail: null,
        lastDescription: null,
        lastAt: null,
        lastTrigger: null,
        pending: 0,
        appends: 0,
        lastRequestAt: null,
        lastLatencyMs: null,
        history: [],
      }
    );
  }
  useVision(vision: VisionPort) {
    this.vision = vision;
    vision.attach((value) => this.send(value));
  }
  /** Règle d’allumage de la caméra, réévaluée à chaque changement d’état par `syncCamera`. */
  setCameraPolicy(policy: () => boolean) {
    this.cameraPolicy = policy;
    this.syncCamera();
  }
  /** Allume ou éteint la caméra seulement quand la règle change de réponse. */
  syncCamera() {
    if (!this.worker) return;
    const wanted = this.wantsCamera();
    if (wanted !== this.cameraApplied) this.setCameraEnabled(wanted);
  }
  private wantsCamera(): boolean {
    return this.cameraPolicy() || this.now() < this.cameraHoldUntil || !!this.enrollment;
  }
  /**
   * La page Caméra ou Visages est ouverte : la caméra reste allumée le temps du réglage, quel
   * que soit le mode d’ouverture. L’administration renouvelle ce maintien tant qu’elle est
   * affichée ; il s’arrête seul ensuite.
   */
  holdCamera(ms = 45_000) {
    this.cameraHoldUntil = this.now() + ms;
    this.syncCamera();
  }
  connect(socket: WebSocket) {
    this.worker?.close(1008, 'Perception remplacée.');
    this.worker = socket;
    this.camera.connect((value) => this.send(value));
    const cameraEnabled = this.wantsCamera();
    this.cameraApplied = cameraEnabled;
    if (!cameraEnabled) this.camera.suspend();
    this.audioInteraction = null;
    this.wakeReady = false;
    this.controller.setSetup({ perception: true });
    this.controller.setWakeWordAvailability(false, 'Chargement du modèle Cornelius.');
    this.lastVadAt = 0;
    // Le service précédent est remplacé : son enregistrement en cours ne se terminera pas.
    this.endEnrollment('rejected', ENROLLMENT_MESSAGES.perception);
    this.diagnostic = null;
    this.refreshProfiles();
    this.vision?.attach((value) => this.send(value));
    this.vision?.onWorkerConnected();
    // Les flux de veille survivent à une perception relancée : elle les reprend tels quels.
    for (const [streamId, { slot }] of this.wakeStreams)
      this.send({ type: 'wake_start', streamId, slot });
    socket.on('message', (data, binary) => {
      if (this.worker !== socket) return;
      if (binary) {
        this.camera.image(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        return;
      }
      try {
        const event = JSON.parse(data.toString());
        if (
          event.type === 'observation' &&
          (event.generation ?? null) === this.mobileGeneration &&
          validateObservation(event.observation)
        )
          this.controller.observe(this.withKnownProfiles(event.observation));
        else if (
          event.type === 'vad' &&
          typeof event.speaking === 'boolean' &&
          event.interactionId === this.audioInteraction &&
          event.interactionId === this.controller.scope().interactionId
        ) {
          this.lastVadAt = this.now();
          this.controller.setUserSpeech(this.controller.scope(), event.speaking);
          if (event.speaking)
            this.controller.setVoiceActivity(this.controller.scope(), 'listening', 1000);
        } else if (
          event.type === 'enrollment_progress' &&
          this.enrollment !== null &&
          this.enrollment.id === event.id &&
          this.enrollment.expiresAt > this.now() &&
          Number.isInteger(event.step) &&
          event.step >= 0 &&
          event.step <= 4 &&
          Number.isInteger(event.total) &&
          event.total >= 1 &&
          event.total <= 12 &&
          Number.isInteger(event.collected) &&
          event.collected >= 0 &&
          event.collected <= event.total &&
          typeof event.message === 'string' &&
          event.message.length <= 160
        ) {
          this.progress = {
            step: event.step,
            collected: event.collected,
            total: event.total,
            message: event.message,
          };
          this.changed();
        } else if (
          event.type === 'wake_status' &&
          typeof event.ready === 'boolean' &&
          (event.detail === null || typeof event.detail === 'string')
        ) {
          this.wakeReady = event.ready;
          this.controller.setWakeWordAvailability(event.ready, event.detail);
        } else if (
          event.type === 'wake_detected' &&
          this.wakeReady &&
          typeof event.streamId === 'string' &&
          this.wakeStreams.has(event.streamId) &&
          typeof event.score === 'number' &&
          event.score >= 0 &&
          event.score <= 1
        ) {
          this.wakeStreams.get(event.streamId)!.detected(event.score);
        } else if (event.type === 'recognition_live') this.receiveLive(event);
        else if (event.type === 'enrolled') this.completeEnrollment(event);
        else if (event.type === 'camera_status') this.camera.receive(event);
        else if (event.type === 'vision_status' || event.type === 'vision_result')
          this.vision?.receive(event);
      } catch {
        this.diagnostic = 'Message de perception invalide.';
        this.changed();
      }
    });
    this.send({ type: 'camera_source', generation: this.mobileGeneration });
    this.send(this.cameraEnabledEvent(cameraEnabled));
    socket.on('error', () => socket.close());
    socket.on('close', () => {
      if (this.worker !== socket) return;
      this.worker = null;
      this.cameraApplied = null;
      this.wakeReady = false;
      this.controller.setSetup({ perception: false });
      this.controller.setWakeWordAvailability(false, 'Perception locale déconnectée.');
      this.camera.disconnect();
      this.endEnrollment('rejected', ENROLLMENT_MESSAGES.perception);
      this.vision?.onWorkerDisconnected();
      this.changed();
    });
  }
  setCameraEnabled(enabled: boolean): void {
    this.cameraApplied = enabled;
    if (enabled) this.camera.resume();
    else {
      this.camera.suspend();
      this.endEnrollment('rejected', ENROLLMENT_MESSAGES.camera);
      this.send({ type: 'vision_cancel' });
    }
    this.send(this.cameraEnabledEvent(enabled));
    this.changed();
  }
  /**
   * Allumage avec la caméra et la résolution enregistrées : la perception ouvre directement la
   * bonne, au lieu de l’entrée par défaut puis de celle choisie quelques secondes plus tard.
   */
  private cameraEnabledEvent(enabled: boolean) {
    return enabled
      ? {
          type: 'camera_enabled',
          enabled,
          deviceId: this.camera.savedDevice(),
          mode: this.camera.savedMode(),
        }
      : { type: 'camera_enabled', enabled };
  }

  /**
   * Un flux de veille (le miroir ou un satellite) : chacun a son emplacement, son propre état
   * openWakeWord dans la perception, et reçoit ses propres détections. Faux si tout est pris.
   */
  startWakeStream(streamId: string, detected: (score: number) => void): boolean {
    if (this.wakeStreams.has(streamId)) return true;
    const used = new Set([...this.wakeStreams.values()].map((stream) => stream.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= MAX_WAKE_STREAMS) return false;
    this.wakeStreams.set(streamId, { slot, detected });
    this.send({ type: 'wake_start', streamId, slot });
    return true;
  }

  wakeAudio(streamId: string, pcm: Buffer): void {
    const stream = this.wakeStreams.get(streamId);
    if (!stream || !this.wakeReady || this.worker?.readyState !== 1 || pcm.length !== 2560) return;
    const frame = Buffer.allocUnsafe(2562);
    frame[0] = 0x57;
    frame[1] = stream.slot;
    pcm.copy(frame, 2);
    if (this.worker.bufferedAmount < 16_384 * this.wakeStreams.size) this.worker.send(frame);
  }

  endWakeStream(streamId: string): void {
    if (!this.wakeStreams.delete(streamId)) return;
    this.send({ type: 'wake_end', streamId });
  }

  /** Flux de veille ouverts : plus d’un, et l’arbitrage départage les appareils. */
  wakeStreamCount(): number {
    return this.wakeStreams.size;
  }

  private send(value: unknown) {
    if (this.mobileGeneration && (value as { type?: string })?.type === 'vision') {
      const generation = this.mobileGeneration,
        worker = this.worker;
      this.mobileSnapshot?.();
      const timer = setTimeout(() => {
        if (
          this.mobileGeneration === generation &&
          this.worker === worker &&
          worker?.readyState === 1 &&
          this.wantsCamera()
        )
          worker.send(JSON.stringify(value));
      }, 350);
      timer.unref();
      return;
    }
    if (this.worker?.readyState === 1) this.worker.send(JSON.stringify(value));
  }
  /** Un profil inconnu du serveur devient une personne non reconnue, sans perdre l’image. */
  private withKnownProfiles(observation: PerceptionObservation): PerceptionObservation {
    if (observation.people.every((person) => this.isKnownProfile(person.profileId)))
      return observation;
    return {
      ...observation,
      people: observation.people.map((person) =>
        this.isKnownProfile(person.profileId) ? person : { ...person, profileId: null },
      ),
    };
  }
  private isKnownProfile(profileId: string | null): boolean {
    if (profileId === null || this.knownProfiles.has(profileId)) return true;
    if (!this.db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)) return false;
    this.knownProfiles.add(profileId);
    return true;
  }
  private faceTemplates(): { profileId: string; templates: number[][] }[] {
    return this.db
      .prepare('SELECT profile_id, embedding, templates FROM profile_faces')
      .all()
      .map((row) => {
        const templates = JSON.parse(String(row.templates)) as number[][];
        return {
          profileId: String(row.profile_id),
          templates: templates.length ? templates : [JSON.parse(String(row.embedding))],
        };
      });
  }
  refreshProfiles() {
    const exists = (profileId: string) =>
      !!this.db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
    if (this.enrollment && !exists(this.enrollment.profileId))
      this.endEnrollment('cancelled', ENROLLMENT_MESSAGES.cancelled);
    // Un profil supprimé ne laisse aucune trace de son dernier enregistrement.
    if (this.result && !exists(this.result.profileId)) this.result = null;
    this.knownProfiles = new Set(
      this.db
        .prepare('SELECT id FROM profiles')
        .all()
        .map((row) => String(row.id)),
    );
    const profiles = this.faceTemplates();
    this.lookalikes = lookalikes(profiles);
    const tracking = this.trackingTimings();
    this.send({
      type: 'profiles',
      engagement: { ...this.engagement },
      recognitionThreshold: this.recognitionThreshold,
      trackingGraceMs: tracking.graceMs,
      identityHoldMs: tracking.identityHoldMs,
      profiles,
      enrollment: this.enrollment,
    });
    this.changed();
  }
  private trackingTimings() {
    const timings = this.controller.getPresenceTimings();
    return {
      graceMs: Math.max(timings.absenceMs, timings.disengagementMs),
      identityHoldMs: timings.identityHoldMs,
    };
  }
  refreshPresenceTimings(): void {
    this.send({ type: 'tracking', ...this.trackingTimings() });
  }
  /** Scores en direct : le worker ne les calcule que tant que l’administration les lit. */
  recognitionLive(): RecognitionLive | null {
    if (this.worker?.readyState !== 1) return null;
    if (this.now() - this.liveRequestedAt >= 1000) {
      this.liveRequestedAt = this.now();
      this.send({ type: 'recognition_debug' });
    }
    return this.live && this.now() - this.live.receivedAt < 2000 ? this.live.value : null;
  }
  private receiveLive(event: { observedAt?: unknown; threshold?: unknown; faces?: unknown }) {
    if (
      typeof event.observedAt !== 'number' ||
      typeof event.threshold !== 'number' ||
      !Array.isArray(event.faces) ||
      event.faces.length > 8
    )
      return;
    const known = new Set(this.faceTemplates().map((profile) => profile.profileId));
    const faces: RecognitionLive['faces'] = [];
    for (const face of event.faces as Record<string, unknown>[]) {
      if (!face || typeof face !== 'object' || !Array.isArray(face.scores)) return;
      faces.push({
        identity:
          typeof face.identity === 'string' && known.has(face.identity) ? face.identity : null,
        usable: face.usable === true,
        issue: typeof face.issue === 'string' ? face.issue.slice(0, 160) : null,
        required: typeof face.required === 'number' ? face.required : null,
        scores: (face.scores as { profileId?: unknown; score?: unknown }[])
          .filter(
            (entry) =>
              typeof entry?.profileId === 'string' &&
              known.has(entry.profileId) &&
              typeof entry.score === 'number' &&
              Number.isFinite(entry.score),
          )
          .slice(0, 3)
          .map((entry) => ({ profileId: entry.profileId as string, score: entry.score as number })),
      });
    }
    this.live = {
      value: { observedAt: event.observedAt, threshold: event.threshold, faces },
      receivedAt: this.now(),
    };
  }
  setRecognitionThreshold(threshold: number) {
    if (!Number.isFinite(threshold) || threshold < 0.2 || threshold > 0.65)
      throw new Error('Seuil attendu entre 0,20 et 0,65.');
    this.db
      .prepare('UPDATE camera_preferences SET recognition_threshold = ? WHERE id = 1')
      .run(threshold);
    this.recognitionThreshold = threshold;
    this.send({ type: 'recognition', threshold });
    this.changed();
  }
  setEngagement(settings: EngagementSettings) {
    if (
      !Number.isFinite(settings.poseTolerance) ||
      settings.poseTolerance < 0.1 ||
      settings.poseTolerance > 0.5 ||
      !Number.isFinite(settings.minFaceRatio) ||
      settings.minFaceRatio < 0.05 ||
      settings.minFaceRatio > 0.3
    )
      throw new Error('Réglages d’engagement invalides.');
    this.db
      .prepare('UPDATE camera_preferences SET engagement_settings = ? WHERE id = 1')
      .run(JSON.stringify(settings));
    this.engagement = { ...settings };
    this.send({ type: 'engagement', settings: this.engagement });
    this.changed();
  }
  // Possible pendant une conversation : elle peut seulement perdre la présence un instant.
  setCameraMode(mode: CameraMode) {
    if (this.enrollment) throw new Error('Attendez la fin de l’enregistrement du visage.');
    this.camera.setMode(mode);
  }
  selectCamera(id: string) {
    if (this.enrollment) throw new Error('Attendez la fin de l’enregistrement du visage.');
    this.camera.select(id);
  }
  enroll(profileId: string, mode: EnrollmentMode = 'replace') {
    if (this.camera.snapshot().changing) throw new Error('Attendez le changement de caméra.');
    if (this.camera.isSuspended())
      throw new Error('La caméra s’allume pour l’enregistrement : réessayez dans un instant.');
    if (this.worker?.readyState !== 1)
      throw new Error(
        'Le service caméra (perception) n’est pas lancé : relancez Cornelius pour mémoriser un visage.',
      );
    if (!this.db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId))
      throw new Error('Profil introuvable.');
    if (
      mode === 'add' &&
      !this.db.prepare('SELECT profile_id FROM profile_faces WHERE profile_id = ?').get(profileId)
    )
      throw new Error('Aucun visage à compléter : mémorisez d’abord ce visage.');
    this.enrollment = { id: randomUUID(), profileId, expiresAt: this.now() + ENROLLMENT_MS, mode };
    this.diagnostic = null;
    this.progress = null;
    this.result = null;
    this.send({ type: 'enroll', enrollment: this.enrollment });
    this.changed();
  }
  cancelEnrollment() {
    if (!this.enrollment) return;
    this.endEnrollment('cancelled', ENROLLMENT_MESSAGES.cancelled);
    this.refreshProfiles();
  }
  forget(profileId: string) {
    this.db.prepare('DELETE FROM profile_faces WHERE profile_id = ?').run(profileId);
    if (this.enrollment?.profileId === profileId)
      this.endEnrollment('cancelled', ENROLLMENT_MESSAGES.cancelled);
    // « Visage mémorisé » ne doit pas survivre à l’oubli de ce visage.
    if (this.result?.profileId === profileId) this.result = null;
    this.refreshProfiles();
  }
  /**
   * Termine l’enregistrement en cours en gardant son issue. Le service de perception arrête
   * le sien dès qu’il envoie ses vues : un refus termine donc aussi l’enregistrement ici.
   */
  private endEnrollment(outcome: EnrollmentOutcome, message: string) {
    const enrollment = this.enrollment;
    this.enrollment = null;
    this.progress = null;
    if (!enrollment) return;
    this.result = {
      id: enrollment.id,
      profileId: enrollment.profileId,
      mode: enrollment.mode,
      outcome,
      message,
      at: this.now(),
    };
  }
  private rejectEnrollment(message: string) {
    this.endEnrollment('rejected', message);
    this.refreshProfiles();
  }
  private completeEnrollment(event: { id?: unknown; templates?: unknown }) {
    const enrollment = this.enrollment;
    if (!enrollment || event.id !== enrollment.id) return;
    if (enrollment.expiresAt <= this.now()) {
      this.endEnrollment('expired', ENROLLMENT_MESSAGES.expired);
      this.refreshProfiles();
      return;
    }
    if (
      !Array.isArray(event.templates) ||
      event.templates.length < 3 ||
      event.templates.length > MAX_NEW_VIEWS
    )
      return this.rejectEnrollment(ENROLLMENT_MESSAGES.invalid);
    const templates: number[][] = [];
    for (const vector of event.templates) {
      if (
        !Array.isArray(vector) ||
        vector.length !== 128 ||
        !vector.every((v) => typeof v === 'number' && Number.isFinite(v))
      )
        return this.rejectEnrollment(ENROLLMENT_MESSAGES.invalid);
      const norm = Math.hypot(...vector);
      if (!Number.isFinite(norm) || norm < 0.01)
        return this.rejectEnrollment(ENROLLMENT_MESSAGES.invalid);
      templates.push(vector.map((v) => v / norm));
    }
    // All views must still represent the same enrolled person.
    if (templates.slice(1).some((vector) => dot(vector, templates[0]!) < 0.35))
      return this.rejectEnrollment(ENROLLMENT_MESSAGES.mixed);
    // « Compléter » garde les vues existantes : l’ensemble couvre plusieurs éclairages.
    const previous =
      enrollment.mode === 'add'
        ? (this.faceTemplates().find((face) => face.profileId === enrollment.profileId)
            ?.templates ?? [])
        : [];
    if (
      previous.length &&
      Math.max(...templates.flatMap((vector) => previous.map((old) => dot(vector, old)))) < 0.35
    )
      return this.rejectEnrollment(ENROLLMENT_MESSAGES.different);
    const stored = [...previous, ...templates].slice(-MAX_VIEWS);
    this.db
      .prepare(
        'INSERT INTO profile_faces (profile_id, embedding, templates, enrolled_at) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET embedding=excluded.embedding, templates=excluded.templates, enrolled_at=excluded.enrolled_at',
      )
      .run(enrollment.profileId, JSON.stringify(stored[0]), JSON.stringify(stored), this.now());
    this.endEnrollment('saved', ENROLLMENT_MESSAGES.saved);
    this.refreshProfiles();
  }
  tick() {
    this.camera.tick();
    // Fin d’un maintien pour réglage : la règle habituelle reprend la main.
    this.syncCamera();
    const session = this.controller.sessionState();
    const lastVad = this.audioInteraction === session.interactionId ? this.lastVadAt : 0;
    // Le mode voix mesure le silence avec ce VAD : sans lui, la fin après silence est aveugle.
    // Les modes caméra ne s’en servent que pour l’animation d’écoute et ne coupent pas.
    // Un satellite passe par le Wi-Fi, qui a des à-coups d’une à deux secondes : il a 5 s.
    const vadLimit = session.satellite ? 5000 : 2000;
    if (
      (session.mode === 4 || session.satellite) &&
      session.phase === 'ready' &&
      this.now() - Math.max(lastVad, session.readyAt!) >= vadLimit
    ) {
      this.controller.close(
        'Détection de parole interrompue. Vérifiez le microphone et la perception.',
      );
      this.controller.publish();
    }
    if (this.enrollment && this.enrollment.expiresAt <= this.now()) {
      this.endEnrollment('expired', ENROLLMENT_MESSAGES.expired);
      this.refreshProfiles();
    } else if (this.result && this.now() - this.result.at >= ENROLLMENT_RESULT_MS) {
      this.result = null;
      this.changed();
    }
  }
  audio(interactionId: string, pcm: Buffer) {
    if (this.worker?.readyState !== 1 || pcm.length !== 1024) return;
    if (this.audioInteraction !== interactionId) {
      this.audioInteraction = interactionId;
      this.send({ type: 'audio', interactionId });
    }
    // Bound queues: old audio must never sustain a later interaction.
    if (this.worker.bufferedAmount < 16_384) this.worker.send(pcm);
  }
  dispose() {
    this.camera.disconnect();
    this.worker?.close(1001, 'Arrêt du serveur');
    this.worker = null;
  }
}
