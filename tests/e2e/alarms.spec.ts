import { test, expect } from '@playwright/test';
import type { StateEvent } from '../../shared/types';
import { login, origin, screenshots } from './env';

test('un minuteur créé dans l’administration sonne sur le miroir puis s’arrête', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-alarms > summary').click();
  await page.getByRole('button', { name: 'Minuteur', exact: true }).click();
  await page.getByLabel('Durée (minutes)').fill('0,1');
  await page.getByLabel('Nom (facultatif)').fill('pâtes');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/alarms') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const view = await (await created).json();
  const timer = view.alarms.find((alarm: { label: string }) => alarm.label === 'pâtes');
  expect(timer?.kind).toBe('timer');
  try {
    await page.goto('/');
    const ringing = page.getByRole('alert', { name: 'Ce qui sonne' });
    await expect(ringing).toContainText('Minuteur', { timeout: 15_000 });
    await expect(ringing).toContainText('pâtes');
    await page.screenshot({ path: `${screenshots}/alarme-miroir.png` });
    const stopped = await page.request.post(`/api/admin/alarms/${timer.id}/stop`, {
      headers: { origin },
      data: {},
    });
    expect(stopped.ok()).toBe(true);
    await expect(ringing).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/admin/alarms/${timer.id}`, { headers: { origin } });
  }
  expect(errors).toEqual([]);
});

test('bandeau : compte à rebours, prochain réveil et pense-bêtes du jour', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sacha = { id: 'sacha-alarms', name: 'Sacha', createdAt: 1 };
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const now = Date.now();
  const snapshot: StateEvent = {
    ...initial,
    bootId: 'alarms-browser-fixture',
    sequence: 1,
    sentAt: now,
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      activeProfile: sacha,
      selection: 'automatic',
      profiles: [sacha],
      presence: {
        state: 'present',
        health: 'ok',
        peopleCount: 1,
        engagementId: null,
        observedAt: now,
        people: [{ trackId: 'one', profileId: sacha.id, engaged: false }],
      },
      ambientDisplays: [],
      cards: [],
      alarms: {
        ringing: [],
        sound: 'bips',
        timers: [{ id: 'pates', label: 'pâtes', endsAt: now + 9 * 60_000 + 30_000 }],
        nextAlarm: {
          id: 'reveil',
          at: now + 20 * 3_600_000,
          time: '07:00',
          day: 'demain',
          label: null,
        },
        today: [{ id: 'garage', at: now + 3_600_000, time: '14:00', text: 'Appeler le garage' }],
      },
    },
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    route.send(JSON.stringify(snapshot));
  });
  await page.goto('/');
  const band = page.getByRole('complementary', { name: 'Minuteurs, réveil et rappels' });
  await expect(band).toContainText('Minuteur · pâtes');
  await expect(band.locator('time')).toHaveText(/^9:(2\d|30)$/u);
  const first = await band.locator('time').textContent();
  await expect(band.locator('time')).not.toHaveText(first!, { timeout: 3_000 });
  await expect(band).toContainText('07:00');
  await expect(band).toContainText('demain');
  await expect(band).toContainText('Appeler le garage');
  await page.screenshot({ path: `${screenshots}/alarmes-bandeau.png` });
  expect(errors).toEqual([]);
});
