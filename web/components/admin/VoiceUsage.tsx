import { useEffect, useState } from 'react';
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
  const value =
    decimalText(minutes(period.seconds)) +
    ' min · ' +
    period.sessions +
    (period.sessions === 1 ? ' conversation' : ' conversations') +
    (period.cost === null ? '' : ' · environ ' + decimalText(period.cost) + ' ' + currency);
  return (
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}

/** Temps de conversation : la voix temps réel est facturée à la durée de la session. */
export function VoiceUsageCard({ run }: { run: RunAction }) {
  const usage = useAdminResource(api.voiceUsage);
  const saved = usage.data;
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Temps de conversation</CardTitle>
        <CardDescription>
          La voix temps réel est facturée à la durée des conversations, pas au nombre de questions.
          Le coût n’est qu’une estimation, d’après le prix par minute saisi ici : vérifiez-le chez
          votre fournisseur.
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
        <div className="flex flex-wrap gap-4">
          <Field
            id="voice-price"
            label="Prix par minute"
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
