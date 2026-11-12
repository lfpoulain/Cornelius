import { test, expect } from '@playwright/test';
import type { StateEvent } from '../../shared/types';
import { login, origin } from './env';

test('le repos reste silencieux et les changements sont poussés sans polling', async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  const states: StateEvent[] = [];
  const heartbeats: unknown[] = [];
  let mirrorStates = 0;
  let lastStateAt = 0;
  const admin = await context.newPage();
  for (const view of [page, admin]) {
    view.on('request', (request) => {
      if (request.method() === 'GET' && request.url().endsWith('/api/state'))
        requests.push(request.url());
    });
    view.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        const event = JSON.parse(String(payload));
        if (event.type === 'state') {
          states.push(event);
          lastStateAt = Date.now();
          if (view === page) mirrorStates++;
        }
        if (event.type === 'heartbeat') heartbeats.push(event);
      }),
    );
  }
  await login(admin, '/admin');
  await page.goto('/');
  await expect(admin.getByText('Serveur connecté', { exact: true })).toBeVisible();
  await expect(page.locator('.orb')).toHaveAttribute('data-presence', 'sleeping');
  // L’orbe dort avant même la connexion du miroir : attendre son premier état, puis la fin
  // de la rafale de connexion (le miroir est annoncé connecté au tick suivant du serveur).
  await expect.poll(() => mirrorStates).toBeGreaterThan(0);
  await expect.poll(() => Date.now() - lastStateAt).toBeGreaterThan(1_000);
  states.length = 0;
  requests.length = 0;
  await page.waitForTimeout(3500);
  expect(states).toHaveLength(0);
  expect(requests).toHaveLength(0);
  expect(heartbeats.length).toBeGreaterThan(0);
  await expect(admin.getByText('Serveur connecté', { exact: true })).toBeVisible();
  // Use HTTP directly so the mirror can only discover this change through the event stream.
  await admin.request.post('/api/admin/profiles', {
    headers: { origin },
    data: { name: 'Profil poussé' },
  });
  await expect.poll(() => states.length).toBeGreaterThan(0);
  expect(requests).toHaveLength(0);
  await admin.close();
});

test('un état manqué déclenche une seule resynchronisation puis le flux reprend', async ({
  page,
}) => {
  let dropped = false;
  let dropNext = false;
  let reads = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().endsWith('/api/state')) reads++;
  });
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (dropNext && value.type === 'state') {
        dropNext = false;
        dropped = true;
        return;
      }
      route.send(message);
    });
  });
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Le foyer' }).click();
  dropNext = true;
  // Use HTTP directly so the UI can only discover this change through the event stream.
  await page.request.post('/api/admin/profiles', {
    headers: { origin },
    data: { name: 'Profil après reconnexion' },
  });
  await expect(page.getByText('Profil après reconnexion', { exact: true }).first()).toBeVisible();
  expect(dropped).toBe(true);
  expect(reads).toBe(1);
  await expect(page.getByText('Serveur connecté', { exact: true })).toBeVisible();
});
