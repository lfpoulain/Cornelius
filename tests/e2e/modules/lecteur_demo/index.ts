/**
 * Module de démonstration du lecteur audio (contrat 0.4.1) : il exerce un outil `play` sans
 * fournisseur réel. Ses stations sont des adresses réglées dans la source ; il ne fait aucun
 * appel réseau, le flux est ouvert par le cœur. Chargé par les parcours navigateur et l'aperçu
 * (CORNELIUS_MODULES_DIR=tests/e2e/modules), testé par tests/player.test.ts.
 */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';

type Station = { nom: string; adresse: string; genre: 'live' | 'file' };
type LecteurConfig = { stations: Station[]; logo: string | null };
type LecteurData = { stations: number; choisie: string | null };

/** « France Inter » et « france-inter » se valent : minuscules, sans accents ni signes. */
function cle(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

const instanceRef = { instanceRef: { type: ['string', 'null'] } };

const addon: AddonDefinition<LecteurConfig, LecteurData> = {
  id: 'lecteur_demo',
  apiVersion: 1,
  version: '1.0.0',
  // Un module publié déclarerait minCoreVersion: '0.4.1' ; celui-ci est livré avec ses tests.
  sourceLabel: 'Lecteur de démonstration',
  display: {
    name: 'Lecteur de démonstration',
    description: 'Module d’essai du lecteur audio : joue sur le miroir les flux réglés ici.',
    icon: 'music',
    group: 'home',
    example: { label: 'Radios', ref: 'radios' },
  },
  configVersion: 1,
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['stations', 'logo'],
    properties: {
      stations: {
        title: 'Stations',
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['nom', 'adresse', 'genre'],
          properties: {
            nom: { title: 'Nom', type: 'string', minLength: 1, maxLength: 80 },
            adresse: {
              title: 'Adresse du flux',
              type: 'string',
              pattern: '^https://',
              maxLength: 2000,
            },
            genre: {
              title: 'Genre',
              type: 'string',
              oneOf: [
                { const: 'live', title: 'En direct' },
                { const: 'file', title: 'Fichier' },
              ],
            },
          },
        },
      },
      logo: {
        title: 'Logo',
        description: 'Image https commune aux stations, facultative.',
        type: ['string', 'null'],
        pattern: '^https://',
        maxLength: 2000,
      },
    },
  },
  configDefaults: {
    stations: [{ nom: 'Radio Démo', adresse: 'https://radio.example/direct.mp3', genre: 'live' }],
    logo: null,
  },
  dataVersion: 1,
  dataSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['stations', 'choisie'],
    properties: {
      stations: { type: 'integer', minimum: 0 },
      choisie: { type: ['string', 'null'], maxLength: 80 },
    },
  },
  freshMs: 60_000,
  tools: [
    {
      name: 'read',
      description: 'Lister les stations du lecteur de démonstration.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: instanceRef,
      },
    },
    {
      name: 'ecouter',
      description:
        'Écouter une station du lecteur de démonstration sur le miroir (« mets Radio Démo »). query : le nom de la station.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef', 'query'],
        properties: { ...instanceRef, query: { type: 'string' } },
      },
      query: { maxLength: 80 },
      play: true,
    },
  ],
  async collect(context) {
    const { stations, logo } = context.config;
    if (!context.play || !context.query)
      return {
        data: { stations: stations.length, choisie: null },
        source: { provider: 'demo', sourceId: 'stations' },
      };
    const demandee = cle(context.query);
    const station =
      stations.find((candidate) => cle(candidate.nom) === demandee) ??
      stations.find((candidate) => cle(candidate.nom).includes(demandee));
    if (!station)
      throw new AddonCollectError('not_found', `Aucune station « ${context.query} » réglée.`);
    return {
      data: { stations: stations.length, choisie: station.nom },
      source: { provider: 'demo', sourceId: 'stations' },
      playback: {
        url: station.adresse,
        title: station.nom,
        subtitle: 'Station de démonstration',
        imageUrl: logo,
        kind: station.genre,
      },
    };
  },
  present(snapshot) {
    const data = snapshot.data!;
    return {
      title: 'Lecteur de démonstration',
      primaryValue: data.choisie ?? `${data.stations} station${data.stations > 1 ? 's' : ''}`,
      subtitle: null,
      description: null,
      items: [],
      summary: data.choisie
        ? `${data.choisie}, sur le miroir.`
        : `${data.stations} station${data.stations > 1 ? 's' : ''} réglée${data.stations > 1 ? 's' : ''}.`,
      sources: ['lecteur_demo'],
    };
  },
};

export default addon;
