import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { hostname as systemHostname, networkInterfaces } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import type { PortableState, PortableStatus } from '../shared/portable.js';
import { isLoopback } from './network.js';

export type { PortableDevice, PortableState, PortableStatus } from '../shared/portable.js';

/** Ce qui désigne la machine elle-même : ses noms et les adresses de ses interfaces. */
export interface MachineIdentity {
  names: string[];
  addresses: string[];
}

function machineIdentity(): MachineIdentity {
  const name = systemHostname().toLowerCase().replace(/\.$/u, '');
  const names = name ? [name, name.split('.')[0]!] : [];
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) addresses.push(entry.address.toLowerCase());
  return { names: [...new Set(names)], addresses: [...new Set(addresses)] };
}

/** IPv4 portée par une adresse IPv6 mappée (`::ffff:7f00:1` ou `::ffff:127.0.0.1`), ou null. */
function mappedV4(ip: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(ip);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(ip);
  if (!hex) return null;
  const high = parseInt(hex[1]!, 16);
  const low = parseInt(hex[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/**
 * La cible de `tailscale serve` désigne-t-elle la machine de Cornelius ? Oui pour la boucle
 * locale, `localhost`, une adresse « quelconque » (`0.0.0.0`, `::`), une adresse d'une interface
 * de la machine, ou son nom (avec ou sans domaine). Une cible illisible compte aussi : c'est le cas
 * sûr. Un autre nom (le service Cornelius vu d'un autre conteneur) n'est pas la machine.
 */
export function targetOnMachine(
  target: string,
  machine: MachineIdentity = machineIdentity(),
): boolean {
  let host: string;
  try {
    // Lu comme une adresse http : les formes abrégées d'IPv4 (« 127.1 », « 0 ») sont normalisées,
    // ce que ne fait pas un schéma inconnu comme « https+insecure ».
    const address = /^[a-z][a-z0-9+.-]*:\/\//iu.test(target)
      ? target.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, 'http://')
      : `http://${target}`;
    host = new URL(address).hostname
      .toLowerCase()
      .replace(/^\[|\]$/gu, '')
      .replace(/\.$/u, '');
  } catch {
    return true;
  }
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host)) {
    const ip = mappedV4(host) ?? host;
    return isLoopback(ip) || ip === '0.0.0.0' || ip === '::' || machine.addresses.includes(ip);
  }
  return machine.names.includes(host) || machine.names.includes(host.split('.')[0]!);
}

/**
 * Cornelius portable : Cornelius pilote un `tailscaled` voisin par son interface locale
 * (LocalAPI, sur un socket Unix partagé) pour être joignable depuis les téléphones du foyer,
 * partout, sans rien ouvrir sur Internet. Tailscale publie Cornelius sur le réseau privé
 * (`serve`, jamais `funnel`), avec un certificat reconnu par les navigateurs.
 *
 * Aucune dépendance : quelques requêtes HTTP sur le socket. Sans socket configuré
 * (CORNELIUS_TAILSCALE_SOCKET), la fonction est simplement absente.
 */

type Json = Record<string, any>;

interface Reply {
  status: number;
  etag: string | null;
  body: string;
}

const noDot = (name: string) => name.replace(/\.$/u, '');

/**
 * Le `tailscaled` que Cornelius a lui-même relié au compte : demande de connexion en cours,
 * puis identifiant du nœud une fois la connexion faite. Seul ce démon-là peut être déconnecté
 * depuis l'administration.
 */
export interface PortableOwnership {
  get(): { pending: boolean; nodeId: string | null };
  set(value: { pending: boolean; nodeId: string | null }): void;
}

/** Table de PortableOwnership (rejouable). */
export const portableOwnershipMigration = `CREATE TABLE IF NOT EXISTS portable_ownership (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
  node_id TEXT
) STRICT;
INSERT OR IGNORE INTO portable_ownership (id) VALUES (1);`;

export function portableOwnershipStore(db: DatabaseSync): PortableOwnership {
  return {
    get() {
      const row = db.prepare('SELECT pending, node_id FROM portable_ownership WHERE id = 1').get();
      return { pending: row?.pending === 1, nodeId: (row?.node_id as string | null) ?? null };
    },
    set({ pending, nodeId }) {
      db.prepare('UPDATE portable_ownership SET pending = ?, node_id = ? WHERE id = 1').run(
        pending ? 1 : 0,
        nodeId,
      );
    },
  };
}

/** En mémoire : pour les tests, ou sans base. */
export function memoryOwnership(): PortableOwnership {
  let value = { pending: false, nodeId: null as string | null };
  return { get: () => value, set: (next) => (value = next) };
}

export class TailscalePortable {
  /** Noms acceptés en plus des noms de la machine : celui du réseau privé, une fois connu. */
  private knownName: string | null = null;
  /**
   * Le démon utilise-t-il une vraie interface réseau (TUN du noyau) ? Faux : réseau en espace
   * utilisateur, où une connexion directe à l'adresse Tailscale du nœud est redirigée vers la
   * boucle locale. Inconnu tant que le démon n'a pas répondu.
   */
  private tun: boolean | null = null;

  constructor(
    private readonly socket: string | null,
    /** Où Tailscale relaie les requêtes : « https+insecure://cornelius:3443 ». */
    private readonly target: string,
    private readonly timeoutMs = 5000,
    private readonly ownership: PortableOwnership = memoryOwnership(),
  ) {}

  get configured(): boolean {
    return !!this.socket;
  }

  /**
   * Vrai seulement si le démon a dit utiliser un TUN du noyau (voir `tun`). Inconnu (démon muet,
   * ou version qui ne le dit pas) compte comme l'espace utilisateur : c'est le cas sûr.
   */
  kernelTun(): boolean {
    return this.tun === true;
  }

  /**
   * La cible est sur la machine de Cornelius : tailscaled partage alors son réseau (installation
   * native, ou conteneur en network_mode: service). Une cible illisible compte comme la machine :
   * c'est le cas sûr.
   */
  targetOnLoopback(): boolean {
    return targetOnMachine(this.target);
  }

  /** Noms d'hôte que Cornelius doit accepter (contrôle contre le « DNS rebinding »). */
  hostnames(): string[] {
    return this.knownName ? [this.knownName] : [];
  }

  private call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return new Promise<Reply>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        {
          socketPath: this.socket!,
          method,
          path: `/localapi/v0/${path}`,
          // Hôte attendu par tailscaled sur son socket ; l'en-tête Sec-Tailscale le protège des
          // pages web qui tenteraient de l'atteindre.
          headers: {
            Host: 'local-tailscaled.sock',
            'Sec-Tailscale': 'localapi',
            ...(data ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              etag: (res.headers.etag as string | undefined) ?? null,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('Tailscale ne répond pas.')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  private async json(method: string, path: string, body?: unknown): Promise<Json> {
    const reply = await this.call(method, path, body);
    if (reply.status >= 300)
      throw new Error(`Tailscale a refusé ${path} (${reply.status}) : ${reply.body.slice(0, 200)}`);
    return reply.body ? (JSON.parse(reply.body) as Json) : {};
  }

  private async serveConfig(): Promise<{ config: Json; etag: string | null }> {
    const reply = await this.call('GET', 'serve-config');
    if (reply.status >= 300)
      throw new Error(`Configuration de publication illisible (${reply.status}).`);
    return { config: reply.body ? (JSON.parse(reply.body) as Json) : {}, etag: reply.etag };
  }

  private servesCornelius(config: Json, dnsName: string): boolean {
    const handler = config.Web?.[`${dnsName}:443`]?.Handlers?.['/'];
    return handler?.Proxy === this.target;
  }

  async status(): Promise<PortableStatus> {
    const empty: PortableStatus = {
      configured: this.configured,
      state: 'unavailable',
      authUrl: null,
      dnsName: null,
      tailnet: null,
      ip: null,
      https: false,
      serving: false,
      url: null,
      devices: [],
      error: null,
    };
    if (!this.socket) return empty;
    let status: Json;
    try {
      status = await this.json('GET', 'status');
    } catch (error) {
      return { ...empty, error: error instanceof Error ? error.message : String(error) };
    }
    const backend = String(status.BackendState ?? '');
    const state: PortableState =
      backend === 'Running'
        ? 'running'
        : backend === 'NeedsLogin' || backend === 'NeedsMachineAuth'
          ? 'needs-login'
          : backend === 'Stopped'
            ? 'stopped'
            : 'starting';
    const dnsName = status.Self?.DNSName ? noDot(String(status.Self.DNSName)) : null;
    const https = Array.isArray(status.CertDomains) && status.CertDomains.length > 0;
    let serving = false;
    if (state === 'running' && dnsName) {
      try {
        serving = this.servesCornelius((await this.serveConfig()).config, dnsName);
      } catch {
        serving = false;
      }
    }
    this.knownName = state === 'running' && dnsName ? dnsName : null;
    if (typeof status.TUN === 'boolean') this.tun = status.TUN;
    // Connexion demandée par Cornelius, maintenant faite : ce nœud est le sien.
    const owned = this.ownership.get();
    if (state === 'running' && owned.pending && status.Self?.ID)
      this.ownership.set({ pending: false, nodeId: String(status.Self.ID) });
    const peers = Object.values((status.Peer ?? {}) as Record<string, Json>);
    return {
      ...empty,
      state,
      authUrl: status.AuthURL ? String(status.AuthURL) : null,
      dnsName,
      tailnet: status.CurrentTailnet?.Name ? String(status.CurrentTailnet.Name) : null,
      ip: Array.isArray(status.Self?.TailscaleIPs)
        ? String(status.Self.TailscaleIPs[0] ?? '') || null
        : null,
      https,
      serving,
      url: serving && dnsName ? `https://${dnsName}` : null,
      devices: peers
        .map((peer) => ({
          // Identifiant du nœud : deux téléphones peuvent porter le même nom (« iphone »).
          id: String(peer.ID || peer.PublicKey || peer.DNSName || ''),
          name: String(
            peer.HostName || noDot(String(peer.DNSName ?? '')).split('.')[0] || 'Appareil',
          ),
          os: String(peer.OS ?? ''),
          online: peer.Online === true,
          lastSeen:
            peer.LastSeen && !String(peer.LastSeen).startsWith('0001')
              ? String(peer.LastSeen)
              : null,
        }))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    };
  }

  /** Relie ce serveur au compte : Tailscale fournit un lien de connexion, lu ensuite par `status`. */
  async connect(): Promise<void> {
    // Seul un démon jamais relié à un compte (NeedsLogin) devient celui de Cornelius : un démon
    // déjà relié, même arrêté (Stopped, « tailscale down »), est celui de l'hôte.
    const status = await this.json('GET', 'status');
    if (status.BackendState === 'NeedsLogin') this.ownership.set({ pending: true, nodeId: null });
    await this.json('PATCH', 'prefs', { WantRunning: true, WantRunningSet: true });
    const reply = await this.call('POST', 'login-interactive');
    if (reply.status >= 300) throw new Error(`Connexion refusée par Tailscale (${reply.status}).`);
  }

  /**
   * Ce que ce `tailscaled` publie en dehors de Cornelius : ports, sites ou publication publique.
   * Cornelius ne touche jamais à ces entrées.
   */
  private others(config: Json, dnsName: string): boolean {
    const key = `${dnsName}:443`;
    const ours = this.servesCornelius(config, dnsName);
    const tcp = Object.keys(config.TCP ?? {}).filter((port) => !(ours && port === '443'));
    const web = Object.entries((config.Web ?? {}) as Record<string, Json>).filter(
      ([name, site]) =>
        !(ours && name === key && Object.keys(site?.Handlers ?? {}).every((path) => path === '/')),
    );
    const funnel = Object.values((config.AllowFunnel ?? {}) as Record<string, boolean>).some(
      Boolean,
    );
    return tcp.length > 0 || web.length > 0 || funnel || !!config.Services;
  }

  /**
   * Publie Cornelius sur le réseau privé (HTTPS, port 443), ou retire la publication. Seule la
   * publication de Cornelius est ajoutée ou retirée : un port 443 déjà pris par autre chose
   * n'est jamais remplacé, et le reste de la configuration est gardé tel quel.
   */
  async setServing(on: boolean): Promise<void> {
    const status = await this.json('GET', 'status');
    const dnsName = status.Self?.DNSName ? noDot(String(status.Self.DNSName)) : null;
    if (!dnsName) throw new Error('Ce serveur n’est pas encore connecté au réseau privé.');
    const { config, etag } = await this.serveConfig();
    const key = `${dnsName}:443`;
    const ours = this.servesCornelius(config, dnsName);
    const next: Json = {
      ...config,
      TCP: { ...(config.TCP ?? {}) },
      Web: { ...(config.Web ?? {}) },
    };
    // Jamais sur Internet : une publication publique (« funnel ») de ce nom, restée d'avant,
    // ouvrirait Cornelius à tous. Elle est retirée, à l'ouverture comme à la fermeture.
    const funnel = !!config.AllowFunnel?.[key];
    if (funnel) {
      const allow: Json = { ...config.AllowFunnel };
      delete allow[key];
      if (Object.keys(allow).length) next.AllowFunnel = allow;
      else delete next.AllowFunnel;
    }
    if (on) {
      if (ours && !funnel) {
        this.knownName = dnsName;
        return;
      }
      if (!ours && (config.TCP?.['443'] || config.Web?.[key]))
        throw new Error(
          'Le port 443 de ce Tailscale publie déjà autre chose : Cornelius ne le remplace pas. Utilisez un Tailscale dédié à Cornelius.',
        );
      next.TCP['443'] = { HTTPS: true };
      next.Web[key] = { Handlers: { '/': { Proxy: this.target } } };
    } else {
      // Rien de Cornelius à retirer : la configuration n'est pas touchée.
      if (!ours) return;
      const site = config.Web[key] as Json;
      const handlers: Json = { ...site.Handlers };
      delete handlers['/'];
      if (Object.keys(handlers).length) next.Web[key] = { ...site, Handlers: handlers };
      else {
        delete next.Web[key];
        delete next.TCP['443'];
      }
    }
    const reply = await this.call('POST', 'serve-config', next, etag ? { 'If-Match': etag } : {});
    if (reply.status >= 300)
      throw new Error(
        `Publication refusée par Tailscale (${reply.status}) : ${reply.body.slice(0, 200)}`,
      );
    if (on) this.knownName = dnsName;
  }

  /**
   * Déconnecte ce serveur du compte : l'adresse privée disparaît. Refusé si ce `tailscaled`
   * n'a pas été relié au compte par Cornelius (le Tailscale de la machine hôte, par exemple :
   * le déconnecter sortirait toute la machine du réseau), ou s'il publie autre chose que
   * Cornelius.
   */
  async logout(): Promise<void> {
    const status = await this.json('GET', 'status');
    const owned = this.ownership.get().nodeId;
    if (!owned || String(status.Self?.ID ?? '') !== owned)
      throw new Error(
        'Ce Tailscale n’a pas été connecté par Cornelius : le déconnecter couperait aussi la machine qui l’héberge. Déconnectez-le depuis son hôte.',
      );
    const dnsName = status.Self?.DNSName ? noDot(String(status.Self.DNSName)) : null;
    if (dnsName && this.others((await this.serveConfig()).config, dnsName))
      throw new Error(
        'Ce Tailscale publie aussi d’autres services : le déconnecter les couperait. Il n’est pas dédié à Cornelius ; déconnectez-le depuis son hôte.',
      );
    try {
      await this.setServing(false);
    } catch {
      // Déjà retiré, ou pas connecté : la déconnexion suffit.
    }
    const reply = await this.call('POST', 'logout');
    if (reply.status >= 300)
      throw new Error(`Déconnexion refusée par Tailscale (${reply.status}).`);
    this.knownName = null;
    this.ownership.set({ pending: false, nodeId: null });
  }
}
