import { stripAccents } from '../../shared/text.js';
import type { CardContent } from '../../shared/types.js';

/**
 * Mots et nombres significatifs d’une carte, sans accents ni pluriel simple : de quoi
 * reconnaître une carte Luna qui répète la carte spécialisée d’un module (« Mes bus » puis
 * « Prochains bus 72 »), sans comprendre le texte.
 */
export function cardTokens(content: CardContent): Set<string> {
  const text = [
    content.title,
    content.primaryValue,
    content.subtitle,
    content.description,
    ...content.items.flatMap((item) => [item.label, item.value]),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const tokens = new Set<string>();
  for (const raw of stripAccents(text)
    .toLocaleLowerCase('fr')
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || (raw.length < 3 && !/\p{N}/u.test(raw))) continue;
    tokens.add(raw.length > 3 && /[sx]$/u.test(raw) ? raw.slice(0, -1) : raw);
  }
  return tokens;
}

/** Part des mots de la carte candidate déjà présents dans les cartes de référence. */
export function cardOverlap(candidate: Set<string>, reference: Set<string>): number {
  if (candidate.size === 0) return 0;
  let shared = 0;
  for (const token of candidate) if (reference.has(token)) shared++;
  return shared / candidate.size;
}

/** Au-delà, la carte Luna redit la carte du module au lieu d’apporter une autre information. */
export const DUPLICATE_CARD_OVERLAP = 0.6;
