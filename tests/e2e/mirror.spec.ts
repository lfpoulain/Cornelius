import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import type { AmbientDisplay } from '../../shared/addons';
import type { DisplayCard, StateEvent } from '../../shared/types';
import { origin, screenshots } from './env';

/** État simulé du miroir : /api/state et le WebSocket servent le même instantané. */
async function mirrorFixture(page: Page, change: (state: StateEvent['state']) => void) {
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const snapshot: StateEvent = {
    ...initial,
    bootId: 'mirror-browser-fixture',
    sequence: 1,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      setup: { openaiKey: true, perception: true },
      browserConnected: true,
      browserAudioReady: true,
      presence: {
        state: 'present',
        health: 'ok',
        peopleCount: 1,
        recognizedProfileIds: [],
        people: [{ trackId: 'one', profileId: null, engaged: false }],
        engagementId: null,
        observedAt: Date.now(),
      },
    },
  };
  change(snapshot.state);
  const sockets: WebSocketRoute[] = [];
  let online = true;
  await page.route('**/api/state', (route) =>
    online
      ? route.fulfill({ json: snapshot })
      : route.fulfill({ status: 503, json: { error: 'Serveur indisponible.' } }),
  );
  await page.routeWebSocket('**/events?role=kiosk', (socket) => {
    if (!online) return void socket.close({ code: 1011 });
    sockets.push(socket);
    socket.send(JSON.stringify(snapshot));
  });
  const heartbeat = setInterval(() => {
    if (!online) return;
    for (const socket of sockets)
      socket.send(
        JSON.stringify({
          schemaVersion: 1,
          type: 'heartbeat',
          bootId: snapshot.bootId,
          sequence: snapshot.sequence,
          sentAt: Date.now(),
        }),
      );
  }, 1000);
  return {
    snapshot,
    publish(update: (state: StateEvent['state']) => void) {
      update(snapshot.state);
      snapshot.sequence++;
      snapshot.sentAt = Date.now();
      for (const socket of sockets) socket.send(JSON.stringify(snapshot));
    },
    /** Le serveur ne répond plus : socket fermé, /api/state en erreur. */
    disconnect() {
      online = false;
      for (const socket of sockets.splice(0)) void socket.close({ code: 1011 });
    },
    reconnect() {
      online = true;
    },
    close: () => clearInterval(heartbeat),
  };
}

function answerCard(state: StateEvent['state'], id: string, title: string): DisplayCard {
  return {
    id,
    interactionId: state.session.interactionId,
    profileEpoch: state.session.profileEpoch,
    contextVersion: state.session.contextVersion,
    profileId: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    content: {
      schemaVersion: 1,
      cardType: 'luna',
      title,
      primaryValue: null,
      subtitle: null,
      description: 'Une réponse affichée pendant la conversation.',
      items: [],
      sources: [],
    },
    sources: [],
  };
}

function converse(state: StateEvent['state']) {
  state.session = {
    ...state.session,
    phase: 'ready',
    interactionId: 'mirror-ui',
    startedAt: Date.now(),
    readyAt: Date.now(),
  };
}

async function expectCenteredMirror(page: Page) {
  await expect(
    page.locator(
      '.mirror-page a, .mirror-page input, .mirror-page select, .mirror-page [tabindex="0"]',
    ),
  ).toHaveCount(0);
  const box = await page.getByTestId('mirror-orb').boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('le miroir garde son orbe centré et propose uniquement l’activation initiale de la voix', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const url = origin;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    // Le navigateur demande /favicon.ico de lui-même : cette absence n’est pas une erreur du miroir.
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
      pageErrors.push(message.text());
  });
  const admin = await context.newPage();
  admin.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url);
    await expect(page.getByTestId('mirror-orb')).toBeVisible();
    await expectCenteredMirror(page);
    await expect(page.getByRole('button', { name: 'Activer la voix' })).toBeVisible();
    const orb = page.locator('.orb');
    await expect(orb).toHaveAttribute('data-presence', 'sleeping');
    await expect(orb).toHaveAttribute('data-renderer', 'three');
    const litPixels = async () => {
      const screenshot = await orb.locator('canvas').screenshot();
      return page.evaluate(async (png) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + png;
        await image.decode();
        const sample = document.createElement('canvas');
        sample.width = image.width;
        sample.height = image.height;
        const context = sample.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
        let count = 0;
        let chroma = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
          if (pixels[i + 3]! > 32 && Math.max(r, g, b) > 60) {
            count++;
            chroma += Math.max(r, g, b) - Math.min(r, g, b);
          }
        }
        return { count, chroma: count ? chroma / count : 0 };
      }, screenshot.toString('base64'));
    };
    await expect.poll(async () => (await litPixels()).count).toBeGreaterThan(0);
    // En veille, rien ne part vers OpenAI : l’orbe est grise.
    await expect.poll(async () => (await litPixels()).chroma).toBeLessThan(45);
    await page.screenshot({ path: `${screenshots}/mirror-sleeping.png` });
    await admin.goto(url + '/admin');
    await admin
      .getByLabel('Mot de passe administrateur')
      .fill('admin-browser-test-only-credentials-1234');
    await admin.getByRole('button', { name: 'Ouvrir cet espace' }).click();
    await expect(admin.locator('.admin-shell')).toHaveCSS('color-scheme', 'dark');
    await admin.getByRole('button', { name: /Le foyer/ }).click();
    for (const name of ['Camille', 'Robin']) {
      await admin.getByLabel('Prénom ou nom d’affichage').fill(name);
      await admin.getByRole('button', { name: /Ajouter au foyer/ }).click();
      await expect(admin.locator('.profile-row').getByText(name, { exact: true })).toBeVisible();
    }
    await page.bringToFront();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expectCenteredMirror(page);
      await page.screenshot({
        path: `${screenshots}/mirror-${viewport.width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const robin = admin.locator('.profile-row').filter({ hasText: 'Robin' });
    await robin.getByRole('button', { name: 'Supprimer Robin', exact: true }).click();
    await robin.getByRole('button', { name: 'Supprimer Robin définitivement' }).click();
    await expect(admin.getByText('Robin', { exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await admin.close();
    await page.close();
  }
});

test('un miroir ouvert dans un autre onglet le dit et ne reprend la main qu’à la demande', async ({
  context,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  const notice = (page: Page) =>
    page.getByRole('status').filter({ hasText: 'Ce miroir est affiché dans un autre onglet.' });
  try {
    await first.goto('/');
    await expect(first.getByTestId('mirror-orb')).toBeVisible();
    await expect(notice(first)).toHaveCount(0);
    await second.goto('/');
    await expect(second.getByTestId('mirror-orb')).toBeVisible();
    // Le serveur ferme l’ancien miroir (1008) : il l’annonce, sans reconnexion automatique.
    await expect(notice(first)).toBeVisible();
    await expect(first.getByRole('button', { name: 'Afficher ici' })).toBeVisible();
    await first.waitForTimeout(2_500);
    await expect(notice(first)).toBeVisible();
    await expect(notice(second)).toHaveCount(0);
    await first.screenshot({ path: `${screenshots}/mirror-other-tab.png` });
    await expectCenteredMirror(first);

    await first.getByRole('button', { name: 'Afficher ici' }).click();
    await expect(notice(first)).toHaveCount(0);
    await expect(first.getByRole('button', { name: 'Afficher ici' })).toHaveCount(0);
    await expect(notice(second)).toBeVisible();
    await expect(second.getByRole('button', { name: 'Afficher ici' })).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test('une seule ligne d’état dit en clair ce qui empêche Cornelius de répondre', async ({
  page,
}) => {
  const fixture = await mirrorFixture(page, (state) => {
    state.setup = { openaiKey: false, perception: false };
  });
  const line = page.locator('.mirror-header .mirror-line');
  try {
    await page.goto('/');
    await expect(line).toHaveText(
      `Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur. Adresse : ${origin}/admin`,
    );
    await expect(line).toHaveAttribute('role', 'status');
    // L’adresse est du texte : aucun lien ni champ sur le miroir.
    await expectCenteredMirror(page);
    await expect(page.locator('.mirror-line')).toHaveCount(1);
    await page.screenshot({ path: `${screenshots}/mirror-line-setup.png` });

    fixture.publish((state) => {
      state.setup = { openaiKey: true, perception: true };
      state.presence.health = 'unavailable';
    });
    await expect(line).toContainText('Caméra du miroir indisponible : vérifiez-la');

    // La voix à activer est déjà dite par le bouton : pas de doublon dans la ligne.
    fixture.publish((state) => {
      state.presence.health = 'ok';
      state.browserAudioReady = false;
    });
    await expect(line).toBeHidden();
    await expect(page.getByRole('button', { name: 'Activer la voix' })).toBeVisible();

    // Tout est prêt : la ligne disparaît.
    fixture.publish((state) => {
      state.browserAudioReady = true;
    });
    await expect(line).toBeHidden();
    await expect(line).toHaveText('');

    // Conversation en cours : aucun motif affiché.
    fixture.publish((state) => {
      converse(state);
      state.wakeWord = { enabled: true, ready: false, detail: 'Modèle introuvable.' };
    });
    await expect(page.locator('.orb')).toHaveAttribute('data-phase', 'ready');
    await expect(line).toBeHidden();

    // Serveur perdu : rien pendant une resynchronisation brève, puis le message après 5 s.
    fixture.disconnect();
    const lostAt = Date.now();
    await expect(page.locator('.orb')).toHaveAttribute('data-phase', 'idle');
    await expect(line).toBeHidden();
    await expect(line).toHaveText('Connexion au serveur perdue, nouvelle tentative…', {
      timeout: 10_000,
    });
    expect(Date.now() - lostAt).toBeGreaterThanOrEqual(4_500);
    await page.screenshot({ path: `${screenshots}/mirror-line-lost.png` });
    fixture.reconnect();
    await expect(line).toBeHidden({ timeout: 15_000 });
  } finally {
    fixture.close();
  }
});

test('l’activation de la voix dit quoi faire et signale l’absence de micro au-dessus du bouton', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('aucun micro', 'NotFoundError');
    };
  });
  const fixture = await mirrorFixture(page, (state) => {
    state.browserAudioReady = false;
  });
  try {
    await page.goto('/');
    const hint = page.locator('.mirror-hint');
    const message = hint.getByRole('status');
    const activate = page.getByRole('button', { name: 'Activer la voix' });
    await expect(message).toHaveText(
      'Touchez pour autoriser le micro et le son. À refaire après un redémarrage du navigateur.',
    );
    const below = await message.boundingBox();
    expect(below!.y).toBeGreaterThanOrEqual((await activate.boundingBox())!.y);
    // L’invite reste centrée sous l’orbe, même avec une aide sur deux lignes.
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      for (const box of [await activate.boundingBox(), await message.boundingBox()])
        expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${screenshots}/mirror-activate.png` });

    await activate.click();
    await expect(message).toHaveText('Aucun micro détecté. Branchez-en un, puis réessayez.');
    // Un seul paragraphe annoncé, en ambre, avec une icône, au-dessus du bouton.
    await expect(hint.locator('[role="status"]')).toHaveCount(1);
    await expect(message).toHaveCSS('color', 'rgb(224, 194, 140)');
    await expect(message.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const error = (await message.boundingBox())!;
    expect(error.y + error.height).toBeLessThanOrEqual((await activate.boundingBox())!.y);
    await expectCenteredMirror(page);
    await page.screenshot({ path: `${screenshots}/mirror-activate-error.png` });
  } finally {
    fixture.close();
  }
});

test('un libellé discret sous l’orbe dit seulement quand Cornelius réfléchit', async ({ page }) => {
  // Voix activée (micro simulé) : l’invite d’activation laisse la place au libellé.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () =>
      new AudioContext().createMediaStreamDestination().stream;
  });
  const fixture = await mirrorFixture(page, (state) => {
    converse(state);
    state.cards = [answerCard(state, 'answer', 'Votre journée')];
  });
  const label = page.locator('.mirror-voice-state');
  const status = page.locator('.mirror-page > p.sr-only[role="status"]');
  const voice = (phase: StateEvent['state']['voice']['phase'], endsAt: number | null) =>
    fixture.publish((state) => {
      state.voice = { phase, startedAt: Date.now(), endsAt };
    });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Activer la voix' }).click();
    await expect(page.locator('.mirror-hint')).toHaveCount(0);
    await expect(page.locator('.orb')).toHaveAttribute('data-phase', 'ready');
    await expect(label).toHaveCount(0);
    await expect(status).toHaveText('Conversation en cours.');
    // Ni « Je vous écoute » ni « Je parle » : seule la réflexion s’écrit sous l’orbe.
    for (const phase of ['listening', 'speaking'] as const) {
      voice(phase, Date.now() + 60_000);
      await page.waitForTimeout(1_200);
      await expect(label).toHaveCount(0);
      await expect(status).toHaveText('Conversation en cours.');
    }
    voice('thinking', Date.now() + 60_000);
    await expect(label).toHaveText('Je réfléchis…');
    await expect(status).toHaveText('Je réfléchis…');
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expectCenteredMirror(page);
      const where = `${viewport.width}x${viewport.height}`;
      const layout = await page.evaluate(() => {
        const label = document.querySelector('.mirror-voice-state')!;
        return {
          label: label.getBoundingClientRect(),
          lineHeight: parseFloat(getComputedStyle(label).lineHeight),
          orb: document.querySelector('.mirror-orb-anchor')!.getBoundingClientRect(),
          card: document.querySelector('.display-card')!.getBoundingClientRect(),
        };
      });
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      // Une ligne, centrée, sous l’orbe visible et sous le trait du micro dessiné par la scène
      // (1,25 / 3,2 de la taille de l’orbe), sans toucher la carte principale.
      expect(layout.label.height, where).toBeLessThan(layout.lineHeight * 1.5);
      expect(Math.abs(layout.label.x + layout.label.width / 2 - center.x), where).toBeLessThan(2);
      expect(layout.label.top, where).toBeGreaterThan(center.y + (layout.orb.width * 1.25) / 3.2);
      const overlaps =
        layout.label.left < layout.card.right &&
        layout.card.left < layout.label.right &&
        layout.label.top < layout.card.bottom &&
        layout.card.top < layout.label.bottom;
      expect(overlaps, where).toBe(false);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${screenshots}/mirror-voice-${where}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Au repos, plus rien sous l’orbe ; une activité expirée vaut le repos.
    voice('idle', null);
    await expect(label).toHaveCount(0);
    await expect(status).toHaveText('Conversation en cours.');
    voice('thinking', Date.now() - 1_000);
    await page.waitForTimeout(300);
    await expect(label).toHaveCount(0);

    // Hors conversation, ni libellé ni « Prêt » annoncé.
    voice('thinking', Date.now() + 60_000);
    await expect(label).toHaveText('Je réfléchis…');
    fixture.publish((state) => {
      state.session = { ...state.session, phase: 'idle', interactionId: null };
    });
    await expect(label).toHaveCount(0);
    await expect(status).toHaveText('En veille.');
  } finally {
    fixture.close();
  }
});

test('les cartes et les personnes se lisent sans vocabulaire interne', async ({ page }) => {
  const camille = { id: 'camille', name: 'Camille', createdAt: 1 };
  const fixture = await mirrorFixture(page, (state) => {
    converse(state);
    state.profiles = [camille];
    state.activeProfile = camille;
    state.selection = 'automatic';
    state.presence.peopleCount = 2;
    state.presence.people = [
      { trackId: 'one', profileId: camille.id, engaged: true },
      { trackId: 'two', profileId: null, engaged: false },
    ];
    state.cards = [answerCard(state, 'answer', 'Votre journée')];
  });
  try {
    await page.goto('/');
    const card = page.locator('.display-card[data-kind="luna"]');
    await expect(card.locator('.card-kicker')).toHaveText('Réponse');
    await expect(page.locator('.mirror-page')).not.toContainText('Luna');
    await expect(page.locator('.mirror-page')).not.toContainText('engagé');
    const presence = page.getByRole('complementary', { name: 'Personnes détectées' });
    await expect(presence.locator('.mirror-person.is-engaged')).toHaveText('Camille, vous regarde');
    await expect(presence.getByText(', vous regarde')).toHaveClass('sr-only');
    // Une personne inconnue reste lisible de loin.
    const unknown = presence.locator('.mirror-person').filter({ hasText: 'Personne inconnue' });
    expect(Number(await unknown.evaluate((element) => getComputedStyle(element).opacity))).toBe(
      0.85,
    );
    // Le nom est un titre pour les lecteurs d’écran ; le logo visible ne se lit pas deux fois.
    await expect(page.getByRole('heading', { level: 1, name: 'Cornelius' })).toHaveClass('sr-only');
    await expect(page.locator('.mirror-wordmark')).toHaveAttribute('aria-hidden', 'true');
  } finally {
    fixture.close();
  }
});

function ambientDisplays(): AmbientDisplay[] {
  const display = (
    instanceId: string,
    label: string,
    content: NonNullable<AmbientDisplay['content']>,
  ) => ({
    instanceId,
    addonId: 'weather',
    profileId: null,
    label,
    status: 'ready' as const,
    fetchedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 600_000).toISOString(),
    content,
  });
  const metric = (title: string, value: string, subtitle: string) => ({
    layout: 'metric' as const,
    title,
    value,
    subtitle,
    items: [],
  });
  return [
    display(
      'meteo',
      'Météo maison',
      metric('Météo', '12 / 21 °C', 'Paris · Peu nuageux, averses possibles en fin de journée'),
    ),
    display('bus', 'Trajet de Camille', {
      layout: 'list',
      title: 'Mes bus',
      value: null,
      subtitle: 'Ligne 91 → Montparnasse',
      items: [
        { label: 'Prochain', value: '4 min' },
        { label: 'Suivant', value: '12 min' },
        { label: 'Après', value: '19 min' },
        { label: 'Plus tard', value: '31 min' },
      ],
    }),
    display('lyon', 'Météo bureau', metric('Météo', '9 °C', 'Lyon')),
    display('nice', 'Météo vacances', metric('Météo', '24 °C', 'Nice')),
    display('brest', 'Météo famille', metric('Météo', '14 °C', 'Brest')),
  ];
}

test('le miroir reste lisible en portrait comme en paysage, sans défilement ni chevauchement', async ({
  page,
}) => {
  const fixture = await mirrorFixture(page, (state) => {
    converse(state);
    state.ambientDisplays = ambientDisplays();
    const main = answerCard(state, 'main', 'Votre journée de mardi');
    main.content = {
      ...main.content,
      primaryValue: '3 rendez-vous',
      subtitle: 'Le premier commence à 9 h 30, au bureau, avec l’équipe projet.',
      description:
        'Pensez à prendre un parapluie : des averses sont prévues en fin d’après-midi. Le dernier rendez-vous se termine vers 18 h, ce qui laisse le temps de passer à la pharmacie.',
      items: [
        { label: 'Matin', value: 'Équipe projet' },
        { label: 'Après-midi', value: 'Visio avec Claire' },
      ],
    } as DisplayCard['content'];
    state.cards = [
      main,
      answerCard(state, 'second', 'Fermeture exceptionnelle de la piscine municipale'),
      answerCard(state, 'third', 'Bus 91 vers Montparnasse'),
    ];
  });
  try {
    await page.goto('/');
    await expect(page.locator('.display-card')).toHaveCount(3);
    for (const viewport of [
      { width: 1080, height: 1920 },
      { width: 2160, height: 3840 },
      { width: 1920, height: 1080 },
      { width: 1440, height: 1000 },
      { width: 800, height: 1280 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expectCenteredMirror(page);
      const layout = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect();
        const ambient = document.querySelector<HTMLElement>('.mirror-ambient')!;
        // Taille des textes visibles : 12 px pour les étiquettes, 14 px pour le reste.
        const labels =
          '.ambient-heading, .ambient-status, .ambient-time, .card-kicker, .card-source, .mirror-person, .mirror-activity, .mirror-voice-state';
        const tooSmall: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>('.mirror-page *')) {
          const text = [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim(),
          );
          if (!text || element.closest('.sr-only') || !element.getClientRects().length) continue;
          const size = parseFloat(getComputedStyle(element).fontSize);
          if (size < (element.closest(labels) ? 12 : 14))
            tooSmall.push(`${element.className || element.tagName} ${size}px`);
        }
        return {
          portrait: innerHeight > innerWidth,
          center: { x: innerWidth / 2, y: innerHeight / 2 },
          orb: document.querySelector('.mirror-orb-anchor')!.getBoundingClientRect().width,
          main: rect('.mirror-card-rail-main .display-card')!,
          secondary: rect('.mirror-card-rail-secondary')!,
          ambient: ambient.getBoundingClientRect(),
          ambientOverflow: getComputedStyle(ambient).overflowY,
          shownModules: [...ambient.children].filter(
            (child) => getComputedStyle(child).display !== 'none',
          ).length,
          footer: rect('.mirror-status')!,
          title: parseFloat(
            getComputedStyle(document.querySelector('.mirror-card-rail-main h2')!).fontSize,
          ),
          tooSmall,
        };
      });
      const where = `${viewport.width}x${viewport.height}`;
      if (where === '1920x1080') {
        // Grand écran : cartes un cinquième plus petites que le reste du miroir.
        expect(layout.title, where).toBeLessThanOrEqual(23);
        expect(layout.main.width, where).toBeLessThanOrEqual(480);
      }
      expect(layout.tooSmall, where).toEqual([]);
      expect(layout.ambientOverflow, where).toBe('visible');
      expect(layout.shownModules, where).toBeGreaterThanOrEqual(2);
      expect(layout.shownModules, where).toBeLessThanOrEqual(4);
      // La pastille de présence ne recouvre jamais la carte principale.
      expect(layout.footer.top, where).toBeGreaterThanOrEqual(layout.main.bottom);
      // Les informations permanentes s’arrêtent au-dessus de l’orbe visible.
      const visibleOrb = (layout.orb * 0.63) / 2;
      expect(layout.ambient.bottom, where).toBeLessThan(layout.center.y - visibleOrb);
      if (layout.portrait) {
        // Pile verticale : informations, orbe, carte principale puis cartes complémentaires.
        expect(layout.main.top, where).toBeGreaterThan(layout.center.y + visibleOrb);
        // Sur un téléphone, l’invite d’activation passe avant les cartes complémentaires.
        if (layout.secondary.height > 0)
          expect(layout.secondary.top, where).toBeGreaterThanOrEqual(layout.main.bottom);
      } else {
        expect(layout.main.right, where).toBeLessThan(layout.center.x - visibleOrb);
        expect(layout.secondary.left, where).toBeGreaterThan(layout.center.x + visibleOrb);
      }
      // Mouvement réduit : la scène WebGL redessine le verre des cartes quatre fois par seconde.
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${screenshots}/mirror-layout-${where}.png` });
    }
  } finally {
    fixture.close();
  }
});

test('la taille de l’orbe choisie dans l’administration s’applique au miroir', async ({ page }) => {
  const fixture = await mirrorFixture(page, () => {});
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    const anchor = page.locator('.mirror-orb-anchor');
    await expect(anchor).toBeVisible();
    const width = async () => (await anchor.boundingBox())!.width;
    const base = await width();
    fixture.publish((state) => {
      state.orbScale = 130;
    });
    await expect.poll(width).toBeCloseTo(base * 1.3, 0);
    fixture.publish((state) => {
      state.orbScale = 70;
    });
    await expect.poll(width).toBeCloseTo(base * 0.7, 0);
    await page.screenshot({ path: `${screenshots}/mirror-orb-70.png` });
  } finally {
    fixture.close();
  }
});

/** Image PNG unie, faite à la main : le miroir la reçoit comme une photo envoyée. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Une peinture servie au miroir à la place de la bibliothèque du serveur. */
async function routeScreensaverImages(page: Page) {
  await page.route('**/api/screensaver', (route) =>
    route.fulfill({
      json: {
        images: [
          {
            id: 'peinture',
            url: '/api/screensaver/images/peinture',
            title: 'La Nuit étoilée',
            credit: 'Vincent van Gogh, 1889',
            origin: 'collection',
          },
        ],
      },
    }),
  );
  await page.route('**/api/screensaver/images/peinture', (route) =>
    route.fulfill({ contentType: 'image/png', body: solidPng(64, 40, [40, 70, 160]) }),
  );
}

function screensaverState(
  wake: 'presence' | 'opening',
): NonNullable<StateEvent['state']['screensaver']> {
  return {
    enabled: true,
    intervalMs: 60_000,
    returnDelayMs: 0,
    transition: 'vortex',
    durationMs: 1_000,
    wake,
    fit: 'canvas',
    imageCount: 1,
    revision: 'essai',
  };
}

test('écran de veille : une peinture quand personne n’est là, l’orbe revient à l’arrivée', async ({
  page,
}) => {
  const fixture = await mirrorFixture(page, (state) => {
    state.presence = { ...state.presence, state: 'absent', peopleCount: 0, people: [] };
    state.screensaver = screensaverState('presence');
  });
  await routeScreensaverImages(page);
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const mirror = page.locator('.mirror-page');
    await expect(mirror).toHaveAttribute('data-screensaver', 'on');
    // Rien d’autre que la peinture et son cartel.
    await expect(page.locator('.mirror-top')).toHaveCSS('opacity', '0');
    await expect(page.locator('.orb-fullscreen')).toHaveCSS('opacity', '0');
    await expect(page.locator('.mirror-footer')).toHaveCSS('opacity', '0');
    await expect(page.locator('.mirror-screensaver-caption')).toContainText('La Nuit étoilée');
    await page.screenshot({ path: `${screenshots}/mirror-screensaver.png` });

    fixture.publish((state) => {
      state.presence = {
        ...state.presence,
        state: 'present',
        peopleCount: 1,
        people: [{ trackId: 'one', profileId: null, engaged: false }],
      };
    });
    await expect(mirror).toHaveAttribute('data-screensaver', 'off');
    await expect(page.locator('.orb-fullscreen')).toHaveCSS('opacity', '1');
    await expect(page.locator('.mirror-top')).toHaveCSS('opacity', '1');
  } finally {
    fixture.close();
  }
});

test('écran de veille calé sur le réveil de Cornelius : un passant ne le retire pas, un regard si', async ({
  page,
}) => {
  const person = { trackId: 'one', profileId: null, engaged: false };
  const fixture = await mirrorFixture(page, (state) => {
    state.opening = { trigger: 'gaze', audience: 'everyone', recognizeVoice: false };
    state.presence = { ...state.presence, state: 'present', peopleCount: 1, people: [person] };
    state.screensaver = screensaverState('opening');
  });
  await routeScreensaverImages(page);
  try {
    await page.goto('/');
    const mirror = page.locator('.mirror-page');
    await expect(mirror).toHaveAttribute('data-screensaver', 'on');
    fixture.publish((state) => {
      state.presence = {
        ...state.presence,
        state: 'engaged',
        people: [{ ...person, engaged: true }],
      };
    });
    await expect(mirror).toHaveAttribute('data-screensaver', 'off');
  } finally {
    fixture.close();
  }
});
