import { test, expect } from '@playwright/test';
import { login } from './env';

test('le bouton bloque OpenAI, conserve son état après rechargement et permet de débloquer', async ({
  page,
}) => {
  // Le panneau complet, avec « Bloquer les services IA », est celui de « Quand il écoute ».
  await login(page, '/admin#voice');
  await page.getByRole('button', { name: 'Bloquer les services IA', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Autoriser les services IA', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Autoriser les services IA', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Autoriser les services IA', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bloquer les services IA', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});
