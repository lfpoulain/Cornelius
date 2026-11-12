/** Réglages d’un satellite, modifiables dans l’administration et envoyés au satellite. */
export interface SatelliteSettings {
  /** Volume du haut-parleur, de 0 à 100 (l’administration le présente de 0 à 10). */
  volume: number;
  /** Couleur principale de l’anneau (écoute, conversation, parole), « #rrggbb ». */
  ledColor: string;
  /** Luminosité de l’anneau, de 0 à 10 ; 0 n’allume plus que les alertes. */
  ledBrightness: number;
  /** En veille, une lueur faible de la couleur principale montre que le satellite est prêt. */
  nightLight: boolean;
  /**
   * Écoute attentive : le micro reste ouvert pendant que Cornelius parle, on peut lui couper
   * la parole. Seulement avec un satellite qui annule l’écho ; sinon, il s’entendrait.
   */
  attentive: boolean;
  /**
   * Fin de parole propre à ce satellite, en millisecondes (3 à 300 s) ; null : le délai du
   * foyer (Quand il écoute → Fin de parole). Une chambre peut fermer plus vite qu’un bureau.
   */
  silenceCloseMs: number | null;
}

/** Un satellite audio tel que l’administration le voit (jamais son jeton). */
export interface SatelliteView extends SatelliteSettings {
  id: string;
  name: string;
  /** Profil rattaché (mémoire personnelle) ; null : satellite anonyme, le cas par défaut. */
  profileId: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
  firmware: string | null;
  muted: boolean;
  /** Le satellite connecté annonce l’annulation d’écho (condition de l’écoute attentive). */
  aec: boolean;
}

/** Un satellite neuf, connecté sans jeton, qui attend qu’on l’associe. */
export interface PendingSatelliteView {
  /** Nom sur le réseau (cornelius-satellite-xxxxxx), aussi imprimé dans son journal série. */
  device: string;
  firmware: string;
  address: string | null;
  since: number;
}

export const SATELLITE_NAME_MAX = 40;
export const SATELLITE_LED_COLOR_PATTERN = '^#[0-9a-f]{6}$';

/** Couleurs proposées dans l’administration (l’ambre, le rouge et l’orange restent aux alertes). */
export const SATELLITE_LED_PRESETS: readonly { color: string; label: string }[] = [
  { color: '#00ffb4', label: 'Turquoise' },
  { color: '#2f7bff', label: 'Bleu' },
  { color: '#9b5cff', label: 'Violet' },
  { color: '#ff4fa3', label: 'Rose' },
  { color: '#4cff3c', label: 'Vert' },
  { color: '#ffffff', label: 'Blanc' },
];
