import { test, expect } from '@playwright/test';
import { login, origin, screenshots } from './env';

test('l’heure se configure et se supprime comme une source, sans horloge imposée au miroir', async ({
  page,
  context,
}) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-clock > summary').click();
  await page.getByLabel('Rechercher un module ou une source').fill('heure');
  await expect(page.getByText('Horloge locale', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter une source' }).click();
  await page.getByLabel('Nom affiché').fill('Heure test');
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('Europe/Paris');
  // Les réglages oui ou non sont des interrupteurs.
  await page.getByRole('switch', { name: 'Afficher les secondes' }).click();
  await page.getByRole('switch', { name: 'Afficher la date' }).click();
  await page.getByRole('switch', { name: 'Afficher en permanence sur le miroir' }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/addons/instances') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const instance = await (await saved).json();
  try {
    expect(instance.config).toEqual({
      timeZone: 'Europe/Paris',
      showDate: false,
      showSeconds: true,
    });
    expect(instance.displayEnabled).toBe(true);
    const row = page.locator('.rounded-lg.border.p-4').filter({ hasText: 'Heure test' });
    await row.getByRole('button', { name: 'Tester la source Heure test', exact: true }).click();
    await expect(row.getByText(/Réponse À jour/i)).toBeVisible();
    await row.getByRole('button', { name: 'Supprimer la source Heure test', exact: true }).click();
    await row.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(page.getByText('Heure test', { exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-clock > summary').click();
    await expect(page.getByText('Heure test', { exact: true })).toHaveCount(0);
    const mirror = await context.newPage();
    await mirror.goto('/');
    await expect(mirror.getByTestId('mirror-orb')).toBeVisible();
    await expect(mirror.locator('.mirror-clock, .mirror-header time')).toHaveCount(0);
    await mirror.close();
  } finally {
    await page.request.delete('/api/admin/addons/instances/' + instance.id, {
      headers: { origin },
    });
  }
});

test('l’heure permanente masque le relevé technique et disparaît quand sa source est retirée', async ({
  page,
}) => {
  const snapshot = await (await page.request.get('/api/state')).json();
  snapshot.bootId = 'clock-browser-fixture';
  snapshot.sequence = 1;
  snapshot.state.openaiBlocked = true;
  snapshot.state.browserConnected = true;
  snapshot.state.privacyMode = false;
  snapshot.state.activeProfile = null;
  snapshot.state.presence = {
    state: 'present',
    health: 'ok',
    peopleCount: 1,
    engagementId: null,
    observedAt: Date.now(),
    people: [{ trackId: 'visitor', profileId: null, engaged: false }],
  };
  snapshot.state.ambientDisplays = [
    {
      instanceId: 'clock-test',
      addonId: 'clock',
      profileId: null,
      label: 'Heure du foyer',
      status: 'ready',
      fetchedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      content: {
        layout: 'metric',
        title: 'Heure',
        value: '12:34:56',
        subtitle: null,
        items: [],
        showCollectedAt: false,
      },
    },
  ];
  let publish = () => {};
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    publish = () => {
      snapshot.sequence++;
      snapshot.sentAt = Date.now();
      route.send(JSON.stringify(snapshot));
    };
    route.send(JSON.stringify(snapshot));
  });
  await page.goto('/');
  const display = page.getByRole('region', { name: 'Heure du foyer' });
  await expect(display.getByText('12:34:56')).toBeVisible();
  await expect(display.locator('.ambient-time, .ambient-subtitle')).toHaveCount(0);
  await expect(page.locator('.mirror-clock, .display-card')).toHaveCount(0);
  await page.screenshot({ path: `${screenshots}/clock-module.png` });
  snapshot.state.ambientDisplays[0].content.value = '12:34:57';
  publish();
  await expect(display.getByText('12:34:57')).toBeVisible();
  // Une heure périmée dit son ancienneté, même sans relevé affiché d’ordinaire.
  snapshot.state.ambientDisplays[0].status = 'stale';
  publish();
  await expect(display.locator('.ambient-status')).toHaveText(
    /^Dernière donnée connue, (à l’instant|il y a 1\smin)$/,
  );
  await expect(display.locator('.ambient-status time')).toBeVisible();
  snapshot.state.ambientDisplays = [];
  publish();
  await expect(display).toHaveCount(0);
  await expect(page.locator('.mirror-clock')).toHaveCount(0);
});
