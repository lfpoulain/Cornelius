import { test, expect, type WebSocketRoute } from '@playwright/test';
import type { StateEvent } from '../../shared/types';
import { login, origin } from './env';

test('l’accueil et les personnes reconnues se règlent dans « Quand il écoute » et persistent', async ({
  page,
}) => {
  await login(page, '/admin#voice');
  const greeting = page.getByRole('group', { name: 'Accueil à l’ouverture' });
  await expect(greeting.getByRole('radio', { name: /« Bonjour » et le prénom/ })).toBeChecked();
  const silent = greeting.getByRole('radio', { name: /Pas d’accueil/ });
  await silent.click();
  await expect(silent).toBeChecked();
  await expect(page.getByText('Accueil enregistré.', { exact: true })).toBeVisible();
  const known = page
    .getByRole('group', { name: 'Qui peut l’ouvrir' })
    .getByRole('radio', { name: /Les membres du foyer/ });
  await expect(known).not.toBeChecked();
  await known.click();
  await expect(known).toBeChecked();
  try {
    // Le choix s’affiche aussitôt : attendre son enregistrement avant de recharger.
    await expect(page.getByText('Ouverture enregistrée.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(silent).toBeChecked();
    await expect(known).toBeChecked();
  } finally {
    // La base est partagée par toute la série : rétablir les réglages par défaut.
    for (const [path, data] of [
      ['/api/admin/greeting', { mode: 'name' }],
      ['/api/admin/opening', { trigger: 'gaze', audience: 'everyone', recognizeVoice: false }],
    ] as const)
      await page.request.patch(path, { headers: { origin }, data });
  }
});

test('le module Web retire et rend la recherche web, réglage conservé', async ({ page }) => {
  await login(page, '/admin#voice');
  const open = async () => {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-web > summary').click();
  };
  await open();
  const toggle = page.getByRole('switch', { name: 'Autoriser la recherche web' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Recherche web désactivée.', { exact: true })).toBeVisible();
  try {
    await page.reload();
    await open();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#module-web')).toContainText('Désactivée');
  } finally {
    await page.request.patch('/api/admin/web-search', {
      headers: { origin },
      data: { enabled: true },
    });
  }
});

test('les cartes portent leur famille et naissent sans masquer leur texte', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const scope = { interactionId: 'cards-ui', profileEpoch: 0, contextVersion: 0 };
  const snapshot: StateEvent = {
    ...initial,
    bootId: 'cards-browser-fixture',
    sequence: 1,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      session: { ...initial.state.session, ...scope, phase: 'ready' },
      cards: [],
    },
  };
  let socket: WebSocketRoute | undefined;
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    socket = route;
    route.send(JSON.stringify(snapshot));
  });
  await page.goto('/');
  await expect(page.locator('.orb')).toHaveAttribute('data-renderer', 'three');
  const card = (
    id: string,
    content: StateEvent['state']['cards'][number]['content'],
    url?: string,
  ) => ({
    id,
    ...scope,
    profileId: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    content,
    sources: url ? [{ id: url, url, title: 'exemple.org' }] : [],
  });
  snapshot.state.cards = [
    card('bus', {
      schemaVersion: 1,
      cardType: 'module',
      addonId: 'transit',
      instanceRef: null,
      title: 'Mes bus',
      primaryValue: '3 min',
      subtitle: null,
      description: null,
      items: [],
      sources: [],
      snapshotId: 'transit:r1',
      stale: false,
    }),
    card(
      'web',
      {
        schemaVersion: 1,
        cardType: 'luna',
        title: 'Fête de la science',
        primaryValue: '10 octobre',
        subtitle: null,
        description: null,
        items: [],
        sources: [],
      },
      'https://exemple.org/',
    ),
  ];
  snapshot.sequence++;
  snapshot.sentAt = Date.now();
  socket?.send(JSON.stringify(snapshot));
  await expect(page.locator('.display-card')).toHaveCount(2);
  await expect(page.locator('.display-card[data-kind="bus"]')).toContainText('3 min');
  await expect(page.locator('.display-card[data-kind="web"]')).toContainText('10 octobre');
  // Mouvement réduit (configuration des tests) : le texte est lisible tout de suite.
  await expect(page.locator('.display-card[data-kind="bus"] .card-surface')).toHaveCSS(
    'opacity',
    '1',
  );
  expect(errors).toEqual([]);
});
