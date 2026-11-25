import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../../../shared/types';
import type { VoiceProvider } from '../../../shared/voice-provider';
import type { VoiceUsagePeriod } from '../../../shared/voice-usage';
import { api } from '../../api';
import { decimalText } from './format';
import { DecimalInput, Field, ResourceState, SaveBar, useDecimalDraft } from './shared';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

const minutes = (seconds: number) => Math.round(seconds / 6) / 10;

function line(label: string, period: VoiceUsagePeriod, currency: string) {
  // Le coût ne porte que sur le temps passé avec Mistral, facturé à la minute.
  const metered =
    period.meteredSeconds === period.seconds
      ? ''
      : ' (dont ' + decimalText(minutes(period.meteredSeconds)) + ' min avec Mistral)';
  const grok =
    period.xaiCost === null || period.xaiSeconds === 0
      ? ''
      : ' · Grok (' +
        decimalText(minutes(period.xaiSeconds)) +
        ' min) : environ ' +
        decimalText(period.xaiCost) +
        ' ' +
        currency;
  const value =
    decimalText(minutes(period.seconds)) +
    ' min · ' +
    period.sessions +
    (period.sessions === 1 ? ' conversation' : ' conversations') +
    (period.cost === null || period.meteredSeconds === 0
      ? ''
      : metered + ' · Mistral : environ ' + decimalText(period.cost) + ' ' + currency) +
    grok;
  return (
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}

/**
 * Temps de conversation par fournisseur. Seul Mistral facture la voix à la minute : le coût
 * estimé ne porte que sur ce temps-là.
 */
export function VoiceUsageCard({
  phase,
  provider,
  run,
}: {
  phase: SessionState['phase'];
  /** Fournisseur de la conversation : le prix par minute ne concerne que Mistral. */
  provider: VoiceProvider | undefined;
  run: RunAction;
}) {
  const usage = useAdminResource(api.voiceUsage);
  const saved = usage.data;
  // Une conversation qui se ferme s’ajoute au temps du jour : la carte se met à jour.
  const previousPhase = useRef(phase);
  const { reload } = usage;
  useEffect(() => {
    if (phase === 'idle' && previousPhase.current !== 'idle') void reload();
    previousPhase.current = phase;
  }, [phase, reload]);
  // Brouillons calés sur les valeurs, pas sur l’objet : chaque relecture (fin d’une
  // conversation) en rend un nouveau, et une saisie en cours serait effacée.
  const price = useDecimalDraft(saved?.perMinute);
  const parsed = price.value;
  const xaiPrice = useDecimalDraft(saved?.xaiPerMinute);
  const xaiParsed = xaiPrice.value;
  const [currency, setCurrency] = useState<'$' | '€'>('$');
  const savedCurrency = saved?.currency;
  useEffect(() => {
    if (savedCurrency !== undefined) setCurrency(savedCurrency);
  }, [savedCurrency]);
  const inRange = (value: number | null) =>
    value === null || (Number.isFinite(value) && value >= 0 && value <= 10);
  const valid = inRange(parsed) && inRange(xaiParsed);
  const dirty = !!saved && (currency !== saved.currency || price.dirty || xaiPrice.dirty);
  // Grok Voice (xAI) facture aussi à la minute : son prix s'affiche dès qu'il est choisi,
  // qu'un prix est enregistré ou que du temps Grok est compté.
  const xaiMetered =
    provider === 'xai' ||
    saved?.xaiPerMinute != null ||
    [saved?.today, saved?.month, saved?.previousMonth].some(
      (period) => (period?.xaiSeconds ?? 0) > 0,
    );
  // Le prix par minute ne sert qu’avec Mistral : il reste visible tant que du temps Mistral est
  // compté ou qu’un prix est enregistré, pour pouvoir le corriger ou l’effacer.
  const metered =
    provider === 'mistral' ||
    saved?.perMinute != null ||
    [saved?.today, saved?.month, saved?.previousMonth].some(
      (period) => (period?.meteredSeconds ?? 0) > 0,
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Temps de conversation</CardTitle>
        <CardDescription>
          Durée des conversations vocales, par jour du foyer.{' '}
          {xaiMetered
            ? 'xAI facture Grok Voice à la minute (0,08 $ US selon xAI) : avec un prix saisi ici, le coût du temps passé avec Grok est estimé (vérifiez-le dans la console xAI). '
            : ''}
          {metered
            ? 'Mistral facture la voix à la minute : avec un prix saisi ici, le coût du temps passé avec Mistral est estimé (vérifiez-le chez Mistral). Le temps passé avec OpenAI, facturé aux jetons, est compté sans coût.'
            : 'OpenAI facture aux jetons (voix, délégation, recherche web, images) : aucun coût n’est estimé ici, consultez la console OpenAI.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResourceState resource={usage} loadingLabel="Lecture du temps de conversation…">
          {(data) => (
            <div className="space-y-1">
              {line('Aujourd’hui', data.today, data.currency)}
              {line('Ce mois-ci', data.month, data.currency)}
              {line('Le mois dernier', data.previousMonth, data.currency)}
            </div>
          )}
        </ResourceState>
        {(metered || xaiMetered) && (
          <div className="flex flex-wrap gap-4">
            {metered && (
              <Field
                id="voice-price"
                label="Prix par minute (Mistral)"
                help="Vide : pas d’estimation. De 0 à 10."
                className="max-w-40"
              >
                <DecimalInput
                  id="voice-price"
                  value={price.text}
                  aria-invalid={!inRange(parsed) || undefined}
                  onChange={(event) => price.setText(event.target.value)}
                />
              </Field>
            )}
            {xaiMetered && (
              <Field
                id="voice-price-xai"
                label="Prix par minute (Grok)"
                help="0,08 en $ US selon xAI. Vide : pas d’estimation."
                className="max-w-40"
              >
                <DecimalInput
                  id="voice-price-xai"
                  value={xaiPrice.text}
                  aria-invalid={!inRange(xaiParsed) || undefined}
                  onChange={(event) => xaiPrice.setText(event.target.value)}
                />
              </Field>
            )}
            <Field id="voice-currency" label="Monnaie" className="max-w-28">
              <NativeSelect
                id="voice-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value === '€' ? '€' : '$')}
              >
                <NativeSelectOption value="$">$</NativeSelectOption>
                <NativeSelectOption value="€">€</NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
        )}
        <SaveBar
          label="Prix par minute"
          count={dirty ? 1 : 0}
          error={valid ? null : 'Indiquez un prix de 0 à 10 par minute.'}
          onSave={() =>
            void run('Prix par minute enregistré.', async () => {
              await api.setVoicePrice(parsed, currency, xaiParsed);
              await usage.reload();
            })
          }
          onCancel={() => {
            price.reset();
            xaiPrice.reset();
            setCurrency(saved?.currency ?? '$');
          }}
        />
      </CardContent>
    </Card>
  );
}
