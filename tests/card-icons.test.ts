import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cardIcons, type AddonDefinition } from '../shared/addons.js';
import { validators } from '../shared/validation.js';
import { createTestModule } from '../server/addons/testing.js';
import demoAddon from './helpers/demo-addon/index.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '../web/components/Mirror.js';
import { AmbientModules } from '../web/components/AmbientModules.js';
import type { DisplayCard, MirrorState } from '../shared/types.js';

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

test('la référence du contrat documente chaque nom de cardIcons', () => {
  const reference = readFileSync(new URL('../docs/modules/reference.md', import.meta.url), 'utf8');
  const debut = reference.indexOf('### Les icônes des cartes');
  assert.ok(debut > 0, 'section « Les icônes des cartes »');
  const section = reference.slice(debut, reference.indexOf('\n## ', debut));
  for (const nom of cardIcons) assert.ok(section.includes(`\`${nom}\``), nom);
});

// Compatibilité : une carte sans icône est rendue exactement comme avant, une icône est
// décorative (aria-hidden) et laisse le texte entier.
const carteModule = (extra: Record<string, unknown> = {}, item: Record<string, unknown> = {}) =>
  ({
    id: 'carte-1',
    profileId: null,
    createdAt: 0,
    expiresAt: 1,
    sources: [],
    content: {
      schemaVersion: 1,
      cardType: 'module',
      addonId: 'meteo',
      instanceRef: null,
      title: 'Météo · Québec',
      primaryValue: '2 °C',
      subtitle: null,
      description: null,
      items: [{ label: 'Ce soir', value: 'Neige faible', ...item }],
      sources: [],
      snapshotId: 's',
      stale: false,
      ...extra,
    },
  }) as unknown as DisplayCard;

test('carte du miroir : sans icône, le rendu d’avant ; avec icône, décorative et texte entier', () => {
  const sans = renderToStaticMarkup(createElement(Card, { card: carteModule() }));
  assert.match(sans, /<p class="card-value">2 °C<\/p>/u);
  assert.match(sans, /<dt>Ce soir<\/dt><dd>Neige faible<\/dd>/u);
  assert.doesNotMatch(sans, /<svg|card-icon/u);

  const avec = renderToStaticMarkup(
    createElement(Card, { card: carteModule({ icon: 'cloud-sun' }, { icon: 'cloud-snow' }) }),
  );
  assert.match(
    avec,
    /<p class="card-value"><svg[^>]*aria-hidden="true"[^>]*data-icon="cloud-sun"[^>]*>.*<\/svg>2 °C<\/p>/u,
  );
  assert.match(
    avec,
    /<dt><svg[^>]*aria-hidden="true"[^>]*data-icon="cloud-snow"[^>]*>.*<\/svg>Ce soir<\/dt><dd>Neige faible<\/dd>/u,
  );
  // Sans les icônes, il reste exactement le texte de la carte sans icône.
  assert.equal(avec.replace(/<svg.*?<\/svg>/gu, ''), sans);
});

test('affichage permanent : sans icône, le rendu d’avant ; avec icône, décorative', () => {
  const etat = (content: Record<string, unknown>) =>
    ({
      browserConnected: true,
      presence: { health: 'ok', state: 'present', peopleCount: 1, people: [] },
      privacyMode: false,
      activeProfile: null,
      ambientDisplays: [
        {
          instanceId: 'i',
          profileId: null,
          addonId: 'meteo',
          label: 'Météo',
          status: 'ready',
          fetchedAt: null,
          validUntil: null,
          content: {
            layout: 'metric',
            title: 'Météo',
            value: '2 °C',
            subtitle: null,
            items: [],
            ...content,
          },
        },
      ],
    }) as unknown as MirrorState;
  const sans = renderToStaticMarkup(createElement(AmbientModules, { state: etat({}), now: 0 }));
  assert.match(sans, /<p class="ambient-value">2 °C<\/p>/u);
  assert.doesNotMatch(sans, /<svg/u);
  const avec = renderToStaticMarkup(
    createElement(AmbientModules, { state: etat({ icon: 'snowflake' }), now: 0 }),
  );
  assert.match(
    avec,
    /<p class="ambient-value"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>2 °C<\/p>/u,
  );
  assert.equal(avec.replace(/<svg.*?<\/svg>/gu, ''), sans);
});

test('une icône hors liste rend la carte du module non conforme', async (t) => {
  const horsListe: AddonDefinition = {
    ...demo,
    present(snapshot, context) {
      return { ...demo.present(snapshot, context), icon: 'licorne' as never };
    },
  };
  const f = createTestModule(t, horsListe, {
    routes: { '/parkings/demo': { name: 'Gare', available: 4 } },
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'malformed');
});
