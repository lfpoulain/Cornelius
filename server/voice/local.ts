import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { VoiceConfiguration, VoiceConnection, VoiceProviderAdapter } from './provider.js';
import {
  pcmToWav,
  synthesizeOpenAiTts,
  synthesizeWyoming,
  transcribeOpenAiStt,
  transcribeWyoming,
  type WyomingEndpoint,
} from './wyoming.js';

export interface LocalVoiceOptions {
  ollamaUrl: string;
  ollamaModel: string;
  ollamaThink?: boolean;
  keepAlive?: string;
  sttUrl?: string;
  sttModel?: string;
  sttPrompt?: string;
  sttHotwords?: string;
  ttsUrl?: string;
  ttsModel?: string;
  ttsVoice?: string;
  whisper: WyomingEndpoint;
  piper: WyomingEndpoint & { voice?: string };
  searxngUrl?: string;
  fetch?: typeof globalThis.fetch;
  transcribe?: typeof transcribeWyoming;
  synthesize?: typeof synthesizeWyoming;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

const BYTES_PER_SECOND_16K = 32_000;
const CHUNK_BYTES = 3200; // 100 ms at 16 kHz mono PCM16
const CHUNK_PACE_MS = 85;
const PRE_ROLL_MAX_BYTES = 9_600; // ~300 ms at 16 kHz mono PCM16
const MIN_NOISE_FLOOR = 120;
const MAX_NOISE_FLOOR = 1200;
const INITIAL_NOISE_FLOOR = 250;
const SILENCE_END_MS = 520;
const SILERO_SILENCE_END_MS = 256; // Silero vad.py attend déjà 160 ms -> ~416 ms total
const MIN_SPEECH_MS = 240;
const MAX_UTTERANCE_MS = 12_000;
const POST_SPEECH_GUARD_MS = 550;
const BARGE_IN_FRAMES = 5; // ~160 ms de parole soutenue pour éviter les faux déclenchements par écho
const SILERO_STALE_MS = 2500;
const DEFAULT_STT_PROMPT =
  'Bonjour Cornelius, vérifie Home Assistant, la météo, les transports, les capteurs et mes rappels.';
const DEFAULT_STT_HOTWORDS = 'Cornelius Home Assistant Immich';

const STT_STOP_WORDS = new Set(
  [
    'allume',
    'éteins',
    'ouvre',
    'ferme',
    'mets',
    'lampe',
    'lumières',
    'lumière',
    'prise',
    'prises',
    'salon',
    'chambre',
    'cuisine',
    'bureau',
    'garage',
    'sous-sol',
    'palier',
    'jardin',
    'entrée',
    'température',
    'humidité',
    'batterie',
    'puissance',
    'énergie',
    'tension',
    'courant',
    'plante',
    'porte',
    'capteur',
    'capteurs',
    'appareil',
    'appareils',
    'source',
    'sources',
    'autorisée',
    'autorisées',
    'statut',
    'état',
    'niveau',
    'débit',
    'entrant',
    'sortant',
    'fibre',
    'imprimante',
    'panneau',
    'ampoule',
    'spots',
    'spot',
    'plafond',
    'tablette',
    'aquarium',
    'toutes',
    'parentale',
    'principale',
    'suspendu',
    'placard',
    'escalier',
    'salle',
    'manger',
    'extérieur',
    'extérieure',
    'ventilateur',
    'climatisation',
    'onduleur',
    'radiateur',
    'thermostat',
    'volet',
    'volets',
    'store',
    'machine',
    'café',
    'lave-linge',
    'lave-vaisselle',
    'sèche-linge',
    'aspirateur',
    'télé',
    'télévision',
    'écran',
    'enceinte',
    'amplificateur',
    'bandeau',
    'interrupteur',
    'bouton',
    'mouvement',
    'présence',
    'contact',
    'fenêtre',
    'fenêtres',
    'piscine',
    'arrosage',
    'compteur',
    'solaire',
    'réseau',
    'tramway',
    'métro',
    'train',
    'ligne',
    'station',
    'gare',
    'maison',
    'bonjour',
    'cornelius',
    'home',
    'assistant',
    'battery',
    'level',
    'state',
    'status',
    'power',
    'voltage',
    'current',
    'energy',
    'uptime',
    'memory',
    'network',
    'input',
    'output',
    'sensor',
    'binary',
    'switch',
    'light',
    'weather',
    'clock',
    'transit',
    'alarms',
    'memory',
  ].map((w) => w.toLowerCase()),
);

/** Builds safe, non-colliding French STT prompt & hotwords dynamically from configured tools. */
export function buildLocalSttHints(tools: VoiceConfiguration['tools'] = []): {
  prompt: string;
  hotwords: string;
} {
  if (!tools.length) {
    return { prompt: DEFAULT_STT_PROMPT, hotwords: DEFAULT_STT_HOTWORDS };
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  const addTerm = (raw: string) => {
    const clean = raw.trim().replace(/^[,.;:!?()[\]"]+|[,.;:!?()[\]"]+$/gu, '');
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key) || STT_STOP_WORDS.has(key)) return;
    if (!/[a-zà-öø-ÿ]/iu.test(clean)) return;
    // Keep safe acronyms (WLED, RER), hyphenated proper names (Brie-Comte-Robert), or capitalized/technical tokens >= 5 chars.
    const isSafeAcronym = /^[A-Z0-9]{3,6}$/u.test(clean);
    const isHyphenPlace =
      /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ-]+(?:-[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ-]+)+$/u.test(clean);
    const isLongTechOrProper = /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ0-9-]{4,}$/u.test(clean);
    if (!isSafeAcronym && !isHyphenPlace && !isLongTechOrProper) return;
    seen.add(key);
    terms.push(clean);
  };

  for (const tool of tools) {
    if (tool.name.startsWith('immich__')) addTerm('Immich');
    const desc = fixMojibake(tool.description ?? '');
    if (tool.name === 'home_assistant__control' || tool.name === 'home_assistant__read') {
      const marker = tool.name === 'home_assistant__control' ? 'Appareils : ' : 'Capteurs : ';
      const idx = desc.indexOf(marker);
      if (idx !== -1) {
        try {
          const parsed = JSON.parse(desc.slice(idx + marker.length)) as { name?: string }[];
          for (const item of parsed) {
            for (const token of String(item.name ?? '').split(/[\s/(),]+/u)) addTerm(token);
          }
          continue;
        } catch {
          // Fall through to generic token extraction.
        }
      }
    }
    const sourceMatch = /Sources? autorisées?\s*:\s*([^.]+)/iu.exec(desc);
    if (sourceMatch) {
      for (const token of sourceMatch[1]!.split(/[\s,()]+/u)) addTerm(token);
    }
  }

  const picked = terms.slice(0, 14);
  if (picked.length === 0) {
    return { prompt: DEFAULT_STT_PROMPT, hotwords: DEFAULT_STT_HOTWORDS };
  }
  return {
    prompt: `Bonjour Cornelius, vérifie Home Assistant, ${picked.slice(0, 10).join(', ')}.`,
    hotwords: ['Cornelius', ...picked].join(' '),
  };
}
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_MESSAGES = 12;

const HALLUCINATION_PATTERN =
  /amara\.org|sous-titres|sous-titrage|merci d'avoir|je vous remercie|société radio-canada|transcrit par|^sousa\.?$|^etc\.?$|^et cetera\.?$|^\s*[.…!,?\-]+\s*$/iu;
const REPETITION_HALLUCINATION_PATTERN =
  /\b([\p{L}'’-]{2,}(?:\s+[\p{L}'’-]{1,8}){0,2})(?:\s+\1){2,}\b/iu;
const STREAM_LOOP_PATTERN = /(.{10,}?)(?:\s*\1){2,}/iu;

export function hasStreamingRepetitionLoop(text: string): boolean {
  return STREAM_LOOP_PATTERN.test(text);
}

/** Repairs single/multi-encoded Latin-1/UTF-8 mojibake (e.g. "LumiÃÂÃÂ¨res" -> "Lumières"). */
export function fixMojibake(text: string): string {
  let current = text;
  for (let pass = 0; pass < 3; pass++) {
    if (!/[ÃÂÅ][\u0080-\u00bf]/u.test(current)) break;
    try {
      const decoded = Buffer.from(current, 'latin1').toString('utf8');
      if (!decoded || decoded === current || decoded.includes('\uFFFD')) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function compactSchemaForLocal(schema: unknown, dropEntityIdEnum = false): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => compactSchemaForLocal(entry, false));
  if (!schema || typeof schema !== 'object') return schema;
  const obj = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      key === 'description' ||
      key === 'title' ||
      key === '$schema' ||
      key === 'minLength' ||
      key === 'maxLength' ||
      key === 'maxItems' ||
      key === 'minimum' ||
      key === 'maximum' ||
      key === 'pattern' ||
      key === 'uniqueItems'
    ) {
      continue;
    }
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const nextProps: Record<string, unknown> = {};
      for (const [propKey, propSchema] of Object.entries(value as Record<string, unknown>)) {
        nextProps[propKey] = compactSchemaForLocal(
          propSchema,
          dropEntityIdEnum && propKey === 'entityId',
        );
      }
      out[key] = nextProps;
      continue;
    }
    if (key === 'enum' && dropEntityIdEnum) continue;
    out[key] = compactSchemaForLocal(value, false);
  }
  return out;
}

const COMPACT_STATIC_DESCRIPTIONS: Record<string, string> = {
  ui__show_luna_card:
    'Afficher une carte visuelle (capteur HA, liste ou recherche web). Jamais après clock, weather, transit, poubelles, vacances, carburants, homelab, printer3d, immich ou alarms.',
  alarms__set:
    'Régler réveil (kind=alarm), minuteur (kind=timer) ou rappel (kind=reminder). Heure fixe (« à 7 h », « ce soir à 20 h ») : time HH:MM, inMinutes=null, durationSeconds=null (ne convertis jamais en inMinutes). Délai (« dans 20 minutes ») : inMinutes=20, time=null, date=null (ne calcule jamais une heure). Minuteur (« minuteur de 8 minutes ») : kind=timer, durationSeconds=480 (en secondes), time=null, inMinutes=null. date AAAA-MM-JJ seulement pour « demain »/jour précis, sinon null.',
  alarms__list: 'Lister les réveils, minuteurs et rappels actifs.',
  alarms__cancel:
    'Annuler un réveil, minuteur ou rappel précis : kind (alarm/timer/reminder), match (mots-clés ex. « pâtes », « 07:00 »), id:null, all:false (all:true uniquement pour « tous » ou « tout »).',
  alarms__respond: 'Arrêter ou repousser (snooze) une alarme qui sonne.',
  image__generate:
    'Générer une image carrée 512x512 à partir d’une description fidèle et l’afficher.',
  image__recall: 'Réafficher une des 3 dernières images générées (position 1-3 ou search).',
  vision__look:
    'Regarder devant le miroir avec la caméra locale (uniquement sur demande explicite de ce qu’on voit).',
  memory__recall:
    'Consulter les souvenirs et préférences personnelles du profil actif (query court ou null, limit 1-10).',
};

const PROFILE_TAIL_TOOL_ORDER: Record<string, number> = {
  transit__read: 10,
  immich__memories: 20,
  immich__search: 21,
  ragator__ask: 30,
  http__send: 40,
  mail__send: 50,
  agents__capabilities: 60,
  agents__start: 61,
  agents__reply: 62,
  agents__status: 63,
  agents__cancel: 64,
};

/** Compacts verbose OpenAI-Live tool schemas/descriptions and puts profile-specific tools last for KV-cache sharing. */
export function compactToolsForLocal(
  tools: VoiceConfiguration['tools'],
): VoiceConfiguration['tools'] {
  const result: VoiceConfiguration['tools'] = [];
  for (const tool of tools) {
    if (tool.name === 'http__send' && !tool.description.includes('Commandes autorisées :')) {
      continue;
    }
    if (tool.name === 'mail__send' && !tool.description.includes('Destinataires possibles :')) {
      continue;
    }
    if (tool.name === 'home_assistant__control') {
      const marker = 'Appareils : ';
      const idx = tool.description.indexOf(marker);
      if (idx !== -1) {
        try {
          const parsed = JSON.parse(tool.description.slice(idx + marker.length)) as {
            id?: string;
            name?: string;
            aliases?: string[];
            brightness?: boolean;
            color?: boolean;
            colorTemp?: boolean;
          }[];
          const compactList = parsed
            .map((e) => {
              const flags = [
                e.brightness ? 'dim' : '',
                e.color ? 'rgb' : '',
                e.colorTemp ? 'ct' : '',
              ]
                .filter(Boolean)
                .join(',');
              const alias = e.aliases?.length ? `/${fixMojibake(e.aliases[0]!)}` : '';
              return `${e.id}=${fixMojibake(e.name ?? '')}${alias}${flags ? `[${flags}]` : ''}`;
            })
            .join('; ');
          result.push({
            ...tool,
            description:
              'Contrôler un appareil HA autorisé (entityId exact; turn_on/turn_off/toggle; brightnessPct 1-100 si [dim], rgbColor si [rgb], colorTempKelvin si [ct], sinon null). Appareils: ' +
              compactList,
            parameters: compactSchemaForLocal(tool.parameters, true) as Record<string, unknown>,
          });
          continue;
        } catch {
          // Keep fallback compaction below.
        }
      }
    }
    if (tool.name === 'home_assistant__read') {
      const marker = 'Capteurs : ';
      const idx = tool.description.indexOf(marker);
      if (idx !== -1) {
        try {
          const parsed = JSON.parse(tool.description.slice(idx + marker.length)) as {
            id?: string;
            name?: string;
            aliases?: string[];
            unit?: string;
          }[];
          const compactList = parsed
            .map((e) => {
              const alias = e.aliases?.length ? `/${fixMojibake(e.aliases[0]!)}` : '';
              const unit = e.unit ? `(${fixMojibake(e.unit)})` : '';
              return `${e.id}=${fixMojibake(e.name ?? '')}${alias}${unit}`;
            })
            .join('; ');
          result.push({
            ...tool,
            description: 'Lire un capteur HA autorisé par entityId exact. Capteurs: ' + compactList,
            parameters: compactSchemaForLocal(tool.parameters, true) as Record<string, unknown>,
          });
          continue;
        } catch {
          // Keep fallback compaction below.
        }
      }
    }
    const staticOverride = COMPACT_STATIC_DESCRIPTIONS[tool.name];
    let description = staticOverride ?? tool.description.trim();
    if (!staticOverride) {
      description = description.replace(/\s*Laisse instanceRef vide\./gu, '').trim();
    }
    const compactedParams = compactSchemaForLocal(tool.parameters, false) as Record<
      string,
      unknown
    >;
    if (
      tool.name === 'alarms__set' &&
      compactedParams.properties &&
      typeof compactedParams.properties === 'object'
    ) {
      (compactedParams.properties as Record<string, unknown>).owner = {
        type: 'string',
        enum: ['moi', 'foyer'],
      };
    }
    result.push({
      ...tool,
      description,
      parameters: compactedParams,
    });
  }
  return result.sort((a, b) => {
    const ra = PROFILE_TAIL_TOOL_ORDER[a.name] ?? 0;
    const rb = PROFILE_TAIL_TOOL_ORDER[b.name] ?? 0;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

export function looksLikeEmptyLookupStall(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 160) return false;
  return /\b(?:un instant|une seconde|je vais chercher|je cherche|je regarde|laisse-moi regarder|laisse-moi vérifier|laissez-moi vérifier|laissez-moi regarder)\b/iu.test(
    trimmed,
  );
}

export function localOllamaSampling(model: string): Record<string, number> {
  if (/^qwen3/iu.test(model)) {
    return {
      temperature: 0.3,
      top_p: 0.85,
      top_k: 20,
      min_p: 0.0,
      presence_penalty: 0.5,
      repeat_penalty: 1.05,
      num_ctx: 8192,
      num_predict: 160,
    };
  }
  if (/^ministral/iu.test(model)) {
    return {
      temperature: 0.25,
      top_p: 0.9,
      repeat_penalty: 1.08,
      presence_penalty: 0.4,
      num_ctx: 8192,
      num_predict: 160,
    };
  }
  return {
    temperature: 0.4,
    top_p: 0.85,
    repeat_penalty: 1.08,
    presence_penalty: 0.6,
    num_ctx: 8192,
    num_predict: 160,
  };
}

export function rmsPcm16(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const sample = pcm.readInt16LE(i * 2);
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

/** Strips internal metadata and accidental tool identifiers so TTS speaks clean French. */
export function cleanSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(
      /\b(?:home_assistant|immich|printer3d|homelab|weather|transit|poubelles|vacances|carburants|alarms|vision|memory|image|mail|http|agents|ui|satellite)__[a-z_]+\b/giu,
      '',
    )
    .replace(/(\d+)\s*\/\s*(\d+)\s*°\s*C\b/giu, '$1 à $2 degrés')
    .replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*C\b/giu, '$1 degrés')
    .replace(/(\d+(?:[.,]\d+)?)\s*€/gu, '$1 euros')
    .replace(/(\d+(?:[.,]\d+)?)\s*km\/h\b/giu, '$1 kilomètres heure')
    .replace(/(\d+(?:[.,]\d+)?)\s*Mbps\b/giu, '$1 mégabits par seconde')
    .replace(/(\d+(?:[.,]\d+)?)\s*kWh\b/giu, '$1 kilowattheures')
    .replace(/(\d+(?:[.,]\d+)?)\s*W\b/gu, '$1 watts')
    .replace(/(\d+(?:[.,]\d+)?)\s*%/gu, '$1 pour cent')
    .replace(/\s+/g, ' ')
    .trim();
}

export function popCompleteSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let remaining = buffer;
  while (true) {
    const match = /([.!?…](?:\s+|$)|\n+)/u.exec(remaining);
    if (match) {
      const endIndex = match.index + match[0].length;
      const piece = remaining.slice(0, endIndex).trim();
      remaining = remaining.slice(endIndex);
      if (piece.length >= 2) sentences.push(piece);
      continue;
    }
    const clause = /([,:;—–]\s+)/u.exec(remaining);
    if (clause && clause.index >= 14) {
      const endIndex = clause.index + clause[0].length;
      const piece = remaining.slice(0, endIndex).trim();
      remaining = remaining.slice(endIndex);
      if (piece.length >= 24) sentences.push(piece);
      continue;
    }
    break;
  }
  return { sentences, rest: remaining };
}

/** Strips internal metadata from tool results before feeding them back to Ollama. */
export function compactToolOutput(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
    delete parsed.schemaVersion;
    delete parsed.snapshotId;
    delete parsed.actionRunId;
    if (parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result)) {
      const res = { ...(parsed.result as Record<string, unknown>) };
      if (res.entity && typeof res.entity === 'object' && !Array.isArray(res.entity)) {
        const entity = { ...(res.entity as Record<string, unknown>) };
        delete entity.attributes;
        delete entity.aliases;
        delete entity.observedAt;
        res.entity = entity;
      }
      parsed.result = res;
    }
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function isAuthorizedHaEntity(entityId: string, toolDescription?: string): boolean {
  if (!toolDescription || !entityId) return false;
  const escaped = entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:"id"\\s*:\\s*"${escaped}"|\\b${escaped}=)`).test(toolDescription);
}

function resolveAuthorizedHaDomainSwap(
  entityId: string,
  pairs: readonly [string, string][],
  toolDescription?: string,
): string {
  if (!toolDescription || isAuthorizedHaEntity(entityId, toolDescription)) return entityId;
  for (const [a, b] of pairs) {
    if (entityId.startsWith(`${a}.`)) {
      const swapped = `${b}.${entityId.slice(a.length + 1)}`;
      if (isAuthorizedHaEntity(swapped, toolDescription)) return swapped;
    } else if (entityId.startsWith(`${b}.`)) {
      const swapped = `${a}.${entityId.slice(b.length + 1)}`;
      if (isAuthorizedHaEntity(swapped, toolDescription)) return swapped;
    }
  }
  return entityId;
}

/** Fills strict OpenAI null-required tool parameters omitted by local Ollama models. */
export function normalizeLocalToolArgs(
  name: string,
  args: Record<string, unknown>,
  toolDescription?: string,
): Record<string, unknown> {
  if (name === 'home_assistant__control') {
    const next = { ...args };
    if (next.entityId === undefined && typeof next.entity_id === 'string') {
      next.entityId = next.entity_id;
      delete next.entity_id;
    }
    if (typeof next.entityId === 'string') {
      next.entityId = resolveAuthorizedHaDomainSwap(
        next.entityId.trim(),
        [
          ['light', 'switch'],
          ['light', 'fan'],
          ['switch', 'input_boolean'],
          ['light', 'input_boolean'],
        ],
        toolDescription,
      );
    }
    return {
      ...next,
      brightnessPct: next.brightnessPct ?? null,
      rgbColor: next.rgbColor ?? null,
      colorTempKelvin: next.colorTempKelvin ?? null,
    };
  }
  if (name === 'home_assistant__read') {
    const next = { ...args };
    if (next.entityId === undefined && typeof next.entity_id === 'string') {
      next.entityId = next.entity_id;
      delete next.entity_id;
    }
    if (typeof next.entityId === 'string') {
      next.entityId = resolveAuthorizedHaDomainSwap(
        next.entityId.trim(),
        [['sensor', 'binary_sensor']],
        toolDescription,
      );
    }
    return next;
  }
  if (name === 'alarms__set') {
    const next: Record<string, unknown> = {
      ...args,
      time: args.time ?? null,
      date: args.date ?? null,
      inMinutes: args.inMinutes ?? null,
      durationSeconds: args.durationSeconds ?? null,
      days: Array.isArray(args.days) ? args.days : [],
      label: args.label ?? null,
    };
    const hasTime = typeof next.time === 'string' && /^\d{1,2}:\d{2}$/u.test(next.time.trim());
    if (hasTime) {
      const [hh, mm] = (next.time as string).trim().split(':');
      next.time = `${hh!.padStart(2, '0')}:${mm}`;
      next.durationSeconds = null;
      next.inMinutes = null;
      if (next.kind !== 'alarm' && next.kind !== 'reminder') {
        next.kind = typeof next.label === 'string' && next.label.trim() ? 'reminder' : 'alarm';
      }
    } else if (next.kind === 'timer' && (next.durationSeconds != null || next.inMinutes != null)) {
      if (
        next.durationSeconds == null &&
        typeof next.inMinutes === 'number' &&
        next.inMinutes > 0
      ) {
        next.durationSeconds = Math.round(next.inMinutes * 60);
        next.inMinutes = null;
      }
      next.time = null;
      next.date = null;
    }
    if (Array.isArray(next.days) && next.days.length > 0) {
      next.date = null;
    }
    return next;
  }
  if (name === 'alarms__cancel') {
    return {
      ...args,
      id: args.id ?? null,
      kind: args.kind ?? null,
      match: args.match ?? null,
      all: Boolean(args.all),
    };
  }
  if (
    name !== 'home_assistant__read' &&
    name !== 'image__recall' &&
    name !== 'memory__recall' &&
    (name.endsWith('__read') ||
      name.endsWith('__status') ||
      name.endsWith('__memories') ||
      name.endsWith('__search') ||
      name.endsWith('__ask'))
  ) {
    const singleSource = toolDescription?.includes('Source autorisée :') ?? false;
    if (singleSource) {
      return { ...args, instanceRef: null };
    }
    const rawRef = typeof args.instanceRef === 'string' ? args.instanceRef.trim() : '';
    const multiMatch = /Sources autorisées\s*:\s*([^.]+)\./u.exec(toolDescription ?? '');
    if (rawRef && multiMatch) {
      const entries = multiMatch[1]!
        .split(',')
        .map((chunk) => {
          const m = /^\s*([^\s(]+)\s*(?:\(([^)]+)\))?/u.exec(chunk.trim());
          return m ? { ref: m[1]!, label: (m[2] ?? '').toLowerCase() } : null;
        })
        .filter((e): e is { ref: string; label: string } => Boolean(e));
      const exact = entries.find((e) => e.ref === rawRef);
      if (!exact) {
        const needle = rawRef.toLowerCase();
        const byLabel = entries.find(
          (e) =>
            e.ref.toLowerCase() === needle || e.label.includes(needle) || needle.includes(e.label),
        );
        if (byLabel) return { ...args, instanceRef: byLabel.ref };
      }
    }
    return {
      ...args,
      instanceRef: args.instanceRef ?? null,
    };
  }
  return args;
}

export function isUsableTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length < 2) return false;
  if (HALLUCINATION_PATTERN.test(normalized)) return false;
  if (REPETITION_HALLUCINATION_PATTERN.test(normalized)) return false;
  return /[a-zà-öø-ÿ0-9]/iu.test(normalized);
}

async function querySearxng(
  baseUrl: string,
  query: string,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<{
  results: { title: string; url: string; content: string }[];
  sources: { title: string; url: string }[];
}> {
  const url = new URL('/search', baseUrl.replace(/\/+$/u, '') + '/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'fr');
  const searchSignal = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
  const response = await fetchImpl(url, { signal: searchSignal });
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
  const payload = (await response.json()) as {
    results?: { title?: unknown; url?: unknown; content?: unknown }[];
  };
  const items = (payload.results ?? []).slice(0, 3).flatMap((entry) => {
    if (typeof entry.url !== 'string') return [];
    const title =
      typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : entry.url;
    const content = typeof entry.content === 'string' ? entry.content.trim().slice(0, 180) : '';
    return [{ title: title.slice(0, 140), url: entry.url, content }];
  });
  return {
    results: items,
    sources: items.map(({ title, url }) => ({ title, url })),
  };
}

function formatLocalDateFr(now: Date = new Date(), timeZone = 'Europe/Paris'): string {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const readable = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return `${isoDate} (${readable})`;
}

/** Builds a short live context header injected right before the active user turn (after static system+tools KV prefix). */
export function buildLocalTurnContextHeader(
  baseInstructions: string,
  dynamicInstructions: string,
  includeDate: boolean,
  now: Date = new Date(),
): string {
  const combined = `${baseInstructions}\n${dynamicInstructions}`;
  const recognizedMatch =
    /Personne reconnue par la caméra[^:\n]*:\s*(?:"([^"\n]+)"|([^.\n]+))/iu.exec(combined);
  const recognizedName = (recognizedMatch?.[1] ?? recognizedMatch?.[2] ?? '').trim();
  const cameraStatus = recognizedName
    ? `Caméra : ${recognizedName} reconnu devant le miroir`
    : 'Caméra : personne inconnue / non reconnue devant le miroir';
  const parts = [cameraStatus];
  if (includeDate) parts.push(`Date : ${formatLocalDateFr(now)}`);
  const extraLines = dynamicInstructions
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('Personne reconnue par la caméra'));
  if (extraLines.length > 0) parts.push(extraLines.join(' '));
  return `[Contexte live — ${parts.join(' | ')}]`;
}

/** Builds Ollama function list with shared static tools + web_search before profile-varying tools for maximum KV-cache sharing. */
export function formatToolsForOllama(
  compacted: VoiceConfiguration['tools'],
  webSearch: boolean,
  hasSearxng: boolean,
) {
  const format = (tool: VoiceConfiguration['tools'][number]) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  });
  const shared = compacted.filter((t) => !(t.name in PROFILE_TAIL_TOOL_ORDER)).map(format);
  if (webSearch && hasSearxng) {
    shared.push({
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Recherche web locale via SearXNG (météo hors Brie-Comte-Robert, actualités, cours, scores, horaires publics, faits externes).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    });
  }
  const tail = compacted.filter((t) => t.name in PROFILE_TAIL_TOOL_ORDER).map(format);
  return [...shared, ...tail];
}

/** Warms up Ollama with Cornelius's shared static tool & prompt KV-cache prefix on server startup. */
export async function warmupLocalOllamaPrefix(options: {
  ollamaUrl: string;
  ollamaModel: string;
  keepAlive?: string;
  ollamaThink?: boolean;
  systemInstructions: string;
  tools: VoiceConfiguration['tools'];
  webSearch?: boolean;
  searxngUrl?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ ok: boolean; durationMs: number; promptEvalCount?: number }> {
  const started = Date.now();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.ollamaUrl.replace(/\/+$/u, '');
  const keepAlive = options.keepAlive ?? '-1';
  const disableThinking =
    options.ollamaThink === false ||
    (options.ollamaThink === undefined && /^qwen3(?:\b|\.)/iu.test(options.ollamaModel));
  const compacted = compactToolsForLocal(options.tools);
  const tools = formatToolsForOllama(
    compacted,
    options.webSearch ?? true,
    Boolean(options.searxngUrl),
  );
  const response = await fetchImpl(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: options.ollamaModel,
      keep_alive: /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive,
      stream: false,
      ...(disableThinking ? { think: false } : {}),
      messages: [{ role: 'system', content: options.systemInstructions }],
      ...(tools.length > 0 ? { tools } : {}),
      options: { ...localOllamaSampling(options.ollamaModel), num_predict: 1 },
    }),
  });
  if (!response.ok) return { ok: false, durationMs: Date.now() - started };
  const payload = (await response.json()) as { prompt_eval_count?: number };
  return {
    ok: true,
    durationMs: Date.now() - started,
    promptEvalCount: payload.prompt_eval_count,
  };
}

export function createLocalVoiceAdapter(options: LocalVoiceOptions): VoiceProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const transcribe =
    options.transcribe ??
    (options.sttUrl
      ? ({
          pcm16k,
          language,
          prompt,
          hotwords,
          signal,
        }: {
          endpoint: WyomingEndpoint;
          pcm16k: Buffer;
          language?: string;
          prompt?: string;
          hotwords?: string;
          signal?: AbortSignal;
        }) =>
          transcribeOpenAiStt({
            baseUrl: options.sttUrl!,
            model: options.sttModel ?? 'deepdml/faster-whisper-large-v3-turbo-ct2',
            pcm16k,
            language,
            prompt: options.sttPrompt ?? prompt ?? DEFAULT_STT_PROMPT,
            hotwords: options.sttHotwords ?? hotwords ?? DEFAULT_STT_HOTWORDS,
            vadFilter: true,
            responseFormat: 'verbose_json',
            signal,
            fetch: fetchImpl,
          })
      : transcribeWyoming);
  const synthesize =
    options.synthesize ??
    (options.ttsUrl
      ? async (input: {
          endpoint: WyomingEndpoint;
          text: string;
          voice?: string;
          signal?: AbortSignal;
          onChunk?: (pcm16k: Buffer) => void;
        }) => {
          let streamedBytes = 0;
          try {
            return await synthesizeOpenAiTts({
              baseUrl: options.ttsUrl!,
              model: options.ttsModel ?? 'kokoro',
              voice: options.ttsVoice ?? 'ff_siwis',
              langCode: 'f',
              text: input.text,
              stream: Boolean(input.onChunk),
              onChunk: input.onChunk
                ? (chunk) => {
                    streamedBytes += chunk.length;
                    input.onChunk!(chunk);
                  }
                : undefined,
              signal: input.signal,
              fetch: fetchImpl,
            });
          } catch (error) {
            if (streamedBytes > 0) return Buffer.alloc(0);
            console.warn('[local-voice] HTTP TTS fallback to Piper:', error);
            return synthesizeWyoming(input);
          }
        }
      : synthesizeWyoming);
  const baseUrl = options.ollamaUrl.replace(/\/+$/u, '');
  const keepAlive = options.keepAlive ?? '5m';
  const disableThinking =
    options.ollamaThink === false ||
    (options.ollamaThink === undefined && /^qwen3(?:\b|\.)/iu.test(options.ollamaModel));
  const samplingOptions = localOllamaSampling(options.ollamaModel);

  return {
    async connect(initialConfig, emit): Promise<VoiceConnection> {
      let config = initialConfig;
      let baseInstructions = initialConfig.instructions;
      let dynamicInstructions = '';
      let closed = false;
      let activeTurnAbort: AbortController | null = null;
      let processing = false;
      let speaking = false;
      let ignoreMicUntil = 0;

      const sessionId = randomUUID();
      const history: ChatMessage[] = [];
      const pendingTools = new Map<
        string,
        { resolve(value: string): void; timer: ReturnType<typeof setTimeout> }
      >();

      // Audio segmentation state (Silero VAD primary when available, adaptive RMS fallback)
      let sileroKnown = false;
      let sileroSpeaking = false;
      let sileroSpeechSeen = false;
      let sileroLastAt = 0;
      let bargeInFrames = 0;
      let preRoll: Buffer[] = [];
      let preRollBytes = 0;
      let speechChunks: Buffer[] = [];
      let speechBytes = 0;
      let inSpeech = false;
      let consecutiveSpeechFrames = 0;
      let silenceBytes = 0;
      let noiseFloor = INITIAL_NOISE_FLOOR;
      let noiseSamples = 0;

      const resetCapture = () => {
        sileroSpeechSeen = false;
        bargeInFrames = 0;
        preRoll = [];
        preRollBytes = 0;
        speechChunks = [];
        speechBytes = 0;
        inSpeech = false;
        consecutiveSpeechFrames = 0;
        silenceBytes = 0;
      };

      const sleep = (ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, ms);
          timer.unref();
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });

      const pacePcmOut = async (pcm: Buffer, signal: AbortSignal) => {
        if (pcm.length === 0) return;
        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
          if (closed || signal.aborted) return;
          const slice = pcm.subarray(offset, offset + CHUNK_BYTES);
          emit({ type: 'assistant_speech', pcm: slice });
          if (offset + CHUNK_BYTES < pcm.length) {
            await sleep(CHUNK_PACE_MS, signal);
          }
        }
      };

      const invokeTool = (name: string, args: unknown, signal: AbortSignal): Promise<string> => {
        if (closed || signal.aborted || pendingTools.size >= 32) {
          return Promise.resolve(JSON.stringify({ error: 'Session ou limite d’outils atteinte.' }));
        }
        const id = randomUUID();
        return new Promise<string>((resolve) => {
          const timer = setTimeout(() => {
            pendingTools.delete(id);
            resolve(JSON.stringify({ error: 'Délai de l’outil dépassé.' }));
          }, 60_000);
          timer.unref();
          const onAbort = () => {
            clearTimeout(timer);
            pendingTools.delete(id);
            resolve(JSON.stringify({ error: 'Appel outil annulé.' }));
          };
          signal.addEventListener('abort', onAbort, { once: true });
          pendingTools.set(id, {
            resolve: (value) => {
              signal.removeEventListener('abort', onAbort);
              resolve(value);
            },
            timer,
          });
          emit({
            type: 'tool_call',
            id,
            name,
            arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          });
        });
      };

      let cachedToolsSource: VoiceConfiguration['tools'] | null = null;
      let cachedCompactTools: VoiceConfiguration['tools'] = [];
      const compactedTools = (current: VoiceConfiguration) => {
        if (cachedToolsSource !== current.tools) {
          cachedToolsSource = current.tools;
          cachedCompactTools = compactToolsForLocal(current.tools);
        }
        return cachedCompactTools;
      };

      const buildToolsPayload = (current: VoiceConfiguration) =>
        formatToolsForOllama(
          compactedTools(current),
          current.webSearch,
          Boolean(options.searxngUrl),
        );

      const streamOllamaTurn = async (
        signal: AbortSignal,
        onSentence: (sentence: string) => void,
        deferStall = false,
      ): Promise<{
        content: string;
        toolCalls: OllamaToolCall[];
        ttftMs: number | null;
        deferred: string[];
      }> => {
        const tools = buildToolsPayload(config);
        const turnHeader = buildLocalTurnContextHeader(
          baseInstructions,
          dynamicInstructions,
          tools.some((t) => t.function.name === 'alarms__set'),
        );
        const outgoingHistory = history.map((msg) => ({ ...msg }));
        let injected = false;
        for (let i = outgoingHistory.length - 1; i >= 0; i--) {
          if (
            outgoingHistory[i]!.role === 'user' &&
            !outgoingHistory[i]!.content.startsWith('[Consigne interne')
          ) {
            outgoingHistory[i] = {
              ...outgoingHistory[i]!,
              content: `${turnHeader}\n${outgoingHistory[i]!.content}`,
            };
            injected = true;
            break;
          }
        }
        const messages: ChatMessage[] = [
          { role: 'system', content: baseInstructions },
          ...(injected ? [] : [{ role: 'user' as const, content: turnHeader }]),
          ...outgoingHistory,
        ];
        const reqStart = Date.now();
        let ttftMs: number | null = null;
        const turnController = new AbortController();
        const onAbort = () => turnController.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: turnController.signal,
            body: JSON.stringify({
              model: options.ollamaModel,
              keep_alive: /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive,
              stream: true,
              ...(disableThinking ? { think: false } : {}),
              messages,
              ...(tools.length > 0 ? { tools } : {}),
              options: samplingOptions,
            }),
          });
        } catch (err) {
          signal.removeEventListener('abort', onAbort);
          throw err;
        }
        if (!response.ok || !response.body) {
          signal.removeEventListener('abort', onAbort);
          throw new Error(`Ollama HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';
        let fullContent = '';
        let speechBuffer = '';
        const deferred: string[] = [];
        let emittedAnySentence = false;
        const toolCalls: OllamaToolCall[] = [];
        const dispatchSentence = (sentence: string) => {
          if (deferStall && !emittedAnySentence && looksLikeEmptyLookupStall(sentence)) {
            deferred.push(sentence);
            return;
          }
          emittedAnySentence = true;
          for (const queued of deferred.splice(0)) onSentence(queued);
          onSentence(sentence);
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              let chunk: {
                message?: { content?: string; tool_calls?: OllamaToolCall[] };
                error?: string;
              };
              try {
                chunk = JSON.parse(trimmed) as typeof chunk;
              } catch {
                continue;
              }
              if (chunk.error) throw new Error(chunk.error);
              if (chunk.message?.tool_calls?.length) {
                if (ttftMs === null) ttftMs = Date.now() - reqStart;
                toolCalls.push(...chunk.message.tool_calls);
              }
              const delta = chunk.message?.content ?? '';
              if (delta) {
                if (ttftMs === null) ttftMs = Date.now() - reqStart;
                fullContent += delta;
                if (hasStreamingRepetitionLoop(fullContent)) {
                  console.warn('[local-voice] Aborting LLM stream due to repetition loop');
                  turnController.abort();
                  break;
                }
                if (toolCalls.length === 0) {
                  speechBuffer += delta;
                  const { sentences, rest } = popCompleteSentences(speechBuffer);
                  speechBuffer = rest;
                  for (const sentence of sentences) dispatchSentence(sentence);
                }
              }
            }
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
        if (
          toolCalls.length === 0 &&
          speechBuffer.trim() &&
          !hasStreamingRepetitionLoop(speechBuffer)
        ) {
          dispatchSentence(speechBuffer.trim());
        }
        return { content: fullContent.trim(), toolCalls, ttftMs, deferred };
      };

      const runAssistantReply = async (signal: AbortSignal) => {
        let ttsChain = Promise.resolve();
        let startedSpeaking = false;
        let firstAudioAt: number | null = null;
        const assistantId = randomUUID();
        const turnStart = Date.now();
        let spokenText = '';
        let ttftFirst: number | null = null;

        const enqueueSpeech = (rawText: string) => {
          const clean = cleanSpeechText(rawText);
          if (!clean) return;
          spokenText = spokenText ? `${spokenText} ${clean}` : clean;

          const queue: Buffer[] = [];
          let finished = false;
          let streamedAny = false;
          let notify: (() => void) | null = null;
          const wake = () => {
            if (notify) {
              const fn = notify;
              notify = null;
              fn();
            }
          };

          const synthPromise = (
            synthesize as (input: {
              endpoint: WyomingEndpoint;
              text: string;
              voice?: string;
              signal?: AbortSignal;
              onChunk?: (pcm16k: Buffer) => void;
            }) => Promise<Buffer>
          )({
            endpoint: options.piper,
            text: clean,
            voice: options.piper.voice,
            signal,
            onChunk: (chunk) => {
              if (chunk.length > 0) {
                streamedAny = true;
                queue.push(chunk);
                wake();
              }
            },
          })
            .then((fullBuf) => {
              if (!streamedAny && fullBuf.length > 0) queue.push(fullBuf);
            })
            .catch(() => {})
            .finally(() => {
              finished = true;
              wake();
            });

          ttsChain = ttsChain.then(async () => {
            while (!closed && !signal.aborted) {
              if (queue.length > 0) {
                const pcm = queue.shift()!;
                if (!startedSpeaking) {
                  startedSpeaking = true;
                  speaking = true;
                  firstAudioAt = Date.now() - turnStart;
                  emit({ type: 'state', state: 'speaking' });
                }
                await pacePcmOut(pcm, signal);
                continue;
              }
              if (finished) break;
              await new Promise<void>((resolve) => {
                const onAbort = () => {
                  notify = null;
                  resolve();
                };
                notify = () => {
                  signal.removeEventListener('abort', onAbort);
                  resolve();
                };
                signal.addEventListener('abort', onAbort, { once: true });
              });
            }
            await synthPromise;
          });
        };

        try {
          let retriedEmptyStall = false;
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (closed || signal.aborted) return;
            const deferStall =
              round === 0 && !retriedEmptyStall && buildToolsPayload(config).length > 0;
            const { content, toolCalls, ttftMs, deferred } = await streamOllamaTurn(
              signal,
              enqueueSpeech,
              deferStall,
            );
            if (ttftFirst === null) ttftFirst = ttftMs;
            if (toolCalls.length === 0) {
              if (
                deferStall &&
                deferred.length > 0 &&
                !spokenText &&
                looksLikeEmptyLookupStall(content)
              ) {
                retriedEmptyStall = true;
                history.push({ role: 'assistant', content });
                history.push({
                  role: 'user',
                  content:
                    '[Consigne interne : Tu as annoncé une recherche sans appeler d’outil. Appelle immédiatement l’outil requis sans texte d’attente, ou donne directement la réponse/refus sans dire « un instant ».]',
                });
                continue;
              }
              for (const queued of deferred) enqueueSpeech(queued);
              if (content) history.push({ role: 'assistant', content });
              break;
            }
            history.push({ role: 'assistant', content, tool_calls: toolCalls });
            for (const call of toolCalls) {
              const name = call.function?.name ?? '';
              const rawArgs = call.function?.arguments ?? {};
              const parsedArgs =
                typeof rawArgs === 'string'
                  ? (() => {
                      try {
                        return JSON.parse(rawArgs) as Record<string, unknown>;
                      } catch {
                        return {};
                      }
                    })()
                  : rawArgs;
              if (name === 'web_search' && options.searxngUrl) {
                const searchId = randomUUID();
                emit({ type: 'web_search', id: searchId, active: true });
                try {
                  const query = typeof parsedArgs.query === 'string' ? parsedArgs.query : '';
                  const result = await querySearxng(options.searxngUrl, query, fetchImpl, signal);
                  emit({
                    type: 'web_search',
                    id: searchId,
                    active: false,
                    sources: result.sources,
                  });
                  history.push({ role: 'tool', content: JSON.stringify(result.results) });
                } catch (error) {
                  emit({ type: 'web_search', id: searchId, active: false });
                  history.push({
                    role: 'tool',
                    content: JSON.stringify({ error: (error as Error).message }),
                  });
                }
              } else if (name) {
                const toolDesc = config.tools.find((tool) => tool.name === name)?.description;
                const rawEntityId =
                  (name === 'home_assistant__read' || name === 'home_assistant__control') &&
                  typeof (parsedArgs.entityId ?? parsedArgs.entity_id) === 'string'
                    ? String(parsedArgs.entityId ?? parsedArgs.entity_id)
                    : '';
                const multiEntityIds = rawEntityId.includes(',')
                  ? rawEntityId
                      .split(',')
                      .map((part) => part.trim())
                      .filter((part) => /^[a-z_]+\.[a-z0-9_]+$/iu.test(part))
                  : [];
                if (multiEntityIds.length >= 2) {
                  const toolStart = Date.now();
                  const combined = await Promise.all(
                    multiEntityIds.map(async (eid) => {
                      const itemArgs = normalizeLocalToolArgs(
                        name,
                        { ...parsedArgs, entityId: eid, entity_id: undefined },
                        toolDesc,
                      );
                      console.info(`[local-voice] tool_call ${name}(${JSON.stringify(itemArgs)})`);
                      const out = compactToolOutput(await invokeTool(name, itemArgs, signal));
                      try {
                        return JSON.parse(out) as unknown;
                      } catch {
                        return out;
                      }
                    }),
                  );
                  const serialized = JSON.stringify(combined);
                  console.info(
                    `[local-voice] tool_result ${name} x${multiEntityIds.length} (${Date.now() - toolStart}ms): ${serialized.slice(0, 220)}`,
                  );
                  history.push({ role: 'tool', content: serialized });
                } else {
                  const normalizedArgs = normalizeLocalToolArgs(name, parsedArgs, toolDesc);
                  const toolStart = Date.now();
                  console.info(
                    `[local-voice] tool_call ${name}(${JSON.stringify(normalizedArgs)})`,
                  );
                  const output = await invokeTool(name, normalizedArgs, signal);
                  const compacted = compactToolOutput(output);
                  console.info(
                    `[local-voice] tool_result ${name} (${Date.now() - toolStart}ms): ${compacted.slice(0, 220)}`,
                  );
                  history.push({ role: 'tool', content: compacted });
                }
              }
            }
          }
          await ttsChain;
        } catch (error) {
          await ttsChain.catch(() => {});
          throw error;
        }
        if (history.length > MAX_HISTORY_MESSAGES) {
          history.splice(0, history.length - MAX_HISTORY_MESSAGES);
          while (history.length > 0 && history[0]!.role === 'tool') {
            history.shift();
          }
        }
        if (spokenText && !signal.aborted && !closed) {
          console.info(
            `[local-voice] LLM reply (${Date.now() - turnStart}ms, ttft=${ttftFirst ?? '-'}ms, ttfa=${firstAudioAt ?? '-'}ms): ${JSON.stringify(spokenText)}`,
          );
          emit({
            type: 'assistant_transcript',
            id: assistantId,
            text: spokenText,
            startMs: turnStart,
            endMs: Date.now(),
          });
        }
      };

      const processUtterance = async (pcm: Buffer) => {
        if (closed || processing) return;
        processing = true;
        const turnAbort = new AbortController();
        activeTurnAbort = turnAbort;
        const turnStart = Date.now();
        try {
          const debugDir = process.env.CORNELIUS_LOCAL_DEBUG_AUDIO_DIR;
          if (debugDir) {
            try {
              mkdirSync(debugDir, { recursive: true });
              writeFileSync(`${debugDir}/utt-${Date.now()}.wav`, pcmToWav(pcm));
            } catch {
              // Diagnostic only.
            }
          }
          const sttStart = Date.now();
          const dynamicStt =
            !options.sttPrompt || !options.sttHotwords ? buildLocalSttHints(config.tools) : null;
          const text = await transcribe({
            endpoint: options.whisper,
            pcm16k: pcm,
            language: 'fr',
            ...(dynamicStt
              ? {
                  prompt: options.sttPrompt ?? dynamicStt.prompt,
                  hotwords: options.sttHotwords ?? dynamicStt.hotwords,
                }
              : {}),
            signal: turnAbort.signal,
          });
          const sttMs = Date.now() - sttStart;
          const audioMs = Math.round((pcm.length / BYTES_PER_SECOND_16K) * 1000);
          const usable = isUsableTranscript(text);
          console.info(
            `[local-voice] STT (stt=${sttMs}ms, audio=${audioMs}ms, floor=${Math.round(noiseFloor)}, silero=${sileroKnown}, usable=${usable}): ${JSON.stringify(text)}`,
          );
          if (closed || turnAbort.signal.aborted || !usable) {
            return;
          }
          emit({
            type: 'user_transcript',
            id: randomUUID(),
            text,
            startMs: turnStart,
            endMs: Date.now(),
          });
          emit({ type: 'state', state: 'thinking' });
          history.push({ role: 'user', content: text });
          await runAssistantReply(turnAbort.signal);
          console.info(`[local-voice] Turn total ${Date.now() - turnStart}ms`);
          if (!closed && !turnAbort.signal.aborted) {
            emit({ type: 'turn_completed' });
          }
        } catch (error) {
          if (turnAbort.signal.aborted) {
            console.info('[local-voice] Turn aborted (barge-in)');
          } else {
            console.error('[local-voice] Turn error:', error);
          }
          if (!closed && !turnAbort.signal.aborted) {
            emit({
              type: 'error',
              code: 'local_voice_failed',
              message: error instanceof Error ? error.message : 'Erreur du moteur vocal local.',
            });
          }
        } finally {
          if (activeTurnAbort === turnAbort) {
            if (speaking) {
              speaking = false;
              ignoreMicUntil = Date.now() + POST_SPEECH_GUARD_MS;
            }
            resetCapture();
            activeTurnAbort = null;
            processing = false;
            if (!closed) emit({ type: 'state', state: 'listening' });
          }
        }
      };

      const runGreeting = async () => {
        const text = config.welcomeMessage?.trim();
        const prompt = config.welcomeInstructions?.trim();
        if (!text && !prompt) return;
        processing = true;
        const turnAbort = new AbortController();
        activeTurnAbort = turnAbort;
        try {
          if (text) {
            const clean = cleanSpeechText(text);
            const pcm = await synthesize({
              endpoint: options.piper,
              text: clean,
              voice: options.piper.voice,
              signal: turnAbort.signal,
            });
            if (!closed && !turnAbort.signal.aborted && pcm.length > 0) {
              speaking = true;
              emit({ type: 'state', state: 'speaking' });
              await pacePcmOut(pcm, turnAbort.signal);
              emit({
                type: 'assistant_transcript',
                id: randomUUID(),
                text: clean,
                startMs: Date.now(),
                endMs: Date.now(),
              });
              history.push({ role: 'assistant', content: clean });
              emit({ type: 'turn_completed' });
            }
          } else if (prompt) {
            history.push({ role: 'user', content: prompt });
            await runAssistantReply(turnAbort.signal);
            if (!closed && !turnAbort.signal.aborted) emit({ type: 'turn_completed' });
          }
        } catch {
          // Greeting is optional: never abort the conversation if it times out.
        } finally {
          if (activeTurnAbort === turnAbort) {
            if (speaking) {
              speaking = false;
              ignoreMicUntil = Date.now() + POST_SPEECH_GUARD_MS;
            }
            resetCapture();
            activeTurnAbort = null;
            processing = false;
            if (!closed) emit({ type: 'state', state: 'listening' });
          }
        }
      };

      emit({ type: 'connected', id: sessionId });
      emit({ type: 'state', state: 'listening' });
      if (config.welcomeMessage || config.welcomeInstructions) {
        void runGreeting();
      }

      return {
        vad(active) {
          if (closed) return;
          sileroKnown = true;
          sileroLastAt = Date.now();
          sileroSpeaking = active;
          if (active && inSpeech) sileroSpeechSeen = true;
        },
        audio(pcm) {
          if (closed) return;
          if (pcm.length === 0) return;
          const now = Date.now();
          const useSilero = sileroKnown && now - sileroLastAt <= SILERO_STALE_MS;
          const energy = rmsPcm16(pcm);

          if (speaking || processing) {
            // Keep a short pre-roll while assistant is active so barge-in doesn't clip the first word.
            preRoll.push(pcm);
            preRollBytes += pcm.length;
            while (preRollBytes > PRE_ROLL_MAX_BYTES && preRoll.length > 1) {
              preRollBytes -= preRoll.shift()!.length;
            }
            const bargeThreshold = Math.max(950, noiseFloor * 2.8);
            const userVocalising = useSilero
              ? sileroSpeaking && energy >= bargeThreshold
              : energy >= Math.max(800, bargeThreshold * 1.3);
            if (userVocalising) {
              bargeInFrames++;
              if (bargeInFrames >= BARGE_IN_FRAMES) {
                console.info(
                  `[local-voice] Barge-in detected (rms=${Math.round(energy)}, floor=${Math.round(noiseFloor)}, silero=${useSilero && sileroSpeaking})`,
                );
                bargeInFrames = 0;
                speaking = false;
                processing = false;
                ignoreMicUntil = 0;
                activeTurnAbort?.abort();
                activeTurnAbort = null;
                emit({ type: 'interrupted' });
                emit({ type: 'state', state: 'listening' });
                inSpeech = true;
                sileroSpeechSeen = true;
                speechChunks = [...preRoll];
                speechBytes = preRollBytes;
                preRoll = [];
                preRollBytes = 0;
                silenceBytes = 0;
              }
            } else {
              bargeInFrames = 0;
            }
            return;
          }

          if (now < ignoreMicUntil) {
            resetCapture();
            sileroSpeaking = false;
            return;
          }

          if (!inSpeech) {
            if (noiseSamples === 0 && energy <= MAX_NOISE_FLOOR) {
              noiseFloor = Math.max(MIN_NOISE_FLOOR, energy);
              noiseSamples = 1;
            } else if (energy < Math.max(650, noiseFloor * 2.0)) {
              const alpha = noiseSamples < 8 ? 0.3 : energy < noiseFloor ? 0.12 : 0.03;
              noiseFloor = noiseFloor * (1 - alpha) + energy * alpha;
              noiseSamples++;
            }
            noiseFloor = Math.max(MIN_NOISE_FLOOR, Math.min(MAX_NOISE_FLOOR, noiseFloor));
            const startThreshold = Math.max(650, noiseFloor * 2.5);

            preRoll.push(pcm);
            preRollBytes += pcm.length;
            while (preRollBytes > PRE_ROLL_MAX_BYTES && preRoll.length > 1) {
              preRollBytes -= preRoll.shift()!.length;
            }
            if (useSilero) {
              if (sileroSpeaking) {
                inSpeech = true;
                sileroSpeechSeen = true;
                speechChunks = [...preRoll];
                speechBytes = preRollBytes;
                preRoll = [];
                preRollBytes = 0;
                silenceBytes = 0;
              }
              return;
            }
            if (energy >= startThreshold) {
              consecutiveSpeechFrames++;
              if (consecutiveSpeechFrames >= 2 || energy >= startThreshold * 1.6) {
                inSpeech = true;
                sileroSpeechSeen = true;
                speechChunks = [...preRoll];
                speechBytes = preRollBytes;
                preRoll = [];
                preRollBytes = 0;
                silenceBytes = 0;
              }
            } else {
              consecutiveSpeechFrames = 0;
            }
            return;
          }

          speechChunks.push(pcm);
          speechBytes += pcm.length;
          if (useSilero) {
            if (sileroSpeaking) {
              sileroSpeechSeen = true;
              silenceBytes = 0;
            } else {
              silenceBytes += pcm.length;
            }
          } else {
            const keepThreshold = Math.max(420, noiseFloor * 1.55);
            if (energy < keepThreshold) silenceBytes += pcm.length;
            else silenceBytes = 0;
          }

          const speechMs = (speechBytes / BYTES_PER_SECOND_16K) * 1000;
          const silenceMs = (silenceBytes / BYTES_PER_SECOND_16K) * 1000;
          const silenceLimitMs = useSilero ? SILERO_SILENCE_END_MS : SILENCE_END_MS;
          if (silenceMs >= silenceLimitMs || speechMs >= MAX_UTTERANCE_MS) {
            const captured = Buffer.concat(speechChunks);
            const validSpeech = !useSilero || sileroSpeechSeen;
            resetCapture();
            if (validSpeech && speechMs >= MIN_SPEECH_MS) {
              void processUtterance(captured);
            }
          }
        },
        result(id, output) {
          const entry = pendingTools.get(id);
          if (!entry) return;
          clearTimeout(entry.timer);
          pendingTools.delete(id);
          entry.resolve(output);
        },
        async update(nextConfig) {
          if (nextConfig.instructions.startsWith(baseInstructions)) {
            dynamicInstructions = nextConfig.instructions.slice(baseInstructions.length).trim();
          } else {
            baseInstructions = nextConfig.instructions;
            dynamicInstructions = '';
          }
          config = nextConfig;
        },
        async close() {
          if (closed) return;
          closed = true;
          activeTurnAbort?.abort();
          for (const [, entry] of pendingTools) {
            clearTimeout(entry.timer);
            entry.resolve(JSON.stringify({ error: 'Session fermée.' }));
          }
          pendingTools.clear();
          emit({ type: 'closed' });
        },
      };
    },
  };
}
