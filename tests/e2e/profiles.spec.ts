import { expect, test, type Page } from '@playwright/test';
import type {
  DevicesEvent,
  DevicesStatus,
  EnrollmentResult,
  Profile,
  StateEvent,
} from '../../shared/types';
import { origin, screenshots } from './env';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

async function login(page: Page) {
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

async function createProfile(page: Page, name: string): Promise<Profile> {
  const response = await page.request.post('/api/admin/profiles', {
    headers: { origin },
    data: { name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Profile;
}

// Les specs partagent le même serveur : l’ouverture modifiée ici est rétablie après le test.
let previousOpening: unknown = null;
async function useCameraOpening(page: Page) {
  const event = (await (await page.request.get('/api/state')).json()) as StateEvent;
  previousOpening = event.state.opening;
  const response = await page.request.patch('/api/admin/opening', {
    headers: { origin },
    data: { trigger: 'presence', audience: 'everyone', recognizeVoice: false },
  });
  expect(response.ok()).toBe(true);
}
test.afterEach(async ({ page }) => {
  if (!previousOpening) return;
  await page.request.patch('/api/admin/opening', { headers: { origin }, data: previousOpening });
  previousOpening = null;
});

/**
 * Remplace l’état du service caméra diffusé à l’administration : le serveur de test n’a pas de
 * service de perception. Les demandes d’enregistrement sont interceptées et simulées.
 */
async function fakePerception(page: Page) {
  const perception: Partial<DevicesStatus['perception']> = {
    connected: true,
    camera: {
      devices: [{ id: 'one', label: 'Webcam intégrée' }],
      selectedId: 'one',
      changing: false,
      error: null,
    },
    enrollingProfileId: null,
    enrollmentMode: null,
    enrollmentProgress: null,
    enrollmentResult: null,
    enrolledProfileIds: [],
    faces: [],
    lookalikes: [],
  };
  const enrollments: { profileId: string; mode: string }[] = [];
  let original: DevicesEvent | null = null;
  let send = () => {};
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    send = () => {
      if (!original) return;
      const event: DevicesEvent = {
        ...original,
        status: {
          ...original.status,
          perception: { ...original.status.perception, ...perception },
        },
      };
      route.send(JSON.stringify(event));
    };
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (value.type === 'devices') {
        original = value;
        send();
      } else route.send(message);
    });
  });
  let sequence = 0;
  const end = (outcome: EnrollmentResult['outcome'], message: string) => {
    const profileId = perception.enrollingProfileId!;
    perception.enrollmentResult = {
      id: 'enrollment-' + ++sequence,
      profileId,
      mode: perception.enrollmentMode ?? 'replace',
      outcome,
      message,
      at: Date.now(),
    };
    perception.enrollingProfileId = null;
    perception.enrollmentMode = null;
    if (outcome === 'saved' && !perception.enrolledProfileIds!.includes(profileId)) {
      perception.enrolledProfileIds = [...perception.enrolledProfileIds!, profileId];
      perception.faces = [...perception.faces!, { profileId, views: 5, enrolledAt: Date.now() }];
    }
    send();
  };
  await page.route('**/api/admin/profiles/*/enroll', async (route) => {
    const profileId = decodeURIComponent(route.request().url().split('/').at(-2)!);
    const { mode } = route.request().postDataJSON() as { mode: 'add' | 'replace' };
    enrollments.push({ profileId, mode });
    perception.enrollingProfileId = profileId;
    perception.enrollmentMode = mode;
    perception.enrollmentResult = null;
    await route.fulfill({ json: { ok: true } });
    send();
  });
  await page.route('**/api/admin/enrollment', async (route) => {
    await route.fulfill({ json: { ok: true } });
    end('cancelled', 'Enregistrement annulé.');
  });
  await page.route('**/api/admin/camera/frame', (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
  return {
    perception,
    enrollments,
    send: () => send(),
    end,
    face(profileId: string) {
      perception.enrolledProfileIds = [...perception.enrolledProfileIds!, profileId];
      perception.faces = [...perception.faces!, { profileId, views: 5, enrolledAt: Date.now() }];
      // Publié tout de suite : sinon le visage n’apparaît qu’au prochain état diffusé par le
      // serveur, qui a pu arriver juste avant (création de la personne).
      send();
    },
  };
}

test('un visage n’est annoncé mémorisé que si le serveur l’a enregistré', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const camera = await fakePerception(page);
  await login(page);
  await useCameraOpening(page);
  const camille = await createProfile(page, 'Camille visage');
  const robin = await createProfile(page, 'Robin visage');
  camera.face(camille.id);
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  const camilleFace = page.locator('#face-' + camille.id);
  const card = page.locator('#face-enrollment');
  await expect(camilleFace.getByText(/^Visage mémorisé/)).toBeVisible();

  // « Compléter » puis Annuler : rien n’est annoncé, surtout pas « Visage … mémorisé ».
  await camilleFace.getByRole('button', { name: 'Compléter' }).click();
  await expect(card.getByText('Complément du visage de Camille visage')).toBeVisible();
  await card.getByRole('button', { name: 'Annuler l’enregistrement' }).click();
  await expect(card.getByText('Complément du visage de Camille visage')).toHaveCount(0);
  await expect(card.getByText(/mémorisé\. Vérifiez/)).toHaveCount(0);
  await expect(card.getByText(/non enregistré/)).toHaveCount(0);

  // « Refaire » qui expire : le temps écoulé est dit, l’ancien visage reste, on peut réessayer.
  await camilleFace.getByRole('button', { name: 'Refaire' }).click();
  await expect(card.getByText('Enregistrement du visage de Camille visage')).toBeVisible();
  camera.end('expired', 'Temps écoulé : recommencez seul, face à la caméra, bien éclairé.');
  await expect(card.getByText('Visage de Camille visage non enregistré')).toBeVisible();
  await expect(
    card.getByText(
      'Temps écoulé : recommencez seul, face à la caméra, bien éclairé. Le visage déjà mémorisé reste actif.',
    ),
  ).toBeVisible();
  await expect(card.getByText(/mémorisé\. Vérifiez/)).toHaveCount(0);
  await page.screenshot({ path: `${screenshots}/faces-expired.png`, fullPage: true });
  await card.getByRole('button', { name: 'Réessayer' }).click();
  expect(camera.enrollments.at(-1)).toEqual({ profileId: camille.id, mode: 'replace' });
  await expect(card.getByText('Enregistrement du visage de Camille visage')).toBeVisible();
  await expect(card.getByText('Visage de Camille visage non enregistré')).toHaveCount(0);
  camera.end('saved', 'Visage mémorisé.');
  await expect(
    card.getByText(
      'Visage de Camille visage mémorisé. Vérifiez qu’il est bien reconnu, et pas confondu avec quelqu’un d’autre.',
    ),
  ).toBeVisible();

  // Premier enregistrement refusé : il ne disparaît plus sans un mot.
  await page
    .locator('#face-' + robin.id)
    .getByRole('button', { name: /^Mémoriser le visage de / })
    .click();
  await expect(card.getByText(/mémorisé\. Vérifiez/)).toHaveCount(0);
  camera.end(
    'rejected',
    'Visage non retenu : les vues ne montraient pas toutes la même personne. Recommencez seul, face à la caméra, bien éclairé.',
  );
  await expect(card.getByText('Visage de Robin visage non enregistré')).toBeVisible();
  await expect(card.getByText(/ne montraient pas toutes la même personne/)).toBeVisible();
  await expect(card.getByText(/reste actif/)).toHaveCount(0);
  await expect(
    page.locator('#face-' + robin.id).getByText('Aucun visage mémorisé', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('nouvelle personne : souvenirs autorisés ou non, et nom déjà pris refusé', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  const memoryConsent = page.getByLabel(
    'Laisser Cornelius retenir des souvenirs pour cette personne (extraits par le fournisseur vocal choisi après la conversation)',
  );
  await expect(memoryConsent).toBeChecked();
  await expect(page.getByText(/Ni souvenir ni service externe/)).toHaveCount(0);
  await page.getByLabel('Prénom ou nom d’affichage').fill('Élise foyer');
  await memoryConsent.uncheck();
  await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
  await expect(page.getByText('Profil créé.', { exact: true })).toBeVisible();
  // Le formulaire revient à son état par défaut : souvenirs autorisés.
  await expect(memoryConsent).toBeChecked();
  const profiles = (await (await page.request.get('/api/admin/profiles')).json()) as Profile[];
  const elise = profiles.find((profile) => profile.name === 'Élise foyer')!;
  const memory = await (await page.request.get('/api/admin/memory/' + elise.id)).json();
  expect(memory.enabled).toBe(false);

  // Même nom, autre casse et sans accent : refusé avant l’envoi, avec une solution.
  await page.getByLabel('Prénom ou nom d’affichage').fill('elise FOYER');
  await expect(
    page.getByText(
      '« Élise foyer » fait déjà partie du foyer. Ajoutez une initiale pour les distinguer, par exemple « Elise FOYER B. ».',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter au foyer', exact: true })).toBeDisabled();
  await page.getByLabel('Prénom ou nom d’affichage').fill('Élise foyer M.');
  await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
  const row = page.locator('.profile-row').filter({ hasText: 'Élise foyer M.' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Renommer Élise foyer M.', exact: true }).click();
  await row.getByLabel('Nouveau nom de Élise foyer M.').fill('ELISE foyer');
  await expect(row.getByText(/« Élise foyer » fait déjà partie du foyer/)).toBeVisible();
  await expect(row.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
  // Le serveur refuse aussi, même sans passer par le formulaire.
  const refused = await page.request.patch('/api/admin/profiles/' + elise.id, {
    headers: { origin },
    data: { name: 'élise foyer m.' },
  });
  expect(refused.status()).toBe(409);
  expect(errors).toEqual([]);
});

test('supprimer une personne dit tout ce qui sera effacé et propose d’oublier seulement le visage', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const camille = await createProfile(page, 'Camille suppression');
  const robin = await createProfile(page, 'Robin suppression');
  // Le serveur de test n’a pas de caméra : seul Camille a un visage pour l’administration.
  let faces = [camille.id];
  await page.route('**/api/admin/devices', async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as DevicesStatus;
    status.perception.enrolledProfileIds = faces;
    await route.fulfill({ response, json: status });
  });
  let forgotten: string | null = null;
  await page.route('**/api/admin/profiles/*/face', async (route) => {
    forgotten = decodeURIComponent(route.request().url().split('/').at(-2)!);
    faces = faces.filter((id) => id !== forgotten);
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  const row = page.locator('.profile-row').filter({ hasText: 'Camille suppression' });
  await row.getByRole('button', { name: 'Supprimer Camille suppression', exact: true }).click();
  await expect(
    row.getByText(
      'Supprimer définitivement Camille suppression ? Son visage, ses souvenirs, son style et ses repères, ses sources et commandes personnelles et la connexion à son agent seront effacés, copies de sécurité comprises. Cette action ne peut pas être annulée.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshots}/profiles-delete.png`, fullPage: true });
  await row.getByRole('button', { name: 'Oublier seulement le visage', exact: true }).click();
  await expect(page.getByText('Visage oublié.', { exact: true })).toBeVisible();
  expect(forgotten).toBe(camille.id);
  await expect(row.getByRole('button', { name: /définitivement/ })).toHaveCount(0);
  await expect(row).toBeVisible();

  // Sans visage, seule la suppression complète est proposée.
  const other = page.locator('.profile-row').filter({ hasText: 'Robin suppression' });
  await other.getByRole('button', { name: 'Supprimer Robin suppression', exact: true }).click();
  const confirm = other.getByRole('button', {
    name: 'Supprimer Robin suppression définitivement',
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await expect(other.getByRole('button', { name: 'Oublier seulement le visage' })).toHaveCount(0);
  await confirm.click();
  await expect(page.getByText('Profil supprimé.', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-row').filter({ hasText: 'Robin suppression' })).toHaveCount(
    0,
  );
  const remaining = (await (await page.request.get('/api/admin/profiles')).json()) as Profile[];
  expect(remaining.some((profile) => profile.id === robin.id)).toBe(false);
  expect(remaining.some((profile) => profile.id === camille.id)).toBe(true);
  expect(errors).toEqual([]);
});

test('le foyer : membres d’abord, nouvelle personne montrée et visage proposé tout de suite', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const camera = await fakePerception(page);
  await login(page);
  await useCameraOpening(page);
  await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
  const titles = await page.locator('[data-slot="card-title"]').allTextContents();
  expect(titles.indexOf('Les membres du foyer')).toBeLessThan(
    titles.indexOf('Une nouvelle personne'),
  );
  await expect(page.getByText(/reste toujours disponible/)).toHaveCount(0);
  await expect(page.getByText(/Aucune photo n’est conservée/)).toHaveCount(1);

  await page.getByLabel('Prénom ou nom d’affichage').fill('Noé foyer');
  await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
  const row = page.locator('.profile-row').filter({ hasText: 'Noé foyer' });
  const offer = row.getByRole('button', {
    name: 'Mémoriser le visage de Noé foyer maintenant',
    exact: true,
  });
  await expect(offer).toBeVisible();
  await expect(offer).toBeInViewport();
  await page.screenshot({ path: `${screenshots}/profiles-created.png` });
  await offer.click();
  const noe = ((await (await page.request.get('/api/admin/profiles')).json()) as Profile[]).find(
    (profile) => profile.name === 'Noé foyer',
  )!;
  await expect
    .poll(() => camera.enrollments.at(-1))
    .toEqual({ profileId: noe.id, mode: 'replace' });
  const guide = page.getByText('Enregistrement du visage de Noé foyer', { exact: true });
  await expect(guide).toBeVisible();
  await expect(guide).toBeInViewport();
  await expect(offer).toHaveCount(0);
  camera.end('cancelled', 'Enregistrement annulé.');

  // Service caméra arrêté : le bouton est désactivé, la raison écrite juste dessous.
  camera.perception.connected = false;
  camera.send();
  const requests = camera.enrollments.length;
  await page.getByLabel('Prénom ou nom d’affichage').fill('Lina foyer');
  await page.getByRole('button', { name: 'Ajouter au foyer', exact: true }).click();
  const blocked = page.getByRole('button', {
    name: 'Mémoriser le visage de Lina foyer maintenant',
  });
  await expect(blocked).toBeDisabled();
  await expect(blocked).toHaveAccessibleDescription(
    /^Impossible pour l’instant : le service caméra \(perception\) n’est pas lancé/,
  );
  const reason = page
    .locator('.profile-row')
    .filter({ hasText: 'Lina foyer' })
    .getByText(/^Impossible pour l’instant : le service caméra \(perception\) n’est pas lancé/);
  await expect(reason).toBeInViewport();
  expect(camera.enrollments).toHaveLength(requests);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/profiles-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('deux visages qui se ressemblent : un conseil sans score, et l’exigence à un clic', async ({
  page,
}) => {
  const camera = await fakePerception(page);
  await login(page);
  await useCameraOpening(page);
  const anna = await createProfile(page, 'Anna sosie');
  const lou = await createProfile(page, 'Lou sosie');
  try {
    camera.perception.enrolledProfileIds = [anna.id, lou.id];
    camera.perception.lookalikes = [{ profileIds: [anna.id, lou.id], similarity: 0.61 }];
    await page.getByRole('button', { name: 'Le foyer et les visages', exact: true }).click();
    camera.send();
    const alert = page
      .getByRole('note')
      .filter({ hasText: 'Anna sosie et Lou sosie se ressemblent pour la caméra' });
    await expect(alert).toBeVisible();
    // Le score brut ne dit rien à la personne : seul le geste à faire est donné.
    await expect(alert).not.toContainText('0,61');
    await expect(alert).toContainText('passez d’un cran vers « Stricte »');
    await alert.getByRole('button', { name: 'Régler l’exigence', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caméra et reconnaissance');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Exigence de la reconnaissance' }),
    ).toBeVisible();
  } finally {
    for (const profile of [anna, lou])
      await page.request.delete('/api/admin/profiles/' + profile.id, { headers: { origin } });
  }
});
