import { test, expect, type WebSocketRoute } from '@playwright/test';
import { login } from './env';

test('le diagnostic montre la santé des sources et le journal des actions', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'État du système' }).click();

  await expect(page.getByText('Sources et modules', { exact: true })).toBeVisible();
  await expect(page.getByText('Génération d’image', { exact: true })).toBeVisible();
  await expect(page.getByText('Dernières exécutions d’actions', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucune source enregistrée.')).toBeVisible();
  await expect(page.getByText('Aucune exécution enregistrée.')).toBeVisible();
  // Un seul bouton d’actualisation, en haut de la rubrique.
  await expect(page.getByRole('button', { name: 'Actualiser', exact: true })).toHaveCount(1);
  // Plus de « Aucun incident » trompeur : le résumé de la mise en route le remplace.
  await expect(page.getByText('Aucun incident à signaler.')).toHaveCount(0);
  await expect(page.getByText(/^Mise en route : \d+ étapes? à terminer\.$/)).toBeVisible();
  await page.getByRole('link', { name: 'Voir la mise en route', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mise en route' })).toBeVisible();
});

test('une lecture en échec n’affiche pas en même temps « Lecture… »', async ({ page }) => {
  await page.route('**/api/admin/addons', (route) =>
    route.fulfill({ status: 500, json: { error: 'Sources indisponibles (test).' } }),
  );
  await login(page, '/admin#diagnostic');
  await expect(page.getByText(/Sources indisponibles \(test\)\./)).toBeVisible();
  await expect(page.getByText('Lecture impossible pour le moment.')).toHaveCount(2);
  await expect(page.getByText('Lecture des sources…')).toHaveCount(0);
  await expect(page.getByText('Lecture des exécutions…')).toHaveCount(0);
});

test('hors connexion, les valeurs sont datées de la dernière connexion', async ({ page }) => {
  let live: WebSocketRoute | undefined;
  await page.routeWebSocket('**/events?role=admin', (socket) => {
    // Première connexion relayée au serveur ; les suivantes sont refusées.
    if (live) return socket.close();
    live = socket;
    socket.connectToServer();
  });
  await login(page, '/admin#diagnostic');
  await expect(page.getByText('Serveur connecté', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Dernière valeur connue à/)).toHaveCount(0);
  await live!.close();
  await expect(page.getByText(/^Dernière valeur connue à \d{2}:\d{2}$/).first()).toBeVisible();
  await expect(page.getByText(/^Connexion perdue à \d{2}:\d{2}/)).toBeVisible();
  // Un seul bandeau en plus de la pastille d’en-tête, qui reste visible en défilant.
  const banner = page.getByText(
    'Connexion au serveur perdue. Les saisies non enregistrées seront perdues si le serveur redémarre.',
    { exact: true },
  );
  await expect(banner).toHaveCount(1);
  await expect(page.getByText('Reconnexion…', { exact: true })).toBeVisible();
  await expect(page.getByText('Connexion interrompue', { exact: true })).toHaveCount(0);
  await page.mouse.wheel(0, 4000);
  await expect(page.getByText('Dernières exécutions d’actions', { exact: true })).toBeInViewport();
  await expect(banner).toBeInViewport();
});
