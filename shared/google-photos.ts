/** Album partagé accessible sans connexion. Aucun accès au compte Google. */
export interface GooglePhotosSettings {
  source: 'local' | 'google-photos';
  albumUrl: string;
  refreshMinutes: number;
}

export interface GooglePhotosView extends GooglePhotosSettings {
  count: number;
  refreshing: boolean;
  lastCheckedAt: number | null;
  error: string | null;
  images: import('./screensaver.js').ScreensaverImage[];
}

export const DEFAULT_GOOGLE_PHOTOS: GooglePhotosSettings = {
  source: 'local',
  albumUrl: '',
  refreshMinutes: 30,
};

export function isGooglePhotosSettings(value: unknown): value is GooglePhotosSettings {
  if (!value || typeof value !== 'object') return false;
  const { source, albumUrl, refreshMinutes, ...rest } = value as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    (source === 'local' || source === 'google-photos') &&
    typeof albumUrl === 'string' &&
    albumUrl.length <= 2048 &&
    typeof refreshMinutes === 'number' &&
    Number.isInteger(refreshMinutes) &&
    refreshMinutes >= 5 &&
    refreshMinutes <= 1440
  );
}
