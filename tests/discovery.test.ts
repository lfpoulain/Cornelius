import assert from 'node:assert/strict';
import test from 'node:test';
import { mdnsSocketOptions } from '../server/discovery.js';

test('mDNS : hors Windows, la socket écoute toutes les adresses pour entendre les recherches', () => {
  for (const platform of ['linux', 'darwin'] as const)
    assert.deepEqual(mdnsSocketOptions('10.0.0.5', platform), {
      interface: '10.0.0.5',
      bind: '0.0.0.0',
    });
  assert.deepEqual(mdnsSocketOptions('10.0.0.5', 'win32'), { interface: '10.0.0.5' });
});
