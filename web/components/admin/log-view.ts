import type { LogEntry, LogLevel } from '../../../shared/logs';

/** Niveau lisible d’une entrée du journal. */
export const levelLabels: Record<LogLevel, string> = {
  info: 'Info',
  warn: 'Attention',
  error: 'Erreur',
};

const sourceLabels: Record<string, string> = {
  local: 'Serveur',
  session: 'Conversation',
  openai: 'OpenAI',
  navigateur: 'Navigateur',
  http: 'Requêtes au serveur',
  perception: 'Périphériques',
  addon: 'Modules',
  player: 'Lecteur audio',
  action: 'Commandes',
  'home-assistant': 'Home Assistant',
  image: 'Images',
  memory: 'Mémoire',
  mesure: 'Mesures',
};

/** Origine lisible d’une entrée ; une origine inconnue garde son nom, avec une majuscule. */
export function sourceLabel(source: string): string {
  return sourceLabels[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/** Toutes les origines, sauf les requêtes au serveur qui ont abouti. */
export const ALL_SOURCES = 'all';

export interface LogFilter {
  /** ALL_SOURCES ou une origine précise. */
  source: string;
  /** Attention et erreurs seulement. */
  problemsOnly: boolean;
  search: string;
}

/**
 * Une requête au serveur qui a abouti n’apprend rien et noie le reste : masquée de la vue
 * « toutes les origines ». Une requête en échec (adresse introuvable, refus, erreur) reste.
 */
export function routineRequest(entry: LogEntry): boolean {
  return entry.source === 'http' && entry.level === 'info';
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Résumé d’une ligne tiré des détails : le nom et le message d’une erreur, l’étape
 * concernée, ou la requête et son statut. Vide quand les détails n’ont rien de tel.
 */
export function logSummary(entry: LogEntry): string {
  const details = entry.details;
  if (entry.source === 'http')
    return [
      [text(details.method), text(details.url) || text(details.route)].filter(Boolean).join(' '),
      text(details.status),
    ]
      .filter(Boolean)
      .join(' · ');
  const error =
    details.error && typeof details.error === 'object'
      ? (details.error as Record<string, unknown>)
      : null;
  const name = text(details.name) || text(error?.name);
  const message = text(details.message) || text(error?.message) || text(details.reason);
  return [text(details.stage), [name, message].filter(Boolean).join(' : ')]
    .filter(Boolean)
    .join(' · ');
}

/** Entrées visibles, de la plus récente à la plus ancienne. */
export function filterLog(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  const needle = filter.search.trim().toLocaleLowerCase('fr-FR');
  return entries
    .filter(
      (entry) =>
        (filter.source === ALL_SOURCES ? !routineRequest(entry) : entry.source === filter.source) &&
        (!filter.problemsOnly || entry.level !== 'info') &&
        (!needle ||
          [JSON.stringify(entry), levelLabels[entry.level], sourceLabel(entry.source)]
            .join(' ')
            .toLocaleLowerCase('fr-FR')
            .includes(needle)),
    )
    .reverse();
}

/** Origines présentes dans le journal, dans l’ordre alphabétique de leur libellé. */
export function logSources(entries: readonly LogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.source))].sort((a, b) =>
    sourceLabel(a).localeCompare(sourceLabel(b), 'fr'),
  );
}
