import { resolve } from 'node:path';
import { externalAddonsRoot } from './addons/registry.js';

export interface AppConfig {
  databasePath: string;
  adminPassword: string;
  origins: string[];
  secureCookies: boolean;
  staticRoot?: string;
  openaiKey?: string;
  aiProvider?: 'openai' | 'groq';
  groqKey?: string;
  groqModel?: string;
  groqTranscriptionModel?: string;
  perceptionToken?: string;
  imageGenerationToken?: string;
  loginRateLimit?: number;
  meteoConceptToken?: string;
  primApiKey?: string;
  /** Dépôt des modules externes (CORNELIUS_MODULES_DIR) ; absent, aucun n'est chargé. */
  modulesDir?: string;
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
}

/** Mot de passe écrit par `npm run setup` et `.env.example`, à changer après l’installation. */
export const DEFAULT_ADMIN_PASSWORD = 'cornelius';

export function loadConfig(): AppConfig & { port: number } {
  const adminPassword = process.env.CORNELIUS_ADMIN_PASSWORD ?? '';
  if (adminPassword.length < 4) {
    throw new Error(
      'Définissez CORNELIUS_ADMIN_PASSWORD (4 caractères minimum) dans .env, ou lancez npm run setup.',
    );
  }
  const aiProvider = process.env.CORNELIUS_AI_PROVIDER?.trim() || 'openai';
  if (aiProvider !== 'openai' && aiProvider !== 'groq')
    throw new Error('CORNELIUS_AI_PROVIDER doit être openai ou groq.');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT invalide.');
  const loginRateLimit = Number(process.env.CORNELIUS_LOGIN_RATE_LIMIT ?? 10);
  if (!Number.isInteger(loginRateLimit) || loginRateLimit < 1)
    throw new Error('CORNELIUS_LOGIN_RATE_LIMIT invalide.');
  const httpsPort = Number(process.env.CORNELIUS_HTTPS_PORT ?? port + 443);
  if (!Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535 || httpsPort === port)
    throw new Error('CORNELIUS_HTTPS_PORT invalide.');
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
    aiProvider,
    groqKey: process.env.GROQ_API_KEY || undefined,
    groqModel: process.env.CORNELIUS_GROQ_MODEL?.trim() || undefined,
    groqTranscriptionModel: process.env.CORNELIUS_GROQ_TRANSCRIPTION_MODEL?.trim() || undefined,
    openaiKey: process.env.OPENAI_API_KEY || undefined,
    perceptionToken: process.env.CORNELIUS_PERCEPTION_TOKEN || undefined,
    imageGenerationToken: process.env.CORNELIUS_IMAGE_GENERATION_TOKEN || undefined,
    meteoConceptToken: process.env.CORNELIUS_METEO_CONCEPT_TOKEN || undefined,
    primApiKey: process.env.CORNELIUS_PRIM_API_KEY || undefined,
    modulesDir: externalAddonsRoot(),
    timeZone: process.env.CORNELIUS_TIMEZONE?.trim() || undefined,
    adminPassword,
    databasePath:
      process.env.CORNELIUS_DATABASE === ':memory:'
        ? ':memory:'
        : resolve(process.env.CORNELIUS_DATABASE ?? 'data/cornelius.sqlite'),
    origins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ],
    secureCookies: false,
    staticRoot: resolve('dist/web'),
  };
}
