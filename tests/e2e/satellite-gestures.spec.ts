import { expect, test } from '@playwright/test';
import { fakeHomeAssistant } from '../helpers/home-assistant';
import { origin } from './env';
import { WebSocket } from 'ws';
import { once } from 'node:events';

test('gestes : ancien satellite, droits HA, sauvegarde et aide desktop/mobile', async ({
  page,
}) => {
  const fake = await fakeHomeAssistant();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let socket: WebSocket | undefined;
  try {
    await page.goto('/admin');
    await page
      .getByLabel('Mot de passe administrateur')
      .fill('admin-browser-test-only-credentials-1234');
    await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
    const headers = { origin };
    const current = await (await page.request.get('/api/admin/home-assistant')).json();
    const connected = await page.request.put('/api/admin/home-assistant', {
      headers,
      data: { url: fake.url, token: fake.token, revision: current.revision },
    });
    expect(connected.ok()).toBeTruthy();
    const selected = await page.request.put('/api/admin/home-assistant/selection', {
      headers,
      data: { selected: ['light.salon'], revision: (await connected.json()).revision },
    });
    expect(selected.ok()).toBeTruthy();
    const created = await page.request.post('/api/admin/satellites', {
      headers,
      data: { name: 'Satellite de recette' },
    });
    expect(created.ok()).toBeTruthy();
    const issued = await created.json();
    socket = new WebSocket(origin.replace('http:', 'ws:') + '/satellite', {
      headers: { authorization: 'Bearer ' + issued.token },
    });
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.2.0' }));
    await page.getByRole('button', { name: 'Satellites audio', exact: true }).click();
    await page.getByText('Gestes de la main', { exact: true }).click();
    const panel = page
      .locator('details')
      .filter({ has: page.getByText('Gestes de la main', { exact: true }) });
    await expect(panel.getByRole('status')).toContainText('Capteur non annoncé');
    await expect(panel.getByLabel('Activer les commandes gestuelles')).not.toBeChecked();
    await expect(panel.locator('select')).toHaveCount(7);
    await expect(panel.getByText('Cercle horaire', { exact: true })).toHaveCount(0);
    await expect(panel.getByLabel('Lampe du salon', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('Prise du bureau', { exact: true })).toHaveCount(0);
    const help = panel.getByRole('button', { name: 'Aide sur les commandes gestuelles' });
    await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await help.hover();
    await expect(panel.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await panel.getByLabel('Lampe du salon', { exact: true }).check();
    await panel.getByRole('button', { name: 'Préremplir les suggestions' }).click();
    await expect(panel.getByLabel('Lampe du salon', { exact: true })).toBeChecked();
    await panel.getByLabel('Activer les commandes gestuelles').check();
    await panel.getByLabel('Vers la droite', { exact: true }).selectOption('lights_on');
    await panel.getByRole('button', { name: 'Enregistrer les gestes' }).click();
    await expect(panel.getByRole('button', { name: 'Enregistrer les gestes' })).toBeDisabled();
    const saved = await (
      await page.request.get(`/api/admin/satellites/${issued.satellite.id}/gestures`)
    ).json();
    expect(saved.config.lightEntityIds).toEqual(['light.salon']);
    expect(saved.config.bindings.right).toBe('lights_on');
    expect(saved.config.enabled).toBe(true);
    await page.reload();
    await page.getByText('Gestes de la main', { exact: true }).click();
    await expect(panel.getByLabel('Lampe du salon', { exact: true })).toBeChecked();
    await expect(panel.getByLabel('Vers la droite', { exact: true })).toHaveValue('lights_on');
    await page.screenshot({ path: '.local/screenshots/gestures-desktop.png', fullPage: true });
    const mobile = await page
      .context()
      .browser()!
      .newContext({
        baseURL: origin,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        storageState: await page.context().storageState(),
      });
    try {
      const touch = await mobile.newPage();
      touch.on('pageerror', (e) => errors.push(e.message));
      await touch.goto('/admin#satellites');
      await touch.getByText('Gestes de la main', { exact: true }).tap();
      await touch.getByRole('button', { name: 'Aide sur les commandes gestuelles' }).tap();
      await expect(touch.getByRole('tooltip')).toBeVisible();
      await touch.screenshot({ path: '.local/screenshots/gestures-mobile.png', fullPage: true });
      expect(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      await mobile.close();
    }
    expect(fake.calls).toEqual([]);
    // Upgrade the simulated device while preserving the same saved associations.
    socket.terminate();
    socket = new WebSocket(origin.replace('http:', 'ws:') + '/satellite', {
      headers: { authorization: 'Bearer ' + issued.token },
    });
    await once(socket, 'open');
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        firmware: '0.3.0-test',
        gestures: true,
        micToggle: true,
      }),
    );
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/admin/satellites/${issued.satellite.id}/gestures`)
            ).json()
          ).supported,
      )
      .toBe(true);
    socket.send(JSON.stringify({ type: 'gesture', gesture: 'up' }));
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/satellites')).json()).satellites.find(
            (s: { id: string }) => s.id === issued.satellite.id,
          ).volume,
      )
      .toBe(80);
    const access = await (await page.request.get('/api/admin/home-assistant')).json();
    expect(
      (
        await page.request.patch('/api/admin/home-assistant/access', {
          headers,
          data: { enabled: true, revision: access.revision },
        })
      ).ok(),
    ).toBeTruthy();
    await expect
      .poll(
        async () =>
          Date.now() -
          (
            await (
              await page.request.get(`/api/admin/satellites/${issued.satellite.id}/gestures`)
            ).json()
          ).last.at,
      )
      .toBeGreaterThanOrEqual(700);
    socket.send(JSON.stringify({ type: 'gesture', gesture: 'right' }));
    await expect.poll(() => fake.calls.length).toBe(1);
    expect(fake.calls[0]!.path).toContain('/light/turn_on');
    expect(fake.calls[0]!.body.entity_id).toBe('light.salon');
    expect(errors).toEqual([]);
  } finally {
    socket?.terminate();
    await fake.close();
  }
});
