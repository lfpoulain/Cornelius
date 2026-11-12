import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { npmNotices, unixLines } from '../scripts/notices.js';

test('THIRD_PARTY_NOTICES.md liste toutes les bibliothèques npm (npm run notices)', () => {
  // Une extraction Git en CRLF (Windows) ne rend pas la liste périmée.
  const text = unixLines(
    readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
  );
  assert.ok(text.includes(npmNotices()), 'Liste périmée : lancez npm run notices.');
});

test('la licence du projet est déclarée partout de la même façon', () => {
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /^Required Notice: Copyright/m);
  assert.match(license, /# PolyForm Noncommercial License 1\.0\.0/);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.license, 'PolyForm-Noncommercial-1.0.0');
});
