import { resolve } from 'node:path';
import { liveBaseUrlError, normalizeLiveBaseUrl } from '../shared/live-endpoint.js';
import type { MachineStatus } from '../shared/types.js';
import { externalAddonsRoot } from './addons/registry.js';
import { detectMachine } from './machine.js';

export interface AppConfig {
  databasePath: string;
  adminPassword: string;
  origins: string[];
  secureCookies: boolean;
  staticRoot?: string;
  openaiKey?: string;
  perceptionToken?: string;
  imageGenerationToken?: string;
  /**
   * Jeton des déclencheurs externes (CORNELIUS_TRIGGER_TOKEN) : Home Assistant, baguette ou
   * bouton démarrent une conversation par POST /api/trigger/start. Absent, la route est fermée.
   */
  triggerToken?: string;
  /**
   * Adresse de base de l’API Live (CORNELIUS_LIVE_BASE_URL), https://api.openai.com/v1 par
   * défaut : un serveur compatible (réseau local) peut remplacer OpenAI pour la conversation.
   */
  liveBaseUrl?: string;
  loginRateLimit?: number;
  meteoConceptToken?: string;
  primApiKey?: string;
  /** Dépôt des modules externes (CORNELIUS_MODULES_DIR) ; absent, aucun n'est chargé. */
  modulesDir?: string;
  /**
   * Modules installés depuis l'administration (CORNELIUS_MANAGED_MODULES_DIR, data/modules par
   * défaut) : dépôts téléchargés et liste des modules choisis. Absent, le catalogue est fermé.
   */
  managedModulesDir?: string;
  /** Mises à jour de Cornelius faites par une autre installation (application Home Assistant). */
  updatesManagedExternally?: boolean;
  /** Recherche quotidienne des mises à jour (CORNELIUS_UPDATE_CHECK=0 pour la couper). */
  autoUpdateCheck?: boolean;
  /** Fuseau horaire du foyer donné aux modules (CORNELIUS_TIMEZONE, Europe/Paris par défaut). */
  timeZone?: string;
  /** Accès depuis les autres appareils du réseau local (HTTPS), en plus de la machine. */
  lan?: boolean;
  /** Annonce mDNS (_cornelius._tcp) pour les satellites audio ; vraie par défaut. */
  mdns?: boolean;
  /** Port HTTPS du réseau local (le port HTTP, lui, ne sert que la machine). */
  httpsPort?: number;
  tlsCert?: string;
  tlsKey?: string;
  /** Noms d'hôte supplémentaires acceptés (CORNELIUS_ALLOWED_HOSTS, séparés par des virgules). */
  allowedHosts?: string[];
  /** Empreinte du certificat HTTPS en service, affichée dans l'administration. */
  tlsFingerprint?: string;
  /** Empreinte de la clé publique : celle que vérifient les satellites audio. */
  tlsKeyFingerprint?: string;
  /** Machine détectée ; absente (tests), elle compte comme un PC sans restriction. */
  machine?: MachineStatus;
  /**
   * Un superviseur relance le serveur quand il s’arrête : systemd (INVOCATION_ID) ou
   * CORNELIUS_SUPERVISED=1 (add-on Home Assistant). Un redémarrage n’a alors qu’à quitter.
   */
  supervised?: boolean;
  /**
   * Un appel venu de 127.0.0.1 compte comme l’ordinateur du miroir (miroir sans autorisation,
   * mot de passe par défaut accepté) ; vrai par défaut. CORNELIUS_TRUST_LOOPBACK=0 quand la
   * boucle locale est partagée avec d’autres programmes (add-on Home Assistant sur le réseau de
   * l’hôte) : 127.0.0.1 a alors les droits d’un appareil du réseau local, et la perception et le
   * générateur d’images y restent servis, avec leur jeton.
   */
  trustLoopback?: boolean;
}

/** Mot de passe écrit par `npm run setup` et `.env.example`, à changer après l’installation. */
export const DEFAULT_ADMIN_PASSWORD = 'cornelius';

/** CORNELIUS_SUPERVISED=1 : un superviseur autre que systemd (add-on Home Assistant) relance le serveur. */
export function explicitlySupervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'oui', 'yes'].includes(
    (env.CORNELIUS_SUPERVISED ?? '').trim().toLowerCase(),
  );
}

/**
 * CORNELIUS_LIVE_BASE_URL : http(s), sans identifiants, requête ni fragment ; la barre finale
 * est retirée. Vide : OpenAI. Une valeur invalide arrête le démarrage plutôt que d’être ignorée.
 */
export function liveBaseUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const error = liveBaseUrlError(value);
  if (error) throw new Error(`CORNELIUS_LIVE_BASE_URL : ${error}`);
  return normalizeLiveBaseUrl(value);
}

export function loadConfig(): AppConfig & { port: number } {
  const adminPassword = process.env.CORNELIUS_ADMIN_PASSWORD ?? '';
  if (adminPassword.length < 4) {
    throw new Error(
      'Définissez CORNELIUS_ADMIN_PASSWORD (4 caractères minimum) dans .env, ou lancez npm run setup.',
    );
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT invalide.');
  const loginRateLimit = Number(process.env.CORNELIUS_LOGIN_RATE_LIMIT ?? 10);
  if (!Number.isInteger(loginRateLimit) || loginRateLimit < 1)
    throw new Error('CORNELIUS_LOGIN_RATE_LIMIT invalide.');
  const httpsPort = Number(process.env.CORNELIUS_HTTPS_PORT ?? port + 443);
  if (!Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535 || httpsPort === port)
    throw new Error('CORNELIUS_HTTPS_PORT invalide.');
  const devPort = Number(process.env.CORNELIUS_DEV_PORT ?? 5173);
  if (!Number.isInteger(devPort) || devPort < 1024 || devPort > 65535 || devPort === port)
    throw new Error('CORNELIUS_DEV_PORT invalide.');
  return {
    port,
    loginRateLimit,
    // Réseau local ouvert par défaut ; CORNELIUS_LAN=0 réserve Cornelius à la machine.
    lan: !['0', 'false', 'non', 'no'].includes(
      (process.env.CORNELIUS_LAN ?? '1').trim().toLowerCase(),
    ),
    httpsPort,
    // Les satellites audio trouvent Cornelius seuls ; CORNELIUS_MDNS=0 retire l’annonce.
    mdns: !['0', 'false', 'non', 'no'].includes(
      (process.env.CORNELIUS_MDNS ?? '1').trim().toLowerCase(),
    ),
    tlsCert: process.env.CORNELIUS_TLS_CERT || undefined,
    tlsKey: process.env.CORNELIUS_TLS_KEY || undefined,
    allowedHosts: (process.env.CORNELIUS_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    openaiKey: process.env.OPENAI_API_KEY || undefined,
    perceptionToken: process.env.CORNELIUS_PERCEPTION_TOKEN || undefined,
    imageGenerationToken: process.env.CORNELIUS_IMAGE_GENERATION_TOKEN || undefined,
    triggerToken: process.env.CORNELIUS_TRIGGER_TOKEN?.trim() || undefined,
    liveBaseUrl: liveBaseUrl(process.env.CORNELIUS_LIVE_BASE_URL),
    meteoConceptToken: process.env.CORNELIUS_METEO_CONCEPT_TOKEN || undefined,
    primApiKey: process.env.CORNELIUS_PRIM_API_KEY || undefined,
    modulesDir: externalAddonsRoot(),
    managedModulesDir: resolve(process.env.CORNELIUS_MANAGED_MODULES_DIR?.trim() || 'data/modules'),
    updatesManagedExternally: explicitlySupervised(),
    autoUpdateCheck: !['0', 'false', 'non', 'no'].includes(
      (process.env.CORNELIUS_UPDATE_CHECK ?? '1').trim().toLowerCase(),
    ),
    timeZone: process.env.CORNELIUS_TIMEZONE?.trim() || undefined,
    machine: detectMachine(),
    supervised: Boolean(process.env.INVOCATION_ID) || explicitlySupervised(),
    trustLoopback: !['0', 'false', 'non', 'no'].includes(
      (process.env.CORNELIUS_TRUST_LOOPBACK ?? '1').trim().toLowerCase(),
    ),
    adminPassword,
    databasePath:
      process.env.CORNELIUS_DATABASE === ':memory:'
        ? ':memory:'
        : resolve(process.env.CORNELIUS_DATABASE ?? 'data/cornelius.sqlite'),
    origins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://127.0.0.1:${devPort}`,
      `http://localhost:${devPort}`,
    ],
    secureCookies: false,
    staticRoot: resolve('dist/web'),
  };
}
