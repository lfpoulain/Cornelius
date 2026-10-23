import type { ReactNode } from 'react';
import { Globe } from 'lucide-react';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { ModulePanel } from './shared';
import type { RunAction } from './types';

/** Module natif « Web » : l’outil de recherche web d’OpenAI, commun à tout le foyer. */
export function WebSearchSettings({
  state,
  run,
  hidden,
  action,
}: {
  state: MirrorState;
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const groq = state.setup?.aiProvider === 'groq';
  const enabled = !groq && state.webSearchEnabled !== false;
  return (
    <ModulePanel
      id="module-web"
      icon={Globe}
      title="Web"
      subtitle="Recherche sur le web par OpenAI, avec les sources sur la carte"
      badge={
        <Badge variant={enabled ? 'secondary' : 'outline'}>
          {groq ? 'Indisponible avec Groq' : enabled ? 'Activée' : 'Désactivée'}
        </Badge>
      }
      action={action}
      hidden={hidden}
    >
      <p className="text-sm text-muted-foreground">
        Pour l’actualité, les horaires d’un lieu, un prix ou un événement, Cornelius cherche sur le
        web avant de répondre, et le miroir affiche les liens cités. Désactivée, la recherche n’est
        plus proposée : Cornelius dit qu’il ne peut pas vérifier une information récente, sans rien
        inventer. Les modules (heure, météo, bus, maison) ne passent jamais par le web.
      </p>
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="web-search-enabled">Autoriser la recherche web</Label>
          <p className="text-xs text-muted-foreground">
            Réglage commun au foyer. Une conversation en cours redémarre pour en tenir compte.
          </p>
        </div>
        <Switch
          id="web-search-enabled"
          checked={enabled}
          disabled={groq}
          onCheckedChange={(value) => {
            void run(value ? 'Recherche web activée.' : 'Recherche web désactivée.', () =>
              api.webSearch(value),
            );
          }}
        />
      </div>
    </ModulePanel>
  );
}
