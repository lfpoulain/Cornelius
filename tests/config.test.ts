import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../server/config.js';

/** Lit la configuration avec ces seules variables de supervision, puis rend l’environnement. */
function supervisedWith(env: { INVOCATION_ID?: string; CORNELIUS_SUPERVISED?: string }) {
  const saved = { ...process.env };
  try {
    delete process.env.INVOCATION_ID;
    delete process.env.CORNELIUS_SUPERVISED;
    process.env.CORNELIUS_ADMIN_PASSWORD = 'mot-de-passe-test';
    Object.assign(process.env, env);
    return loadConfig().supervised;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test('sans superviseur, un redémarrage relance lui-même le serveur', () => {
  assert.equal(supervisedWith({}), false);
  assert.equal(supervisedWith({ CORNELIUS_SUPERVISED: '0' }), false);
  assert.equal(supervisedWith({ CORNELIUS_SUPERVISED: '' }), false);
});

test('systemd ou CORNELIUS_SUPERVISED : un redémarrage n’a qu’à quitter', () => {
  assert.equal(supervisedWith({ INVOCATION_ID: 'b5c1a7' }), true);
  assert.equal(supervisedWith({ CORNELIUS_SUPERVISED: '1' }), true);
  assert.equal(supervisedWith({ CORNELIUS_SUPERVISED: ' Oui ' }), true);
});

test('la boucle locale reste de confiance, sauf CORNELIUS_TRUST_LOOPBACK=0', () => {
  const saved = { ...process.env };
  try {
    process.env.CORNELIUS_ADMIN_PASSWORD = 'mot-de-passe-test';
    delete process.env.CORNELIUS_TRUST_LOOPBACK;
    assert.equal(loadConfig().trustLoopback, true);
    for (const value of ['0', 'false', ' Non ']) {
      process.env.CORNELIUS_TRUST_LOOPBACK = value;
      assert.equal(loadConfig().trustLoopback, false, value);
    }
    process.env.CORNELIUS_TRUST_LOOPBACK = '1';
    assert.equal(loadConfig().trustLoopback, true);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
