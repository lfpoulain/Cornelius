import { useEffect, useRef, useState } from 'react';
import type { DelegationMode } from '../../../shared/delegation';
import { OPENAI_DELEGATION_MODELS } from '../../../shared/live-endpoint';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { isSessionActive } from './format';
import { ConfirmAction, Field } from './shared';
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
  // Modèles lus sur le serveur Live : conservés par le serveur jusqu’au changement d’adresse.
  const [serverModels, setServerModels] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    api
      .liveEndpoint()
      .then((view) => current && setServerModels(view.models))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
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
      message: `Une conversation est en cours : changer de modèle la termine. La suivante utilisera ${next || 'le modèle du mode'}.`,
      apply: () =>
        run(
          next ? `Modèle de délégation : ${next}.` : 'Modèle de délégation : selon le mode.',
          () => api.delegationModel(next),
          { key: 'delegation-model', payload: next },
        ),
    });
  const known = new Set<string>(OPENAI_DELEGATION_MODELS);
  const others = serverModels.filter((item) => !known.has(item));
  const orphan = model && !known.has(model) && !serverModels.includes(model);
  return (
    <Card>
      <CardHeader>
        {/* Rangée dans « Réglages avancés », dont le résumé porte le h3. */}
        <CardTitle as="h4">Délégation : recherches et actions</CardTitle>
        <CardDescription>
          Choisissez le modèle et la vitesse pour les recherches, les cartes et les commandes
          confiées par Cornelius.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChoiceGroup
          legend="Mode de délégation"
          hideLegend
          value={state.delegationMode}
          options={modes}
          onValueChange={chooseMode}
        />
        <Field
          id="delegation-model"
          label="Modèle de délégation"
          help={
            model
              ? 'Ce modèle remplace celui du mode ; la vitesse et le raisonnement du mode restent appliqués.'
              : 'Selon le mode : GPT-6 Luna, ou GPT-6 Astra en ultra rapide. « Charger la liste » lit les modèles du serveur Live.'
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
              <NativeSelectOption value="">Selon le mode</NativeSelectOption>
              <optgroup label="Modèles OpenAI">
                {OPENAI_DELEGATION_MODELS.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {item}
                  </NativeSelectOption>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="Serveur Live">
                  {others.map((item) => (
                    <NativeSelectOption key={item} value={item}>
                      {item}
                    </NativeSelectOption>
                  ))}
                </optgroup>
              )}
              {orphan && (
                <optgroup label="Choix actuel">
                  <NativeSelectOption value={model}>{model}</NativeSelectOption>
                </optgroup>
              )}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void run('Liste des modèles chargée.', async () => {
                  const view = await api.liveModels();
                  setServerModels(view.models);
                })
              }
            >
              Charger la liste
            </Button>
          </div>
        </Field>
        {confirming && (
          <ConfirmAction
            message={confirming.message}
            confirmLabel="Changer et terminer la conversation"
            onConfirm={() => decide(true)}
            onCancel={() => decide(false)}
          />
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Changer de mode ou de modèle termine la conversation en cours ; la suivante utilisera ce
          choix.
        </p>
        {state.delegationMode === 'ultrafast' && (
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
