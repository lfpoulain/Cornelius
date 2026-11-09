import type { ToolResult } from '../shared/addons.js';
import type { SatelliteHub } from './satellites.js';
import type { SatelliteStore } from './satellites-store.js';

/** Outil vocal des conversations de satellite : « parle moins fort », « volume à 5 ». */
export const SATELLITE_VOLUME_TOOL = 'satellite__volume';
/** Un cran de « plus fort » ou « moins fort », sur l’échelle de 0 à 10 de l’administration. */
const STEP = 2;

export const satelliteVolumeTool = {
  name: SATELLITE_VOLUME_TOOL,
  description:
    'Régler le volume du haut-parleur du satellite où se tient la conversation. level : de 0 (muet) à 10 pour une valeur dite (« mets le volume à 5 »), sinon null. change : louder pour « parle plus fort », quieter pour « parle moins fort », sinon null. Exactement l’un des deux. Redis le niveau renvoyé, sur 10.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['level', 'change'],
    properties: {
      level: { anyOf: [{ type: 'integer', minimum: 0, maximum: 10 }, { type: 'null' }] },
      change: { anyOf: [{ type: 'string', enum: ['louder', 'quieter'] }, { type: 'null' }] },
    },
  } as Record<string, unknown>,
};

function result(status: ToolResult['status'], summary: string, level: number | null): ToolResult {
  return {
    schemaVersion: 1,
    status,
    result: level === null ? null : { level },
    snapshotId: null,
    actionRunId: null,
    summary,
    error:
      status === 'succeeded'
        ? null
        : {
            code: status === 'failed' ? 'invalid_params' : 'unavailable',
            message: summary,
            retryable: false,
          },
  };
}

/**
 * Nouveau volume du satellite, enregistré comme depuis l’administration (0 à 100 en base,
 * présenté de 0 à 10) puis envoyé au satellite connecté par le message settings.
 */
export function setSatelliteVolume(
  store: Pick<SatelliteStore, 'get' | 'update'>,
  hub: Pick<SatelliteHub, 'refresh'>,
  satelliteId: string,
  args: unknown,
): ToolResult {
  const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const level = input.level;
  const change = input.change;
  const keys = Object.keys(input);
  const validLevel =
    level === null ||
    (Number.isInteger(level) && (level as number) >= 0 && (level as number) <= 10);
  const validChange = change === null || change === 'louder' || change === 'quieter';
  if (
    !validLevel ||
    !validChange ||
    keys.some((key) => key !== 'level' && key !== 'change') ||
    (level === null) === (change === null)
  )
    return result(
      'failed',
      'Volume invalide : donnez un niveau de 0 à 10, ou plus fort / moins fort.',
      null,
    );
  const satellite = store.get(satelliteId);
  if (!satellite) return result('unknown', 'Satellite introuvable.', null);
  const current = Math.round(satellite.volume / 10);
  const next =
    level !== null
      ? (level as number)
      : Math.min(10, Math.max(0, current + (change === 'louder' ? STEP : -STEP)));
  const updated = store.update(satelliteId, { volume: next * 10 });
  if (!updated) return result('unknown', 'Satellite introuvable.', null);
  hub.refresh(updated);
  return result(
    'succeeded',
    (next === current
      ? `Le volume est déjà à ${next} sur 10${next === 10 ? ', le maximum' : next === 0 ? ', le minimum' : ''}.`
      : `Volume réglé à ${next} sur 10.`) +
      // Le satellite joue ses sonneries au même volume : à 0, elles sont muettes aussi.
      (next === 0
        ? ' Attention : les réveils et minuteurs de ce satellite seront muets aussi.'
        : ''),
    next,
  );
}
