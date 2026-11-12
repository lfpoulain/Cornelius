import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { LogEntry, LogLevel } from '../../../shared/logs';
import { request, errorMessage } from '../../api';
import { plural } from './format';
import { Pause, Play, Download } from 'lucide-react';
import {
  ALL_SOURCES,
  filterLog,
  levelLabels,
  logSources,
  logSummary,
  routineRequest,
  sourceLabel,
} from './log-view';
import { Fold, SearchInput } from './shared';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

interface Snapshot {
  entries: LogEntry[];
  diskAvailable: boolean;
  /** Heure de la dernière lecture réussie. */
  at: number;
}

// Dernière lecture, gardée d’une visite de la rubrique à l’autre : le journal s’affiche
// aussitôt au retour, puis s’actualise.
let lastSnapshot: Snapshot | null = null;

const levelBadges: Record<LogLevel, string> = {
  info: 'text-muted-foreground',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const timeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });

/**
 * Journal détaillé. Hors connexion, il reste lisible : les dernières entrées restent
 * affichées, les détails se déplient et l’export (un lien) fonctionne toujours.
 */
export function Logs() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(lastSnapshot);
  const [error, setError] = useState('');
  const [source, setSource] = useState(ALL_SOURCES);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      // Onglet masqué : inutile d’interroger le serveur toutes les 2 secondes.
      if (document.hidden) {
        timer = setTimeout(refresh, 2000);
        return;
      }
      try {
        const result = await request<{ entries: LogEntry[]; diskAvailable: boolean }>(
          '/api/admin/logs',
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          // Rien de nouveau (même longueur, même dernière entrée) : l’ancien tableau est gardé,
          // sinon chaque lecture refiltre et redessine jusqu’à mille lignes.
          const previous = lastSnapshot?.entries;
          const unchanged =
            previous !== undefined &&
            previous.length === result.entries.length &&
            previous.at(-1)?.id === result.entries.at(-1)?.id &&
            previous[0]?.id === result.entries[0]?.id;
          lastSnapshot = {
            ...result,
            entries: unchanged ? previous : result.entries,
            at: Date.now(),
          };
          setSnapshot(lastSnapshot);
          setError('');
        }
      } catch (error) {
        if (!abort.signal.aborted) setError(errorMessage(error));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 2000);
      }
    };
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [paused]);
  const entries = snapshot?.entries ?? null;
  const visible = useMemo(
    () => filterLog(entries ?? [], { source, problemsOnly, search }),
    [entries, source, problemsOnly, search],
  );
  const sources = useMemo(() => logSources(entries ?? []), [entries]);
  const hiddenRequests = source === ALL_SOURCES ? (entries ?? []).filter(routineRequest).length : 0;
  // Un lien de téléchargement : l’export ne demande rien au serveur et marche hors connexion.
  function exportVisible(event: MouseEvent<HTMLAnchorElement>) {
    if (!visible.length) {
      event.preventDefault();
      return;
    }
    const link = event.currentTarget;
    const url = URL.createObjectURL(
      new Blob(
        [
          visible
            .slice()
            .reverse()
            .map((entry) => JSON.stringify(entry))
            .join('\n'),
        ],
        { type: 'application/x-ndjson' },
      ),
    );
    link.href = url;
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.href = '#logs';
    }, 1000);
  }
  return (
    <Card className="min-w-0 shadow-none xl:col-span-2">
      <CardHeader>
        <CardTitle>Journal détaillé</CardTitle>
        <CardDescription>
          Les 1 000 derniers événements depuis le démarrage, mis à jour toutes les 2 secondes.{' '}
          {snapshot === null
            ? ''
            : snapshot.diskAvailable
              ? 'Une copie est aussi gardée sur le disque de cet ordinateur.'
              : 'Aucune copie sur le disque : le journal repart de zéro au redémarrage.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect
            aria-label="Origine des événements du journal"
            wrapperClassName="w-52"
            className="w-full"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <NativeSelectOption value={ALL_SOURCES}>Toutes les origines</NativeSelectOption>
            {sources.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {sourceLabel(item)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Label className="min-h-9 cursor-pointer font-normal">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(event) => setProblemsOnly(event.target.checked)}
            />
            Problèmes seulement
          </Label>
          <SearchInput
            aria-label="Rechercher dans le journal"
            className="max-w-xs"
            placeholder="OpenAI, microphone, interaction…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="outline" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {paused ? 'Reprendre' : 'Pause'}
          </Button>
          <Button variant="outline" asChild>
            <a
              href="#logs"
              download="cornelius-journal.jsonl"
              aria-disabled={visible.length ? undefined : 'true'}
              onClick={exportVisible}
            >
              <Download aria-hidden="true" />
              Exporter le journal filtré
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {entries === null
            ? ''
            : (paused ? 'Actualisation en pause · ' : '') +
              plural(visible.length, 'événement') +
              (visible.length !== entries.length ? ' sur ' + entries.length : '') +
              (hiddenRequests
                ? ' · ' +
                  plural(hiddenRequests, 'requête réussie masquée', 'requêtes réussies masquées') +
                  ' (origine « Requêtes au serveur » pour les voir)'
                : '')}
        </p>
        {error && (
          <p role="status" className="text-sm text-warning">
            Journal non actualisé : {error}
            {snapshot
              ? ` Entrées affichées : lecture de ${new Date(snapshot.at).toLocaleTimeString('fr-FR')}.`
              : ''}
          </p>
        )}
        <div
          className="max-h-[36rem] divide-y overflow-auto rounded-lg border"
          role="log"
          aria-live="off"
          aria-label="Journal détaillé"
          tabIndex={0}
        >
          {entries === null ? (
            <p className="p-4 text-sm text-muted-foreground">Lecture du journal…</p>
          ) : (
            visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {entries.length
                  ? 'Aucun événement ne correspond à ces filtres.'
                  : 'Aucun événement pour le moment.'}
              </p>
            )
          )}
          {visible.map((entry) => {
            const summary = logSummary(entry);
            const hasDetails = Object.keys(entry.details).length > 0;
            return (
              <div key={entry.id} className="space-y-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <time
                    className="font-mono text-xs text-muted-foreground tabular-nums"
                    dateTime={entry.time}
                  >
                    {timeFormat.format(new Date(entry.time))}
                  </time>
                  <Badge variant="outline" className={levelBadges[entry.level]}>
                    {levelLabels[entry.level]}
                  </Badge>
                  <span className="text-muted-foreground">{sourceLabel(entry.source)}</span>
                  <span className="font-medium">{entry.event}</span>
                </div>
                {summary && <p className="break-words text-muted-foreground">{summary}</p>}
                {hasDetails && (
                  <Fold variant="inline" summary="Détails" className="text-xs">
                    <pre className="font-mono break-all whitespace-pre-wrap text-muted-foreground">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </Fold>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
