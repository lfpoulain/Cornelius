/** Appareils que Luna peut allumer ou éteindre. */
export const HOME_ASSISTANT_CONTROL_DOMAINS = ['light', 'switch'] as const;
/** Entités lues seulement : capteurs, minuteries, thermostats, volets, serrures… */
export const HOME_ASSISTANT_SENSOR_DOMAINS = [
  'sensor',
  'binary_sensor',
  'timer',
  'input_datetime',
  'input_number',
  'input_boolean',
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
  return entity.domain === 'light' || entity.domain === 'switch';
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
  /**
   * Entités apparues dans Home Assistant depuis le dernier enregistrement de la sélection : à
   * cocher si Cornelius doit s’en servir. Rien ne devient utilisable sans être coché.
   */
  newEntities: string[];
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
