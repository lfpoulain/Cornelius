import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  MemoryBatch,
  MemoryEdit,
  MemoryFact,
  MemoryTurn,
  MemoryView,
} from '../shared/memory.js';
import { validators } from '../shared/validation.js';

export const memoryMigration = `
  CREATE TABLE memory_policies (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    fact TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('durable', 'temporary')),
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('conversation', 'admin')),
    CHECK ((scope = 'durable' AND expires_at IS NULL) OR (scope = 'temporary' AND expires_at IS NOT NULL))
  ) STRICT;
  CREATE INDEX memories_profile ON memories(profile_id, updated_at);
  CREATE TABLE memory_batches (
    id TEXT PRIMARY KEY,
    interaction_id TEXT NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('extracting', 'applied', 'rejected', 'failed', 'cancelled')),
    reason TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (interaction_id, profile_id)
  ) STRICT;`;

export class MemoryError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}
const factColumns = `id, profile_id AS profileId, topic, fact, scope, expires_at AS expiresAt,
  created_at AS createdAt, updated_at AS updatedAt, evidence, origin`;
const batchColumns = `id, interaction_id AS interactionId, profile_id AS profileId, version, status,
  reason, created_at AS createdAt`;

export class MemoryRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now = Date.now,
  ) {}

  policy(profileId: string): { enabled: boolean; version: number } | null {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_policies (profile_id)
      SELECT id FROM profiles WHERE id = ?`,
      )
      .run(profileId);
    const row = this.db
      .prepare('SELECT enabled, version FROM memory_policies WHERE profile_id = ?')
      .get(profileId) as { enabled: number; version: number } | undefined;
    return row ? { enabled: !!row.enabled, version: row.version } : null;
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private bump(profileId: string) {
    this.db
      .prepare('UPDATE memory_policies SET version = version + 1 WHERE profile_id = ?')
      .run(profileId);
  }
  private requireVersion(profileId: string, version: number) {
    const policy = this.policy(profileId);
    if (!policy) throw new MemoryError('Profil introuvable.', 404);
    if (policy.version !== version)
      throw new MemoryError('La mémoire a changé. Actualisez avant de réessayer.', 409);
    return policy;
  }
  purgeExpired() {
    this.transaction(() => {
      const owners = this.db
        .prepare('SELECT DISTINCT profile_id FROM memories WHERE expires_at <= ?')
        .all(this.now()) as { profile_id: string }[];
      for (const row of owners) this.bump(row.profile_id);
      this.db.prepare('DELETE FROM memories WHERE expires_at <= ?').run(this.now());
    });
  }
  list(profileId: string): MemoryFact[] {
    const rows = this.db
      .prepare(
        `SELECT ${factColumns} FROM memories WHERE profile_id = ?
      AND (expires_at IS NULL OR expires_at > ?) ORDER BY updated_at DESC, id`,
      )
      .all(profileId, this.now());
    return rows.map((row) => ({
      ...row,
      evidence: JSON.parse(String(row.evidence)),
    })) as unknown as MemoryFact[];
  }
  view(profileId: string): MemoryView {
    this.purgeExpired();
    const policy = this.policy(profileId);
    if (!policy) throw new MemoryError('Profil introuvable.', 404);
    const batches = this.db
      .prepare(
        `SELECT ${batchColumns} FROM memory_batches WHERE profile_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 20`,
      )
      .all(profileId) as unknown as MemoryBatch[];
    return { profileId, ...policy, memories: this.list(profileId), batches };
  }
  setEnabled(profileId: string, enabled: boolean, version: number) {
    this.transaction(() => {
      const policy = this.requireVersion(profileId, version);
      if (policy.enabled === enabled) return;
      this.db
        .prepare(
          'UPDATE memory_policies SET enabled = ?, version = version + 1 WHERE profile_id = ?',
        )
        .run(Number(enabled), profileId);
    });
  }
  edit(profileId: string, id: string, edit: MemoryEdit) {
    this.transaction(() => {
      this.requireVersion(profileId, edit.version);
      this.validateFact(edit);
      const result = this.db
        .prepare(
          `UPDATE memories SET topic = ?, fact = ?, scope = ?, expires_at = ?,
        updated_at = ?, evidence = '[]', origin = 'admin' WHERE id = ? AND profile_id = ?`,
        )
        .run(
          edit.topic.trim(),
          edit.fact.trim(),
          edit.scope,
          edit.expiresAt ? Date.parse(edit.expiresAt) : null,
          this.now(),
          id,
          profileId,
        );
      if (!result.changes) throw new MemoryError('Souvenir introuvable.', 404);
      this.bump(profileId);
    });
  }
  forget(profileId: string, id: string | null, version: number) {
    this.transaction(() => {
      this.requireVersion(profileId, version);
      if (id) {
        const result = this.db
          .prepare('DELETE FROM memories WHERE id = ? AND profile_id = ?')
          .run(id, profileId);
        if (!result.changes) throw new MemoryError('Souvenir introuvable.', 404);
      } else this.db.prepare('DELETE FROM memories WHERE profile_id = ?').run(profileId);
      this.bump(profileId);
    });
  }
  private validateFact(value: {
    topic: string;
    fact: string | null;
    scope: string;
    expiresAt: string | null;
  }) {
    if (
      !value.topic.trim() ||
      value.topic.length > 80 ||
      !value.fact?.trim() ||
      value.fact.length > 500
    )
      throw new MemoryError('Sujet ou souvenir invalide.');
    if (
      value.scope === 'durable'
        ? value.expiresAt !== null
        : value.scope !== 'temporary' ||
          !value.expiresAt ||
          !Number.isFinite(Date.parse(value.expiresAt)) ||
          Date.parse(value.expiresAt) <= this.now()
    )
      throw new MemoryError(
        'Un souvenir temporaire exige une expiration future ; un souvenir durable n’en a pas.',
      );
  }
  begin(interactionId: string, profileId: string, version: number): MemoryBatch | null {
    const policy = this.policy(profileId);
    if (!policy?.enabled || policy.version !== version) return null;
    const batch: MemoryBatch = {
      id: randomUUID(),
      interactionId,
      profileId,
      version,
      status: 'extracting',
      reason: null,
      createdAt: this.now(),
    };
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_batches
      (id, interaction_id, profile_id, version, status, created_at) VALUES (?, ?, ?, ?, 'extracting', ?)`,
      )
      .run(batch.id, interactionId, profileId, version, batch.createdAt);
    return result.changes ? batch : null;
  }
  finish(id: string, status: MemoryBatch['status'], reason: string | null = null) {
    this.db
      .prepare(
        "UPDATE memory_batches SET status = ?, reason = ? WHERE id = ? AND status = 'extracting'",
      )
      .run(status, reason, id);
  }
  recover() {
    this.db
      .prepare(
        "UPDATE memory_batches SET status = 'cancelled', reason = 'Serveur redémarré ; transcription purgée.' WHERE status = 'extracting'",
      )
      .run();
  }
  apply(batch: MemoryBatch, proposal: unknown, turns: MemoryTurn[]): boolean {
    return this.transaction(() => {
      const stored = this.db
        .prepare(`SELECT ${batchColumns} FROM memory_batches WHERE id = ?`)
        .get(batch.id) as unknown as MemoryBatch | undefined;
      if (!stored || stored.status !== 'extracting') return false;
      const policy = this.policy(stored.profileId);
      const reject = (reason: string) => {
        this.finish(stored.id, 'rejected', reason);
        return false;
      };
      if (!policy?.enabled || policy.version !== stored.version)
        return reject('Politique ou version mémoire modifiée.');
      if (!validators.memoryChanges(proposal)) return reject('Proposition hors contrat.');
      const evidence = new Map(
        turns
          .filter(
            (turn) =>
              turn.profileId === stored.profileId &&
              turn.version === stored.version &&
              turn.text.trim(),
          )
          .map((turn) => [turn.id, turn]),
      );
      const existing = new Map(this.list(stored.profileId).map((fact) => [fact.id, fact]));
      const anywhere = this.db.prepare('SELECT 1 FROM memories WHERE id = ?');
      // Les petits modèles locaux confondent souvent ajout et correction : un « update » vers un
      // identifiant inventé, ou un « add » qui en porte un. Sans souvenir à viser, c'est un ajout ;
      // un oubli sans souvenir n'a rien à faire. Un identifiant connu, de ce profil ou d'un autre,
      // garde la vérification stricte ci-dessous, et chaque fait reste soumis à ses preuves.
      const changes = proposal.changes.flatMap((change) => {
        if (
          change.memoryId !== null &&
          (existing.has(change.memoryId) || anywhere.get(change.memoryId))
        )
          return [change];
        if (change.operation === 'forget') return [];
        return [{ ...change, operation: 'add' as const, memoryId: null }];
      });
      const touched = new Set<string>();
      for (const change of changes) {
        if (change.evidenceTurnIds.some((id) => !evidence.has(id)))
          return reject('Preuve absente ou non attribuable.');
        if (
          change.operation === 'add'
            ? change.memoryId !== null
            : !change.memoryId || !existing.has(change.memoryId)
        )
          return reject('Souvenir absent ou propriétaire incompatible.');
        if (change.memoryId && touched.has(change.memoryId))
          return reject('Opérations contradictoires dans un même lot.');
        if (change.memoryId) touched.add(change.memoryId);
        if (change.operation === 'forget') {
          if (change.fact !== null || !change.topic.trim()) return reject('Oubli invalide.');
        } else {
          try {
            this.validateFact(change);
          } catch {
            return reject('Fait ou expiration invalide.');
          }
        }
      }
      if (
        existing.size +
          changes.filter((c) => c.operation === 'add').length -
          changes.filter((c) => c.operation === 'forget').length >
        256
      )
        return reject('Limite de 256 souvenirs par profil atteinte.');
      let written = 0;
      for (const change of changes) {
        if (change.operation === 'forget') {
          this.db
            .prepare('DELETE FROM memories WHERE id = ? AND profile_id = ?')
            .run(change.memoryId!, stored.profileId);
          written++;
          continue;
        }
        const proof = change.evidenceTurnIds.map((id) => {
          const turn = evidence.get(id)!;
          return {
            turnId: id,
            interactionId: stored.interactionId,
            startMs: turn.startMs,
            endMs: turn.endMs,
          };
        });
        if (
          change.operation === 'add' &&
          this.list(stored.profileId).some(
            (m) =>
              m.topic === change.topic.trim() &&
              m.fact === change.fact!.trim() &&
              m.scope === change.scope &&
              m.expiresAt === (change.expiresAt ? Date.parse(change.expiresAt) : null),
          )
        )
          continue;
        this.db
          .prepare(
            `INSERT INTO memories (id, profile_id, topic, fact, scope, expires_at, created_at, updated_at, evidence, origin)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'conversation')
          ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, fact = excluded.fact, scope = excluded.scope,
            expires_at = excluded.expires_at, updated_at = excluded.updated_at, evidence = excluded.evidence, origin = 'conversation'`,
          )
          .run(
            change.memoryId ?? randomUUID(),
            stored.profileId,
            change.topic.trim(),
            change.fact!.trim(),
            change.scope,
            change.expiresAt ? Date.parse(change.expiresAt) : null,
            this.now(),
            this.now(),
            JSON.stringify(proof),
          );
        written++;
      }
      if (changes.length) this.bump(stored.profileId);
      // L’administration distingue une conversation sans fait utile d’une écriture réelle.
      this.finish(
        stored.id,
        'applied',
        written
          ? `${written} changement${written > 1 ? 's' : ''} enregistré${written > 1 ? 's' : ''}.`
          : 'Aucun fait à retenir dans cette conversation.',
      );
      return true;
    });
  }
}
