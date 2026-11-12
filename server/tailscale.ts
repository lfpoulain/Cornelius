import { request as httpRequest } from 'node:http';
import type { PortableState, PortableStatus } from '../shared/portable.js';

export type { PortableDevice, PortableState, PortableStatus } from '../shared/portable.js';

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

export class TailscalePortable {
  /** Noms acceptés en plus des noms de la machine : celui du réseau privé, une fois connu. */
  private knownName: string | null = null;

  constructor(
    private readonly socket: string | null,
    /** Où Tailscale relaie les requêtes : « https+insecure://cornelius:3443 ». */
    private readonly target: string,
    private readonly timeoutMs = 5000,
  ) {}

  get configured(): boolean {
    return !!this.socket;
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
    await this.json('PATCH', 'prefs', { WantRunning: true, WantRunningSet: true });
    const reply = await this.call('POST', 'login-interactive');
    if (reply.status >= 300) throw new Error(`Connexion refusée par Tailscale (${reply.status}).`);
  }

  /** Publie Cornelius sur le réseau privé (HTTPS, port 443), ou retire la publication. */
  async setServing(on: boolean): Promise<void> {
    const status = await this.json('GET', 'status');
    const dnsName = status.Self?.DNSName ? noDot(String(status.Self.DNSName)) : null;
    if (!dnsName) throw new Error('Ce serveur n’est pas encore connecté au réseau privé.');
    const { config, etag } = await this.serveConfig();
    const key = `${dnsName}:443`;
    const next: Json = {
      ...config,
      TCP: { ...(config.TCP ?? {}) },
      Web: { ...(config.Web ?? {}) },
    };
    if (on) {
      next.TCP['443'] = { HTTPS: true };
      next.Web[key] = { Handlers: { '/': { Proxy: this.target } } };
    } else {
      delete next.TCP['443'];
      delete next.Web[key];
    }
    // Jamais sur Internet : la publication publique (« funnel ») n'est pas touchée ici et reste
    // désactivée.
    const reply = await this.call('POST', 'serve-config', next, etag ? { 'If-Match': etag } : {});
    if (reply.status >= 300)
      throw new Error(
        `Publication refusée par Tailscale (${reply.status}) : ${reply.body.slice(0, 200)}`,
      );
    if (on) this.knownName = dnsName;
  }

  /** Déconnecte ce serveur du compte : l'adresse privée disparaît. */
  async logout(): Promise<void> {
    try {
      await this.setServing(false);
    } catch {
      // Déjà retiré, ou pas connecté : la déconnexion suffit.
    }
    const reply = await this.call('POST', 'logout');
    if (reply.status >= 300)
      throw new Error(`Déconnexion refusée par Tailscale (${reply.status}).`);
    this.knownName = null;
  }
}
