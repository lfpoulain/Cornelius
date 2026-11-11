import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticLog } from '../server/logs.js';

test('logs mask secrets and sensitive fields in errors, nested details and files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-logs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'test.log');
  const logs = new DiagnosticLog({ file, secrets: ['private-local-key'] });
  logs.write('error', 'openai', 'failure', {
    error: Object.assign(new Error('private-local-key sk-example Bearer abcdef'), {
      status: 401,
      request_id: 'req-123',
    }),
    nested: { token: 'hidden-token', sdp: 'hidden-sdp', transcript: 'hidden-words' },
  });
  const output = JSON.stringify(logs.snapshot()) + readFileSync(file, 'utf8');
  for (const secret of [
    'private-local-key',
    'sk-example',
    'abcdef',
    'hidden-token',
    'hidden-sdp',
    'hidden-words',
  ])
    assert.ok(!output.includes(secret), secret);
  assert.match(output, /req-123/);
  assert.match(output, /401/);
});

test('logs bound memory and rotate files, while disk errors preserve diagnostics', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-rotation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const logs = new DiagnosticLog({ file: join(directory, 'test.log'), maxBytes: 300 });
  for (let i = 0; i < 1010; i++) logs.write('info', 'local', 'event', { i });
  assert.equal(logs.snapshot().entries.length, 1000);
  assert.equal(readdirSync(directory).length, 4);
  writeFileSync(join(directory, 'blocked'), 'file');
  const broken = new DiagnosticLog({ file: join(directory, 'blocked', 'test.log') });
  assert.doesNotThrow(() => broken.write('info', 'local', 'start'));
  assert.equal(broken.snapshot().diskAvailable, false);
  assert.equal(broken.snapshot().entries.at(-1)?.level, 'error');
});

test('journal : la rotation part du fichier existant et survit à un dossier retiré', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'logs', 'test.log');
  const first = new DiagnosticLog({ file, maxBytes: 300 });
  for (let i = 0; i < 2; i++) first.write('info', 'local', 'event', { i });
  assert.deepEqual(readdirSync(join(directory, 'logs')), ['test.log']);
  // Après un redémarrage, la taille déjà écrite compte : la limite n’est pas remise à zéro.
  const second = new DiagnosticLog({ file, maxBytes: 300 });
  for (let i = 0; i < 2; i++) second.write('info', 'local', 'event', { i });
  assert.deepEqual(readdirSync(join(directory, 'logs')).sort(), ['test.log', 'test.log.1']);
  rmSync(join(directory, 'logs'), { recursive: true, force: true });
  second.write('info', 'local', 'après le retrait du dossier');
  assert.equal(second.snapshot().diskAvailable, true);
  assert.match(readFileSync(file, 'utf8'), /après le retrait du dossier/);
});
