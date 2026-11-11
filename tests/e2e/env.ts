import type { Page } from '@playwright/test';

// Réglages partagés des tests navigateur et de playwright.config.ts.
// CORNELIUS_E2E_PORT choisit le port du serveur de test (3101 par défaut), par exemple quand un
// autre serveur l’occupe déjà.
export const port = Number(process.env.CORNELIUS_E2E_PORT ?? 3101);
export const origin = `http://127.0.0.1:${port}`;
/** Captures d’écran produites par les specs, hors dépôt (.local est ignoré par git). */
export const screenshots = '.local/screenshots';
/** Mot de passe de l’administration du serveur de test (playwright.config.ts), jamais réel. */
export const adminPassword = 'admin-browser-test-only-credentials-1234';

/** Ouvre l’administration à l’adresse donnée et passe l’écran de connexion. */
export async function login(page: Page, path = '/admin') {
  await page.goto(path);
  await page.getByLabel('Mot de passe administrateur').fill(adminPassword);
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}
