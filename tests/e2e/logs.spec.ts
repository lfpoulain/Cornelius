import { test, expect, type WebSocketRoute } from '@playwright/test';
import { login } from './env';

test('le journal affiche, filtre et exporte les erreurs locales', async ({ page }) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Journal' }).click();
  await expect(page.getByRole('heading', { name: 'Journal détaillé', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await fetch('/api/client-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'error',
        stage: 'microphone test',
        name: 'NotAllowedError',
        message: 'Autorisation refusée',
      }),
    });
    // Adresse introuvable : notée dans le journal avec son chemin.
    await fetch('/fichier-introuvable.js');
  });
  await page.getByLabel('Problèmes seulement').check();
  await page.getByLabel('Rechercher dans le journal').fill('microphone test');
  const log = page.getByRole('log');
  await expect(log).toContainText('NotAllowedError');
  await expect(log.getByText('Erreur', { exact: true })).toBeVisible();
  await expect(log.getByText('Navigateur', { exact: true })).toBeVisible();
  // Les détails sont repliés, et se déplient à la demande.
  const details = log.locator('details');
  await expect(details.locator('pre')).toBeHidden();
  await details.getByText('Détails').click();
  await expect(details.locator('pre')).toContainText('"stage": "microphone test"');

  // Requête en échec : visible parmi les problèmes, avec l’adresse demandée.
  await page.getByLabel('Rechercher dans le journal').fill('fichier-introuvable');
  await expect(log).toContainText('GET /fichier-introuvable.js · 404');
  await expect(log.getByText('Attention', { exact: true })).toBeVisible();

  await page.getByLabel('Rechercher dans le journal').fill('microphone test');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exporter le journal filtré' }).click();
  expect((await download).suggestedFilename()).toBe('cornelius-journal.jsonl');
  await expect(page).toHaveURL(/#logs$/);
});

test('le journal reste affiché au retour dans la rubrique', async ({ page }) => {
  await login(page, '/admin#logs');
  const log = page.getByRole('log');
  await expect(log.locator('time').first()).toBeVisible();
  await page.getByRole('button', { name: 'État du système' }).click();
  // Au retour, les dernières entrées s’affichent sans attendre une nouvelle lecture.
  await page.route('**/api/admin/logs', () => {});
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(log.locator('time').first()).toBeVisible();
  await expect(log).not.toContainText('Lecture du journal');
});

test('hors connexion, le journal reste lisible et s’exporte', async ({ page }) => {
  let live: WebSocketRoute | undefined;
  await page.routeWebSocket('**/events?role=admin', (socket) => {
    // Première connexion relayée au serveur ; les suivantes sont refusées.
    if (live) return socket.close();
    live = socket;
    socket.connectToServer();
  });
  await login(page, '/admin#logs');
  const log = page.getByRole('log');
  await expect(log.locator('time').first()).toBeVisible();
  await live!.close();
  await expect(page.getByText('Reconnexion…', { exact: true })).toBeVisible();
  // Le journal ne modifie rien : hors connexion, sa rubrique n’est pas grisée.
  await expect(page.locator('.admin-settings')).not.toHaveAttribute('disabled');
  // Les entrées restent affichées, la recherche filtre, la pause fige la liste, les détails se
  // déplient et l’export fonctionne.
  await expect(log.locator('time').first()).toBeVisible();
  const search = page.getByLabel('Rechercher dans le journal');
  await expect(search).toBeEnabled();
  await search.fill('aucune entrée ne contient ce texte');
  await expect(log.locator('time')).toHaveCount(0);
  await search.fill('');
  await expect(log.locator('time').first()).toBeVisible();
  // Figée, la liste ne reçoit plus d’entrée nouvelle en tête pendant la lecture.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  const details = log.locator('details').first();
  await details.locator('summary').click();
  await expect(details.locator('pre')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exporter le journal filtré' }).click();
  expect((await download).suggestedFilename()).toBe('cornelius-journal.jsonl');
});
