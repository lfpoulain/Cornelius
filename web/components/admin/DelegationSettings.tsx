import { useEffect, useRef, useState } from 'react';
import type { DelegationMode } from '../../../shared/delegation';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { isSessionActive } from './format';
import { ConfirmAction } from './shared';
import { ChoiceGroup } from '../ui/choice-card';
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

export function DelegationSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const active = isSessionActive(state);
  // Changer de mode termine la conversation en cours : le choix attend alors une confirmation.
  const [confirming, setConfirming] = useState<DelegationMode | null>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const save = (mode: DelegationMode) =>
    run('Mode de délégation enregistré.', () => api.delegationMode(mode), { payload: mode });
  const decide = (confirmed: boolean) => {
    const resolve = answer.current;
    const mode = confirming;
    answer.current = null;
    setConfirming(null);
    if (!confirmed || !mode) resolve?.(false);
    else void save(mode).then((ok) => resolve?.(ok));
  };
  // La conversation s’est terminée entre-temps : plus rien à confirmer, le choix s’applique.
  useEffect(() => {
    if (confirming && !active) decide(true);
  }, [confirming, active]);
  const choose = (mode: DelegationMode) => {
    if (!active) return save(mode);
    answer.current?.(false);
    setConfirming(mode);
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
    });
  };
  const label = modes.find((entry) => entry.value === confirming)?.label;
  if (state.setup?.aiProvider === 'groq')
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h4">Recherches et actions</CardTitle>
          <CardDescription>
            Groq utilise le modèle configuré dans CORNELIUS_GROQ_MODEL pour les réponses et les
            outils. Les modes de vitesse OpenAI ne s’appliquent pas à ce fournisseur.
          </CardDescription>
        </CardHeader>
      </Card>
    );
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
          onValueChange={choose}
        />
        {confirming && (
          <ConfirmAction
            message={`Une conversation est en cours : passer en mode « ${label} » la termine. La suivante utilisera ce choix.`}
            confirmLabel="Changer et terminer la conversation"
            onConfirm={() => decide(true)}
            onCancel={() => decide(false)}
          />
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Changer de mode termine la conversation en cours ; la suivante utilisera ce choix.
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
