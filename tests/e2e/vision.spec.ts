import { expect, test, type WebSocketRoute } from '@playwright/test';
import type {
  DevicesStatus,
  ModelDownload,
  VisionDevice,
  VisionMode,
  VisionModel,
} from '../../shared/types';
import { login, screenshots } from './env';

const download = (state: ModelDownload['state'], extra: Partial<ModelDownload> = {}) => ({
  state,
  file: null,
  completed: 0,
  files: 9,
  received: 0,
  total: null,
  error: null,
  ...extra,
});

test('vision : choisir ne télécharge rien, installer se confirme, progresse, échoue lisiblement puis s’active', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // État d’installation simulé : aucun téléchargement réel pendant les tests.
  const fake: {
    modelId: VisionModel;
    device: VisionDevice;
    mode: VisionMode;
    downloads: Partial<Record<VisionModel, ModelDownload>>;
  } = {
    modelId: '450m',
    device: 'auto',
    mode: 'scene',
    // Les trois modèles sont fixés, quoi que contienne ce poste : un modèle déjà installé dans
    // models/ ne doit pas changer le parcours.
    downloads: {
      '450m': download('missing'),
      '1.6b': download('missing'),
      '3b': download('present', { variant: 'gpu' }),
    },
  };
  let socket: WebSocketRoute | undefined;
  let last: { status: DevicesStatus } | null = null;
  const patch = (status: DevicesStatus) => {
    const vision = status.perception.vision;
    Object.assign(vision, { modelId: fake.modelId, device: fake.device, mode: fake.mode });
    vision.downloads = { ...vision.downloads!, ...fake.downloads } as Record<
      VisionModel,
      ModelDownload
    >;
  };
  const publish = () => {
    if (!last) return;
    patch(last.status);
    socket?.send(JSON.stringify(last));
  };
  await page.routeWebSocket('**/events?role=admin', (route) => {
    socket = route;
    const server = route.connectToServer();
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (value.type !== 'devices') return route.send(message);
      last = value;
      patch(value.status);
      route.send(JSON.stringify(value));
    });
  });
  const models: VisionModel[] = [];
  const devices: VisionDevice[] = [];
  const modes: VisionMode[] = [];
  await page.route('**/api/admin/vision/model', async (route) => {
    const { model } = route.request().postDataJSON() as { model: VisionModel };
    models.push(model);
    fake.modelId = model;
    fake.downloads[model] = download('downloading', {
      file: 'decoder.onnx_data',
      completed: 2,
      received: 750_000,
      total: 1_000_000,
    });
    await route.fulfill({ json: { ok: true } });
    publish();
  });
  await page.route('**/api/admin/vision/device', async (route) => {
    const { device } = route.request().postDataJSON() as { device: VisionDevice };
    devices.push(device);
    fake.device = device;
    await route.fulfill({ json: { ok: true } });
    publish();
  });
  await page.route('**/api/admin/vision', async (route) => {
    const { mode } = route.request().postDataJSON() as { mode: VisionMode };
    modes.push(mode);
    fake.mode = mode;
    await route.fulfill({ json: { ok: true } });
    publish();
  });

  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  const module = page.locator('#module-vision');
  await module.locator(':scope > summary').click();
  await expect(module.locator(':scope > summary')).toContainText('Modèle léger');
  await expect(module.locator(':scope > summary')).toContainText('À installer');
  // Le nom des modèles reste secondaire ; le reste du vocabulaire technique est replié.
  await expect(module.locator(':scope > summary')).not.toContainText('LFM');
  await expect(
    module.getByText(/Luna|GPT-Live|ONNX|VRAM|worker|perception/i).filter({ visible: true }),
  ).toHaveCount(0);
  // Sans modèle installé, seul « Jamais » reste possible.
  const when = module.getByLabel('Quand regarder');
  await expect(when.locator('option[value="scene"]')).toBeDisabled();
  await expect(when.locator('option[value="off"]')).toBeEnabled();

  await expect(module.getByRole('radio', { name: 'Léger', exact: true })).toBeChecked();
  await module.getByRole('radio', { name: 'Équilibré', exact: true }).check();
  expect(models).toEqual([]);
  await module.getByRole('button', { name: 'Installer « Équilibré »…', exact: true }).click();
  const confirm = module.getByRole('group', { name: 'Installer « Équilibré » sur ce PC ?' });
  await expect(confirm).toContainText('Environ 3,5 Go à télécharger');
  expect(models).toEqual([]);
  await confirm.getByRole('button', { name: 'Installer', exact: true }).click();
  await expect.poll(() => models).toEqual(['1.6b']);
  const progress = module.getByRole('progressbar', {
    name: 'Installation de « Équilibré » en cours…',
  });
  await expect(progress).toHaveAttribute('aria-valuenow', '75');
  await expect(module.getByText('Fichier 3 sur 9', { exact: true })).toBeVisible();
  await expect(module.getByRole('radio', { name: 'Précis', exact: true })).toBeDisabled();

  fake.downloads['1.6b'] = download('failed', {
    completed: 2,
    error: 'urllib.error.URLError: <urlopen error [Errno -3] Temporary failure in name resolution>',
  });
  publish();
  const failure = module.getByRole('alert').filter({ hasText: 'L’installation a échoué' });
  await expect(failure).toBeVisible();
  await expect(failure.getByText(/Temporary failure/)).toBeHidden();
  await failure.getByRole('button', { name: 'Voir les détails', exact: true }).click();
  await expect(failure.getByText(/Temporary failure/)).toBeVisible();
  await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect.poll(() => models).toEqual(['1.6b', '1.6b']);
  fake.downloads['1.6b'] = download('ready', { completed: 9, variant: 'gpu' });
  publish();
  await expect(module.getByText('« Équilibré » est installé sur ce PC.')).toBeVisible();
  await expect(when.locator('option[value="scene"]')).toBeEnabled();
  await when.selectOption('tool');
  await expect.poll(() => modes).toEqual(['tool']);

  // Un modèle déjà présent s’utilise sans nouvelle installation à confirmer.
  await module.getByRole('radio', { name: 'Précis', exact: true }).check();
  await module.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
  await expect.poll(() => models).toEqual(['1.6b', '1.6b', '3b']);
  fake.downloads['3b'] = download('ready', { completed: 9, variant: 'gpu' });
  publish();
  await expect(module.getByText('« Précis » est installé sur ce PC.')).toBeVisible();

  // Le calcul reste dans les détails techniques.
  await module.getByText('Détails techniques', { exact: true }).click();
  await module.getByLabel('Calcul').selectOption('cpu');
  await expect.poll(() => devices).toEqual(['cpu']);
  await page.screenshot({ path: `${screenshots}/vision-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `${screenshots}/vision-mobile.png`, fullPage: true });
  expect(errors).toEqual([]);
});
