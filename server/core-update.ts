import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DiagnosticLog } from './logs.js';
import type { CoreUpdateView } from '../shared/module-store.js';

/**
 * Mise à jour de Cornelius lui-même, pour une installation faite par `git clone`.
 *
 * - Sur `main` (ou un commit détaché), Cornelius suit les versions publiées : le dernier tag
 *   `vX.Y.Z`. Sur une autre branche (`beta`), il suit la branche distante.
 * - Seule une avance rapide est proposée : des modifications locales ou un historique
 *   divergent bloquent la mise à jour, qui ne doit jamais rien écraser.
 * - L'application se fait hors du serveur, par scripts/update.sh ou update.ps1 : ils arrêtent
 *   Cornelius, avancent le dépôt, réinstallent les dépendances si besoin, recompilent et
 *   relancent. En cas d'échec, le dépôt revient au commit de départ.
 *
 * Sous Home Assistant (CORNELIUS_SUPERVISED), c'est le Supervisor qui met à jour l'image.
 */

const run = promisify(execFile);
const shaPattern = /^[0-9a-f]{40}$/u;

export interface CoreUpdaterOptions {
  root: string;
  version: string;
  /** Mises à jour gérées par une autre installation (application Home Assistant). */
  externallyManaged: boolean;
  /** Lancé par systemd (INVOCATION_ID) : le script part dans sa propre unité. */
  systemd: boolean;
  logs?: DiagnosticLog;
  now?: () => number;
  /** Remplaçable dans les tests. */
  git?: (args: string[]) => Promise<string>;
  launch?: (target: string) => void;
}

export class CoreUpdater {
  private view: CoreUpdateView;
  private checking: Promise<void> | null = null;

  constructor(private readonly options: CoreUpdaterOptions) {
    this.view = {
      supported: false,
      reason: null,
      version: options.version,
      commit: null,
      branch: null,
      channel: null,
      dirty: false,
      checking: false,
      checkedAt: null,
      error: null,
      target: null,
      running: false,
      lastRun: this.readLastRun(),
    };
    if (options.externallyManaged)
      this.view.reason = 'Cornelius est mis à jour par Home Assistant, avec son application.';
    else if (!options.git && !existsSync(join(options.root, '.git')))
      this.view.reason =
        'Installation sans git : téléchargez la nouvelle version ou réinstallez avec git clone.';
    else this.view.supported = true;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async git(args: string[]): Promise<string> {
    if (this.options.git) return this.options.git(args);
    const { stdout } = await run('git', args, {
      cwd: this.options.root,
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    return stdout.trim();
  }

  private resultFile(): string {
    return join(this.options.root, 'data', 'run', 'update-result.json');
  }

  private readLastRun(): CoreUpdateView['lastRun'] {
    try {
      const parsed = JSON.parse(readFileSync(this.resultFile(), 'utf8').replace(/^﻿/u, ''));
      if (typeof parsed?.ok !== 'boolean' || typeof parsed?.message !== 'string') return null;
      return {
        ok: parsed.ok,
        message: parsed.message.slice(0, 300),
        at: Number(parsed.at) * (Number(parsed.at) < 1e12 ? 1000 : 1) || 0,
        from: typeof parsed.from === 'string' ? parsed.from : undefined,
        to: typeof parsed.to === 'string' ? parsed.to : undefined,
      };
    } catch {
      return null;
    }
  }

  status(): CoreUpdateView {
    return { ...this.view, checking: this.checking !== null };
  }

  /** Lit l'état local, puis interroge le dépôt distant (`git fetch`). */
  async check(): Promise<CoreUpdateView> {
    if (!this.view.supported) return this.status();
    this.checking ??= this.refresh().finally(() => {
      this.checking = null;
    });
    await this.checking;
    return this.status();
  }

  private async refresh(): Promise<void> {
    try {
      const commit = await this.git(['rev-parse', 'HEAD']);
      const branch = await this.git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '');
      const dirty = (await this.git(['status', '--porcelain', '--untracked-files=no'])).length > 0;
      Object.assign(this.view, { commit, branch: branch || null, dirty });
      await this.git(['fetch', '--quiet', '--tags', '--force', 'origin']);
      let ref: string;
      if (!branch || branch === 'main') {
        this.view.channel = 'stable';
        const tag = (
          await this.git([
            'for-each-ref',
            '--sort=-v:refname',
            '--count=1',
            '--format=%(refname:short)',
            'refs/tags/v*',
          ])
        ).trim();
        if (!tag) throw new Error('Aucune version publiée (tag vX.Y.Z) dans le dépôt.');
        ref = tag;
      } else {
        this.view.channel = 'branch';
        ref = await this.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(
          () => {
            throw new Error(`La branche « ${branch} » ne suit aucune branche distante.`);
          },
        );
      }
      const target = await this.git(['rev-parse', `${ref}^{commit}`]);
      const ancestor = async (a: string, b: string) =>
        this.git(['merge-base', '--is-ancestor', a, b]).then(
          () => true,
          () => false,
        );
      if (target === commit || (await ancestor(target, commit))) {
        this.view.target = null;
      } else if (await ancestor(commit, target)) {
        const count = Number(await this.git(['rev-list', '--count', `${commit}..${target}`]));
        const log = await this.git([
          'log',
          '--format=%H%x09%s',
          '-n',
          '15',
          `${commit}..${target}`,
        ]);
        let version: string | null = null;
        try {
          version = JSON.parse(await this.git(['show', `${target}:package.json`])).version ?? null;
        } catch {
          version = null;
        }
        this.view.target = {
          ref,
          commit: target,
          version,
          count,
          commits: log
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [sha = '', ...subject] = line.split('\t');
              return { sha, subject: subject.join('\t') };
            }),
        };
      } else {
        this.view.target = null;
        throw new Error(
          `L’historique local a divergé de ${ref} : mettez à jour à la main (git pull).`,
        );
      }
      this.view.error = null;
    } catch (error) {
      const message =
        (error as { stderr?: string; message?: string }).stderr?.trim() ||
        (error as Error).message ||
        'Vérification impossible.';
      this.view.error = /could not resolve host|unable to access|Could not read from remote/iu.test(
        message,
      )
        ? 'Dépôt de Cornelius injoignable : vérifiez la connexion.'
        : message.split('\n')[0]!.slice(0, 300);
    }
    this.view.checkedAt = this.now();
  }

  /** Lance la mise à jour vers le commit vérifié ; le serveur s'arrêtera pendant l'opération. */
  async start(expected: string): Promise<void> {
    if (!this.view.supported) throw new Error(this.view.reason ?? 'Mise à jour indisponible.');
    if (this.view.running) throw new Error('Mise à jour déjà en cours.');
    await this.check();
    const target = this.view.target;
    if (this.view.error) throw new Error(this.view.error);
    if (!target || !shaPattern.test(target.commit)) throw new Error('Cornelius est déjà à jour.');
    if (target.commit !== expected)
      throw new Error('Une version plus récente est apparue : relisez-la avant de mettre à jour.');
    if (this.view.dirty)
      throw new Error(
        'Des fichiers de Cornelius ont été modifiés à la main : la mise à jour les écraserait.',
      );
    this.view.running = true;
    this.options.logs?.write('info', 'local', 'Mise à jour de Cornelius lancée', {
      from: this.view.commit,
      to: target.commit,
      version: target.version,
    });
    (this.options.launch ?? ((commit) => this.launch(commit)))(target.commit);
  }

  /** Script détaché : il survit à l'arrêt du serveur qu'il provoque. */
  private launch(target: string): void {
    const root = resolve(this.options.root);
    const logs = join(root, 'data', 'run', 'logs');
    mkdirSync(logs, { recursive: true });
    const output = openSync(join(logs, 'update.log'), 'a');
    if (process.platform === 'win32') {
      // Start-Process détache le script de l'arbre du serveur, que stop.ps1 arrête en entier.
      const script = join(root, 'scripts', 'update.ps1').replace(/'/gu, "''");
      spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${script}"','-Target','${target}','-FromServer'`,
        ],
        { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' },
      )
        .on('error', (error) => this.failed(error))
        .unref();
      return;
    }
    const script = join(root, 'scripts', 'update.sh');
    const args = ['--target', target, '--from-server'];
    // Sous systemd, arrêter cornelius.service tuerait aussi le script lancé depuis son groupe.
    const [command, commandArgs] = this.options.systemd
      ? [
          'systemd-run',
          ['--user', '--collect', '--quiet', `--working-directory=${root}`, script, ...args],
        ]
      : [script, args];
    spawn(command, commandArgs as string[], {
      cwd: root,
      detached: true,
      stdio: ['ignore', output, output],
    })
      .on('error', (error) => this.failed(error))
      .unref();
  }

  private failed(error: Error): void {
    this.view.running = false;
    this.view.error = `Lancement de la mise à jour impossible : ${error.message}`;
    this.options.logs?.write('error', 'local', 'Mise à jour de Cornelius non lancée', { error });
  }
}
