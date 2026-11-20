import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { PendingSatelliteView } from '../shared/satellites.js';
import type { DiagnosticLog } from './logs.js';
import { SATELLITE_PROTOCOL } from './satellites.js';

interface Pending extends PendingSatelliteView {
  socket: WebSocket;
  expiry: ReturnType<typeof setTimeout>;
}

// Peu de satellites neufs à la fois : au-delà, les plus anciens attendront une reconnexion.
const MAX_PENDING = 8;
const HELLO_MS = 5000;
const PAIRING_MS = 5 * 60_000;
const DEVICE_PATTERN = /^[a-z0-9-]{3,48}$/u;

/**
 * Association des satellites neufs. Un satellite sans jeton ouvre /satellite/pair et se
 * présente ; il attend que quelqu’un l’associe dans l’administration, qui crée alors le
 * satellite et lui envoie son jeton sur cette connexion. Rien n’est accordé sans ce clic.
 */
export class SatellitePairing {
  private pending = new Map<string, Pending>();
  constructor(
    private readonly logs: DiagnosticLog,
    private readonly now: () => number = Date.now,
  ) {}

  list(): PendingSatelliteView[] {
    return [...this.pending.values()]
      .sort((a, b) => a.since - b.since)
      .map(({ requestId, device, firmware, address, since }) => ({
        requestId,
        device,
        firmware,
        address,
        since,
      }));
  }

  connect(socket: WebSocket, address: string | null): void {
    let requestId: string | null = null;
    const helloTimer = setTimeout(() => socket.close(1008, 'Message pair attendu.'), HELLO_MS);
    helloTimer.unref?.();
    socket.on('message', (data, binary) => {
      if (binary || requestId) return;
      let message: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(String(data));
        if (parsed && typeof parsed === 'object') message = parsed as Record<string, unknown>;
      } catch {
        /* Message illisible : refusé ci-dessous. */
      }
      if (
        message.type !== 'pair' ||
        message.protocol !== SATELLITE_PROTOCOL ||
        typeof message.device !== 'string' ||
        !DEVICE_PATTERN.test(message.device) ||
        typeof message.firmware !== 'string' ||
        message.firmware.length < 1 ||
        message.firmware.length > 32
      )
        return socket.close(1008, 'Message pair invalide.');
      clearTimeout(helloTimer);
      const device = message.device;
      const waiting = this.list();
      const previous = waiting.find((entry) => entry.device === device);
      if (previous) this.closeRequest(previous.requestId, 1008, 'Satellite reconnecté.');
      if (this.pending.size >= MAX_PENDING) {
        this.closeRequest(waiting[0]!.requestId, 1008, 'Trop de satellites neufs.');
      }
      const id = randomUUID();
      requestId = id;
      const expiry = setTimeout(
        () => this.closeRequest(id, 1008, 'Association expirée.'),
        PAIRING_MS,
      );
      expiry.unref();
      this.pending.set(id, {
        requestId: id,
        socket,
        device,
        firmware: message.firmware,
        address,
        since: this.now(),
        expiry,
      });
      this.logs.write('info', 'local', 'Satellite neuf en attente d’association', {
        device,
        firmware: message.firmware,
      });
      this.send(socket, { type: 'waiting' });
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (requestId) this.removeRequest(requestId);
    });
    socket.on('error', () => socket.close());
  }

  /** Fait clignoter l’anneau du satellite, pour le reconnaître parmi d’autres. */
  identify(requestId: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry || entry.socket.readyState !== 1) return false;
    this.send(entry.socket, { type: 'identify' });
    return true;
  }

  /**
   * Association acceptée : le satellite reçoit son jeton et son nom, puis se reconnecte en
   * satellite ordinaire. Faux s’il n’attend plus (le satellite créé est alors à retirer).
   */
  accept(requestId: string, satellite: { name: string; token: string }): boolean {
    const entry = this.pending.get(requestId);
    if (!entry || entry.socket.readyState !== 1) return false;
    this.removeRequest(requestId);
    this.send(entry.socket, { type: 'paired', name: satellite.name, token: satellite.token });
    this.logs.write('info', 'local', 'Satellite associé', {
      device: entry.device,
      satellite: satellite.name,
    });
    // Le satellite ferme lui-même après avoir enregistré son jeton ; sinon, au bout de 5 s.
    setTimeout(() => entry.socket.close(1000, 'Associé.'), 5000).unref?.();
    return true;
  }

  reject(requestId: string): boolean {
    return this.closeRequest(requestId, 1008, 'Association refusée.');
  }

  dispose(): void {
    for (const requestId of this.pending.keys())
      this.closeRequest(requestId, 1001, 'Arrêt du serveur');
  }

  private removeRequest(requestId: string): Pending | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.expiry);
    return entry;
  }

  private closeRequest(requestId: string, code: number, reason: string): boolean {
    const entry = this.removeRequest(requestId);
    if (!entry) return false;
    entry.socket.close(code, reason);
    return true;
  }

  private send(socket: WebSocket, value: unknown) {
    if (socket.readyState === 1) socket.send(JSON.stringify(value));
  }
}
