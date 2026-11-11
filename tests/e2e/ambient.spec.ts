import { test, expect, type WebSocketRoute } from '@playwright/test';
import type { StateEvent } from '../../shared/types';
import { login, origin, screenshots } from './env';
import { withModuleTokens } from './module-tokens';

test('l’administration conserve le choix d’affichage permanent de chaque source', async ({
  page,
}) => {
  await withModuleTokens(page);
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-weather > summary').click();
  await page.getByLabel('Rechercher un module ou une source').fill('météo');
  await page.getByRole('button', { name: 'Ajouter une source' }).click();
  await page.getByLabel('Nom affiché').fill('Météo permanente test');
  await page.getByLabel('Code INSEE').fill('75056');
  const toggle = page.getByRole('switch', { name: 'Afficher en permanence sur le miroir' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/addons/instances') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const instance = await (await saved).json();
  try {
    expect(instance.displayEnabled).toBe(true);
    await expect(page.getByText('Affichage permanent', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-weather > summary').click();
    const row = page.locator('.rounded-lg.border.p-4').filter({ hasText: 'Météo permanente test' });
    await row.getByRole('button', { name: 'Configurer' }).click();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(row.getByText('Affichage permanent', { exact: true })).toHaveCount(0);
  } finally {
    await page.request.delete('/api/admin/addons/instances/' + instance.id, {
      headers: { origin },
    });
  }
});

test('les informations restent affichées sans conversation et suivent la reconnaissance', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const alice = { id: 'alice-ambient', name: 'Sacha', createdAt: 1 };
  const bob = { id: 'bob-ambient', name: 'Camille', createdAt: 1 };
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const snapshot: StateEvent = {
    ...initial,
    bootId: 'ambient-browser-fixture',
    sequence: 1,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      activeProfile: alice,
      selection: 'automatic',
      profiles: [alice, bob],
      privacyMode: false,
      presence: {
        state: 'present',
        health: 'ok',
        peopleCount: 1,
        engagementId: null,
        observedAt: Date.now(),
        people: [{ trackId: 'one', profileId: alice.id, engaged: false }],
      },
      ambientDisplays: [
        {
          instanceId: 'meteo',
          addonId: 'weather',
          profileId: null,
          label: 'Météo maison',
          status: 'ready',
          fetchedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          content: {
            layout: 'metric',
            title: 'Météo',
            value: '12 / 21 °C',
            subtitle: 'Paris · Peu nuageux',
            items: [],
          },
        },
        {
          instanceId: 'bus',
          addonId: 'transit',
          profileId: alice.id,
          label: 'Trajet de Sacha',
          status: 'ready',
          fetchedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          content: {
            layout: 'list',
            title: 'Prochains bus',
            value: null,
            subtitle: 'Ligne 91 → Montparnasse',
            items: [
              { label: 'Prochain', value: '4 min' },
              { label: 'Suivant', value: '12 min' },
            ],
          },
        },
        {
          instanceId: 'other',
          addonId: 'transit',
          profileId: bob.id,
          label: 'Trajet de Camille',
          status: 'ready',
          fetchedAt: null,
          validUntil: null,
          content: {
            layout: 'metric',
            title: 'Bus privé Camille',
            value: '9 min',
            subtitle: null,
            items: [],
          },
        },
      ],
      cards: [],
    },
  };
  let socket: WebSocketRoute | undefined;
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    socket = route;
    route.send(JSON.stringify(snapshot));
  });
  const heartbeat = setInterval(
    () =>
      socket?.send(
        JSON.stringify({
          schemaVersion: 1,
          type: 'heartbeat',
          bootId: snapshot.bootId,
          sequence: snapshot.sequence,
          sentAt: Date.now(),
        }),
      ),
    1000,
  );
  const publish = () => {
    snapshot.sequence++;
    snapshot.sentAt = Date.now();
    socket?.send(JSON.stringify(snapshot));
  };
  try {
    await page.goto('/');
    const permanent = page.getByRole('complementary', { name: 'Informations permanentes' });
    await expect(permanent).toBeVisible();
    await expect(permanent.getByText('12 / 21 °C')).toBeVisible();
    await expect(permanent.getByText('4 min', { exact: true })).toBeVisible();
    // Un seul en-tête par module : le nom de la source, sans le titre générique en double.
    const weather = permanent.getByRole('region', { name: 'Météo maison' });
    await expect(weather.getByRole('heading')).toHaveText('Météo maison');
    await expect(weather.getByText('Météo', { exact: true })).toHaveCount(0);
    await expect(page.locator('.display-card')).toHaveCount(0);
    await expect(page.getByText('Trajet de Camille')).toHaveCount(0);
    await page.screenshot({ path: `${screenshots}/ambient-desktop.png` });
    // Écran 1920 x 1080 : les informations restent discrètes autour de l’orbe.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const sizes = await page.evaluate(() => ({
      value: parseFloat(getComputedStyle(document.querySelector('.ambient-value')!).fontSize),
      heading: parseFloat(getComputedStyle(document.querySelector('.ambient-heading')!).fontSize),
      width: document.querySelector('.ambient-module')!.getBoundingClientRect().width,
      height: document.querySelector('.mirror-ambient')!.getBoundingClientRect().height,
    }));
    expect(sizes.value).toBeLessThanOrEqual(38);
    expect(sizes.heading).toBeLessThanOrEqual(14);
    expect(sizes.width).toBeLessThanOrEqual(280);
    await page.screenshot({ path: `${screenshots}/ambient-1920x1080.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(permanent).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${screenshots}/ambient-mobile.png` });
    // Valeur périmée : son ancienneté reste visible, en ambre, même sur un téléphone.
    snapshot.state.ambientDisplays[1]!.status = 'stale';
    snapshot.state.ambientDisplays[1]!.fetchedAt = new Date(Date.now() - 12 * 60_000).toISOString();
    publish();
    const stale = permanent
      .getByRole('region', { name: 'Trajet de Sacha' })
      .locator('.ambient-status');
    await expect(stale).toHaveText(/^Dernière donnée connue, il y a 12\smin$/);
    await expect(stale).toBeVisible();
    await expect(stale).toHaveCSS('color', 'rgb(224, 194, 140)');
    await page.screenshot({ path: `${screenshots}/ambient-stale-mobile.png` });
    snapshot.state.activeProfile = bob;
    snapshot.state.presence.people = [{ trackId: 'one', profileId: bob.id, engaged: false }];
    publish();
    await expect(page.getByText('Trajet de Sacha')).toHaveCount(0);
    await expect(page.getByText('Trajet de Camille')).toBeVisible();
    await expect(permanent.getByText('9 min', { exact: true })).toBeVisible();
    snapshot.state.privacyMode = true;
    snapshot.state.presence.peopleCount = 2;
    publish();
    await expect(permanent).toHaveCount(0);
    snapshot.state.privacyMode = false;
    snapshot.state.presence.state = 'absent';
    publish();
    await expect(permanent).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    clearInterval(heartbeat);
  }
});
