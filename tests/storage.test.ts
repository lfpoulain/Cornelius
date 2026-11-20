import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeAssistantRepository } from '../server/home-assistant-store.js';
import {
  AddonRepository,
  migrations,
  openDatabase,
  ProfileRepository,
  SessionPreferences,
} from '../server/storage.js';

/** Version juste avant la migration visée : elle et les suivantes, rejouables, repassent. */
function before(fragment: string): number {
  const index = migrations.findIndex((sql) => sql.includes(fragment));
  assert.ok(index >= 0, 'Migration introuvable : ' + fragment);
  return index;
}

test('profile validation, rename and hard deletion are persisted with foreign keys enabled', () => {
  const db = openDatabase(':memory:');
  try {
    const profiles = new ProfileRepository(db);
    const first = profiles.create('Alice');
    const second = profiles.create('Bob');
    assert.equal(profiles.list().length, 2);
    assert.equal(profiles.rename(first.id, '  Alicia  ').name, 'Alicia');
    assert.throws(() => profiles.create('   '));
    assert.throws(() => profiles.create('A\nB'));
    assert.throws(() => profiles.rename('unknown', 'Test'), /introuvable/u);
    profiles.delete(first.id);
    assert.equal(profiles.get(first.id), null);
    assert.equal(profiles.get(second.id)?.name, 'Bob');
    assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  } finally {
    db.close();
  }
});

test('migration backs up an existing database consistently and does not back it up on every startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-migration-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE legacy_marker (value TEXT); INSERT INTO legacy_marker VALUES ('preserved');",
    );
    db.close();
    db = openDatabase(path);
    const fresh = openDatabase(':memory:');
    try {
      assert.equal(
        db.prepare('PRAGMA user_version').get()?.user_version,
        fresh.prepare('PRAGMA user_version').get()?.user_version,
      );
      assert.deepEqual(
        {
          ...db
            .prepare('SELECT vision_mode, vision_model, vision_device FROM camera_preferences')
            .get(),
        },
        { vision_mode: 'scene', vision_model: '450m', vision_device: 'auto' },
      );
    } finally {
      fresh.close();
    }
    assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
    assert.equal(db.prepare('SELECT value FROM legacy_marker').get()?.value, 'preserved');
    const backups = readdirSync(directory).filter((file) => file.includes('.backup-'));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(join(directory, backups[0]!), { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version, 0);
      assert.equal(backup.prepare('SELECT value FROM legacy_marker').get()?.value, 'preserved');
    } finally {
      backup.close();
    }
    new SessionPreferences(db).setOpenAIBlocked(true);
    db.close();
    db = openDatabase(path);
    assert.equal(new SessionPreferences(db).getOpenAIBlocked(), true);
    assert.equal(readdirSync(directory).filter((file) => file.includes('.backup-')).length, 1);
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('delegation mode migrates existing settings and persists all choices across restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-delegation-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    const preferences = new SessionPreferences(db);
    preferences.setSessionMode(2);
    preferences.setPrivacyMode(true);
    // Reconstruct the schema just before the delegation migration; the later idempotent
    // migrations run again.
    db.exec('ALTER TABLE session_preferences DROP COLUMN delegation_mode');
    db.exec(`PRAGMA user_version = ${before('ADD COLUMN delegation_mode')}`);
    db.close();
    db = openDatabase(path);
    assert.equal(new SessionPreferences(db).getDelegationMode(), 'fast');
    assert.equal(new SessionPreferences(db).getSessionMode(), 2);
    assert.equal(new SessionPreferences(db).getPrivacyMode(), true);
    for (const mode of ['normal', 'ultrafast', 'fast'] as const) {
      new SessionPreferences(db).setDelegationMode(mode);
      db.close();
      db = openDatabase(path);
      assert.equal(new SessionPreferences(db).getDelegationMode(), mode);
    }
    assert.throws(() =>
      db.prepare('UPDATE session_preferences SET delegation_mode = ?').run('unknown'),
    );
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('input_boolean devenu commandable : une sélection faite pour le lire est décochée', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-input-boolean-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    db.prepare('UPDATE home_assistant SET selected = ?, revision = 4 WHERE id = 1').run(
      JSON.stringify(['light.salon', 'input_boolean.mode_nuit', 'sensor.temperature']),
    );
    db.exec(`PRAGMA user_version = ${before("'input_boolean.'")}`);
    db.close();
    db = openDatabase(path);
    const config = new HomeAssistantRepository(db).get();
    assert.deepEqual(config.selected, ['light.salon', 'sensor.temperature']);
    assert.equal(config.revision, 5);
    // Rejouée sur une base déjà migrée, elle ne change rien.
    db.exec(`PRAGMA user_version = ${before("'input_boolean.'")}`);
    db.close();
    db = openDatabase(path);
    assert.equal(new HomeAssistantRepository(db).get().revision, 5);
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed migrations roll back the schema version and leave the previous database usable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-migration-failure-'));
  const path = join(directory, 'cornelius.sqlite');
  const original = new DatabaseSync(path);
  original.exec('CREATE TABLE session_preferences (legacy INTEGER);');
  original.close();
  try {
    assert.throws(() => openDatabase(path), /already exists/u);
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0);
      assert.equal(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'profiles'").get(),
        undefined,
      );
      assert.equal(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'session_preferences'").get()?.name,
        'session_preferences',
      );
      assert.deepEqual(
        (db.prepare('PRAGMA table_info(session_preferences)').all() as { name: string }[]).map(
          (column) => column.name,
        ),
        ['legacy'],
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('l’affichage est désactivé par défaut et son activation persiste après redémarrage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-ambient-migration-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    const source = new AddonRepository(db).createInstance({
      addonId: 'weather',
      profileId: null,
      ref: null,
      label: 'Source existante',
      config: {},
      configVersion: 1,
    });
    db.close();
    db = openDatabase(path);
    assert.equal(new AddonRepository(db).getInstance(source.id)?.displayEnabled, false);
    new AddonRepository(db).updateInstance(source.id, { displayEnabled: true });
    db.close();
    db = openDatabase(path);
    assert.equal(new AddonRepository(db).getInstance(source.id)?.displayEnabled, true);
    assert.equal(new AddonRepository(db).getInstance(source.id)?.label, 'Source existante');
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('les délais de présence persistent après réouverture de la base', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-timings-'));
  const path = join(directory, 'cornelius.sqlite');
  const settings = {
    presenceMs: 800,
    absenceMs: 4500,
    engagementMs: 500,
    disengagementMs: 12000,
    identityHoldMs: 4000,
  };
  let db = openDatabase(path);
  try {
    const preferences = new SessionPreferences(db);
    assert.deepEqual(preferences.getPresenceTimings(), {
      presenceMs: 400,
      absenceMs: 1500,
      engagementMs: 350,
      disengagementMs: 8000,
      identityHoldMs: 8000,
    });
    preferences.setPresenceTimings(settings);
    db.close();
    db = openDatabase(path);
    assert.deepEqual(new SessionPreferences(db).getPresenceTimings(), settings);
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('la migration ajoute le maintien d’identité sans perdre les délais réglés', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-identity-hold-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    db.prepare('UPDATE session_preferences SET presence_timings = ?').run(
      JSON.stringify({
        presenceMs: 600,
        absenceMs: 2500,
        engagementMs: 350,
        disengagementMs: 12000,
      }),
    );
    // Rejoue la migration du maintien d’identité et celles, idempotentes, qui la suivent.
    db.exec(`PRAGMA user_version = ${before("'$.identityHoldMs'")}`);
    db.close();
    db = openDatabase(path);
    assert.deepEqual(new SessionPreferences(db).getPresenceTimings(), {
      presenceMs: 600,
      absenceMs: 2500,
      engagementMs: 350,
      disengagementMs: 12000,
      identityHoldMs: 8000,
    });
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('le son d’ouverture est désactivé par défaut, persiste et survit à une migration rejouée', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-admission-sound-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    assert.deepEqual(new SessionPreferences(db).getAdmissionSound(), {
      enabled: false,
      sound: 'carillon',
    });
    new SessionPreferences(db).setAdmissionSound({ enabled: true, sound: 'cloche' });
    db.exec(`PRAGMA user_version = ${before('admission_sound_preferences')}`);
    db.close();
    db = openDatabase(path);
    assert.deepEqual(new SessionPreferences(db).getAdmissionSound(), {
      enabled: true,
      sound: 'cloche',
    });
    // Un son retiré d’une version future retombe sur le son par défaut.
    db.prepare('UPDATE admission_sound_preferences SET sound = ?').run('disparu');
    assert.equal(new SessionPreferences(db).getAdmissionSound().sound, 'carillon');
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('recherche web, accueil et personnes reconnues gardent le comportement existant par défaut et persistent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-conversation-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    let preferences = new SessionPreferences(db);
    assert.equal(preferences.getWebSearchEnabled(), true);
    assert.equal(preferences.getGreetingMode(), 'name');
    assert.equal(preferences.getKnownPeopleOnly(), false);
    preferences.setWebSearchEnabled(false);
    preferences.setGreetingMode('off');
    preferences.setKnownPeopleOnly(true);
    // La migration rejouée ne réinitialise pas les choix enregistrés.
    db.exec(`PRAGMA user_version = ${before('IF NOT EXISTS conversation_preferences')}`);
    db.close();
    db = openDatabase(path);
    preferences = new SessionPreferences(db);
    assert.equal(preferences.getWebSearchEnabled(), false);
    assert.equal(preferences.getGreetingMode(), 'off');
    assert.equal(preferences.getKnownPeopleOnly(), true);
    assert.throws(() =>
      db.prepare('UPDATE conversation_preferences SET greeting = ?').run('salut'),
    );
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fin de parole, Home Assistant réservé et reconnaissance vocale : désactivés par défaut et conservés', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-listening-'));
  const path = join(directory, 'cornelius.sqlite');
  let db = openDatabase(path);
  try {
    let preferences = new SessionPreferences(db);
    assert.deepEqual(preferences.getSilenceClose(), { enabled: false, delayMs: 20_000 });
    assert.equal(preferences.getVoiceRecognition(), false);
    assert.equal(new HomeAssistantRepository(db).get().knownPeopleOnly, false);
    preferences.setSilenceClose({ enabled: true, delayMs: 45_000 });
    preferences.setVoiceRecognition(true);
    const home = new HomeAssistantRepository(db);
    home.save({ ...home.get(), knownPeopleOnly: true });
    assert.throws(() => preferences.setSilenceClose({ enabled: true, delayMs: 999 }));
    // La migration rejouée ne réinitialise pas les choix enregistrés.
    db.exec(`PRAGMA user_version = ${before('IF NOT EXISTS listening_preferences')}`);
    db.close();
    db = openDatabase(path);
    preferences = new SessionPreferences(db);
    assert.deepEqual(preferences.getSilenceClose(), { enabled: true, delayMs: 45_000 });
    assert.equal(preferences.getVoiceRecognition(), true);
    assert.equal(new HomeAssistantRepository(db).get().knownPeopleOnly, true);
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('le délai de silence du mode voix rejoint « Fin de parole » et quitte les délais', (t) => {
  const migrate = (mode: number, speechIdleMs: number, silenceClose: 0 | 1) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const index = before('SET silence_close_ms = (');
    for (const migration of migrations.slice(0, index)) db.exec(migration);
    db.prepare(
      `UPDATE session_preferences SET session_mode = ?, presence_timings = json_set(presence_timings, '$.speechIdleMs', ?) WHERE id = 1`,
    ).run(mode, speechIdleMs);
    db.prepare('UPDATE listening_preferences SET silence_close = ? WHERE id = 1').run(silenceClose);
    for (const migration of migrations.slice(index)) db.exec(migration);
    // Rejouable : une deuxième application ne change rien.
    db.exec(migrations[index]!);
    const row = db
      .prepare(
        `SELECT silence_close_ms, json_type(presence_timings, '$.speechIdleMs') AS legacy FROM listening_preferences, session_preferences`,
      )
      .get() as { silence_close_ms: number; legacy: string | null };
    return [row.silence_close_ms, row.legacy];
  };
  assert.deepEqual(migrate(4, 12000, 0), [12000, null]);
  assert.deepEqual(migrate(4, 1000, 0), [3000, null], 'borné au minimum de « Fin de parole »');
  assert.deepEqual(migrate(3, 12000, 0), [20000, null], 'mode caméra : délai par défaut gardé');
  assert.deepEqual(migrate(4, 12000, 1), [20000, null], 'réglage déjà choisi : gardé');
});
