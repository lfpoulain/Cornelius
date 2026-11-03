export const GESTURES = ['up', 'down', 'left', 'right', 'forward', 'backward', 'wave'] as const;
export type Gesture = (typeof GESTURES)[number];
export const GESTURE_ACTIONS = [
  'none',
  'volume_up',
  'volume_down',
  'stop',
  'mute',
  'mic_toggle',
  'night_light',
  'lights_on',
  'lights_off',
] as const;
export type GestureAction = (typeof GESTURE_ACTIONS)[number];
export interface GestureConfig {
  enabled: boolean;
  lightEntityIds?: string[];
  bindings: Record<Gesture, GestureAction>;
}
export const GESTURE_LABELS: Record<Gesture, string> = {
  up: 'Vers le haut',
  down: 'Vers le bas',
  left: 'Vers la gauche',
  right: 'Vers la droite',
  forward: 'Vers le capteur',
  backward: 'Éloigner la main',
  wave: 'Agitation de la main',
};
export const ACTION_LABELS: Record<GestureAction, string> = {
  none: 'Aucune commande',
  volume_up: 'Volume +10',
  volume_down: 'Volume −10',
  stop: 'Terminer la conversation de ce satellite',
  mute: 'Couper le micro',
  mic_toggle: 'Couper le micro (bouton pour le rouvrir)',
  night_light: 'Basculer la veilleuse',
  lights_on: 'Allumer les lampes sélectionnées de ce satellite',
  lights_off: 'Éteindre les lampes sélectionnées de ce satellite',
};
export function defaultGestureConfig(): GestureConfig {
  return {
    enabled: false,
    lightEntityIds: [],
    bindings: Object.fromEntries(GESTURES.map((g) => [g, 'none'])) as GestureConfig['bindings'],
  };
}
export function suggestedGestureConfig(): GestureConfig {
  const config = defaultGestureConfig();
  Object.assign(config.bindings, {
    up: 'volume_up',
    down: 'volume_down',
    left: 'lights_off',
    right: 'lights_on',
    forward: 'stop',
  });
  return config;
}
