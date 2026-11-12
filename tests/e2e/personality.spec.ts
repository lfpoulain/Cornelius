import { expect, test } from '@playwright/test';
import { login, origin, screenshots } from './env';

test('personnaliser le foyer et une personne, consulter les prompts et réinitialiser', async ({
  page,
}) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  await page.getByLabel('Prénom ou nom d’affichage').fill('Camille personnalité');
  await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Personnaliser Cornelius pour le foyer', exact: true })
    .click();
  const household = page.getByLabel('Comment parler à tout le monde', { exact: true });
  // Barre commune d’enregistrement : absente tant que rien n’a changé.
  const bar = page.getByRole('region', { name: /: modifications non enregistrées$/ });
  const save = bar.getByRole('button', { name: 'Enregistrer', exact: true });
  const cancel = bar.getByRole('button', { name: 'Annuler', exact: true });
  await expect(bar).toHaveCount(0);
  await expect(page.getByText('À jour.', { exact: true })).toHaveCount(0);
  await household.fill('Sois chaleureux et malicieux.');
  await expect(
    page.getByRole('region', { name: 'Style du foyer : modifications non enregistrées' }),
  ).toContainText('1 modification non enregistrée');
  await expect(page.getByLabel('Personnaliser pour', { exact: true })).toBeDisabled();
  // Garde de sortie : quitter la rubrique demande confirmation, et refuser y reste.
  const dialogs: string[] = [];
  page.once('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  expect(dialogs).toEqual([
    'Des modifications ne sont pas enregistrées. Quitter cette rubrique sans les enregistrer ?',
  ]);
  await expect(household).toHaveValue('Sois chaleureux et malicieux.');
  await save.click();
  await expect(page.getByText('Style du foyer enregistré.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  await page
    .getByRole('button', { name: 'Personnaliser Cornelius pour Camille personnalité', exact: true })
    .click();
  // Sans style propre, le style du foyer est montré à part, en lecture seule.
  const inherited = page.getByRole('region', { name: 'Hérité du foyer' });
  await expect(inherited).toContainText('Sois chaleureux et malicieux.');
  const personal = page.getByLabel('Comment parler à Camille personnalité', { exact: true });
  await expect(personal).toHaveValue('');
  const context = page.getByLabel('Ce qu’il faut savoir sur Camille personnalité', {
    exact: true,
  });
  // Style et repères s’enregistrent ensemble, d’un seul bouton.
  await context.fill('Mon bureau est Pivoine.');
  await personal.fill('Vouvoie-moi et réponds en une phrase.');
  await expect(page.getByLabel('Personnaliser pour', { exact: true })).toBeDisabled();
  await save.click();
  await expect(
    page.getByText('Réglages de Camille personnalité enregistrés.', { exact: true }),
  ).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(inherited).toHaveCount(0);
  const prompt = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^Conversation/ }) });
  await prompt.locator('summary').click();
  await expect(prompt.locator('pre')).toContainText('Vouvoie-moi et réponds en une phrase.');
  await expect(prompt.locator('pre')).toContainText('Mon bureau est Pivoine.');
  await page.screenshot({ path: `${screenshots}/personality-desktop.png`, fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Personnaliser Cornelius', exact: true }).click();
  await expect(household).toHaveValue('Sois chaleureux et malicieux.');
  await expect(context).toHaveCount(0);
  await page
    .getByLabel('Personnaliser pour', { exact: true })
    .selectOption({ label: 'Camille personnalité' });
  await expect(personal).toHaveValue('Vouvoie-moi et réponds en une phrase.');
  await expect(context).toHaveValue('Mon bureau est Pivoine.');
  await context.fill('Brouillon contexte');
  await personal.fill('Brouillon');
  await cancel.click();
  await expect(context).toHaveValue('Mon bureau est Pivoine.');
  await expect(personal).toHaveValue('Vouvoie-moi et réponds en une phrase.');
  await page.getByRole('button', { name: 'Revenir au style du foyer', exact: true }).click();
  // La barre dit ce que l’enregistrement changera.
  await expect(bar).toContainText(
    'Style vidé : Camille personnalité suivra le style du foyer après enregistrement.',
  );
  await save.click();
  await expect(personal).toHaveValue('');
  await expect(inherited).toContainText('Sois chaleureux et malicieux.');
  await expect(context).toHaveValue('Mon bureau est Pivoine.');
  await page.getByRole('button', { name: 'Effacer les repères', exact: true }).click();
  await save.click();
  await expect(context).toHaveValue('');
  await expect(page.getByLabel('Personnaliser pour', { exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/personality-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('Personnaliser : tutoiement ou vouvoiement, visage manquant et liens vers la mémoire', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, '/admin');
  const created = await page.request.post('/api/admin/profiles', {
    headers: { origin },
    data: { name: 'Camille liens' },
  });
  const profile = (await created.json()) as { id: string };
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  await page
    .getByRole('button', { name: 'Personnaliser Cornelius pour Camille liens', exact: true })
    .click();
  const style = page.getByLabel('Comment parler à Camille liens', { exact: true });
  await page.getByRole('button', { name: 'Ajouter : Tutoie-moi.', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Ajouter : Donne d’abord la réponse courte, puis développe si je le demande.',
      exact: true,
    })
    .click();
  await expect(style).toHaveValue(
    'Tutoie-moi.\nDonne d’abord la réponse courte, puis développe si je le demande.',
  );
  // Ajouter le vouvoiement remplace le tutoiement : jamais les deux à la fois.
  await page.getByRole('button', { name: 'Remplacer par : Vouvoie-moi.', exact: true }).click();
  await expect(style).toHaveValue(
    'Donne d’abord la réponse courte, puis développe si je le demande.\nVouvoie-moi.',
  );
  await expect(page.getByRole('button', { name: 'Ajouter : Vouvoie-moi.' })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Remplacer par : Tutoie-moi.', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('region', { name: 'Réglages de Camille liens : modifications non enregistrées' })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();

  // Le serveur de test n’a pas de caméra : aucun visage n’est mémorisé.
  await expect(page.getByText(/^Aucun visage mémorisé pour Camille liens/)).toBeVisible();
  await expect(
    page.getByText(/« Luna » y désigne le modèle chargé des recherches et des actions/),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Voir ce que Cornelius a retenu', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mémoire' })).toBeVisible();
  await expect(page.getByLabel('Souvenirs de', { exact: true })).toHaveValue(profile.id);
  await page.getByRole('link', { name: 'Écrire un fait permanent', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Personnaliser Cornelius' }),
  ).toBeVisible();
  await expect(page.getByLabel('Personnaliser pour', { exact: true })).toHaveValue(profile.id);
  await expect(
    page.getByLabel('Ce qu’il faut savoir sur Camille liens', { exact: true }),
  ).toBeFocused();
  await page
    .getByRole('link', { name: 'Mémoriser le visage de Camille liens', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Le foyer et les visages' }),
  ).toBeVisible();
  const row = page.locator('#face-' + profile.id);
  await expect(row).toHaveAttribute('data-highlighted', 'true');
  await expect(row).toBeInViewport();
  expect(errors).toEqual([]);
});
