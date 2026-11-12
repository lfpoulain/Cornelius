import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { loadAddons } from '../server/addons/registry.js';
import { CoreUpdater } from '../server/core-update.js';
import {
  normalizeRepositoryUrl,
  parseRefAdvertisement,
  type Fetch,
} from '../server/module-store/git-remote.js';
import { readCatalog } from '../server/module-store/catalog.js';
import { ModuleStore, officialRepositoryUrl } from '../server/module-store/store.js';
import { extractTarGz, readTarGz, TarError } from '../server/module-store/tar.js';

/** Archive tar.gz minimale, comme celles des forges : un dossier racine autour du dépôt. */
function tarGz(files: Record<string, string>, root = 'depot-abc'): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, flag: string) => {
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, 'utf8');
    block.write('0000644\0', 100);
    block.write('0000000\0', 108);
    block.write('0000000\0', 116);
    block.write(size.toString(8).padStart(11, '0') + '\0', 124);
    block.write('00000000000\0', 136);
    block.write('        ', 148);
    block.write(flag, 156);
    block.write('ustar\0', 257);
    block.write('00', 263);
    let sum = 0;
    for (const byte of block) sum += byte;
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return block;
  };
  blocks.push(header(`${root}/`, 0, '5'));
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    blocks.push(header(`${root}/${path}`, data.length, '0'));
    blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function pkt(line: string): string {
  return (line.length + 4).toString(16).padStart(4, '0') + line;
}

function advertisement(branches: Record<string, string>, head = 'main'): string {
  const lines = [pkt('# service=git-upload-pack\n'), '0000'];
  const entries = Object.entries(branches);
  lines.push(pkt(`${branches[head]} HEAD\0multi_ack symref=HEAD:refs/heads/${head} agent=git/2\n`));
  for (const [name, sha] of entries) lines.push(pkt(`${sha} refs/heads/${name}\n`));
  lines.push('0000');
  return lines.join('');
}

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);
const clockSource = readFileSync(
  resolve(import.meta.dirname, '..', 'addons', 'clock', 'index.ts'),
  'utf8',
);

/** Module Heure renommé : un vrai module, importable, dans une archive de dépôt. */
function moduleFiles(id: string, version: string, extra: Record<string, string> = {}) {
  const source = clockSource
    .replace("id: 'clock'", `id: '${id}'`)
    .replace(/^ {2}version: '[^']+'/mu, `  version: '${version}'`);
  const files: Record<string, string> = {
    [`${id}/index.ts`]: source,
    [`${id}/README.md`]: `# Module Horloge ${id}\n\nDonne l’heure d’un fuseau. Seconde phrase.\n`,
    'docs/guide.md': '# Guide\n',
    ...extra,
  };
  for (const name of ['config.schema.json', 'data.schema.json']) {
    const path = resolve(import.meta.dirname, '..', 'addons', 'clock', name);
    if (existsSync(path)) files[`${id}/${name}`] = readFileSync(path, 'utf8');
  }
  return files;
}

/** Forge factice : branches et archives par commit. */
function forge(
  repos: Record<string, { branches: Record<string, string>; archives: Record<string, Buffer> }>,
) {
  const calls: string[] = [];
  const fetcher: Fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    for (const [base, repo] of Object.entries(repos)) {
      if (url === `${base}.git/info/refs?service=git-upload-pack`)
        return new Response(advertisement(repo.branches));
      for (const [sha, archive] of Object.entries(repo.archives))
        if (url === `${base}/archive/${sha}.tar.gz`) return new Response(new Uint8Array(archive));
    }
    return new Response('introuvable', { status: 404 });
  };
  return { fetcher, calls };
}

function temporary(t: { after: (fn: () => void) => void }): string {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('les adresses de dépôt sont normalisées, https seulement', () => {
  assert.equal(
    normalizeRepositoryUrl('https://GitHub.com/nom/depot.git/'),
    'https://github.com/nom/depot',
  );
  assert.equal(normalizeRepositoryUrl('http://github.com/nom/depot'), null);
  assert.equal(normalizeRepositoryUrl('https://github.com/nom'), null);
  assert.equal(normalizeRepositoryUrl('https://jeton@github.com/nom/depot'), null);
  assert.equal(normalizeRepositoryUrl('git@github.com:nom/depot.git'), null);
});

test('la liste des branches se lit dans la réponse smart HTTP', () => {
  const refs = parseRefAdvertisement(advertisement({ main: shaA, beta: shaB }));
  assert.equal(refs.defaultBranch, 'main');
  assert.equal(refs.branches.get('beta'), shaB);
});

test('sans `display`, le catalogue prend le titre et la première phrase du README', (t) => {
  const target = temporary(t);
  extractTarGz(
    tarGz({
      'meteo/index.ts': "export default {\n  version: '2.1.0',\n  minCoreVersion: '0.2.0',\n};\n",
      'meteo/README.md': '# Module Météo locale\n\nLes [prévisions](https://x) du jour. Suite.\n',
      '_lib/outil.ts': 'export {};',
    }),
    target,
  );
  assert.deepEqual(readCatalog(target), [
    {
      id: 'meteo',
      name: 'Météo locale',
      description: 'Les prévisions du jour.',
      version: '2.1.0',
      minCoreVersion: '0.2.0',
      icon: null,
    },
  ]);
});

test('l’archive est extraite sans son dossier racine, et jamais hors de la cible', (t) => {
  const target = temporary(t);
  extractTarGz(tarGz({ 'a/index.ts': 'x', 'README.md': '# R' }), target);
  assert.equal(readFileSync(join(target, 'a', 'index.ts'), 'utf8'), 'x');
  assert.throws(() => readTarGz(tarGz({ '../evil.ts': 'x' })), TarError);
  assert.throws(() => readTarGz(Buffer.from('pas une archive')), TarError);
  assert.throws(
    () => readTarGz(tarGz({ 'a.txt': '1', 'b.txt': '2' }), { maxBytes: 1e6, maxFiles: 1 }),
    /trop de fichiers/u,
  );
});

test('un dépôt s’ajoute, son catalogue se lit sans exécuter de code, un module s’installe', async (t) => {
  const directory = temporary(t);
  const url = 'https://forge.example/nom/mes-modules';
  const { fetcher } = forge({
    [url]: {
      branches: { main: shaA },
      archives: { [shaA]: tarGz(moduleFiles('horloge', '1.0.0')) },
    },
  });
  const store = new ModuleStore({
    directory,
    coreVersion: '9.0.0',
    reservedIds: () => new Set(['clock']),
    fetch: fetcher,
  });
  const id = await store.addRepository({ url: url + '.git' });
  const view = store.view();
  assert.ok(view.repositories.some((repository) => repository.url === officialRepositoryUrl));
  const repository = view.repositories.find((item) => item.id === id)!;
  assert.equal(repository.commit, shaA);
  assert.deepEqual(
    repository.modules.map((module) => [module.id, module.version, module.installed]),
    [['horloge', '1.0.0', false]],
  );
  // Nom et description déclarés dans `display`, lus dans le texte du fichier.
  assert.equal(repository.modules[0]!.name, 'Heure');
  assert.equal(
    repository.modules[0]!.description,
    'Heure locale et date, avec le fuseau horaire de votre choix.',
  );
  assert.equal(repository.modules[0]!.icon, 'clock');
  await assert.rejects(store.addRepository({ url }), /déjà dans la liste/u);

  await store.install(id, 'horloge');
  assert.equal(store.view().pendingRestart, true);
  const plan = store.plan();
  assert.equal(plan.length, 1);
  // Le module installé se charge bien, comme au démarrage.
  const report = await loadAddons({ externalRoot: null, managed: plan });
  assert.deepEqual(report.rejected, []);
  assert.ok(report.addons.some((addon) => addon.id === 'horloge'));
  assert.equal(report.origins.get('horloge'), 'repository');

  // L'état survit à un redémarrage.
  const reopened = new ModuleStore({
    directory,
    coreVersion: '9.0.0',
    reservedIds: () => new Set(),
    fetch: fetcher,
  });
  assert.deepEqual(reopened.plan(), plan);
  assert.equal(reopened.view().pendingRestart, false);
});

test('un module livré, incompatible ou déjà installé ailleurs ne s’installe pas', async (t) => {
  const directory = temporary(t);
  const one = 'https://forge.example/a/modules';
  const two = 'https://forge.example/b/modules';
  const futureFiles = moduleFiles('futur', '1.0.0');
  futureFiles['futur/index.ts'] = futureFiles['futur/index.ts']!.replace(
    /^ {2}version: '1\.0\.0',$/mu,
    "  version: '1.0.0',\n  minCoreVersion: '99.0.0',",
  );
  const { fetcher } = forge({
    [one]: {
      branches: { main: shaA },
      archives: {
        [shaA]: tarGz({
          ...moduleFiles('clock', '1.0.0'),
          ...moduleFiles('meteo2', '1.0.0'),
          ...futureFiles,
        }),
      },
    },
    [two]: {
      branches: { main: shaB },
      archives: { [shaB]: tarGz(moduleFiles('meteo2', '2.0.0')) },
    },
  });
  const store = new ModuleStore({
    directory,
    coreVersion: '1.0.0',
    reservedIds: () => new Set(['clock']),
    fetch: fetcher,
  });
  const a = await store.addRepository({ url: one });
  const b = await store.addRepository({ url: two });
  await assert.rejects(store.install(a, 'clock'), /livré avec Cornelius/u);
  await assert.rejects(store.install(a, 'futur'), /Cornelius 99\.0\.0/u);
  await store.install(a, 'meteo2');
  await assert.rejects(store.install(b, 'meteo2'), /autre dépôt/u);
  // Retirer le dépôt désinstalle ses modules.
  await store.removeRepository(a);
  assert.deepEqual(store.plan(), []);
  await assert.rejects(store.removeRepository(store.view().repositories[0]!.id), /officiel/u);
});

test('une mise à jour se télécharge, puis s’applique au redémarrage', async (t) => {
  const directory = temporary(t);
  const url = 'https://forge.example/nom/modules';
  const repos = {
    [url]: {
      branches: { main: shaA } as Record<string, string>,
      archives: {
        [shaA]: tarGz(moduleFiles('horloge', '1.0.0')),
        [shaB]: tarGz({ ...moduleFiles('horloge', '1.1.0'), ...moduleFiles('nouveau', '1.0.0') }),
      },
    },
  };
  const { fetcher } = forge(repos);
  const store = new ModuleStore({
    directory,
    coreVersion: '9.0.0',
    reservedIds: () => new Set(),
    fetch: fetcher,
  });
  const id = await store.addRepository({ url });
  await store.install(id, 'horloge');
  store.setLoaded({
    loaded: new Map([['horloge', { version: '1.0.0', origin: 'repository' }]]),
    rejected: [],
    local: [],
    localDirectory: null,
  });
  assert.equal(store.view().pendingRestart, false);

  repos[url].branches.main = shaB;
  await store.check(id);
  let repository = store.view().repositories.find((item) => item.id === id)!;
  assert.deepEqual(repository.update, { commit: shaB, changed: 1, added: 1 });
  assert.equal(repository.modules[0]!.nextVersion, '1.1.0');
  // Rien ne change avant « Mettre à jour ».
  assert.equal(repository.commit, shaA);

  await store.update(id);
  repository = store.view().repositories.find((item) => item.id === id)!;
  assert.equal(repository.commit, shaB);
  assert.equal(repository.modules.find((m) => m.id === 'horloge')!.loadedVersion, '1.0.0');
  assert.equal(store.view().pendingRestart, true);
  assert.ok(store.plan()[0]!.directory.includes(shaB));
});

test('un dépôt injoignable est signalé sans casser le catalogue', async (t) => {
  const directory = temporary(t);
  const store = new ModuleStore({
    directory,
    coreVersion: '9.0.0',
    reservedIds: () => new Set(),
    fetch: async () => new Response('', { status: 404 }),
  });
  await assert.rejects(
    store.addRepository({ url: 'https://forge.example/x/y' }),
    /introuvable ou privé/u,
  );
  const official = store.view().repositories[0]!;
  await store.check(official.id);
  assert.match(store.view().repositories[0]!.error ?? '', /introuvable ou privé/u);
});

/** Faux git : réponses par commande, pour suivre les décisions du programme de mise à jour. */
function fakeGit(answers: Record<string, string | Error>) {
  return async (args: string[]) => {
    const key = args.join(' ');
    for (const [pattern, answer] of Object.entries(answers))
      if (key.startsWith(pattern)) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
    return '';
  };
}

test('Cornelius sur main propose la dernière version publiée, en avance rapide', async () => {
  const launched: string[] = [];
  const updater = new CoreUpdater({
    root: tmpdir(),
    version: '0.3.0',
    externallyManaged: false,
    systemd: false,
    git: fakeGit({
      'rev-parse HEAD': shaA,
      'symbolic-ref': 'main',
      'status --porcelain': '',
      'for-each-ref': 'v0.4.0',
      'rev-parse v0.4.0^{commit}': shaB,
      [`merge-base --is-ancestor ${shaB} ${shaA}`]: new Error('non'),
      [`merge-base --is-ancestor ${shaA} ${shaB}`]: '',
      'rev-list --count': '3',
      'log --format': `${shaB}\tAlarmes\n${'c'.repeat(40)}\tCorrectifs`,
      show: '{ "version": "0.4.0" }',
    }),
    launch: (target) => launched.push(target),
  });
  const view = await updater.check();
  assert.equal(view.channel, 'stable');
  assert.equal(view.error, null);
  assert.deepEqual(
    { ref: view.target?.ref, version: view.target?.version, count: view.target?.count },
    { ref: 'v0.4.0', version: '0.4.0', count: 3 },
  );
  assert.equal(view.target?.commits[0]?.subject, 'Alarmes');
  await assert.rejects(updater.start(shaA), /plus récente/u);
  await updater.start(shaB);
  assert.deepEqual(launched, [shaB]);
  assert.equal(updater.status().running, true);
});

test('des fichiers modifiés ou une branche sans suivi bloquent la mise à jour', async () => {
  const dirty = new CoreUpdater({
    root: tmpdir(),
    version: '0.3.0',
    externallyManaged: false,
    systemd: false,
    git: fakeGit({
      'rev-parse HEAD': shaA,
      'symbolic-ref': 'beta',
      'status --porcelain': ' M server/app.ts',
      'rev-parse --abbrev-ref': 'origin/beta',
      'rev-parse origin/beta^{commit}': shaB,
      [`merge-base --is-ancestor ${shaB} ${shaA}`]: new Error('non'),
      'rev-list --count': '1',
      'log --format': `${shaB}\tSuite`,
    }),
    launch: () => assert.fail('ne doit pas lancer'),
  });
  const view = await dirty.check();
  assert.equal(view.channel, 'branch');
  assert.equal(view.dirty, true);
  await assert.rejects(dirty.start(shaB), /modifiés à la main/u);

  const managed = new CoreUpdater({
    root: tmpdir(),
    version: '0.3.0',
    externallyManaged: true,
    systemd: false,
  });
  assert.equal(managed.status().supported, false);
  assert.match(managed.status().reason ?? '', /Home Assistant/u);
});
