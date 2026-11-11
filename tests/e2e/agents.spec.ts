import { expect, test } from '@playwright/test';
import { fakeHermes } from '../helpers/hermes.js';
import { login, screenshots } from './env';

test('Agents : configuration réelle, découverte, demande, accord, profil et affichage mobile', async ({
  page,
}) => {
  const fake = await fakeHermes();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await login(page, '/admin');
    await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
    for (const name of ['Alice Hermes navigateur', 'Bob Hermes navigateur']) {
      await page.getByLabel('Prénom ou nom d’affichage').fill(name);
      await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    const profiles = (await (await page.request.get('/api/admin/profiles')).json()) as {
      id: string;
      name: string;
    }[];
    const alice = profiles.find((p) => p.name === 'Alice Hermes navigateur')!,
      bob = profiles.find((p) => p.name === 'Bob Hermes navigateur')!;
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByLabel('Agent de', { exact: true }).selectOption(alice.id);
    // Avant toute connexion : l’explication en trois étapes, sans compteurs à zéro.
    await expect(page.getByText('Relier un agent Hermes', { exact: true })).toBeVisible();
    await expect(page.getByText('Accords attendus', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Hermes d’Alice Hermes navigateur', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Adresse de Hermes', { exact: true }).fill(fake.url);
    await page.getByLabel('Jeton de connexion', { exact: true }).fill(fake.token);
    await page
      .getByLabel('À quoi sert cet agent ?', { exact: true })
      .fill('Agenda et organisation des sorties.');
    await page.getByRole('switch', { name: 'Autoriser Cornelius à contacter cet agent' }).click();
    await page.getByRole('button', { name: 'Enregistrer et vérifier', exact: true }).click();
    await expect(page.getByLabel('Jeton de connexion', { exact: true })).toHaveValue('');
    await expect(page.getByText('Accords attendus', { exact: true })).toBeVisible();
    await expect(page.getByText('Relier un agent Hermes', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${screenshots}/agents-connection-desktop.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Connexion', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Capacités', exact: true })).toHaveAttribute(
      'data-state',
      'active',
    );
    // L’en-tête et les capacités disent la même chose.
    const overview = page.getByRole('region', { name: 'Vue d’ensemble de Hermes' });
    await expect(overview.getByText('Disponible pour Cornelius', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('tabpanel').getByText('Disponible pour Cornelius', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Luna/)).toHaveCount(0);
    await expect(page.getByText('Consulter et organiser l’agenda.', { exact: true })).toBeVisible();
    await page.getByLabel('Rechercher une capacité').fill('introuvable-xyz');
    await expect(page.getByText('Aucune capacité ne correspond à cette recherche.')).toBeVisible();
    await page.getByLabel('Rechercher une capacité').fill('agenda');
    await expect(page.getByText('Consulter et organiser l’agenda.', { exact: true })).toBeVisible();
    await page.getByLabel('Rechercher une capacité').fill('');
    await page.getByText('Compétences installées (1)', { exact: true }).click();
    await expect(page.getByText('Préparer des sorties.', { exact: true })).toBeVisible();
    await expect(page.getByText('mail_send', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Demandes', exact: true }).click();
    fake.options.initialStatus = 'completed';
    fake.options.initialOutput = 'Voici trois idées de sorties pour samedi.';
    await page.getByLabel('Message à Hermes', { exact: true }).fill('Que faire samedi ?');
    await page.getByRole('button', { name: 'Envoyer à Hermes', exact: true }).click();
    await expect(page.getByText(fake.options.initialOutput, { exact: true })).toBeVisible();
    const task = (await (await page.request.get('/api/admin/agents/' + alice.id)).json()).tasks[0];
    await expect(page.getByRole('combobox', { name: 'Conversation', exact: true })).toHaveValue(
      task.id,
    );
    await page.getByLabel('Afficher les demandes').selectOption('active');
    await expect(page.getByText('Aucune demande dans cette catégorie.')).toBeVisible();
    await page.getByLabel('Afficher les demandes').selectOption('all');
    const run = [...fake.runs.values()][0]!;
    run.status = 'waiting_for_approval';
    run.approval = { request_id: 'approval-ui', command: 'Créer un rendez-vous samedi à 14 h' };
    await page.getByRole('button', { name: 'Actualiser les tâches', exact: true }).click();
    await expect(
      page.getByText('Créer un rendez-vous samedi à 14 h', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `${screenshots}/agents-desktop.png`, fullPage: true });
    await page.getByRole('button', { name: 'Autoriser cette fois', exact: true }).click();
    await expect.poll(() => run.status).toBe('running');
    expect(fake.calls.find((c) => c.path.endsWith('/approval'))!.body).toEqual({
      request_id: 'approval-ui',
      choice: 'once',
    });
    await page.getByRole('button', { name: 'Demander l’arrêt', exact: true }).click();
    await expect.poll(() => run.status).toBe('stopping');
    await page.getByLabel('Agent de', { exact: true }).selectOption(bob.id);
    await expect(page.getByLabel('Adresse de Hermes', { exact: true })).toHaveValue('');
    await expect(
      page.getByRole('heading', { name: 'Hermes de Bob Hermes navigateur', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Demandes', exact: true }).click();
    await expect(
      page.getByText('Aucune demande pour cette personne.', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Agent de', { exact: true }).selectOption(alice.id);
    await page.getByRole('tab', { name: 'Capacités', exact: true }).click();
    await expect(page.getByText('Outils disponibles (1)', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${screenshots}/agents-mobile.png`, fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await fake.close();
  }
});

test('Agents : jeton conservé et vérification explicite en cours, refusée, partielle ou indisponible', async ({
  page,
}) => {
  const fake = await fakeHermes();
  let release = () => {};
  let closed = false;
  try {
    await login(page, '/admin');
    await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
    const name = 'Hermes erreurs navigateur';
    await page.getByLabel('Prénom ou nom d’affichage').fill(name);
    await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    const profiles = await (await page.request.get('/api/admin/profiles')).json();
    const profile = profiles.find((p: { name: string }) => p.name === name);
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByLabel('Agent de', { exact: true }).selectOption(profile.id);
    const token = page.getByLabel('Jeton de connexion', { exact: true });
    const save = page.getByRole('button', { name: 'Enregistrer et vérifier', exact: true });
    const feedback = page.getByLabel('État de la connexion Hermes', { exact: true });
    await page.getByLabel('Adresse de Hermes', { exact: true }).fill(fake.url);
    await token.fill('incorrect-test-token');
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/agents/' + profile.id, async (route) => {
      if (route.request().method() === 'PUT') await gate;
      await route.continue();
    });
    await save.click();
    await expect(
      page.getByRole('button', { name: 'Enregistrement et vérification…', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        'Enregistrement de la configuration et vérification de la connexion à Hermes…',
        { exact: true },
      ),
    ).toBeVisible();
    release();
    await expect(feedback).toContainText(
      'Configuration enregistrée, mais la vérification de connexion a échoué.',
    );
    await expect(feedback).toContainText('Hermes a refusé le jeton ou les droits.');
    await expect(feedback).toHaveAttribute('role', 'alert');
    // Une seule présentation : l’encadré, sans message d’erreur relancé en bas d’écran.
    await expect(page.locator('.admin-toast')).toHaveCount(0);
    await expect(page.locator('.admin-alert')).toHaveCount(0);
    await expect(token).toHaveValue('');
    await expect(token).toHaveAttribute('placeholder', 'Jeton enregistré (masqué)');
    await expect(page.getByText('Jeton enregistré', { exact: true })).toBeVisible();
    await expect(page.getByText('Catalogue reçu.', { exact: false })).toHaveCount(0);

    await token.fill(fake.token);
    await save.click();
    await expect(feedback).toHaveText('Configuration enregistrée. Connexion à Hermes vérifiée.');
    await expect(feedback).toHaveAttribute('role', 'status');
    await expect(page.locator('.admin-toast')).toHaveCount(0);
    await expect(token).toHaveValue('');
    // A blank password field must preserve the real saved token on another save.
    const before = (await (await page.request.get('/api/admin/agents/' + profile.id)).json())
      .connection.revision;
    await save.click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/agents/' + profile.id)).json()).connection
            .revision,
      )
      .toBe(before + 1);
    await expect(feedback).toHaveText('Configuration enregistrée. Connexion à Hermes vérifiée.');
    await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByLabel('Agent de', { exact: true }).selectOption(profile.id);
    await expect(token).toHaveAttribute('placeholder', 'Jeton enregistré (masqué)');
    await expect(page.getByText('Jeton enregistré', { exact: true })).toBeVisible();
    await expect(feedback).toContainText('Connexion à Hermes vérifiée.');

    const refreshCapabilities = async () => {
      await page.getByRole('tab', { name: 'Capacités', exact: true }).click();
      await page.getByRole('button', { name: 'Actualiser les capacités', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Actualiser les capacités', exact: true }),
      ).toBeEnabled();
    };
    fake.options.failCatalog = true;
    await refreshCapabilities();
    await expect(
      page.getByText('Outils (/v1/toolsets) : Hermes est indisponible (HTTP 503).'),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Connexion', exact: true }).click();
    await expect(feedback).toContainText('Connexion à Hermes vérifiée, mais certaines capacités');
    await expect(feedback).toHaveAttribute('role', 'status');

    await fake.close();
    closed = true;
    await refreshCapabilities();
    await page.getByRole('tab', { name: 'Connexion', exact: true }).click();
    await expect(feedback).toContainText('la vérification de connexion a échoué.');
    await expect(feedback).toContainText('Connexion à Hermes indisponible.');
    await expect(page.locator('.admin-toast')).toHaveCount(0);
    await expect(page.locator('.admin-alert')).toHaveCount(0);
    await save.click();
    await expect(feedback).toContainText(
      'Configuration enregistrée, mais la vérification de connexion a échoué.',
    );
    await expect(page.locator('.admin-toast')).toHaveCount(0);
    await expect(page.locator('.admin-alert')).toHaveCount(0);
    // Un refus du serveur s’affiche aussi dans l’encadré, une seule fois.
    await page.route('**/api/admin/agents/' + profile.id, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 409,
            json: { error: 'Configuration modifiée : actualisez la page.' },
          })
        : route.fallback(),
    );
    await save.click();
    await expect(feedback).toHaveText('Configuration modifiée : actualisez la page.');
    await expect(page.locator('.admin-alert')).toHaveCount(0);
    await expect(token).toHaveAttribute('placeholder', 'Jeton enregistré (masqué)');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${screenshots}/agents-connection-error-mobile.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    release();
    if (!closed) await fake.close();
  }
});

test('Agents sans personne : Hermes expliqué et un bouton pour ajouter quelqu’un', async ({
  page,
}) => {
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (value.type === 'state') value.state.profiles = [];
      route.send(JSON.stringify(value));
    });
  });
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    value.state.profiles = [];
    await route.fulfill({ response, json: value });
  });
  await login(page, '/admin#agents');
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  await expect(
    page.getByText('Hermes est un agent personnel installé à part', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('list').filter({ hasText: 'Installez Hermes' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.getByRole('link', { name: 'Ajouter une personne' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Le foyer et les visages' }),
  ).toBeVisible();
});
