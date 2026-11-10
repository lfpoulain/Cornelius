import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import { duplicateNameMessage, profileNameKey, sameNameProfile } from '../shared/profile-names.js';

const origin = 'http://localhost';
const password = 'profiles-test-only-1234';

async function fixture(t: TestContext, databasePath = ':memory:') {
  const services = await createApp(
    { databasePath, adminPassword: password, origins: [origin], secureCookies: false },
    { timers: false },
  );
  await services.app.ready();
  t.after(() => services.app.close());
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const entry = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
  const headers = { origin, cookie: `${entry.name}=${entry.value}` };
  const create = (payload: Record<string, unknown>) =>
    services.app.inject({ method: 'POST', url: '/api/admin/profiles', headers, payload });
  const rename = (id: string, name: string) =>
    services.app.inject({
      method: 'PATCH',
      url: '/api/admin/profiles/' + id,
      headers,
      payload: { name },
    });
  return { ...services, headers, create, rename };
}

test('les noms se comparent sans casse, sans accents et sans espaces répétés', () => {
  assert.equal(profileNameKey('  Élodie  Marie '), 'elodie marie');
  assert.equal(profileNameKey('CAMILLE'), profileNameKey('camille'));
  const profiles = [
    { id: 'a', name: 'Élodie' },
    { id: 'b', name: 'Camille' },
  ];
  assert.equal(sameNameProfile(profiles, 'elodie')?.id, 'a');
  assert.equal(sameNameProfile(profiles, 'Elodie', 'a'), null);
  assert.equal(sameNameProfile(profiles, 'Camille D.'), null);
  assert.equal(sameNameProfile(profiles, '   '), null);
  assert.equal(
    duplicateNameMessage('Camille', ' camille '),
    '« Camille » fait déjà partie du foyer. Ajoutez une initiale pour les distinguer, par exemple « Camille B. ».',
  );
});

test('un nom déjà pris est refusé à la création et au renommage, sans bloquer les doublons anciens', async (t) => {
  const f = await fixture(t);
  const camille = await f.create({ name: 'Camille' });
  assert.equal(camille.statusCode, 201, camille.body);
  for (const name of ['camille', ' CAMILLE ', 'Cämille', 'Camille  ']) {
    const duplicate = await f.create({ name });
    assert.equal(duplicate.statusCode, 409, name);
    assert.match(
      duplicate.json().error,
      /^« Camille » fait déjà partie du foyer\. Ajoutez une initiale/,
    );
  }
  const initial = await f.create({ name: 'Camille D.' });
  assert.equal(initial.statusCode, 201, initial.body);
  const robin = (await f.create({ name: 'Robin' })).json<{ id: string }>();
  const renamed = await f.rename(robin.id, 'camille d.');
  assert.equal(renamed.statusCode, 409);
  assert.match(renamed.json().error, /« Camille D\. » fait déjà partie du foyer/);
  // Changer seulement la casse de son propre nom reste possible.
  const own = await f.rename(camille.json<{ id: string }>().id, 'CAMILLE');
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.json().name, 'CAMILLE');
  // Des doublons créés avant la règle ne bloquent ni la liste, ni un autre renommage, ni la suppression.
  const old = f.profiles.create('Robin');
  assert.equal(
    (await f.app.inject({ url: '/api/admin/profiles', headers: f.headers })).statusCode,
    200,
  );
  assert.equal((await f.rename(old.id, 'Robin B.')).statusCode, 200);
  assert.equal((await f.rename(robin.id, 'Robin')).statusCode, 200);
  const twin = f.profiles.create('Robin');
  assert.equal(
    (
      await f.app.inject({
        method: 'DELETE',
        url: '/api/admin/profiles/' + twin.id,
        headers: f.headers,
      })
    ).statusCode,
    200,
  );
});

test('la mémoire est autorisée par défaut et peut être refusée dès la création', async (t) => {
  const f = await fixture(t);
  const memoryOf = async (id: string) =>
    (await f.app.inject({ url: '/api/admin/memory/' + id, headers: f.headers })).json<{
      enabled: boolean;
    }>();
  const plain = (await f.create({ name: 'Alice' })).json<{ id: string }>();
  assert.equal((await memoryOf(plain.id)).enabled, true);
  const allowed = (await f.create({ name: 'Bruno', memoryEnabled: true })).json<{ id: string }>();
  assert.equal((await memoryOf(allowed.id)).enabled, true);
  const refused = await f.create({ name: 'Chloé', memoryEnabled: false });
  assert.equal(refused.statusCode, 201, refused.body);
  assert.equal((await memoryOf(refused.json<{ id: string }>().id)).enabled, false);
  for (const payload of [
    { name: 'Denis', memoryEnabled: 'non' },
    { name: 'Denis', memoryEnabled: null },
  ]) {
    assert.equal((await f.create(payload)).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(
    f.profiles.list().some((profile) => profile.name === 'Denis'),
    false,
  );
});

test('supprimer un profil efface visage, souvenirs, style, repères, sources, commandes et agent, copies comprises', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-profiles-'));
  const path = join(directory, 'cornelius.sqlite');
  const f = await fixture(t, path);
  const camille = (await f.create({ name: 'Camille' })).json<{ id: string }>();
  const robin = (await f.create({ name: 'Robin' })).json<{ id: string }>();
  const db = new DatabaseSync(path);
  // Les crochets s’exécutent dans l’ordre de leur déclaration : le dossier s’efface en dernier,
  // une fois le serveur et cette connexion fermés. Sous Windows, une base encore ouverte ne se
  // supprime pas (EPERM).
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const seed = (profileId: string) => {
    const now = Date.now();
    db.prepare(
      'INSERT INTO profile_faces (profile_id, embedding, templates, enrolled_at) VALUES (?, ?, ?, ?)',
    ).run(profileId, '[1]', '[[1]]', now);
    db.prepare(
      `INSERT INTO memories (id, profile_id, topic, fact, scope, expires_at, created_at, updated_at, evidence, origin)
       VALUES (?, ?, 'goûts', 'Aime le thé.', 'durable', NULL, 1, 1, '[]', 'admin')`,
    ).run(randomUUID(), profileId);
    db.prepare(
      `INSERT INTO memory_batches (id, interaction_id, profile_id, version, status, created_at)
       VALUES (?, ?, ?, 0, 'applied', 1)`,
    ).run(randomUUID(), randomUUID(), profileId);
    db.prepare('INSERT OR IGNORE INTO memory_policies (profile_id) VALUES (?)').run(profileId);
    db.prepare(
      'INSERT INTO profile_personality (profile_id, instructions, context) VALUES (?, ?, ?)',
    ).run(profileId, 'Tutoie-moi.', 'Mon bureau est Pivoine.');
    const instance = randomUUID();
    db.prepare(
      `INSERT INTO addon_instances (id, addon_id, profile_id, ref, label, enabled, config, config_version, created_at, updated_at)
       VALUES (?, 'clock', ?, NULL, 'Horloge', 1, '{}', 1, ?, ?)`,
    ).run(instance, profileId, now, now);
    db.prepare('INSERT INTO addon_states (instance_id, updated_at) VALUES (?, ?)').run(
      instance,
      now,
    );
    const action = randomUUID();
    db.prepare(
      `INSERT INTO http_actions (id, ref, label, method, url, profile_id, created_at, updated_at)
       VALUES (?, ?, 'Portail', 'POST', 'https://example.test/portail', ?, ?, ?)`,
    ).run(action, 'portail-' + profileId.slice(0, 8), profileId, now, now);
    db.prepare(
      `INSERT INTO action_runs (id, action_id, profile_id, idempotency_key, status, started_at)
       VALUES (?, ?, ?, ?, 'succeeded', ?)`,
    ).run(randomUUID(), action, profileId, randomUUID(), now);
    const connection = randomUUID();
    db.prepare(
      `INSERT INTO agent_connections (profile_id, id, url, token, enabled, description, revision, discovery)
       VALUES (?, ?, 'https://agent.test', 'jeton', 1, '', 1, NULL)`,
    ).run(profileId, connection);
    db.prepare(
      `INSERT INTO agent_tasks (id, connection_id, profile_id, session_id, scope, call_id, persistent, status, created_at, updated_at)
       VALUES (?, ?, ?, 's', '{}', ?, 0, 'running', ?, ?)`,
    ).run(randomUUID(), connection, profileId, randomUUID(), now, now);
  };
  seed(camille.id);
  seed(robin.id);
  // Copie de sécurité au format de celles créées avant une migration.
  const backup = `${path}.backup-v40-${Date.now()}-${randomUUID()}.sqlite`;
  db.prepare('VACUUM INTO ?').run(backup);
  const tables = [
    'profile_faces',
    'memories',
    'memory_batches',
    'memory_policies',
    'profile_personality',
    'addon_instances',
    'http_actions',
    'agent_connections',
    'agent_tasks',
  ];
  const counts = (database: DatabaseSync, profileId: string) =>
    Object.fromEntries(
      tables.map((table) => [
        table,
        Number(
          database
            .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE profile_id = ?`)
            .get(profileId)?.count,
        ),
      ]),
    );
  const states = (database: DatabaseSync) =>
    Number(database.prepare('SELECT COUNT(*) AS count FROM addon_states').get()?.count);
  const runs = (database: DatabaseSync) =>
    Number(database.prepare('SELECT COUNT(*) AS count FROM action_runs').get()?.count);
  const none = Object.fromEntries(tables.map((table) => [table, 0]));
  const one = Object.fromEntries(tables.map((table) => [table, 1]));
  assert.deepEqual(counts(db, camille.id), one);

  const deleted = await f.app.inject({
    method: 'DELETE',
    url: '/api/admin/profiles/' + camille.id,
    headers: f.headers,
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.deepEqual(counts(db, camille.id), none);
  assert.deepEqual(counts(db, robin.id), one);
  assert.equal(states(db), 1);
  assert.equal(runs(db), 1);
  const copy = new DatabaseSync(backup, { readOnly: true });
  try {
    assert.equal(
      Number(
        copy.prepare('SELECT COUNT(*) AS count FROM profiles WHERE id = ?').get(camille.id)?.count,
      ),
      0,
    );
    assert.deepEqual(counts(copy, camille.id), none);
    assert.deepEqual(counts(copy, robin.id), one);
    assert.equal(states(copy), 1);
    assert.equal(runs(copy), 1);
  } finally {
    copy.close();
  }
});
