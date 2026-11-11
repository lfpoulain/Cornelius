import { test, expect } from '@playwright/test';
import { login, screenshots } from './env';

test('les cartes web affichent les citations OpenAI comme liens accessibles', async ({ page }) => {
  const snapshot = await (await page.request.get('/api/state')).json();
  snapshot.bootId = 'web-search-browser-fixture';
  snapshot.sequence = 1;
  snapshot.state.openaiBlocked = true;
  snapshot.state.browserConnected = true;
  snapshot.state.session.interactionId = 'web-search-ui';
  snapshot.state.session.phase = 'blocked';
  snapshot.state.cards = [
    {
      id: 'web-card',
      interactionId: 'web-search-ui',
      profileEpoch: snapshot.state.session.profileEpoch,
      contextVersion: snapshot.state.session.contextVersion,
      profileId: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      content: {
        schemaVersion: 1,
        cardType: 'luna',
        title: 'Une information vérifiée sur le web',
        primaryValue: null,
        subtitle: null,
        description: 'Les sources de la réponse restent consultables.',
        items: [],
        sources: [],
      },
      sources: [
        {
          id: 'https://example.org/article',
          title: 'Source officielle',
          url: 'https://example.org/article',
        },
        {
          id: 'https://example.org/details',
          title: 'Détails complémentaires de la publication',
          url: 'https://example.org/details',
        },
      ],
    },
  ];
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/events?role=kiosk', (route) =>
    route.send(JSON.stringify(snapshot)),
  );
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Carte principale' });
  const source = card.getByRole('link', { name: 'Source officielle', exact: true });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('href', 'https://example.org/article');
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await source.focus();
  await expect(source).toBeFocused();
  await page.screenshot({ path: `${screenshots}/web-search-card.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(source).toBeVisible();
  await expect(
    card.getByRole('link', { name: 'Détails complémentaires de la publication' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `${screenshots}/web-search-card-mobile.png` });
});

test('le module Web parle de Cornelius, pas du modèle interne', async ({ page }) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  const module = page.locator('#module-web');
  await module.locator(':scope > summary').click();
  await expect(module).toContainText('Cornelius cherche sur le web avant de répondre');
  await expect(module).not.toContainText('Luna');
  await expect(module).not.toContainText('liste d’outils');
});
