import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cardIcons, type AddonDefinition } from '../shared/addons.js';
import { validators } from '../shared/validation.js';
import { createTestModule } from '../server/addons/testing.js';
import demoAddon from './helpers/demo-addon/index.js';

const demo = demoAddon as unknown as AddonDefinition;

test('les deux schémas acceptent exactement la liste cardIcons', () => {
  for (const nom of ['module-card', 'ambient-presentation']) {
    const schema = JSON.parse(
      readFileSync(new URL(`../schemas/${nom}.schema.json`, import.meta.url), 'utf8'),
    );
    assert.deepEqual(schema.properties.icon.enum, [...cardIcons], nom);
    assert.deepEqual(
      schema.properties.items.items.properties.icon,
      { $ref: '#/properties/icon' },
      nom,
    );
  }
});

test('carte de module : icône de la valeur et des lignes, nom inconnu refusé', () => {
  const carte = {
    schemaVersion: 1,
    cardType: 'module',
    addonId: 'meteo',
    instanceRef: null,
    title: 'Météo · Québec',
    icon: 'cloud-sun',
    primaryValue: '2 °C',
    subtitle: 'Partiellement nuageux',
    description: null,
    items: [
      { label: 'Ce soir', value: 'Généralement nuageux, minimum -6', icon: 'cloud-moon' },
      { label: 'Vent', value: '12 km/h' },
    ],
    sources: [],
    snapshotId: 'meteo:test:r1',
    stale: false,
  };
  assert.equal(validators.moduleCard(carte), true);
  assert.equal(validators.moduleCard({ ...carte, icon: 'parapluie' }), false);
  assert.equal(
    validators.moduleCard({
      ...carte,
      items: [{ label: 'Ce soir', value: 'nuageux', icon: 'licorne' }],
    }),
    false,
  );
});

test('une icône rendue par present() arrive dans la carte et l’affichage permanent', async (t) => {
  const avecIcones: AddonDefinition = {
    ...demo,
    present(snapshot, context) {
      const presentation = demo.present(snapshot, context);
      return {
        ...presentation,
        icon: 'sun',
        items: [{ label: 'Météo', value: 'ensoleillé', icon: 'cloud-sun' }],
      };
    },
    ambient: demo.ambient && {
      ...demo.ambient,
      present(snapshot, context) {
        const ambient = demo.ambient!.present(snapshot, context);
        return { ...ambient, icon: 'thermometer' };
      },
    },
  };
  const f = createTestModule(t, avecIcones, {
    routes: { '/parkings/demo': { name: 'Gare', available: 4 } },
  });
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok && result.card.icon, 'sun');
  assert.deepEqual(result.ok && result.card.items, [
    { label: 'Météo', value: 'ensoleillé', icon: 'cloud-sun' },
  ]);
  if (demo.ambient) assert.equal(f.ambient().content?.icon, 'thermometer');
  // Sans icône, la carte n'en porte aucune (pas de champ vide).
  const sans = createTestModule(t, demo, {
    routes: { '/parkings/demo': { name: 'Gare', available: 4 } },
  });
  const ordinaire = await sans.read();
  assert.equal(ordinaire.ok && 'icon' in ordinaire.card, false);
});
