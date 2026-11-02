import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import {
  Alarms,
  AlarmError,
  formatLocal,
  nextOccurrence,
  parseDate,
  zonedTime,
} from '../server/alarms.js';
import { AlarmsRepository } from '../server/alarms-store.js';
import { AlarmTools } from '../server/alarms-tools.js';
import { DiagnosticLog } from '../server/logs.js';
import { openDatabase, ProfileRepository } from '../server/storage.js';
import {
  ALARM_CATCH_UP_MS,
  ALARM_RETENTION_MS,
  ALARM_SNOOZE_MS,
  ALARM_WEEKDAYS,
  ALARMS_ACTIVE_MAX,
  type AlarmRequest,
} from '../shared/alarms.js';
import type { MirrorState } from '../shared/types.js';

const paris = 'Europe/Paris';
const minute = 60_000;

/** Lundi 2 novembre 2026, 9 h à Paris (UTC+1). */
const start = Date.parse('2026-11-02T08:00:00Z');

const ask = (patch: Partial<AlarmRequest>): AlarmRequest => ({
  kind: 'alarm',
  profileId: null,
  label: '',
  time: null,
  date: null,
  days: 0,
  durationMs: null,
  inMinutes: null,
  ...patch,
});

function fixture(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let clock = start;
  const store = new AlarmsRepository(db, () => clock);
  const alarms = new Alarms(store, paris, new DiagnosticLog({ console: false }), () => clock);
  let changes = 0;
  alarms.onChange(() => changes++);
  return {
    db,
    store,
    alarms,
    profiles: new ProfileRepository(db),
    advance(ms: number) {
      clock += ms;
      alarms.tick();
    },
    set(at: number) {
      clock = at;
    },
    get now() {
      return clock;
    },
    get changes() {
      return changes;
    },
  };
}

test('heures murales : fuseau du foyer et changements d’heure', () => {
  assert.equal(
    zonedTime({ year: 2026, month: 11, day: 3 }, '07:00', paris),
    Date.parse('2026-11-03T06:00:00Z'),
  );
  assert.equal(
    zonedTime({ year: 2026, month: 7, day: 1 }, '07:00', paris),
    Date.parse('2026-07-01T05:00:00Z'),
  );
  // 2 h 30 n'existe pas le 29 mars 2026 : l'échéance tombe à 3 h 30, heure d'été.
  assert.equal(
    zonedTime({ year: 2026, month: 3, day: 29 }, '02:30', paris),
    Date.parse('2026-03-29T01:30:00Z'),
  );
  // 2 h 30 a lieu deux fois le 25 octobre 2026 : la seconde, heure d'hiver.
  assert.equal(
    zonedTime({ year: 2026, month: 10, day: 25 }, '02:30', paris),
    Date.parse('2026-10-25T01:30:00Z'),
  );
  // Un réveil quotidien reste à 7 h de part et d'autre du passage à l'heure d'hiver.
  const before = nextOccurrence('07:00', 0, Date.parse('2026-10-24T12:00:00Z'), paris);
  assert.equal(before, Date.parse('2026-10-25T06:00:00Z'));
  assert.equal(nextOccurrence('07:00', 0, before, paris), Date.parse('2026-10-26T06:00:00Z'));
  assert.equal(parseDate('2026-02-30'), null);
  assert.deepEqual(parseDate('2028-02-29'), { year: 2028, month: 2, day: 29 });
  assert.equal(formatLocal(Date.parse('2026-11-03T06:00:00Z'), paris), 'mardi 3 novembre à 07:00');
});

test('création : heure passée pour demain, jours de répétition, minuteur, rappel', (t) => {
  const f = fixture(t);
  // 7 h est passé ce lundi à 9 h : le réveil sonne demain.
  const tomorrow = f.alarms.create(ask({ time: '07:00' }));
  assert.equal(tomorrow.nextAt, Date.parse('2026-11-03T06:00:00Z'));
  assert.equal(tomorrow.atLocal, 'mardi 3 novembre à 07:00');
  // Samedi et dimanche seulement : samedi 7 novembre.
  const weekend = f.alarms.create(ask({ time: '09:30', days: 0b1100000 }));
  assert.equal(weekend.nextAt, Date.parse('2026-11-07T08:30:00Z'));
  const timer = f.alarms.create(ask({ kind: 'timer', durationMs: 10 * minute, label: ' pâtes ' }));
  assert.equal(timer.nextAt, start + 10 * minute);
  assert.equal(timer.label, 'pâtes');
  const reminder = f.alarms.create(
    ask({ kind: 'reminder', label: 'Appeler le garage', inMinutes: 20 }),
  );
  assert.equal(reminder.nextAt, start + 20 * minute);
  const dated = f.alarms.create(
    ask({ kind: 'reminder', label: 'Anniversaire', time: '18:00', date: '2026-12-24' }),
  );
  assert.equal(dated.nextAt, Date.parse('2026-12-24T17:00:00Z'));
  assert.equal(f.store.activeCount(null), 5);
});

test('création : demandes refusées avec le champ en cause', (t) => {
  const f = fixture(t);
  const refused = (request: Partial<AlarmRequest>, field?: string) =>
    assert.throws(
      () => f.alarms.create(ask(request)),
      (error) => error instanceof AlarmError && error.field === field,
    );
  refused({ time: '7h' }, 'time');
  refused({ time: '25:00' }, 'time');
  refused({ time: '07:00', date: '2026-11-01' }, 'date');
  refused({ time: '07:00', date: '2026-02-30' }, 'date');
  refused({ time: '07:00', date: '2028-01-01' }, 'date');
  refused({ time: '07:00', date: '2026-11-10', days: 1 }, 'date');
  refused({ kind: 'reminder', time: '07:00' }, 'label');
  refused({ kind: 'timer', durationMs: 1000 }, 'durationMs');
  refused({ kind: 'timer', durationMs: 25 * 3_600_000 }, 'durationMs');
  refused({ kind: 'timer', durationMs: minute, time: '07:00' });
  refused({ label: 'x'.repeat(121), time: '07:00' }, 'label');
  for (let index = 0; index < ALARMS_ACTIVE_MAX; index++)
    f.alarms.create(ask({ kind: 'timer', durationMs: minute }));
  refused({ kind: 'timer', durationMs: minute });
  // La limite est par personne : un profil garde la sienne.
  const artus = f.profiles.create('Artus');
  f.alarms.create(ask({ kind: 'timer', durationMs: minute, profileId: artus.id }));
});

test('sonnerie : arrive, se répète, s’arrête ; un réveil répété repart pour le suivant', (t) => {
  const f = fixture(t);
  const timer = f.alarms.create(ask({ kind: 'timer', durationMs: 5 * minute }));
  const daily = f.alarms.create(ask({ time: '09:10', days: ALARM_WEEKDAYS }));
  f.advance(4 * minute);
  assert.equal(f.alarms.ringing().length, 0);
  f.advance(minute);
  assert.deepEqual(
    f.alarms.ringing().map((alarm) => alarm.id),
    [timer.id],
  );
  assert.equal(f.alarms.snooze(timer.id, ALARM_SNOOZE_MS)?.state, 'snoozed');
  assert.equal(f.alarms.snooze(timer.id, ALARM_SNOOZE_MS), null);
  f.advance(5 * minute);
  // 9 h 10 : le réveil sonne ; le minuteur, repoussé, attend encore.
  assert.deepEqual(
    f.alarms.ringing().map((alarm) => alarm.id),
    [daily.id],
  );
  const next = f.alarms.stop(daily.id)!;
  assert.equal(next.state, 'scheduled');
  assert.equal(next.nextAt, Date.parse('2026-11-03T08:10:00Z'));
  f.advance(5 * minute);
  assert.equal(f.alarms.get(timer.id)!.state, 'ringing');
  assert.equal(f.alarms.stop(timer.id)!.state, 'done');
  assert.equal(f.alarms.stop(timer.id), null);
  assert.ok(f.changes > 0);
});

test('sonnerie sans réponse : arrêt automatique après la durée réglée', (t) => {
  const f = fixture(t);
  f.alarms.saveSettings({ ringMinutes: 2 });
  const timer = f.alarms.create(ask({ kind: 'timer', durationMs: minute }));
  const daily = f.alarms.create(ask({ time: '09:01', days: 127 }));
  f.advance(minute);
  assert.equal(f.alarms.ringing().length, 2);
  f.advance(minute);
  assert.equal(f.alarms.ringing().length, 2);
  f.advance(minute);
  assert.equal(f.alarms.ringing().length, 0);
  const missed = f.alarms.get(timer.id)!;
  assert.equal(missed.state, 'missed');
  assert.equal(missed.missedAt, start + minute);
  // Le réveil quotidien garde la trace et revient demain.
  const repeated = f.alarms.get(daily.id)!;
  assert.equal(repeated.state, 'scheduled');
  assert.equal(repeated.missedAt, start + minute);
  assert.equal(repeated.nextAt, Date.parse('2026-11-03T08:01:00Z'));
});

test('après un arrêt : un petit retard sonne encore, un grand est noté manqué', (t) => {
  const f = fixture(t);
  const soon = f.alarms.create(ask({ kind: 'timer', durationMs: 10 * minute }));
  const late = f.alarms.create(ask({ kind: 'reminder', label: 'Médicament', inMinutes: 1 }));
  // Serveur arrêté : aucune horloge pendant 20 minutes.
  f.set(start + 10 * minute + ALARM_CATCH_UP_MS - minute);
  f.alarms.tick();
  assert.equal(f.alarms.get(soon.id)!.state, 'ringing');
  assert.equal(f.alarms.get(late.id)!.state, 'missed');
  assert.equal(f.alarms.get(late.id)!.missedAt, start + minute);
});

test('désactivé : rien ne sonne ; ménage après une semaine ; profil supprimé', (t) => {
  const f = fixture(t);
  f.alarms.saveSettings({ enabled: false });
  const timer = f.alarms.create(ask({ kind: 'timer', durationMs: minute }));
  f.advance(2 * minute);
  assert.equal(f.alarms.get(timer.id)!.state, 'scheduled');
  f.alarms.saveSettings({ enabled: true });
  f.advance(ALARM_CATCH_UP_MS);
  assert.equal(f.alarms.get(timer.id)!.state, 'missed');
  f.advance(ALARM_RETENTION_MS + minute);
  assert.equal(f.alarms.get(timer.id), null);

  const sacha = f.profiles.create('Sacha');
  const own = f.alarms.create(ask({ time: '07:00', profileId: sacha.id }));
  f.profiles.delete(sacha.id);
  assert.equal(f.alarms.get(own.id), null);
});

test('administration : réglages, création, arrêt et suppression', async (t) => {
  const services = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'alarms-test-only-1234',
      origins: ['http://localhost'],
      secureCookies: false,
    },
    { timers: false, now: () => start },
  );
  await services.app.ready();
  t.after(() => services.app.close());
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'alarms-test-only-1234' },
  });
  const cookie = login.cookies.find((entry) => entry.name === 'cornelius_admin')!;
  const headers = { origin: 'http://localhost', cookie: `${cookie.name}=${cookie.value}` };
  const call = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    services.app.inject(
      payload === undefined ? { method, url, headers } : { method, url, headers, payload },
    );

  assert.equal(
    (await services.app.inject({ method: 'GET', url: '/api/admin/alarms' })).statusCode,
    401,
  );
  const initial = (await call('GET', '/api/admin/alarms')).json();
  assert.deepEqual(initial.settings, { enabled: true, ringMinutes: 5, sound: 'bips' });
  assert.equal(initial.timeZone, paris);
  assert.equal(
    (await call('PUT', '/api/admin/alarms/settings', { ringMinutes: 31 })).statusCode,
    400,
  );
  assert.equal(
    (await call('PUT', '/api/admin/alarms/settings', { ringMinutes: 10 })).json().settings
      .ringMinutes,
    10,
  );

  const body = { ...ask({ time: '07:00', days: ALARM_WEEKDAYS, label: 'travail' }) };
  const unknown = await call('POST', '/api/admin/alarms', { ...body, profileId: 'personne' });
  assert.equal(unknown.statusCode, 400);
  const past = await call('POST', '/api/admin/alarms', { ...body, days: 0, date: '2026-11-01' });
  assert.equal(past.statusCode, 400);
  assert.equal(past.json().field, 'date');
  assert.equal((await call('POST', '/api/admin/alarms', { ...body, target: 'x' })).statusCode, 400);
  const created = await call('POST', '/api/admin/alarms', body);
  assert.equal(created.statusCode, 200);
  const [alarm] = created.json().alarms;
  assert.equal(alarm.atLocal, 'mardi 3 novembre à 07:00');
  assert.equal(alarm.target, 'mirror');

  assert.equal((await call('POST', `/api/admin/alarms/${alarm.id}/stop`)).statusCode, 409);
  assert.equal((await call('POST', '/api/admin/alarms/inconnue/stop')).statusCode, 404);
  assert.equal((await call('DELETE', `/api/admin/alarms/${alarm.id}`)).json().alarms.length, 0);
  assert.equal((await call('DELETE', `/api/admin/alarms/${alarm.id}`)).statusCode, 404);
});

test('voix : réveil, rappel et minuteur, pour soi ou le foyer, sans doublon', (t) => {
  const f = fixture(t);
  const tools = new AlarmTools(f.alarms, () => f.now);
  const artus = f.profiles.create('Artus');
  const me = { profileId: artus.id, profileName: 'Artus', satelliteId: null };
  const set = (
    input: { profileId: string | null; profileName: string | null; satelliteId: string | null },
    args: Record<string, unknown>,
  ) =>
    tools.run(input, 'alarms__set', {
      kind: 'alarm',
      time: null,
      date: null,
      inMinutes: null,
      durationSeconds: null,
      days: [],
      label: null,
      owner: 'moi',
      ...args,
    });
  assert.match(tools.tools(artus.id)[0]!.description, /Nous sommes lundi 2 novembre 2026 à 09:00/u);

  const weekdays = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
  const alarm = set(me, { time: '07:00', days: weekdays });
  assert.equal(alarm.tool.status, 'succeeded');
  assert.equal(alarm.tool.result?.atLocal, 'mardi 3 novembre à 07:00');
  assert.equal(alarm.tool.result?.inWords, '22 h');
  assert.equal(alarm.tool.result?.repeat, 'en semaine');
  assert.match(alarm.tool.summary, /pour Artus\.$/u);
  assert.equal(alarm.card?.title, 'Réveil réglé');
  // Même demande relancée : rien de neuf.
  assert.equal(set(me, { time: '07:00', days: weekdays }).tool.result?.duplicate, true);
  assert.equal(f.store.activeCount(artus.id), 1);

  // Personne non reconnue : « moi » devient le foyer ; le satellite garde la sonnerie.
  const anonymous = { profileId: null, profileName: null, satelliteId: 'cuisine' };
  const timer = set(anonymous, { kind: 'timer', durationSeconds: 90, label: 'œufs' });
  assert.equal(timer.tool.result?.owner, 'foyer');
  assert.equal(f.alarms.get(String(timer.tool.result?.id))?.target, 'cuisine');

  const reminder = set(me, { kind: 'reminder', inMinutes: 20, label: 'Appeler le garage' });
  assert.equal(reminder.tool.result?.inWords, '20 min');
  const refused = set(me, { kind: 'reminder', time: '08:00', date: '2026-11-01', label: 'x' });
  assert.equal(refused.tool.status, 'failed');
  assert.equal(refused.tool.summary, 'Cette heure est déjà passée.');

  // Le foyer voit le minuteur, pas le réveil ni le rappel personnels.
  const listed = tools.run(anonymous, 'alarms__list', { kind: null });
  assert.equal((listed.tool.result?.items as unknown[]).length, 1);
  const mine = tools.run(me, 'alarms__list', { kind: null });
  assert.equal((mine.tool.result?.items as unknown[]).length, 3);
  assert.equal(mine.card?.items.length, 3);
});

test('voix : annuler par nom ou par heure ; plusieurs candidats, rien d’annulé', (t) => {
  const f = fixture(t);
  const tools = new AlarmTools(f.alarms, () => f.now);
  const input = { profileId: null, profileName: null, satelliteId: null };
  f.alarms.create(ask({ kind: 'timer', durationMs: 10 * minute, label: 'pâtes' }));
  f.alarms.create(ask({ kind: 'timer', durationMs: 20 * minute, label: 'gâteau' }));
  f.alarms.create(ask({ time: '07:00' }));
  f.alarms.create(ask({ time: '07:30' }));
  const cancel = (args: Record<string, unknown>) =>
    tools.run(input, 'alarms__cancel', { id: null, kind: null, match: null, all: false, ...args });

  const ambiguous = cancel({ kind: 'timer', match: 'le minuteur' });
  assert.equal(ambiguous.tool.result?.status, 'ambiguous');
  assert.equal(f.alarms.active(null).length, 4);
  assert.equal(
    cancel({ kind: 'timer', match: 'le minuteur des pates' }).tool.summary,
    'Le minuteur « pâtes » est annulé.',
  );
  assert.equal(cancel({ kind: 'alarm', match: '7 h 30' }).tool.status, 'succeeded');
  assert.deepEqual(
    f.alarms.active(null).map((alarm) => alarm.time ?? alarm.label),
    ['gâteau', '07:00'],
  );
  assert.equal(cancel({ kind: 'reminder' }).tool.error?.code, 'not_found');
  assert.equal(cancel({ all: true }).tool.summary, '2 échéances annulées.');

  f.alarms.saveSettings({ enabled: false });
  assert.deepEqual(tools.tools(null), []);
  assert.equal(tools.handles('alarms__set'), false);
});

/** Juste ce que les alarmes lisent de l'état du miroir : profils, personne active, présence. */
function mirror(
  profiles: { id: string; name: string }[],
  people: (string | null)[],
  active: string | null = people[0] ?? null,
) {
  return {
    profiles,
    activeProfile: profiles.find((profile) => profile.id === active) ?? null,
    presence: {
      health: 'ok',
      peopleCount: people.length,
      people: people.map((profileId, index) => ({ trackId: String(index), profileId })),
    },
  } as unknown as MirrorState;
}

test('miroir : ce qui sonne ; le texte d’un rappel personnel reste à son propriétaire seul', (t) => {
  const f = fixture(t);
  const sacha = f.profiles.create('Sacha');
  const profiles = [sacha];
  f.alarms.create(
    ask({ kind: 'reminder', label: 'Médicament', inMinutes: 1, profileId: sacha.id }),
  );
  f.alarms.create(ask({ time: '09:01', label: 'travail' }));
  assert.deepEqual(f.alarms.mirrorView(mirror(profiles, [])), { ringing: [], sound: 'bips' });
  f.advance(minute);
  const alone = f.alarms.mirrorView(mirror(profiles, [sacha.id]))!;
  assert.deepEqual(
    alone.ringing.map(({ title, text, soft }) => ({ title, text, soft })),
    [
      { title: 'Rappel pour Sacha', text: 'Médicament', soft: true },
      { title: 'Réveil · 09:01', text: 'travail', soft: false },
    ],
  );
  // Quelqu'un d'autre devant le miroir, ou Sacha accompagnée : le texte reste privé.
  for (const people of [[], [null], [sacha.id, null]])
    assert.equal(f.alarms.mirrorView(mirror(profiles, people))!.ringing[0]!.text, null);
  f.alarms.saveSettings({ sound: 'alerte' });
  assert.equal(f.alarms.mirrorView(mirror(profiles, []))!.sound, 'alerte');
  f.alarms.saveSettings({ enabled: false });
  assert.equal(f.alarms.mirrorView(mirror(profiles, [])), undefined);
});

test('voix : arrêter ou repousser ce qui sonne, quel que soit son propriétaire', (t) => {
  const f = fixture(t);
  const tools = new AlarmTools(f.alarms, () => f.now);
  const sacha = f.profiles.create('Sacha');
  const visitor = { profileId: null, profileName: null, satelliteId: null };
  const respond = (action: string, minutes: number | null = null) =>
    tools.run(visitor, 'alarms__respond', { action, minutes });
  assert.equal(respond('stop').tool.error?.code, 'not_found');
  const daily = f.alarms.create(ask({ time: '09:01', days: 127, profileId: sacha.id }));
  f.advance(minute);
  const snoozed = respond('snooze', 5);
  assert.equal(snoozed.tool.summary, 'Repoussé de 5 min : ça sonnera de nouveau à 09:06.');
  assert.equal(f.alarms.get(daily.id)!.state, 'snoozed');
  // « Arrête » pendant le répit : le réveil repart pour demain.
  assert.equal(respond('stop').tool.summary, 'Arrêté. Prochaine fois : mardi 3 novembre à 09:01.');
  assert.equal(f.alarms.get(daily.id)!.state, 'scheduled');
  assert.equal(respond('snooze').tool.error?.code, 'not_found');
});

test('annonces : ce qui sonne d’abord, puis les manqués, chacun dit une fois', (t) => {
  const f = fixture(t);
  const tools = new AlarmTools(f.alarms, () => f.now);
  const sacha = f.profiles.create('Sacha');
  const profiles = [sacha];
  const pasta = f.alarms.create(ask({ kind: 'timer', durationMs: minute, label: 'pâtes' }));
  f.alarms.create(
    ask({ kind: 'reminder', label: 'Médicament', inMinutes: 1, profileId: sacha.id }),
  );
  f.alarms.saveSettings({ ringMinutes: 1 });
  f.advance(minute);
  const ringing = tools.notices(mirror(profiles, [null]));
  assert.equal(ringing.length, 2);
  assert.match(ringing[0]!.content, /^Le minuteur « pâtes » sonne en ce moment/u);
  assert.match(ringing[1]!.content, /^Un rappel pour Sacha sonne/u);
  assert.doesNotMatch(ringing[1]!.content, /Médicament/u);
  assert.equal(ringing[0]!.acknowledge, undefined);

  // Personne n'a répondu : les deux sont manqués.
  f.advance(minute);
  const visitor = tools.notices(mirror(profiles, [null]));
  assert.deepEqual(
    visitor.map((notice) => notice.key.split(':')[0]),
    ['missed'],
  );
  assert.match(visitor[0]!.content, /Le minuteur « pâtes » a sonné à 09:01 sans réponse/u);
  visitor[0]!.acknowledge!();
  assert.equal(f.alarms.get(pasta.id)!.missedAt, null);
  const owner = tools.notices(mirror(profiles, [sacha.id]));
  assert.equal(owner.length, 1);
  assert.match(owner[0]!.content, /Rappel manqué de 09:01 pour Sacha .*"Médicament"/u);
  owner[0]!.acknowledge!();
  assert.deepEqual(tools.notices(mirror(profiles, [sacha.id])), []);
});
