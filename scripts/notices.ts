// Met à jour, dans THIRD_PARTY_NOTICES.md, la liste des bibliothèques npm installées par npm ci
// (package-lock.json) et leur licence, lue dans package-lock.json seul pour être la même partout.
// Usage : npm run notices (après un changement de dépendances). --check échoue si la liste est périmée.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const file = join(root, 'THIRD_PARTY_NOTICES.md');
const start = '<!-- npm:début -->';
const end = '<!-- npm:fin -->';

interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
}

/**
 * Texte en fins de ligne LF : sous Windows, Git peut extraire le fichier en CRLF, alors que la
 * liste est produite en LF. Sans cela, une liste à jour paraît périmée.
 */
export function unixLines(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

export function npmNotices(): string {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockPackage>;
  };
  const rows = new Map<string, string>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const key = `${name}@${entry.version}`;
    if (rows.has(key)) continue;
    rows.set(
      key,
      `| ${name} | ${entry.version ?? ''} | ${entry.license ?? 'voir le paquet'} | ${entry.dev ? 'outil' : 'exécution'} |`,
    );
  }
  return [
    start,
    '| Paquet | Version | Licence | Rôle |',
    '| --- | --- | --- | --- |',
    ...[...rows.keys()].sort().map((key) => rows.get(key)!),
    end,
  ].join('\n');
}

function updated(text: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error(`Marqueurs ${start} et ${end} introuvables.`);
  return text.slice(0, from) + npmNotices() + text.slice(to + end.length);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const raw = readFileSync(file, 'utf8');
  const current = unixLines(raw);
  const next = updated(current);
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('THIRD_PARTY_NOTICES.md est périmé : lancez npm run notices.');
      process.exit(1);
    }
  } else {
    // Le fichier garde ses fins de ligne d’origine.
    writeFileSync(file, raw.includes('\r\n') ? next.replaceAll('\n', '\r\n') : next);
    console.info('THIRD_PARTY_NOTICES.md mis à jour.');
  }
}
