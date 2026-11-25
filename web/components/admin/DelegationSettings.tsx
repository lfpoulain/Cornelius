import { useEffect, useRef, useState } from 'react';
import type { DelegationMode } from '../../../shared/delegation';
import { delegationModelsOf } from '../../../shared/live-endpoint';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { isSessionActive } from './format';
import { ConfirmAction, Field } from './shared';
import { liveServerLabel } from './LiveEndpointSettings';
import { loadLiveModels, useLiveEndpoint } from './liveEndpointStore';
import { ChoiceGroup } from '../ui/choice-card';
import { Button } from '../ui/button';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

const modes: { value: DelegationMode; label: string; meta: string; description: string }[] = [
  {
    value: 'normal',
    label: 'Normal',
    meta: 'GPT-6 Luna',
    description: 'Tarification standard, pour les recherches et les actions du quotidien.',
  },
  {
    value: 'fast',
    label: 'Rapide',
    meta: 'GPT-6 Luna',
    description:
      'Le modèle actuel avec un traitement plus rapide et un coût supérieur au mode normal.',
  },
  {
    value: 'ultrafast',
    label: 'Ultra rapide',
    meta: 'GPT-6 Astra',
    description:
      'Passe à Astra, avec le traitement le plus rapide d’OpenAI. Plus coûteux, pour privilégier la vitesse et le raisonnement.',
  },
];

/** Changement qui termine la conversation en cours : il attend une confirmation. */
interface Pending {
  message: string;
  apply: () => Promise<boolean>;
}

export function DelegationSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const active = isSessionActive(state);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  // Le serveur Live décide de ce qui se règle ici : les modes pour OpenAI, un modèle sinon.
  const { view } = useLiveEndpoint();
  const kind = view?.kind ?? 'openai';
  const decide = (confirmed: boolean) => {
    const resolve = answer.current;
    const pending = confirming;
    answer.current = null;
    setConfirming(null);
    if (!confirmed || !pending) resolve?.(false);
    else void pending.apply().then((ok) => resolve?.(ok));
  };
  // La conversation s’est terminée entre-temps : plus rien à confirmer, le choix s’applique.
  useEffect(() => {
    if (confirming && !active) decide(true);
  }, [confirming, active]);
  const confirmFirst = (pending: Pending) => {
    if (!active) return pending.apply();
    answer.current?.(false);
    setConfirming(pending);
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
    });
  };
  const chooseMode = (mode: DelegationMode) =>
    confirmFirst({
      message: `Une conversation est en cours : passer en mode « ${modes.find((entry) => entry.value === mode)?.label} » la termine. La suivante utilisera ce choix.`,
      apply: () =>
        run('Mode de délégation enregistré.', () => api.delegationMode(mode), { payload: mode }),
    });
  const model = state.delegationModel ?? '';
  const chooseModel = (next: string) =>
    confirmFirst({
      message: `Une conversation est en cours : changer de modèle la termine. La suivante utilisera ${next || 'gpt-6-luna'}.`,
      apply: () =>
        run(
          next ? `Modèle de délégation : ${next}.` : 'Modèle de délégation retiré.',
          () => api.delegationModel(next),
          { key: 'delegation-model', payload: next },
        ),
    });
  const serverModels = delegationModelsOf(view?.models ?? []);
  const orphan = model && !serverModels.includes(model);
  const reload = () => void run('Liste des modèles relue.', loadLiveModels, { key: 'live-models' });
  const reloadButton = (
    <Button type="button" variant="outline" onClick={reload}>
      Relire la liste
    </Button>
  );
  return (
    <Card>
      <CardHeader>
        {/* Rangée dans « Réglages avancés », dont le résumé porte le h3. */}
        <CardTitle as="h4">Délégation : recherches et actions</CardTitle>
        <CardDescription>
          {kind === 'openai'
            ? 'Choisissez la vitesse des recherches, des cartes et des commandes confiées par Cornelius.'
            : `Les recherches, les cartes et les commandes confiées par Cornelius passent par le serveur Live (${view ? liveServerLabel(view) : ''}).`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {kind === 'openai' && (
          <ChoiceGroup
            legend="Mode de délégation"
            hideLegend
            value={state.delegationMode}
            options={modes}
            onValueChange={chooseMode}
          />
        )}
        {kind === 'localive' && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
            <p className="min-w-0 flex-1 basis-64 leading-relaxed">
              {serverModels.length > 0 ? (
                <>
                  Localive répond avec son cerveau{' '}
                  <code className="font-mono font-medium">{serverModels.join(', ')}</code>.
                </>
              ) : (
                'Localive répond avec son cerveau.'
              )}{' '}
              <span className="text-muted-foreground">
                Il se choisit dans l’administration de Localive (Cerveau), pas ici.
              </span>
            </p>
            {reloadButton}
          </div>
        )}
        {kind === 'compatible' && (
          <Field
            id="delegation-model"
            label="Modèle de délégation"
            help={
              serverModels.length > 0
                ? 'Modèles proposés par le serveur Live, hors modèles de conversation.'
                : 'Aucun modèle lu sur le serveur Live : vérifiez son adresse, puis relisez la liste.'
            }
          >
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                id="delegation-model"
                wrapperClassName="min-w-0 flex-1 basis-56"
                className="w-full font-mono"
                value={model}
                onChange={(event) => void chooseModel(event.target.value)}
              >
                <NativeSelectOption value="">Non choisi (gpt-6-luna)</NativeSelectOption>
                {serverModels.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {item}
                  </NativeSelectOption>
                ))}
                {orphan && (
                  <NativeSelectOption value={model}>{model} (absent du serveur)</NativeSelectOption>
                )}
              </NativeSelect>
              {reloadButton}
            </div>
          </Field>
        )}
        {confirming && (
          <ConfirmAction
            message={confirming.message}
            confirmLabel="Changer et terminer la conversation"
            onConfirm={() => decide(true)}
            onCancel={() => decide(false)}
          />
        )}
        {kind !== 'localive' && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Changer de {kind === 'openai' ? 'mode' : 'modèle'} termine la conversation en cours ; la
            suivante utilisera ce choix.
          </p>
        )}
        {kind === 'openai' && state.delegationMode === 'ultrafast' && (
          <p className="text-sm text-muted-foreground">
            Ce traitement très rapide dépend des limites de votre compte OpenAI et passe par ses
            serveurs mondiaux ou américains : il ne fonctionne pas si votre compte OpenAI garde ses
            données en Europe.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
