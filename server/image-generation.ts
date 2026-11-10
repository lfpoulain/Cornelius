import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { WebSocket } from 'ws';
import imageGenerateSchema from '../schemas/image-generate.schema.json' with { type: 'json' };
import imageRecallSchema from '../schemas/image-recall.schema.json' with { type: 'json' };
import type { ToolResult } from '../shared/addons.js';
import {
  IMAGE_GENERATION_MODEL_DEFAULT,
  IMAGE_GENERATION_MODELS,
  IMAGE_GENERATION_PROVIDERS,
  OPENAI_IMAGE_MODEL_DEFAULT,
  OPENAI_IMAGE_MODELS,
  OPENAI_IMAGE_QUALITIES,
  OPENAI_IMAGE_QUALITY_DEFAULT,
  type ImageCard,
  type ImageGenerationActivity,
  type ImageGenerationModel,
  type ImageGenerationProvider,
  type ImageGenerationStatus,
  type OpenAIImageModel,
  type OpenAIImageQuality,
  type Scope,
} from '../shared/types.js';
import { compile } from '../shared/validation.js';
import type { DiagnosticLog } from './logs.js';
import { OPENAI_IMAGE_SIZE, openAIImageError, type OpenAIImageCreator } from './openai-images.js';

/** Accès à l’API d’images d’OpenAI : la même clé que la conversation, relue à chaque image. */
export interface OpenAIImageSource {
  creator(): OpenAIImageCreator | null;
  blocked(): boolean;
}
type AnyImageModel = ImageGenerationModel | OpenAIImageModel;

interface GenerateInput {
  prompt: string;
  seed: number | null;
}
interface Pending {
  id: string;
  output: string;
  input: GenerateInput;
  model: AnyImageModel;
  automatic: boolean;
  profileId: string | null;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
  /** Génération confiée à OpenAI : interrompue en coupant la requête. */
  abort?: AbortController;
  resolve(value: ImageGenerationOutcome): void;
  reject(error: Error): void;
}
/** Image conservée pour être réaffichée ; le fichier disparaît en sortant de la mémoire. */
interface StoredImage {
  id: string;
  prompt: string;
  model: AnyImageModel;
  automatic: boolean;
  profileId: string | null;
  createdAt: number;
}
interface RecallInput {
  position: number | null;
  search: string | null;
}
export interface ImageGenerationOutcome {
  tool: ToolResult;
  card: ImageCard | null;
}

const validateInput = compile<GenerateInput>(imageGenerateSchema);
const validateRecall = compile<RecallInput>(imageRecallSchema);
const dimensions = { width: 512, height: 512 } as const;
/** Au plus trois images sur disque, illustrations comprises ; tout est effacé au démarrage. */
const storedImages = 3;
const timeoutMs = 3 * 60 * 1000;
const idPattern = /^[a-f0-9-]{36}$/u;
const generatedName = /^[a-f0-9-]{36}(\.tmp)?\.webp$/u;
const maxImageBytes = 20 * 1024 * 1024;

const isOpenAIModel = (model: string): model is OpenAIImageModel =>
  (OPENAI_IMAGE_MODELS as readonly string[]).includes(model);

/** Mots significatifs, sans accents, pour retrouver une image par son sujet. */
function words(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );
}

function failure(summary: string, code = 'unavailable', retryable = false): ImageGenerationOutcome {
  return {
    card: null,
    tool: {
      schemaVersion: 1,
      status: 'failed',
      result: null,
      snapshotId: null,
      actionRunId: null,
      summary,
      error: { code, message: summary, retryable },
    },
  };
}

export class ImageGeneration {
  private worker: WebSocket | null = null;
  private pending: Pending | null = null;
  private cancelled = new Set<string>();
  private stored: StoredImage[] = [];
  private activityListener: ((activity: ImageGenerationActivity | null) => void) | null = null;
  private enabled: boolean;
  private preload: boolean;
  private illustrateCards: boolean;
  private model: ImageGenerationModel;
  private sanaSteps: 2 | 4;
  private provider: ImageGenerationProvider;
  private openaiModel: OpenAIImageModel;
  private openaiQuality: OpenAIImageQuality;
  private openai: OpenAIImageSource | null = null;
  private loadedModel: ImageGenerationModel | null = null;
  private device: string | null = null;
  private detail: string | null = null;
  private lastDurationMs: number | null = null;
  /** Petite machine : seul OpenAI crée les images, le choix enregistré est gardé tel quel. */
  private localUnavailable: string | null = null;
  readonly outputDirectory: string;

  constructor(
    private readonly db: DatabaseSync,
    private readonly configured: boolean,
    private readonly changed: () => void,
    private readonly logs?: DiagnosticLog,
    private readonly now = Date.now,
    outputDirectory = resolve('data', 'generated-images'),
  ) {
    const row = db
      .prepare(
        'SELECT enabled, model, sana_steps, illustrate_cards FROM image_generation_preferences WHERE id = 1',
      )
      .get();
    this.enabled = row?.enabled === 1;
    this.illustrateCards = row?.illustrate_cards === 1;
    const stored = String(row?.model ?? IMAGE_GENERATION_MODEL_DEFAULT);
    this.model = IMAGE_GENERATION_MODELS.includes(stored as ImageGenerationModel)
      ? (stored as ImageGenerationModel)
      : IMAGE_GENERATION_MODEL_DEFAULT;
    this.sanaSteps = row?.sana_steps === 4 ? 4 : 2;
    const remote = db
      .prepare(
        'SELECT provider, openai_model, openai_quality FROM image_generation_provider WHERE id = 1',
      )
      .get();
    this.provider = remote?.provider === 'openai' ? 'openai' : 'local';
    const openaiModel = String(remote?.openai_model ?? '');
    this.openaiModel = isOpenAIModel(openaiModel) ? openaiModel : OPENAI_IMAGE_MODEL_DEFAULT;
    const quality = String(remote?.openai_quality ?? '');
    this.openaiQuality = OPENAI_IMAGE_QUALITIES.includes(quality as OpenAIImageQuality)
      ? (quality as OpenAIImageQuality)
      : OPENAI_IMAGE_QUALITY_DEFAULT;
    this.preload =
      db.prepare('SELECT enabled FROM image_generation_preload WHERE id = 1').get()?.enabled === 1;
    this.outputDirectory = outputDirectory;
    mkdirSync(this.outputDirectory, { recursive: true, mode: 0o700 });
    this.purge();
  }

  /** Le miroir affiche un petit encart pendant la création d’une image. */
  onActivity(listener: (activity: ImageGenerationActivity | null) => void) {
    this.activityListener = listener;
  }

  tools() {
    if (!this.enabled) return [];
    const openai = this.provider === 'openai';
    const sanaPrompt =
      !openai && this.model === 'sana-sprint-0.6b'
        ? ' Pour SANA-Sprint, rédige la description visuelle en anglais ; conserve à l’identique tout texte que la personne demande explicitement d’inscrire dans l’image.'
        : '';
    return [
      {
        name: 'image__generate',
        description:
          (openai
            ? 'Créer avec OpenAI une nouvelle image carrée à partir d’une description et l’afficher sur le miroir.'
            : 'Créer localement une nouvelle image carrée de 512 × 512 pixels à partir d’une description et l’afficher sur le miroir.') +
          ' Utilise un prompt visuel fidèle à la demande, sans ajouter de personnes, marque, texte ou détail non demandé.' +
          sanaPrompt +
          ' La génération peut prendre plusieurs dizaines de secondes. Une nouvelle demande interrompt l’image en cours.',
        parameters: imageGenerateSchema as Record<string, unknown>,
      },
      {
        name: 'image__recall',
        description:
          'Réafficher sur le miroir une image déjà créée, sans la régénérer. Seules les trois dernières images sont gardées, jusqu’au redémarrage du miroir. position : 1 pour la plus récente, 2 l’avant-dernière, 3 la plus ancienne, ou null avec search : quelques mots du sujet demandé. Le résultat indique la demande d’origine de l’image affichée.',
        parameters: imageRecallSchema as Record<string, unknown>,
      },
    ];
  }

  handles(name: string): boolean {
    return (name === 'image__generate' || name === 'image__recall') && this.enabled;
  }

  snapshot(): ImageGenerationStatus {
    return {
      enabled: this.enabled,
      provider: this.provider,
      openaiModel: this.openaiModel,
      openaiQuality: this.openaiQuality,
      openaiUnavailable: this.openaiUnavailable(),
      localUnavailable: this.localUnavailable,
      preload: this.preload,
      storedImages: this.stored.filter((image) => !image.automatic).length,
      illustrateCards: this.illustrateCards,
      configured: this.configured,
      connected: this.worker?.readyState === 1,
      busy: this.pending !== null,
      model: this.model,
      sanaSteps: this.sanaSteps,
      loadedModel: this.loadedModel,
      device: this.device,
      detail: this.detail,
      lastDurationMs: this.lastDurationMs,
    };
  }

  setEnabled(enabled: boolean) {
    this.db
      .prepare('UPDATE image_generation_preferences SET enabled = ? WHERE id = 1')
      .run(Number(enabled));
    this.enabled = enabled;
    if (!enabled) this.cancel('Génération d’image désactivée.');
    this.configure();
    this.changed();
  }

  /** Charger le modèle dès le démarrage du worker, avant la première conversation. */
  setPreload(preload: boolean) {
    this.db
      .prepare('UPDATE image_generation_preload SET enabled = ? WHERE id = 1')
      .run(Number(preload));
    this.preload = preload;
    this.configure();
    this.changed();
  }

  setIllustrateCards(enabled: boolean) {
    this.db
      .prepare('UPDATE image_generation_preferences SET illustrate_cards = ? WHERE id = 1')
      .run(Number(enabled));
    this.illustrateCards = enabled;
    if (!enabled && this.pending?.automatic) this.cancel('Illustration automatique désactivée.');
    this.changed();
  }

  canIllustrateCards(): boolean {
    return this.enabled && this.illustrateCards && this.ready() && !this.pending;
  }

  setModel(model: ImageGenerationModel) {
    if (!IMAGE_GENERATION_MODELS.includes(model)) throw new Error('Modèle d’image inconnu.');
    if (this.pending) throw new Error('Attendez la fin de la génération en cours.');
    this.db.prepare('UPDATE image_generation_preferences SET model = ? WHERE id = 1').run(model);
    this.model = model;
    this.detail =
      this.loadedModel === model
        ? this.detail
        : this.preload && this.enabled
          ? 'Préchargement du modèle…'
          : 'Le modèle sera chargé à la prochaine génération.';
    this.configure();
    this.changed();
  }

  setSanaSteps(steps: 2 | 4) {
    if (steps !== 2 && steps !== 4) throw new Error('Nombre d’étapes SANA invalide.');
    if (this.pending) throw new Error('Attendez la fin de la génération en cours.');
    this.db
      .prepare('UPDATE image_generation_preferences SET sana_steps = ? WHERE id = 1')
      .run(steps);
    this.sanaSteps = steps;
    this.changed();
  }

  /** Relie la clé OpenAI du serveur ; sans elle, seul le générateur local est utilisable. */
  useOpenAI(source: OpenAIImageSource) {
    this.openai = source;
  }

  /** Retire le générateur local sur cette machine (Raspberry Pi) : OpenAI seulement. */
  restrictToOpenAI(reason: string) {
    this.localUnavailable = reason;
    // Une base venue d’un PC où les images restaient locales : rien ne part chez OpenAI, ni
    // facturé, avant que l’administration réactive la création. La base garde ses réglages.
    if (this.provider === 'local') {
      this.enabled = false;
      this.illustrateCards = false;
    }
    this.provider = 'openai';
  }

  setProvider(provider: ImageGenerationProvider) {
    if (!IMAGE_GENERATION_PROVIDERS.includes(provider)) throw new Error('Moteur d’image inconnu.');
    if (provider === 'local' && this.localUnavailable) throw new Error(this.localUnavailable);
    if (this.pending) throw new Error('Attendez la fin de la génération en cours.');
    this.db.prepare('UPDATE image_generation_provider SET provider = ? WHERE id = 1').run(provider);
    this.provider = provider;
    this.detail =
      provider === 'openai'
        ? 'Images créées par OpenAI.'
        : 'Le modèle sera chargé à la prochaine génération.';
    this.configure();
    this.changed();
  }

  setOpenAIModel(model: OpenAIImageModel) {
    if (!isOpenAIModel(model)) throw new Error('Modèle d’image OpenAI inconnu.');
    if (this.pending) throw new Error('Attendez la fin de la génération en cours.');
    this.db
      .prepare('UPDATE image_generation_provider SET openai_model = ? WHERE id = 1')
      .run(model);
    this.openaiModel = model;
    this.changed();
  }

  setOpenAIQuality(quality: OpenAIImageQuality) {
    if (!OPENAI_IMAGE_QUALITIES.includes(quality)) throw new Error('Qualité d’image inconnue.');
    if (this.pending) throw new Error('Attendez la fin de la génération en cours.');
    this.db
      .prepare('UPDATE image_generation_provider SET openai_quality = ? WHERE id = 1')
      .run(quality);
    this.openaiQuality = quality;
    this.changed();
  }

  private openaiUnavailable(): string | null {
    if (!this.openai) return 'OpenAI n’est pas relié à ce serveur.';
    if (this.openai.blocked()) return 'Connexions OpenAI bloquées dans l’administration.';
    if (!this.openai.creator()) return 'Clé OpenAI absente : renseignez-la dans Clés et accès.';
    return null;
  }

  /** Le moteur choisi peut-il créer une image maintenant ? */
  private ready(): boolean {
    return this.provider === 'openai'
      ? this.openaiUnavailable() === null
      : this.configured && this.worker?.readyState === 1;
  }

  connect(socket: WebSocket) {
    this.worker?.close(1008, 'Générateur remplacé.');
    this.worker = socket;
    this.detail =
      this.preload && this.enabled
        ? 'Générateur connecté ; préchargement du modèle…'
        : 'Générateur connecté ; modèle chargé à la demande.';
    this.configure();
    socket.on('message', (data, binary) => {
      if (this.worker !== socket || binary) return;
      try {
        this.receive(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch {
        this.detail = 'Message invalide reçu du générateur.';
        this.changed();
      }
    });
    socket.on('error', () => socket.close());
    socket.on('close', () => {
      if (this.worker !== socket) return;
      this.worker = null;
      this.loadedModel = null;
      this.device = null;
      this.detail = 'Générateur d’image arrêté.';
      this.cancel('Générateur d’image déconnecté.');
      this.changed();
    });
    this.changed();
  }

  async generate(
    scope: Scope,
    args: unknown,
    signal: AbortSignal,
    automatic = false,
    profileId: string | null = null,
  ): Promise<ImageGenerationOutcome> {
    if (!this.enabled) return failure('La génération d’image est désactivée.', 'forbidden');
    if (!validateInput(args)) return failure('Description d’image invalide.', 'invalid_params');
    if (this.provider === 'openai') {
      const reason = this.openaiUnavailable();
      if (reason) return failure(reason);
    } else {
      if (!this.configured) return failure('Générateur d’image non configuré sur ce serveur.');
      if (this.worker?.readyState !== 1)
        return failure('Générateur d’image indisponible.', 'unavailable', true);
    }
    if (signal.aborted || !scope.interactionId) return failure('Génération annulée.', 'cancelled');
    if (this.pending) {
      // Une illustration ne passe jamais devant ; une demande explicite coupe l’image en cours.
      if (automatic) return failure('Une génération d’image est déjà en cours.', 'busy', true);
      this.cancel('Image remplacée par une nouvelle demande.');
    }
    const input = { ...args, prompt: args.prompt.trim() };
    const id = randomUUID();
    const output = join(this.outputDirectory, id + '.webp');
    let abortListener = () => {};
    const promise = new Promise<ImageGenerationOutcome>((resolvePromise, rejectPromise) => {
      abortListener = () => {
        if (this.pending?.id === id) this.cancel('Génération annulée.');
      };
      const timer = setTimeout(() => this.cancel('La génération d’image a expiré.'), timeoutMs);
      timer.unref();
      this.pending = {
        id,
        output,
        input,
        model: this.provider === 'openai' ? this.openaiModel : this.model,
        automatic,
        profileId,
        startedAt: this.now(),
        timer,
        resolve: resolvePromise,
        reject: rejectPromise,
      };
      this.activityListener?.({
        kind: automatic ? 'illustration' : 'requested',
        startedAt: this.pending.startedAt,
      });
      signal.addEventListener('abort', abortListener, { once: true });
      if (this.provider === 'openai') this.remote(this.pending, this.openai!.creator()!);
      else
        this.send({
          type: 'generate',
          requestId: id,
          prompt: input.prompt,
          model: this.model,
          sanaSteps: this.model === 'sana-sprint-0.6b' ? this.sanaSteps : undefined,
          width: dimensions.width,
          height: dimensions.height,
          seed: input.seed,
          output,
        });
      this.detail =
        this.provider === 'openai' ? 'Création par OpenAI en cours…' : 'Génération en cours…';
      this.changed();
    });
    try {
      return await promise;
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : 'Génération impossible.',
        'unavailable',
        true,
      );
    } finally {
      signal.removeEventListener('abort', abortListener);
    }
  }

  /**
   * Image demandée parmi celles du foyer ou de la même personne, illustrations exclues : par
   * quelques mots du sujet, sinon par position (1 pour la plus récente).
   */
  private pick(
    input: RecallInput,
    profileId: string | null,
    verb: string,
  ): { image: StoredImage; position: number } | { summary: string } {
    const images = this.stored
      .filter(
        (image) => !image.automatic && (image.profileId === null || image.profileId === profileId),
      )
      .reverse();
    if (images.length === 0)
      return {
        summary: `Aucune image récente à ${verb} : les trois dernières sont effacées au redémarrage.`,
      };
    let image: StoredImage | undefined;
    if (input.search !== null) {
      const wanted = words(input.search);
      const ranked = images
        .map((candidate) => ({
          candidate,
          score: [...words(candidate.prompt)].filter((word) => wanted.has(word)).length,
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      image = ranked[0]?.candidate;
      if (!image)
        return {
          summary:
            'Aucune image récente ne correspond. Images disponibles, de la plus récente à la plus ancienne : ' +
            images.map((entry, index) => `${index + 1}. ${entry.prompt.slice(0, 80)}`).join(' ; '),
        };
    } else image = images[(input.position ?? 1) - 1];
    if (!image || !this.generatedFile(image.id))
      return {
        summary: `Il n’y a que ${images.length} image${images.length > 1 ? 's' : ''} récente${images.length > 1 ? 's' : ''} à ${verb}.`,
      };
    return { image, position: images.indexOf(image) + 1 };
  }

  /**
   * Fichier d’une image à joindre à un e-mail. Sans position ni recherche, l’image affichée
   * (illustration comprise) passe en premier, si elle est visible pour cette personne.
   */
  attachment(
    profileId: string | null,
    input: RecallInput & { shownId: string | null },
  ): { image: { id: string; prompt: string; path: string } } | { summary: string } {
    if (input.position === null && input.search === null && input.shownId) {
      const shown = this.stored.find(
        (image) =>
          image.id === input.shownId && (image.profileId === null || image.profileId === profileId),
      );
      const path = shown ? this.generatedFile(shown.id) : null;
      if (shown && path) return { image: { id: shown.id, prompt: shown.prompt, path } };
    }
    const picked = this.pick(input, profileId, 'envoyer');
    if (!('image' in picked)) return picked;
    const path = this.generatedFile(picked.image.id);
    if (!path) return { summary: 'L’image n’est plus disponible.' };
    return { image: { id: picked.image.id, prompt: picked.image.prompt, path } };
  }

  /** Réaffiche une image gardée en mémoire : celles du foyer, ou de la même personne. */
  recall(args: unknown, profileId: string | null): ImageGenerationOutcome {
    if (!this.enabled) return failure('La génération d’image est désactivée.', 'forbidden');
    if (!validateRecall(args)) return failure('Demande de rappel invalide.', 'invalid_params');
    const picked = this.pick(args, profileId, 'réafficher');
    if (!('image' in picked)) return failure(picked.summary);
    const { image, position } = picked;
    return {
      card: this.card(image.id, image.prompt, image.model),
      tool: {
        schemaVersion: 1,
        status: 'succeeded',
        result: { position, prompt: image.prompt, createdAt: image.createdAt },
        snapshotId: image.id,
        actionRunId: null,
        summary: 'L’image a été réaffichée sur le miroir.',
        error: null,
      },
    };
  }

  /** Confie l’image à OpenAI ; la réponse suit le même chemin que celle du générateur local. */
  private remote(pending: Pending, creator: OpenAIImageCreator) {
    const abort = new AbortController();
    pending.abort = abort;
    creator({
      prompt: pending.input.prompt,
      model: pending.model as OpenAIImageModel,
      quality: this.openaiQuality,
      signal: abort.signal,
    }).then(
      (image) => {
        if (this.pending?.id !== pending.id) return;
        if (image.length <= 12 || image.length > maxImageBytes) {
          this.receive({ type: 'error', requestId: pending.id, message: 'Image OpenAI invalide.' });
          return;
        }
        try {
          writeFileSync(pending.output, image, { mode: 0o600 });
        } catch {
          this.receive({
            type: 'error',
            requestId: pending.id,
            message: 'Impossible d’enregistrer l’image reçue d’OpenAI.',
          });
          return;
        }
        this.receive({ type: 'result', requestId: pending.id });
      },
      (error: unknown) => {
        if (this.pending?.id !== pending.id) return;
        this.receive({ type: 'error', requestId: pending.id, message: openAIImageError(error) });
      },
    );
  }

  generatedFile(id: string): string | null {
    if (!idPattern.test(id) || !this.stored.some((image) => image.id === id)) return null;
    const path = join(this.outputDirectory, id + '.webp');
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    return stat.isFile() && stat.size > 12 && stat.size <= maxImageBytes ? path : null;
  }

  private receive(event: Record<string, unknown>) {
    if (event.type === 'status') {
      this.loadedModel = IMAGE_GENERATION_MODELS.includes(event.model as ImageGenerationModel)
        ? (event.model as ImageGenerationModel)
        : null;
      this.device = typeof event.device === 'string' ? event.device.slice(0, 80) : null;
      const detail = typeof event.detail === 'string' ? event.detail.slice(0, 240) : this.detail;
      // Placement en VRAM, chargement et erreurs du worker : utiles pour comprendre une lenteur.
      if (detail !== this.detail && detail && !detail.startsWith('Chargement du modèle ou'))
        this.logs?.write('info', 'image', 'État du générateur d’image', {
          model: this.loadedModel,
          device: this.device,
          detail,
        });
      this.detail = detail;
      this.changed();
      return;
    }
    const pending = this.pending;
    if (!pending || event.requestId !== pending.id) {
      if (
        typeof event.requestId === 'string' &&
        idPattern.test(event.requestId) &&
        this.cancelled.delete(event.requestId)
      )
        this.remove(event.requestId);
      return;
    }
    clearTimeout(pending.timer);
    this.pending = null;
    this.activityListener?.(null);
    if (event.type === 'result' && this.remember(pending)) {
      this.lastDurationMs = Math.max(0, this.now() - pending.startedAt);
      const remote = isOpenAIModel(pending.model);
      if (!remote) this.loadedModel = pending.model as ImageGenerationModel;
      this.detail =
        (remote ? 'Dernière image créée par OpenAI en ' : 'Dernière image générée en ') +
        (this.lastDurationMs / 1000).toFixed(1) +
        ' s.';
      const card = this.card(pending.id, pending.input.prompt, pending.model);
      pending.resolve({
        card,
        tool: {
          schemaVersion: 1,
          status: 'succeeded',
          result: {
            imageUrl: card.imageUrl,
            model: card.model,
            width: card.width,
            height: card.height,
          },
          snapshotId: pending.id,
          actionRunId: null,
          summary: 'L’image a été créée et affichée sur le miroir.',
          error: null,
        },
      });
      this.logs?.write(
        'info',
        'image',
        remote ? 'Image créée par OpenAI' : 'Image générée localement',
        {
          model: pending.model,
          ...(remote ? { quality: this.openaiQuality } : {}),
          durationMs: this.lastDurationMs,
          width: card.width,
          height: card.height,
        },
      );
    } else {
      const message =
        typeof event.message === 'string' && event.message.trim()
          ? event.message.slice(0, 240)
          : 'Le générateur n’a pas produit d’image valide.';
      this.detail = message;
      this.logs?.write('warn', 'image', 'Génération d’image échouée', {
        model: pending.model,
        durationMs: Math.max(0, this.now() - pending.startedAt),
        message,
      });
      pending.reject(new Error(message));
    }
    this.changed();
  }

  private card(id: string, prompt: string, model: AnyImageModel): ImageCard {
    return {
      schemaVersion: 1,
      cardType: 'image',
      title: 'Image générée',
      prompt,
      imageUrl: `/api/generated-images/${id}.webp`,
      model,
      ...(isOpenAIModel(model)
        ? { width: OPENAI_IMAGE_SIZE, height: OPENAI_IMAGE_SIZE }
        : dimensions),
      primaryValue: null,
      subtitle: null,
      description: null,
      items: [],
      sources: [],
    };
  }

  /** Garde le fichier produit ; au-delà de trois, l’illustration puis l’image la plus ancienne partent. */
  private remember(pending: Pending): boolean {
    const path = join(this.outputDirectory, pending.id + '.webp');
    if (!existsSync(path) || !statSync(path).isFile()) return false;
    this.stored.push({
      id: pending.id,
      prompt: pending.input.prompt,
      model: pending.model,
      automatic: pending.automatic,
      profileId: pending.profileId,
      createdAt: this.now(),
    });
    while (this.stored.length > storedImages) {
      const illustration = this.stored.findIndex(
        (image, index) => image.automatic && index < this.stored.length - 1,
      );
      const [evicted] = this.stored.splice(illustration >= 0 ? illustration : 0, 1);
      this.remove(evicted!.id);
    }
    return this.generatedFile(pending.id) !== null;
  }

  private remove(id: string) {
    try {
      unlinkSync(join(this.outputDirectory, id + '.webp'));
    } catch {
      // Déjà supprimé, ou verrouillé : la purge du prochain démarrage le reprendra.
    }
  }

  private configure() {
    this.send({
      type: 'configure',
      model: this.model,
      preload: this.enabled && this.preload && this.provider === 'local',
    });
  }

  private send(value: unknown) {
    if (this.worker?.readyState === 1) this.worker.send(JSON.stringify(value));
  }

  /** Abandonne la génération en cours et demande au worker de l’interrompre. */
  private cancel(message: string) {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (pending.abort) pending.abort.abort();
    else this.send({ type: 'cancel', requestId: pending.id });
    this.cancelled.add(pending.id);
    if (this.cancelled.size > 256) this.cancelled.delete(this.cancelled.values().next().value!);
    // Une génération trop lente se voit ici : durée écoulée avant l’annulation ou l’expiration.
    this.logs?.write('info', 'image', 'Génération d’image interrompue', {
      model: pending.model,
      durationMs: Math.max(0, this.now() - pending.startedAt),
      reason: message,
    });
    this.detail = message;
    this.activityListener?.(null);
    pending.reject(new Error(message));
    this.changed();
  }

  /** Le cache ne survit pas à un redémarrage : aucune image ancienne n’est réaffichée. */
  private purge() {
    for (const name of readdirSync(this.outputDirectory)) {
      if (!generatedName.test(name)) continue;
      try {
        unlinkSync(join(this.outputDirectory, name));
      } catch {
        // Un fichier supprimé simultanément n’a pas besoin d’être retraité.
      }
    }
  }

  dispose() {
    this.cancel('Arrêt du serveur.');
    this.worker?.close(1001, 'Arrêt du serveur');
    this.worker = null;
    this.cancelled.clear();
    this.stored = [];
  }
}
