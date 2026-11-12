import { expect, test, type Page } from '@playwright/test';
import { login } from './env';

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

/** Note le message de chaque confirmation, puis l’accepte ou la refuse. */
function answerDialogs(page: Page, accept: () => boolean) {
  const messages: string[] = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    if (accept()) await dialog.accept();
    else await dialog.dismiss();
  });
  return messages;
}

test('une valeur chiffrée non enregistrée retient le changement de rubrique', async ({ page }) => {
  // Ancien défaut : un délai saisi revenait à sa valeur précédente après un changement de
  // rubrique, sans aucune confirmation.
  let accept = false;
  const dialogs = answerDialogs(page, () => accept);
  await login(page, '/admin#voice');
  await page.locator('summary').filter({ hasText: 'Réglages avancés' }).click();
  await page.locator('summary').filter({ hasText: 'Départ :' }).click();
  const departure = page.getByLabel('Confirmer un départ (s)', { exact: true });
  await departure.fill('7');
  await page.getByRole('button', { name: 'Le foyer et les visages' }).click();
  expect(dialogs).toEqual([
    'Des modifications ne sont pas enregistrées. Quitter cette rubrique sans les enregistrer ?',
  ]);
  await expect(heading(page)).toHaveText('Quand il écoute');
  await expect(departure).toHaveValue('7');
  // « Annuler » rend la valeur enregistrée : plus rien ne retient.
  await page
    .getByRole('region', { name: 'Délais de présence : modifications non enregistrées' })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  await expect(departure).toHaveValue('1,5');
  await page.getByRole('button', { name: 'Le foyer et les visages' }).click();
  await expect(heading(page)).toHaveText('Le foyer et les visages');
  expect(dialogs).toHaveLength(1);

  // Délai de silence personnalisé : même garde.
  await page.getByRole('button', { name: 'Quand il écoute' }).click();
  const silence = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: 'Fin de parole', exact: true }) });
  await silence.getByText('Réglage fin').click();
  await page.getByLabel('Délai de silence (s)').fill('45');
  await page.getByRole('button', { name: 'Le foyer et les visages' }).click();
  expect(dialogs).toHaveLength(2);
  await expect(heading(page)).toHaveText('Quand il écoute');
  // Confirmer abandonne la saisie : la valeur enregistrée revient au retour.
  accept = true;
  await page.getByRole('button', { name: 'Le foyer et les visages' }).click();
  await expect(heading(page)).toHaveText('Le foyer et les visages');
  expect(dialogs).toHaveLength(3);
  accept = false;

  // Exigence de la reconnaissance et détection du regard, rubrique « Caméra ».
  await page.getByRole('button', { name: 'Caméra et reconnaissance' }).click();
  for (const [fold, label, value] of [
    [0, 'Exigence de la reconnaissance', '0.45'],
    [1, 'Orientation de la tête acceptée', '40'],
  ] as const) {
    await page.getByText('Réglage fin').nth(fold).click();
    const input = page.getByLabel(label, { exact: true });
    const saved = await input.inputValue();
    await input.fill(value);
    const before = dialogs.length;
    await page.getByRole('button', { name: 'Quand il écoute' }).click();
    expect(dialogs).toHaveLength(before + 1);
    await expect(heading(page)).toHaveText('Caméra et reconnaissance');
    await expect(input).toHaveValue(value);
    await input.fill(saved);
  }
  await page.getByRole('button', { name: 'Quand il écoute' }).click();
  await expect(heading(page)).toHaveText('Quand il écoute');
});
