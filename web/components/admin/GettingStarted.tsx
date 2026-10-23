import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  ExternalLink,
  Lock,
  Mic,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  readinessComplete,
  type ReadinessId,
  type ReadinessItem,
  type ReadinessStatus,
} from '../../../shared/readiness';
import { cn } from '@/lib/utils';
import { plural } from './format';
import { activateMirrorLabel } from './activate-mirror';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

/** Guides du dépôt, lus en ligne : le serveur local ne les publie pas. */
const DOCS_URL = 'https://github.com/lfpoulain/Cornelius/blob/main/';

const statuses: Record<ReadinessStatus, { label: string; icon: LucideIcon; tone: string }> = {
  done: { label: 'Fait', icon: CircleCheck, tone: 'text-primary' },
  todo: { label: 'À faire', icon: CircleDot, tone: 'text-warning' },
  blocked: { label: 'Bloqué', icon: Lock, tone: 'text-muted-foreground' },
  optional: { label: 'Facultatif', icon: CircleDashed, tone: 'text-muted-foreground' },
};

// Libellés d’action propres à chaque étape : jamais le nom d’une rubrique, que la navigation
// porte déjà.
const sectionActions: Partial<Record<ReadinessId, string>> = {
  perception: 'Ouvrir le diagnostic',
  camera: 'Choisir la caméra',
  faces: 'Enregistrer un visage',
};
const docActions: Partial<Record<ReadinessId, string>> = {
  'openai-key': 'Guide d’installation',
  'wake-word': 'Guide du mot d’appel',
};

/** Étapes restantes : à faire, ou bloquées par une étape précédente. */
export function remainingSteps(items: readonly ReadinessItem[]): number {
  return items.filter((item) => item.status === 'todo' || item.status === 'blocked').length;
}

export function GettingStarted({
  items,
  perceptionDiagnostic,
  openaiBlocked,
  onGo,
  onActivateMirror,
  onAllowOpenAI,
}: {
  items: ReadinessItem[];
  /** Dernière erreur du service caméra, affichée sous son étape. */
  perceptionDiagnostic: string | null;
  openaiBlocked: boolean;
  onGo: (section: string) => void;
  /** « Activer et ouvrir le miroir », le même geste que dans le panneau de session. */
  onActivateMirror: () => void;
  onAllowOpenAI: () => void;
}) {
  const complete = readinessComplete(items);
  const todo = items.filter((item) => item.status === 'todo').length;
  const blocked = items.filter((item) => item.status === 'blocked').length;
  const next = items.find((item) => item.status === 'todo');
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{complete ? 'Tout est prêt' : 'Avant la première conversation'}</CardTitle>
        <CardDescription>
          {complete
            ? 'Cornelius peut converser. Les réglages fins se trouvent dans les autres rubriques.'
            : `${plural(todo, 'étape')} à faire` +
              (blocked
                ? `, ${plural(blocked, 'bloquée', 'bloquées')} par une étape précédente`
                : '') +
              '. La liste se met à jour d’elle-même.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y" aria-label="Étapes de la mise en route">
          {items.map((item) => {
            const status = statuses[item.status];
            const Icon = status.icon;
            // Une étape facultative ne propose d’agir que si cela apporte quelque chose.
            const showAction =
              item.status === 'todo' || (item.status === 'optional' && item.id === 'faces');
            // Le panneau de session reste compact ici : l’autorisation d’OpenAI se donne à
            // l’étape même.
            const allowOpenAI = item.id === 'openai-blocked' && item.status === 'todo';
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0"
                data-status={item.status}
              >
                <Icon className={cn('mt-0.5 size-5 shrink-0', status.tone)} aria-hidden="true" />
                <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <strong
                      className={cn(
                        'text-sm font-medium',
                        item.status === 'done' && 'text-muted-foreground',
                      )}
                    >
                      {item.title}
                    </strong>
                    {/* Mêmes couleurs d’état qu’ailleurs : ambre pour ce qui reste à faire (comme
                        « Configuration à terminer »), vert pour ce qui est prêt. */}
                    <Badge
                      variant={item.status === 'done' ? 'secondary' : 'outline'}
                      className={
                        item.status === 'todo'
                          ? 'border-warning/40 bg-warning/10 text-warning'
                          : undefined
                      }
                    >
                      {status.label}
                    </Badge>
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
                  {item.id === 'mirror' && item.status === 'todo' && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Adresse du miroir :{' '}
                      <code className="font-mono text-xs text-foreground">{location.origin}/</code>
                    </p>
                  )}
                  {item.id === 'perception' && perceptionDiagnostic && (
                    <p className="text-sm leading-relaxed text-destructive">
                      {perceptionDiagnostic}
                    </p>
                  )}
                </div>
                {showAction && item.action && (
                  <div className="ml-9 sm:ml-0">
                    <StepAction
                      item={item}
                      primary={item === next}
                      openaiBlocked={openaiBlocked}
                      onGo={onGo}
                      onActivateMirror={onActivateMirror}
                    />
                  </div>
                )}
                {allowOpenAI && (
                  <div className="ml-9 sm:ml-0">
                    <Button
                      variant={item === next ? 'default' : 'outline'}
                      size="sm"
                      className="max-[760px]:min-h-11"
                      onClick={onAllowOpenAI}
                    >
                      <ShieldCheck aria-hidden="true" />
                      Autoriser {item.title.replace('Accès à ', '')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function StepAction({
  item,
  primary,
  openaiBlocked,
  onGo,
  onActivateMirror,
}: {
  item: ReadinessItem;
  primary: boolean;
  openaiBlocked: boolean;
  onGo: (section: string) => void;
  onActivateMirror: () => void;
}) {
  const action = item.action;
  const variant = primary ? 'default' : 'outline';
  // Sur téléphone, une zone tactile d’au moins 44 px.
  const touch = 'max-[760px]:min-h-11';
  if (!action) return null;
  if (action.kind === 'doc')
    return (
      <Button asChild variant={variant} size="sm" className={touch}>
        <a href={DOCS_URL + action.path} target="_blank" rel="noreferrer" title={action.path}>
          {docActions[item.id] ?? 'Lire le guide'}
          <ExternalLink aria-hidden="true" />
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
      </Button>
    );
  // Même geste et même libellé que le panneau de session : la voix est préparée, puis le miroir
  // s’ouvre dans cet onglet.
  if (action.kind === 'mirror')
    return (
      <Button variant={variant} size="sm" className={touch} onClick={onActivateMirror}>
        <Mic aria-hidden="true" />
        {activateMirrorLabel(openaiBlocked)}
        <ArrowRight aria-hidden="true" />
      </Button>
    );
  return (
    <Button variant={variant} size="sm" className={touch} onClick={() => onGo(action.section)}>
      {sectionActions[item.id] ?? 'Ouvrir la rubrique'}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}
