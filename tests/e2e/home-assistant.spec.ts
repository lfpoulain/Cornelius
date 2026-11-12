import { expect, test } from '@playwright/test';
import { fakeHomeAssistant } from '../helpers/home-assistant';
import { login } from './env';

test('connexion HA, sélection Assist, contrôle réel simulé et suppression du jeton', async ({
  page,
}, testInfo) => {
  const fake = await fakeHomeAssistant();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await login(page, '/admin');
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    const module = page.locator('#module-home-assistant');
    const toast = page.locator('.admin-toast');
    const alert = page.locator('.admin-alert');
    await module.locator(':scope > summary').click();
    await expect(module).not.toContainText('Luna');
    // Rien n’écoute sur ce port : seule l’adresse est mise en cause.
    await module.getByLabel('Adresse Home Assistant').fill('http://127.0.0.1:9');
    await module.getByLabel('Jeton longue durée').fill(fake.token);
    await module.getByRole('button', { name: 'Connecter Home Assistant', exact: true }).click();
    // L’échec reste sous le formulaire, relié au champ en cause, sans message en bas à droite.
    const address = module.getByLabel('Adresse Home Assistant');
    const failure =
      'Connexion impossible : Home Assistant ne répond pas à cette adresse (souvent http://homeassistant.local:8123).';
    await expect(module.getByRole('alert')).toHaveText(failure);
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await expect(address).toHaveAccessibleDescription(failure);
    await expect(alert).toHaveCount(0);
    await address.fill(fake.url);
    await expect(module.getByRole('alert')).toHaveCount(0);
    await module.getByRole('button', { name: 'Connecter Home Assistant', exact: true }).click();
    await expect(module.getByText('Connecté', { exact: true })).toBeVisible();
    await expect(toast).toContainText('Home Assistant connecté.');
    await expect(module.getByLabel('Jeton longue durée')).toHaveValue('');
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).not.toBeChecked();
    await expect(module.getByText('Autres noms : Lumière du canapé, Salon cosy')).toBeVisible();
    await expect(module.getByRole('button', { name: /Recharger/ })).toHaveCount(0);
    await module.getByLabel('Rechercher un appareil').fill('canapé');
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).toBeVisible();
    await expect(module.getByLabel('Autoriser Prise du bureau', { exact: true })).toHaveCount(0);
    await module.getByLabel('Rechercher un appareil').fill('');
    // Une serrure se lit seulement : aucune commande, même dans l’administration.
    const types = module.getByRole('group', { name: 'Type d’entité' });
    await types.getByRole('button', { name: 'Capteurs', exact: true }).click();
    await expect(module.getByLabel('Autoriser lock.porte', { exact: true })).toBeVisible();
    await expect(module.getByText('lock.porte · Lecture seule')).toBeVisible();
    await expect(module.getByRole('button', { name: /^(Allumer|Éteindre) / })).toHaveCount(0);
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).toHaveCount(0);
    await types.getByRole('button', { name: 'Tout', exact: true }).click();
    // Commande manuelle avant toute autorisation donnée à Cornelius.
    await module.getByRole('button', { name: 'Allumer Prise du bureau', exact: true }).click();
    await expect(toast).toHaveText('Allumer « Prise du bureau » : commande envoyée.');
    expect(fake.calls).toHaveLength(1);

    // Les deux autorisations s’enregistrent dès le clic.
    const enabled = module.getByRole('switch', {
      name: 'Autoriser Cornelius à utiliser la sélection',
    });
    const knownOnly = module.getByRole('switch', { name: 'Réserver aux personnes reconnues' });
    await knownOnly.click();
    await expect(knownOnly).toBeChecked();
    await expect(toast).toHaveText('Home Assistant est réservé aux personnes reconnues.');
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/home-assistant')).json()).knownPeopleOnly,
      )
      .toBe(true);

    const bar = module.getByRole('region', {
      name: 'Sélection des appareils : modifications non enregistrées',
    });
    await expect(bar).toHaveCount(0);
    await module.getByRole('button', { name: 'Reprendre la sélection Assist' }).click();
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).toBeChecked();
    await expect(bar).toContainText(/^\d+ modifications? non enregistrées?/);
    // Après l’import, seule la sélection Assist est affichée.
    await expect(module.getByLabel('Afficher uniquement la sélection')).toBeChecked();
    await expect(module.getByLabel('Autoriser Prise du bureau', { exact: true })).toHaveCount(0);
    await module.getByLabel('Afficher uniquement la sélection').uncheck();
    await expect(module.getByLabel('Autoriser Prise du bureau', { exact: true })).not.toBeChecked();
    // Annuler revient à la sélection enregistrée, sans rien envoyer.
    await bar.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).not.toBeChecked();
    await module.getByLabel('Autoriser Lampe du salon', { exact: true }).check();
    await expect(bar).toContainText('1 modification non enregistrée');
    // Activer l’autorisation n’emporte pas la sélection en cours de modification.
    await enabled.click();
    await expect(enabled).toBeChecked();
    await expect(toast).toHaveText('Cornelius peut utiliser la sélection Home Assistant.');
    await expect(bar).toContainText('1 modification non enregistrée');
    const saved = (await (await page.request.get('/api/admin/home-assistant')).json()) as {
      selected: string[];
      enabled: boolean;
    };
    expect(saved).toMatchObject({ selected: [], enabled: true });
    await expect(
      module.getByRole('button', { name: 'Allumer Lampe du salon', exact: true }),
    ).toBeEnabled();
    const selectedFilter = module.getByLabel('Afficher uniquement la sélection');
    await selectedFilter.check();
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).toBeVisible();
    await expect(module.getByLabel('Autoriser Prise du bureau', { exact: true })).toHaveCount(0);
    await module.getByLabel('Rechercher un appareil').fill('bureau');
    await expect(
      module.getByRole('button', { name: 'Allumer Lampe du salon', exact: true }),
    ).toHaveCount(0);
    await selectedFilter.uncheck();
    await expect(
      module.getByRole('button', { name: 'Éteindre Prise du bureau', exact: true }),
    ).toBeVisible();
    // La sélection en cours n'empêche pas une commande manuelle.
    await module.getByRole('button', { name: 'Éteindre Prise du bureau', exact: true }).click();
    await expect(toast).toHaveText('Éteindre « Prise du bureau » : commande envoyée.');
    expect(fake.calls).toHaveLength(2);
    await module.getByLabel('Rechercher un appareil').fill('');
    await bar.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast).toHaveText('Sélection enregistrée.');
    await expect(bar).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('home-assistant-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('home-assistant-mobile.png'),
      fullPage: true,
    });
    await module.getByRole('button', { name: 'Allumer Lampe du salon', exact: true }).click();
    await expect(toast).toHaveText('Allumer « Lampe du salon » : commande envoyée.');
    expect(fake.calls).toHaveLength(3);
    // Sur téléphone, un sélecteur remplace la bande de rubriques : revenir à l’ordinateur.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-home-assistant > summary').click();
    await expect(module.getByLabel('Autoriser Lampe du salon', { exact: true })).toBeChecked();
    await expect(enabled).toBeChecked();
    await expect(knownOnly).toBeChecked();
    await expect(module.getByLabel('Jeton longue durée')).toHaveValue('');
    await module.getByRole('button', { name: 'Supprimer la connexion', exact: true }).click();
    await module
      .getByRole('button', { name: 'Supprimer la connexion', exact: true })
      .last()
      .click();
    await expect(toast).toHaveText('Connexion supprimée.');
    await expect(module.getByText('À configurer', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    // La base est partagée par la série : rétablir la règle d’accès par défaut.
    const view = await (await page.request.get('/api/admin/home-assistant')).json();
    await page.request.patch('/api/admin/home-assistant/access', {
      headers: { origin: new URL(page.url()).origin },
      data: { knownPeopleOnly: false, revision: view.revision },
    });
    await fake.close();
  }
});
