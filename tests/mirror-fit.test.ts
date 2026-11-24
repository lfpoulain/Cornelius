import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rowKind, valueFit } from '../web/components/fit.js';
import { AmbientModules } from '../web/components/AmbientModules.js';
import type { MirrorState } from '../shared/types.js';

test('la valeur principale donne sa longueur, icône comprise', () => {
  assert.deepEqual(valueFit('15:04'), { chars: 5, long: false });
  assert.deepEqual(valueFit('SP95-E10 1,807 €', true), { chars: 18, long: false });
  assert.equal(valueFit('Collecte des emballages demain matin').long, true);
});

test('une ligne dont la valeur est une phrase devient une ligne de texte', () => {
  assert.equal(rowKind({ value: '1,990 €' }), 'pair');
  assert.equal(rowKind({ value: 'dans 4 min, puis 12 min' }), 'text');
});

test('le miroir marque la tuile, la valeur et les lignes selon leur contenu', () => {
  const state = {
    privacyMode: false,
    browserConnected: true,
    activeProfile: null,
    presence: { state: 'present', health: 'ok', peopleCount: 1, people: [] },
    ambientDisplays: [
      {
        instanceId: 'actu',
        addonId: 'actu',
        profileId: null,
        label: 'En une',
        status: 'ready',
        fetchedAt: null,
        validUntil: null,
        content: {
          layout: 'list',
          title: 'Actualités',
          value: 'SP95-E10 1,807 €',
          subtitle: null,
          items: [
            { label: '1', value: 'La ligne de tramway rouvre lundi après trois mois de travaux' },
            { label: 'Gazole', value: '1,990 €' },
          ],
        },
      },
    ],
  } as unknown as MirrorState;
  const html = renderToStaticMarkup(createElement(AmbientModules, { state, now: Date.now() }));
  assert.match(html, /data-wide="true"/);
  assert.match(html, /class="ambient-value" style="--value-chars:16"/);
  assert.match(html, /data-row="text"/);
  assert.match(html, /data-row="pair"/);
});
