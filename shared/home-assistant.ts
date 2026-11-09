/**
 * Appareils que Luna peut allumer ou éteindre : lumières, prises, modes (`input_boolean`),
 * ventilateurs, scripts (lancer, arrêter) et scènes (activer seulement).
 */
export const HOME_ASSISTANT_CONTROL_DOMAINS = [
  'light',
  'switch',
  'input_boolean',
  'fan',
  'script',
  'scene',
] as const;
/** Entités lues seulement : capteurs, minuteries, thermostats, volets, serrures… */
export const HOME_ASSISTANT_SENSOR_DOMAINS = [
  'sensor',
  'binary_sensor',
  'timer',
  'input_datetime',
  'input_number',
  'input_select',
  'counter',
  'climate',
  'cover',
  'lock',
] as const;
export type HomeAssistantDomain =
  (typeof HOME_ASSISTANT_CONTROL_DOMAINS)[number] | (typeof HOME_ASSISTANT_SENSOR_DOMAINS)[number];
export const HOME_ASSISTANT_ENTITY_PATTERN =
  '^(' +
  [...HOME_ASSISTANT_CONTROL_DOMAINS, ...HOME_ASSISTANT_SENSOR_DOMAINS].join('|') +
  ')\\.[a-z0-9_]+$';

export interface HomeAssistantEntity {
  id: string;
  name: string;
  aliases: string[];
  domain: HomeAssistantDomain;
  state: string;
  brightness: boolean;
  brightnessPct: number | null;
  observedAt: string | null;
  /** Capteurs : unité et classe Home Assistant (absentes des anciens catalogues). */
  unit?: string | null;
  deviceClass?: string | null;
  /** Attributs utiles seulement : fin de minuterie, température, position… */
  attributes?: Record<string, string | number | boolean | null>;
  /** Lumières : couleur et blanc réglables, état de couleur relu dans Home Assistant. */
  color?: boolean;
  colorTemp?: boolean;
  rgbColor?: [number, number, number] | null;
  colorTempKelvin?: number | null;
  minColorTempKelvin?: number | null;
  maxColorTempKelvin?: number | null;
}

export function isControllable(entity: Pick<HomeAssistantEntity, 'domain'>): boolean {
  return (HOME_ASSISTANT_CONTROL_DOMAINS as readonly string[]).includes(entity.domain);
}

/** Une scène s’active seulement ; tout le reste s’allume et s’éteint. */
export function controlActions(
  entity: Pick<HomeAssistantEntity, 'domain'>,
): ('turn_on' | 'turn_off')[] {
  if (!isControllable(entity)) return [];
  return entity.domain === 'scene' ? ['turn_on'] : ['turn_on', 'turn_off'];
}

/**
 * Scripts et scènes se déclenchent : un script court repasse aussitôt à « off », l’état d’une
 * scène est l’heure de sa dernière activation. Leur confirmation est une mise à jour de l’état.
 */
export function isTriggered(entity: Pick<HomeAssistantEntity, 'domain'>): boolean {
  return entity.domain === 'script' || entity.domain === 'scene';
}

export interface HomeAssistantView {
  url: string;
  hasToken: boolean;
  enabled: boolean;
  connected: boolean;
  error: string | null;
  entities: HomeAssistantEntity[];
  selected: string[];
  revision: number;
  /** Luna ne commande ni ne lit la maison sans personne reconnue devant le miroir. */
  knownPeopleOnly: boolean;
}

export interface HomeAssistantCommand {
  entityId: string;
  action: 'read' | 'turn_on' | 'turn_off';
  brightnessPct: number | null;
  /** Couleur demandée (0 à 255 par canal) ; absente ou null : inchangée. */
  rgbColor?: [number, number, number] | null;
  /** Blanc demandé, en kelvins ; absent ou null : inchangé. */
  colorTempKelvin?: number | null;
}
