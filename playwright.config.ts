import { defineConfig } from '@playwright/test';
import { origin, port } from './tests/e2e/env';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: '.local/browser-results',
  reporter: 'list',
  webServer: {
    command: 'node --import tsx server/index.ts',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      CORNELIUS_DATABASE: ':memory:',
      CORNELIUS_ADMIN_PASSWORD: 'admin-browser-test-only-credentials-1234',
      CORNELIUS_LOGIN_RATE_LIMIT: '200',
      // Le serveur de test reste sur cette machine : ni port ouvert sur le réseau local avec le
      // mot de passe de test, ni second « Cornelius » annoncé aux satellites de la maison.
      CORNELIUS_LAN: '0',
      CORNELIUS_MDNS: '0',
      // Les parcours ne dépendent pas du dépôt cornelius-modules éventuellement cloné à côté :
      // leur seul module externe est celui d'essai du formulaire.
      CORNELIUS_MODULES_DIR: 'tests/e2e/modules',
    },
  },
  use: {
    baseURL: origin,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  },
});
