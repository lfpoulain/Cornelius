import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { hostname as systemHostname, networkInterfaces } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer, isIP, type Server as NetServer } from 'node:net';
import { join } from 'node:path';
import { generate } from 'selfsigned';

/** Adresse de boucle locale : la machine elle-même. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.replace(/^::ffff:/i, '');
  return ip === '::1' || ip.startsWith('127.');
}

/**
 * Adresse du réseau local (RFC 1918, lien local, IPv6 locale unique) ou de la machine
 * elle-même. Une adresse publique n'en fait jamais partie, même si un routeur la redirige.
 */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (isLoopback(address)) return true;
  const ip = address.replace(/^::ffff:/i, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(ip) === 6) {
    const first = parseInt(ip.split(':')[0] || '0', 16);
    // fc00::/7 (adresses locales uniques) et fe80::/10 (lien local).
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

/** Nom de la machine, tel que les appareils du réseau peuvent l'écrire. */
export function machineHostnames(): string[] {
  const name = systemHostname().toLowerCase();
  return name ? [name, name.endsWith('.local') ? name : name + '.local'] : [];
}

/** Adresses IP de la machine sur le réseau local (pour le certificat et l'affichage). */
export function localAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      if (!entry.internal && entry.family === 'IPv4' && isPrivateAddress(entry.address))
        addresses.push(entry.address);
  return [...new Set(addresses)];
}

/**
 * Hôte accepté dans l'en-tête Host : la boucle locale, une adresse IP du réseau local, le nom
 * de la machine ou un nom ajouté dans CORNELIUS_ALLOWED_HOSTS. Refuser les autres noms
 * protège contre le « DNS rebinding » (un site extérieur qui se ferait passer pour Cornelius).
 */
export function allowedHostname(hostname: string, lan: boolean, extra: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || isLoopback(host)) return true;
  if (!lan) return false;
  if (isIP(host)) return isPrivateAddress(host);
  return (
    machineHostnames().includes(host) || extra.map((item) => item.toLowerCase()).includes(host)
  );
}

/**
 * Port du réseau local partagé entre HTTPS et une redirection HTTP : quelqu'un qui tape
 * http://10.0.0.20:3443 (sans le « s ») est renvoyé vers l'adresse chiffrée au lieu d'une
 * page vide. Le premier octet suffit à les distinguer : 0x16 ouvre toute poignée de main TLS.
 * La redirection ne vise qu'un hôte accepté, pour ne pas servir de rebond vers un autre site.
 */
export function tlsWithHttpRedirect(
  tls: NetServer,
  accepts: (hostname: string) => boolean,
): NetServer {
  const redirect = createHttpServer((req, res) => {
    let target: URL | null = null;
    try {
      target = new URL(req.url ?? '/', `https://${req.headers.host ?? ''}`);
    } catch {
      target = null;
    }
    if (!target || !accepts(target.hostname)) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      res.end('Hôte non autorisé.');
      return;
    }
    res.writeHead(301, { location: target.href, connection: 'close' });
    res.end();
  });
  return createNetServer((socket) => {
    socket.on('error', () => socket.destroy());
    socket.once('data', (head) => {
      socket.pause();
      socket.unshift(head);
      (head[0] === 0x16 ? tls : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
}

export interface Certificate {
  key: string;
  cert: string;
  /** Empreinte SHA-256, affichée pour vérifier le certificat depuis un autre appareil. */
  fingerprint: string;
  /**
   * Empreinte SHA-256 de la clé publique (SubjectPublicKeyInfo). Elle ne change pas quand le
   * certificat est recréé : les satellites audio la vérifient à la place du certificat.
   */
  keyFingerprint: string;
  generated: boolean;
}

/**
 * Certificat HTTPS du réseau local. Un fichier fourni (CORNELIUS_TLS_CERT et _KEY) est utilisé
 * tel quel ; sinon un certificat autosigné est créé dans data/tls et recréé si les adresses de
 * la machine changent. Le navigateur demande de l'accepter une fois par appareil : c'est le prix
 * d'un accès chiffré sans nom de domaine, indispensable pour que le micro fonctionne à distance.
 */
export async function ensureCertificate(options: {
  directory: string;
  certPath?: string;
  keyPath?: string;
  names?: string[];
  addresses?: string[];
}): Promise<Certificate> {
  if (options.certPath && options.keyPath) {
    const cert = readFileSync(options.certPath, 'utf8');
    const key = readFileSync(options.keyPath, 'utf8');
    return {
      cert,
      key,
      fingerprint: fingerprintOf(cert),
      keyFingerprint: keyFingerprintOf(key),
      generated: false,
    };
  }
  const names = [...new Set(['localhost', ...(options.names ?? machineHostnames())])];
  const addresses = [...new Set(['127.0.0.1', ...(options.addresses ?? localAddresses())])];
  // La signature compte : un ancien certificat SHA-1 (refusé par les satellites) est recréé.
  const wanted = JSON.stringify({
    names: [...names].sort(),
    addresses: [...addresses].sort(),
    signature: 'sha256',
  });
  const certFile = join(options.directory, 'cert.pem');
  const keyFile = join(options.directory, 'key.pem');
  const metaFile = join(options.directory, 'cert.json');
  if (existsSync(certFile) && existsSync(keyFile) && existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as {
        subject: string;
        notAfter: number;
      };
      if (meta.subject === wanted && meta.notAfter > Date.now() + 30 * 24 * 3600 * 1000) {
        const cert = readFileSync(certFile, 'utf8');
        const key = readFileSync(keyFile, 'utf8');
        return {
          cert,
          key,
          fingerprint: fingerprintOf(cert),
          keyFingerprint: keyFingerprintOf(key),
          generated: false,
        };
      }
    } catch {
      /* Métadonnées illisibles : un nouveau certificat est créé. */
    }
  }
  const notAfter = new Date(Date.now() + 825 * 24 * 3600 * 1000);
  // Nouvelles adresses : nouveau certificat, mais même clé, pour que les satellites qui
  // l’ont épinglée restent reliés.
  const keyPair = existingKeyPair(keyFile);
  const pems = await generate([{ name: 'commonName', value: 'Cornelius' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    ...(keyPair ? { keyPair } : {}),
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          ...names.map((value) => ({ type: 2 as const, value })),
          ...addresses.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });
  mkdirSync(options.directory, { recursive: true });
  writeFileSync(keyFile, pems.private, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  writeFileSync(certFile, pems.cert);
  writeFileSync(metaFile, JSON.stringify({ subject: wanted, notAfter: notAfter.getTime() }));
  return {
    cert: pems.cert,
    key: pems.private,
    fingerprint: fingerprintOf(pems.cert),
    keyFingerprint: keyFingerprintOf(pems.private),
    generated: true,
  };
}

function existingKeyPair(keyFile: string): { privateKey: string; publicKey: string } | null {
  if (!existsSync(keyFile)) return null;
  try {
    const privateKey = readFileSync(keyFile, 'utf8');
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    return { privateKey, publicKey: String(publicKey) };
  } catch {
    /* Clé illisible : une nouvelle est créée. */
    return null;
  }
}

/** Empreinte SHA-256 de la clé publique, au même format que celle du certificat. */
export function keyFingerprintOf(privateKey: string): string {
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return createHash('sha256')
    .update(spki)
    .digest('hex')
    .toUpperCase()
    .replace(/(..)(?!$)/g, '$1:');
}

function fingerprintOf(pem: string): string {
  const der = Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, ''), 'base64');
  return createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .replace(/(..)(?!$)/g, '$1:');
}
