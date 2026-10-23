import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { createServer } from 'node:https';
import { dirname, join } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { announceSatellites } from './discovery.js';
import {
  allowedHostname,
  ensureCertificate,
  localAddresses,
  tlsWithHttpRedirect,
} from './network.js';

/** Écoute un port ; après un redémarrage, attend que l’ancienne instance l’ait libéré. */
async function listenWithRetry(listen: () => Promise<unknown>) {
  const retries = process.env.CORNELIUS_RESTARTED === '1' ? 20 : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await listen();
    } catch (error) {
      if ((error as { code?: string }).code !== 'EADDRINUSE' || attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

try {
  const config = loadConfig();
  // Réseau local : HTTPS obligatoire, sans quoi les navigateurs refusent le micro (et le mot
  // de passe administrateur passerait en clair).
  const certificate = config.lan
    ? await ensureCertificate({
        directory: join(
          config.databasePath === ':memory:' ? 'data' : dirname(config.databasePath),
          'tls',
        ),
        certPath: config.tlsCert,
        keyPath: config.tlsKey,
      })
    : null;
  if (certificate) {
    config.tlsFingerprint = certificate.fingerprint;
    config.tlsKeyFingerprint = certificate.keyFingerprint;
  }
  let lanServer: ReturnType<typeof createServer> | null = null;
  let lanPort: ReturnType<typeof tlsWithHttpRedirect> | null = null;
  let unannounce: (() => Promise<void>) | null = null;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await unannounce?.().catch(() => {});
    lanPort?.close();
    lanServer?.close();
    lanServer?.closeAllConnections();
    // Une connexion qui traîne ne bloque pas l’arrêt plus de quelques secondes.
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 4000))]);
  };
  /**
   * Redémarrage demandé par l’administration. Sous systemd (Restart=always), il suffit de
   * quitter. Sinon, une nouvelle instance est lancée avec les mêmes arguments, journaux dans
   * data/run/logs comme avec les scripts, puis celle-ci s’arrête ; la nouvelle relit .env.
   */
  const restart = async () => {
    await stop();
    if (!process.env.INVOCATION_ID) {
      const logs = join('data', 'run', 'logs');
      const output = (name: string) =>
        existsSync(logs) ? openSync(join(logs, `backend.${name}.log`), 'a') : 'ignore';
      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        stdio: ['ignore', output('out'), output('err')],
        env: { ...process.env, CORNELIUS_RESTARTED: '1' },
      });
      child.unref();
    }
    process.exit(0);
  };
  const { app } = await createApp(config, { restart: () => void restart() });
  // HTTP sur la seule boucle locale : le navigateur de la machine, la perception et le
  // générateur d'images.
  await listenWithRetry(() => app.listen({ host: '127.0.0.1', port: config.port }));
  console.info(`Cornelius · http://127.0.0.1:${config.port}`);
  if (certificate) {
    const server = createServer({ key: certificate.key, cert: certificate.cert }, (req, res) =>
      app.routing(req, res),
    );
    lanServer = server;
    // Les WebSocket du miroir et de l'administration passent par le même routage.
    server.on('upgrade', (req, socket, head) => app.server.emit('upgrade', req, socket, head));
    // Le même port répond en HTTP par une redirection : taper l'adresse sans « s » suffit.
    const front = tlsWithHttpRedirect(server, (host) =>
      allowedHostname(host, true, config.allowedHosts ?? []),
    );
    lanPort = front;
    await listenWithRetry(
      () =>
        new Promise<void>((resolve, reject) => {
          front.once('error', reject);
          front.listen(config.httpsPort, '0.0.0.0', () => {
            front.off('error', reject);
            resolve();
          });
        }),
    );
    for (const address of localAddresses())
      console.info(`Réseau local · https://${address}:${config.httpsPort}`);
    console.info(`Empreinte du certificat · ${certificate.fingerprint}`);
    if (config.mdns !== false) {
      unannounce = announceSatellites({
        port: config.httpsPort ?? 3443,
        keyFingerprint: certificate.keyFingerprint,
        onError: (error) =>
          console.warn('Annonce mDNS des satellites impossible :', (error as Error)?.message),
      });
      console.info('Satellites · annonce mDNS _cornelius._tcp');
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Démarrage impossible.');
  process.exitCode = 1;
}
