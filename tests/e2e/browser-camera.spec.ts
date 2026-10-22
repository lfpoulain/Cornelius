import { test, expect, type WebSocketRoute } from '@playwright/test';
import type { StateEvent } from '../../shared/types';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('browser camera starts automatically, bounds frames until decode acknowledgement and releases capture', async ({
  page,
}) => {
  const snapshot = (await (await page.request.get('/api/state')).json()) as StateEvent;
  let events: WebSocketRoute | undefined;
  const config = {
    schemaVersion: 1,
    type: 'camera_config',
    source: 'browser',
    enabled: true,
    mode: { width: 640, height: 480, fps: 15 },
  };
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    events = route;
    route.send(JSON.stringify(snapshot));
    route.send(JSON.stringify(config));
  });
  let stream: WebSocketRoute | undefined;
  let frames = 0;
  let connections = 0;
  let lastSequence = 0;
  await page.routeWebSocket('**/camera-stream', (route) => {
    stream = route;
    connections++;
    route.send(JSON.stringify({ type: 'camera_ready' }));
    route.onMessage((data) => {
      expect(Buffer.isBuffer(data)).toBe(true);
      const frame = data as Buffer;
      expect(frame[0]).toBe(0x43);
      expect(frame.length).toBeLessThanOrEqual(250005);
      expect(frame[5]).toBe(255);
      expect(frame[6]).toBe(216);
      frames++;
      lastSequence = frame.readUInt32BE(1);
    });
  });
  await page.goto('/');
  await expect(page.getByText('Caméra de cet appareil', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /caméra/i })).toHaveCount(0);
  await expect.poll(() => frames).toBe(1);
  // Multiple capture ticks without an ACK must not send another image.
  await expect
    .poll(async () => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.5);
  expect(frames).toBe(1);
  stream!.send(JSON.stringify({ type: 'camera_ack', sequence: lastSequence }));
  await expect.poll(() => frames).toBe(2);
  stream!.close({ code: 1013 });
  await expect.poll(() => connections).toBe(2);
  await expect.poll(() => frames).toBe(3);
  events!.send(JSON.stringify({ ...config, enabled: false }));
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).srcObject === null))
    .toBe(true);
  events!.send(JSON.stringify(config));
  await expect.poll(() => frames).toBe(4);
  events!.send(JSON.stringify({ ...config, source: 'server', enabled: false }));
  await expect(page.locator('video')).toHaveCount(0);
});

for (const failure of ['insecure', 'denied'] as const) {
  test(`browser camera reports ${failure} capture failure to administration logs`, async ({
    page,
  }) => {
    const snapshot = (await (await page.request.get('/api/state')).json()) as StateEvent;
    await page.addInitScript((failure) => {
      if (failure === 'insecure')
        Object.defineProperty(window, 'isSecureContext', { value: false });
      else
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        };
    }, failure);
    await page.routeWebSocket('**/events?role=kiosk', (route) => {
      route.send(JSON.stringify(snapshot));
      route.send(
        JSON.stringify({
          schemaVersion: 1,
          type: 'camera_config',
          source: 'browser',
          enabled: true,
          mode: { width: 640, height: 480, fps: 30 },
        }),
      );
    });
    const diagnostic = page.waitForRequest(
      (request) =>
        request.url().endsWith('/api/client-logs') &&
        request
          .postDataJSON()
          .entries.some(
            (entry: { stage: string }) => entry.stage === 'caméra du navigateur du miroir',
          ),
    );
    await page.goto('/');
    const entries = (await diagnostic).postDataJSON().entries;
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'error',
          stage: 'caméra du navigateur du miroir',
          message: expect.stringContaining(
            failure === 'insecure' ? 'HTTPS' : 'Accès à la caméra refusé',
          ),
        }),
      ]),
    );
  });
}
