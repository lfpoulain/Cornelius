import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../../../shared/types';
import type { VoiceProvider } from '../../../shared/voice-provider';
import type { VoiceUsagePeriod } from '../../../shared/voice-usage';
import { api } from '../../api';
import { decimalText, parseDecimal } from './format';
import { DecimalInput, Field, ResourceState, SaveBar } from './shared';
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
  const value =
    decimalText(minutes(period.seconds)) +
    ' min · ' +
    period.sessions +
    (period.sessions === 1 ? ' conversation' : ' conversations') +
    (period.cost === null || period.meteredSeconds === 0
      ? ''
      : metered + ' · Mistral : environ ' + decimalText(period.cost) + ' ' + currency);
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
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<'$' | '€'>('$');
  useEffect(() => {
    if (!saved) return;
    setPrice(saved.perMinute === null ? '' : decimalText(saved.perMinute));
    setCurrency(saved.currency);
  }, [saved]);
  const parsed = price.trim() ? parseDecimal(price) : null;
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10);
  const dirty =
    !!saved && (currency !== saved.currency || (parsed ?? null) !== (saved.perMinute ?? null));
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
        {metered && (
          <div className="flex flex-wrap gap-4">
            <Field
              id="voice-price"
              label="Prix par minute (Mistral)"
              help="Vide : pas d’estimation. De 0 à 10."
              className="max-w-40"
            >
              <DecimalInput
                id="voice-price"
                value={price}
                aria-invalid={!valid || undefined}
                onChange={(event) => setPrice(event.target.value)}
              />
            </Field>
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
              await api.setVoicePrice(parsed, currency);
              await usage.reload();
            })
          }
          onCancel={() => {
            setPrice(saved?.perMinute == null ? '' : decimalText(saved.perMinute));
            setCurrency(saved?.currency ?? '$');
          }}
        />
      </CardContent>
    </Card>
  );
}
