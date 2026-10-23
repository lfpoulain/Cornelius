/**
 * Écran de veille du miroir : des peintures et des photos, plein écran, quand personne n’est
 * devant lui. Une personne détectée fait revenir l’orbe.
 */
export interface ScreensaverSettings {
  enabled: boolean;
  /** Durée d’affichage de chaque image avant la suivante. */
  intervalMs: number;
  /** Délai sans personne devant le miroir avant le retour des images. */
  returnDelayMs: number;
  /** Passage de l’image à l’orbe, et retour. */
  transition: ScreensaverTransition;
  /** Durée de la disparition de l’image ; son retour prend un peu moins du double. */
  durationMs: number;
  /** Ce qui fait revenir l’orbe. */
  wake: ScreensaverWake;
  /** Place de l’image à l’écran, jamais étirée. */
  fit: ScreensaverFit;
}

/**
 * whole : l’image entière, de bord à bord, des bandes noires sur les côtés restants. canvas :
 * posée comme une toile sur son propre flou, sauf si ses proportions sont voisines de l’écran
 * (elle le remplit alors). fill : elle remplit l’écran, quitte à en couper les bords.
 */
export const SCREENSAVER_FITS = ['whole', 'canvas', 'fill'] as const;
export type ScreensaverFit = (typeof SCREENSAVER_FITS)[number];

/**
 * vortex : l’image s’enroule et s’effondre dans l’orbe. embers : elle se consume depuis l’orbe.
 * ripple : une onde partie de l’orbe l’emporte. mosaic : elle se défait en carreaux aspirés
 * vers l’orbe. curtain : elle s’ouvre en deux comme un rideau. fade : elle s’éteint vers le noir,
 * sans se griser. random : l’un des effets animés au hasard,
 * à chaque fois. none : l’image disparaît d’un coup.
 */
export const SCREENSAVER_EFFECTS = [
  'vortex',
  'embers',
  'ripple',
  'mosaic',
  'curtain',
  'fade',
] as const;
export type ScreensaverEffect = (typeof SCREENSAVER_EFFECTS)[number];
/** « Au hasard » tire parmi les effets animés ; le fondu reste un choix délibéré. */
export const SCREENSAVER_RANDOM_EFFECTS = SCREENSAVER_EFFECTS.filter((effect) => effect !== 'fade');
export const SCREENSAVER_TRANSITIONS = [...SCREENSAVER_EFFECTS, 'random', 'none'] as const;
export type ScreensaverTransition = (typeof SCREENSAVER_TRANSITIONS)[number];

/**
 * presence : dès qu’une personne passe devant le miroir. opening : seulement quand Cornelius
 * s’éveille, selon ce qui ouvre la conversation (présence, regard ou mot « Cornelius »).
 */
export const SCREENSAVER_WAKES = ['presence', 'opening'] as const;
export type ScreensaverWake = (typeof SCREENSAVER_WAKES)[number];

export const SCREENSAVER_INTERVAL_MIN_MS = 10_000;
export const SCREENSAVER_INTERVAL_MAX_MS = 86_400_000;
export const SCREENSAVER_RETURN_DELAY_MAX_MS = 3_600_000;

export const DEFAULT_SCREENSAVER: ScreensaverSettings = {
  enabled: false,
  intervalMs: 300_000,
  returnDelayMs: 30_000,
  transition: 'vortex',
  durationMs: 1_000,
  wake: 'presence',
  fit: 'canvas',
};

/** Durées proposées d’un geste dans l’administration. */
export const SCREENSAVER_INTERVALS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000];
export const SCREENSAVER_RETURN_DELAYS_MS = [5_000, 30_000, 60_000, 300_000];
export const SCREENSAVER_DURATIONS_MS = [500, 1_000, 1_500, 2_000, 3_000];
export const SCREENSAVER_DURATION_MIN_MS = 300;
export const SCREENSAVER_DURATION_MAX_MS = 5_000;

export function isScreensaverSettings(value: unknown): value is ScreensaverSettings {
  if (!value || typeof value !== 'object') return false;
  const { enabled, intervalMs, returnDelayMs, transition, durationMs, wake, fit, ...rest } =
    value as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    (SCREENSAVER_TRANSITIONS as readonly unknown[]).includes(transition) &&
    (SCREENSAVER_WAKES as readonly unknown[]).includes(wake) &&
    (SCREENSAVER_FITS as readonly unknown[]).includes(fit) &&
    typeof enabled === 'boolean' &&
    Number.isInteger(intervalMs) &&
    (intervalMs as number) >= SCREENSAVER_INTERVAL_MIN_MS &&
    (intervalMs as number) <= SCREENSAVER_INTERVAL_MAX_MS &&
    Number.isInteger(durationMs) &&
    (durationMs as number) >= SCREENSAVER_DURATION_MIN_MS &&
    (durationMs as number) <= SCREENSAVER_DURATION_MAX_MS &&
    Number.isInteger(returnDelayMs) &&
    (returnDelayMs as number) >= 0 &&
    (returnDelayMs as number) <= SCREENSAVER_RETURN_DELAY_MAX_MS
  );
}

/** Ce que le miroir reçoit dans son état : les réglages, et de quoi relire la liste d’images. */
export interface ScreensaverState extends ScreensaverSettings {
  imageCount: number;
  /** Change dès qu’une image est ajoutée ou retirée. */
  revision: string;
}

export interface ScreensaverImage {
  id: string;
  url: string;
  /** Titre de l’œuvre, ou nom du fichier envoyé. */
  title: string;
  /** Artiste et date pour une peinture de la collection ; vide pour une photo envoyée. */
  credit: string;
  origin: 'upload' | 'collection';
  /** Dimensions affichées (rotation des photos comprise) ; null si l’en-tête est illisible. */
  width: number | null;
  height: number | null;
}

export interface ScreensaverCollectionStatus {
  total: number;
  installed: number;
  downloading: boolean;
  error: string | null;
}

export interface ScreensaverView {
  images: ScreensaverImage[];
  collection: ScreensaverCollectionStatus;
}

/** Formats acceptés à l’envoi, reconnus à leurs premiers octets. */
export const SCREENSAVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ScreensaverImageType = (typeof SCREENSAVER_IMAGE_TYPES)[number];
export const SCREENSAVER_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
