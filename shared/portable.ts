/** Cornelius portable : état renvoyé par l'administration (voir server/tailscale.ts). */
export type PortableState = 'unavailable' | 'stopped' | 'needs-login' | 'starting' | 'running';

export interface PortableDevice {
  name: string;
  os: string;
  online: boolean;
  lastSeen: string | null;
}

export interface PortableStatus {
  /** Socket configuré : la carte s'affiche. */
  configured: boolean;
  state: PortableState;
  /** Lien de connexion au compte, pendant `needs-login`. */
  authUrl: string | null;
  /** Nom de ce serveur sur le réseau privé (« cornelius.exemple.ts.net »). */
  dnsName: string | null;
  tailnet: string | null;
  ip: string | null;
  /** Les certificats HTTPS sont permis sur ce réseau privé (réglage du compte Tailscale). */
  https: boolean;
  /** Cornelius est publié sur le réseau privé. */
  serving: boolean;
  /** Adresse à ouvrir sur les téléphones. */
  url: string | null;
  devices: PortableDevice[];
  error: string | null;
}
