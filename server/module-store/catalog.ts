import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Catalogue d'un dépôt de modules, lu sans exécuter son code : installer un dépôt tiers ne
 * doit rien lancer tant que la personne n'a pas choisi un module. Un module est un dossier
 * `<id>/index.ts` ; son nom et sa description viennent du titre et du premier paragraphe
 * de son README, sa version et sa version minimale de Cornelius de son index.ts.
 */

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string | null;
  minCoreVersion: string | null;
  icon: string | null;
}

export const moduleIdPattern = /^[a-z][a-z0-9_]{0,31}$/u;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

/** Texte lisible d'une ligne Markdown : liens, code et emphase retirés. */
function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_]/gu, '');
}

function readme(directory: string): { title: string | null; summary: string | null } {
  const file = join(directory, 'README.md');
  if (!existsSync(file)) return { title: null, summary: null };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  const heading = lines.findIndex((line) => /^#\s+/u.test(line));
  const title =
    heading >= 0
      ? plain(lines[heading]!.replace(/^#\s+/u, ''))
          .replace(/^Module\s+/iu, '')
          .trim()
      : null;
  const paragraph: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (/^\s*$/u.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^(#|>|\||```|- |\* |<)/u.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }
  const text = plain(paragraph.join(' '));
  // Première phrase : la carte du catalogue reste courte.
  const sentence = /^.+?[.!?](?=\s|$)/u.exec(text)?.[0] ?? text;
  return { title: title || null, summary: sentence ? clip(sentence, 160) : null };
}

/** Valeur littérale d'un champ écrit en début de ligne (`  version: '1.2.0',`). */
function declared(source: string, field: string, max = 40): string | null {
  const match = new RegExp(
    `^\\s*${field}\\s*:\\s*(['"\`])([^\\n]{1,${max}}?)\\1\\s*,?\\s*$`,
    'mu',
  ).exec(source);
  return match?.[2] ?? null;
}

export function readCatalog(root: string): CatalogEntry[] {
  let names: string[] = [];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const entries: CatalogEntry[] = [];
  for (const id of names) {
    if (!moduleIdPattern.test(id)) continue;
    const directory = join(root, id);
    const index = join(directory, 'index.ts');
    try {
      if (!statSync(directory).isDirectory() || !existsSync(index)) continue;
    } catch {
      continue;
    }
    const source = readFileSync(index, 'utf8');
    const { title, summary } = readme(directory);
    // `display: { name: … }` en premier choix, sinon le titre du README, sinon l'identifiant.
    const displayBlock = /\bdisplay\s*:\s*\{([\s\S]{0,800}?)\}/u.exec(source)?.[1] ?? '';
    const version = declared(source, 'version');
    const minCoreVersion = declared(source, 'minCoreVersion');
    entries.push({
      id,
      name: clip(declared(displayBlock, 'name') ?? title ?? id, 40),
      description: clip(
        declared(displayBlock, 'description', 200) ?? summary ?? 'Module sans description.',
        160,
      ),
      version: version && /^\d+\.\d+\.\d+/u.test(version) ? version : null,
      minCoreVersion:
        minCoreVersion && /^\d+\.\d+\.\d+$/u.test(minCoreVersion) ? minCoreVersion : null,
      icon: declared(displayBlock, 'icon'),
    });
  }
  return entries;
}
