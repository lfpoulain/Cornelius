import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MobileDevice } from '../shared/mobile.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class MobileStore {
  readonly serverId: string;
  private pending = new Map<
    string,
    {
      secretHash: string;
      name: string;
      code: string;
      expiresAt: number;
      invitation?: string;
      rejected?: boolean;
    }
  >();
  private prunePending() {
    for (const [id, value] of this.pending)
      if (value.expiresAt <= this.now()) this.pending.delete(id);
  }
  requestPairing(name: string) {
    this.prunePending();
    if (!name.trim() || name.length > 80 || /[\x00-\x1f]/u.test(name) || this.pending.size >= 16)
      return null;
    const id = randomUUID(),
      secret = randomBytes(32).toString('base64url');
    const code = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = this.now() + 300_000;
    this.pending.set(id, { secretHash: hash(secret), name: name.trim(), code, expiresAt });
    return { id, secret, code, expiresAt };
  }
  pendingRequests() {
    this.prunePending();
    return [...this.pending]
      .filter(([, value]) => !value.invitation && !value.rejected)
      .map(([id, { name, code, expiresAt }]) => ({ id, name, code, expiresAt }));
  }
  decidePairing(id: string, approve: boolean) {
    this.prunePending();
    const value = this.pending.get(id);
    if (!value || value.invitation || value.rejected) return false;
    if (approve) value.invitation = this.invite().invitation;
    else value.rejected = true;
    return true;
  }
  pairingStatus(id: string, secret: string) {
    this.prunePending();
    const value = this.pending.get(id);
    if (!value || secret.length > 128 || hash(secret) !== value.secretHash) return null;
    if (value.rejected) {
      this.pending.delete(id);
      return { status: 'rejected' as const };
    }
    if (value.invitation) {
      this.pending.delete(id);
      return { status: 'approved' as const, invitation: value.invitation };
    }
    return { status: 'pending' as const };
  }
  private invitations = new Map<string, number>();
  constructor(
    private db: DatabaseSync,
    private now: () => number,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mobile_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS mobile_identity (id INTEGER PRIMARY KEY CHECK(id=1), server_id TEXT NOT NULL) STRICT;`);
    db.prepare('INSERT OR IGNORE INTO mobile_identity VALUES (1, ?)').run(randomUUID());
    this.serverId = String(
      db.prepare('SELECT server_id FROM mobile_identity WHERE id=1').get()!.server_id,
    );
  }
  invite() {
    for (const [key, until] of this.invitations)
      if (until <= this.now()) this.invitations.delete(key);
    if (this.invitations.size >= 8) this.invitations.delete(this.invitations.keys().next().value!);
    const invitation = randomBytes(32).toString('base64url'),
      expiresAt = this.now() + 300_000;
    this.invitations.set(hash(invitation), expiresAt);
    return { invitation, expiresAt };
  }
  pair(invitation: string, name: string) {
    if (
      typeof invitation !== 'string' ||
      invitation.length > 128 ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      /[\x00-\x1f]/u.test(name)
    )
      return null;
    const key = hash(invitation),
      until = this.invitations.get(key);
    if (!until || until <= this.now()) return null;
    this.invitations.delete(key);
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO mobile_devices VALUES (?, ?, ?, ?)')
      .run(id, name.trim(), hash(token), this.now());
    return { deviceId: id, token, serverId: this.serverId, protocol: 1 as const };
  }
  authenticate(token: string): MobileDevice | null {
    if (!token || token.length > 128) return null;
    const row = this.db
      .prepare('SELECT id, name, created_at FROM mobile_devices WHERE token_hash=?')
      .get(hash(token));
    return row
      ? { id: String(row.id), name: String(row.name), createdAt: Number(row.created_at) }
      : null;
  }
  list(): MobileDevice[] {
    return this.db
      .prepare('SELECT id, name, created_at FROM mobile_devices ORDER BY created_at')
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        createdAt: Number(row.created_at),
      }));
  }
  remove(id: string) {
    return this.db.prepare('DELETE FROM mobile_devices WHERE id=?').run(id).changes > 0;
  }
}
