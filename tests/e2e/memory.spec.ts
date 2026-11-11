import { expect, test } from '@playwright/test';
import type { MemoryView } from '../../shared/memory';
import { login, screenshots } from './env';

test('mémoire : consultation, correction, oubli, désactivation et affichage mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  await page.getByLabel('Prénom ou nom d’affichage').fill('Camille mémoire');
  await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
  await expect(page.getByText('Profil créé.', { exact: true })).toBeVisible();
  const profile = (
    (await (await page.request.get('/api/admin/profiles')).json()) as { id: string; name: string }[]
  ).find((p) => p.name === 'Camille mémoire')!;
  const stamp = Date.now();
  const view: MemoryView = {
    profileId: profile.id,
    enabled: true,
    version: 1,
    memories: [
      {
        id: 'fixture-memory',
        profileId: profile.id,
        topic: 'Communication',
        fact: 'Préfère des réponses courtes.',
        scope: 'durable',
        expiresAt: null,
        createdAt: stamp,
        updatedAt: stamp,
        origin: 'conversation',
        evidence: [
          {
            turnId: 'user-turn-fixture',
            interactionId: 'conversation-fixture',
            startMs: 1200,
            endMs: 3500,
          },
        ],
      },
      {
        id: 'fixture-temporary',
        profileId: profile.id,
        topic: 'Agenda',
        fact: 'Part en vacances la semaine prochaine.',
        scope: 'temporary',
        expiresAt: stamp + 7 * 86_400_000,
        createdAt: stamp,
        updatedAt: stamp,
        origin: 'conversation',
        evidence: [
          { turnId: 'turn-a', interactionId: 'conversation-fixture', startMs: 0, endMs: 900 },
          { turnId: 'turn-b', interactionId: 'conversation-fixture', startMs: 1000, endMs: 1900 },
        ],
      },
    ],
    batches: [
      {
        id: 'batch-fixture',
        interactionId: 'conversation-fixture',
        profileId: profile.id,
        version: 0,
        status: 'applied',
        reason: '2 changements enregistrés.',
        createdAt: stamp,
      },
    ],
  };
  // Première correction refusée : la mémoire a changé ailleurs (une conversation, par exemple).
  let conflictOnce = true;
  // UI fixture only; memory-api.test.ts exercises these mutations against real SQLite and authentication.
  await page.route('**/api/admin/memory/' + profile.id + '**', async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      expect(body.version).toBe(view.version);
      view.enabled = body.enabled;
      view.version++;
    }
    if (request.method() === 'PUT' && conflictOnce) {
      conflictOnce = false;
      view.version++;
      await route.fulfill({
        status: 409,
        json: { error: 'La mémoire a changé. Actualisez avant de réessayer.' },
      });
      return;
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      expect(body.version).toBe(view.version);
      Object.assign(view.memories[0]!, body, {
        updatedAt: stamp + 1,
        origin: 'admin',
        evidence: [],
        expiresAt: body.expiresAt ? Date.parse(body.expiresAt) : null,
      });
      view.version++;
    }
    if (request.method() === 'DELETE') {
      expect(request.postDataJSON().version).toBe(view.version);
      const id = new URL(request.url()).pathname.split('/').at(-1);
      view.memories = view.memories.filter((memory) => memory.id !== id && id !== profile.id);
      view.version++;
    }
    await route.fulfill({ json: view });
  });
  await page.getByRole('button', { name: 'Mémoire', exact: true }).click();
  await page.getByLabel('Souvenirs de', { exact: true }).selectOption(profile.id);
  await expect(page.getByText('Préfère des réponses courtes.', { exact: true })).toBeVisible();
  // L’origine se lit sans identifiant technique de tour ni de conversation.
  const day = await page.evaluate(
    (value) => new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    stamp,
  );
  await expect(
    page.getByText('Retenu de 1 phrase dite par Camille mémoire le ' + day, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp('^Retenu de 2 phrases dites par Camille mémoire le ' + day)),
  ).toBeVisible();
  await expect(page.getByText('Temporaire', { exact: true })).toBeVisible();
  await expect(page.getByText(/user-turn-fixture|conversation-fixture/)).toHaveCount(0);
  // Ce que Cornelius a retenu récemment : en haut, replié.
  const recent = page.locator('details').filter({ hasText: 'Ce que Cornelius a retenu récemment' });
  await expect(recent).not.toHaveAttribute('open');
  await expect(page.getByText('2 changements enregistrés.', { exact: true })).toBeHidden();
  await recent.locator('summary').click();
  await expect(page.getByText('2 changements enregistrés.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${screenshots}/memory-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Tout oublier sur Camille mémoire' }).click();
  await expect(
    page.getByText('Oublier les 2 souvenirs de Camille mémoire ? C’est définitif.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Préfère des réponses courtes.' });
  await row.getByRole('button', { name: 'Corriger le souvenir « Communication »' }).click();
  const fact = page.getByLabel('Souvenir', { exact: true });
  await fact.fill('Préfère des explications détaillées.');
  await page.getByRole('button', { name: 'Enregistrer le souvenir' }).click();
  // Conflit : la liste est relue, la correction reste ouverte avec le brouillon.
  await expect(
    page.getByRole('status').filter({ hasText: /a changé entre-temps\. La liste est à jour/ }),
  ).toBeVisible();
  await expect(fact).toHaveValue('Préfère des explications détaillées.');
  await page.getByRole('button', { name: 'Enregistrer le souvenir' }).click();
  await expect(
    page.getByText('Préfère des explications détaillées.', { exact: true }),
  ).toBeVisible();
  await expect(fact).toHaveCount(0);
  await expect(page.getByText('Corrigé', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Corrigé dans l’administration le ' + day, { exact: true }),
  ).toBeVisible();
  await page.getByRole('switch', { name: 'Autoriser la mémoire' }).click();
  await expect(page.getByRole('switch', { name: 'Autoriser la mémoire' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Actualiser les souvenirs' }).click();
  await expect(page.getByRole('switch', { name: 'Autoriser la mémoire' })).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/memory-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByRole('button', { name: /^Oublier le souvenir « / })
    .first()
    .click();
  await expect(
    page.getByText('Oublier ce souvenir de Camille mémoire ? C’est définitif.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Oublier ce souvenir', exact: true }).click();
  await expect(
    page
      .getByRole('list', { name: 'Ce que Cornelius sait de Camille mémoire' })
      .getByRole('listitem'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Tout oublier sur Camille mémoire' }).click();
  await page.getByRole('button', { name: 'Oublier le souvenir', exact: true }).click();
  await expect(page.getByText(/^Aucun souvenir pour l’instant/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Tout oublier sur Camille mémoire' }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test('mémoire sans personne : un bouton mène à l’ajout d’une personne', async ({ page }) => {
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (value.type === 'state') value.state.profiles = [];
      route.send(JSON.stringify(value));
    });
  });
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    value.state.profiles = [];
    await route.fulfill({ response, json: value });
  });
  await login(page, '/admin#memory');
  await expect(page.getByRole('heading', { level: 1, name: 'Mémoire' })).toBeVisible();
  await page.getByRole('link', { name: 'Ajouter une personne' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Le foyer et les visages' }),
  ).toBeVisible();
  await expect(page.getByLabel('Prénom ou nom d’affichage')).toBeVisible();
});
