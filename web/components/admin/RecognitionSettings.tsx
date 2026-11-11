import type { DevicesStatus } from '../../../shared/types';
import type { RunAction } from './types';
import { request } from '../../api';
import { FineTuning } from './FineTuning';
import { DecimalInput, Field, SaveBar, useDecimalDraft } from './shared';
import { ChoiceGroup, type ChoiceOption } from '../ui/choice-card';

/** Du plus souple au plus strict : le chiffre exact se règle dans « Réglage fin ». */
export const RECOGNITION_PRESETS = [
  { label: 'Très souple', threshold: 0.3 },
  { label: 'Souple', threshold: 0.38 },
  { label: 'Équilibrée', threshold: 0.42 },
  { label: 'Stricte', threshold: 0.5 },
] as const;
const MIN = 0.2;
const MAX = 0.65;
const decimal = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 2 });

/** Exigence de la reconnaissance : de Souple à Stricte. */
export function RecognitionSettings({
  status,
  run,
}: {
  status: DevicesStatus | null;
  run: RunAction;
}) {
  const saved = status?.perception.recognitionThreshold;
  const draft = useDecimalDraft(saved);
  const value = draft.value ?? Number.NaN;
  const valid = Number.isFinite(value) && value >= MIN && value <= MAX;
  const dirty = saved !== undefined && draft.dirty;
  const preset =
    saved === undefined
      ? null
      : (RECOGNITION_PRESETS.find((entry) => entry.threshold === saved)?.label ?? 'custom');
  const options: ChoiceOption<string>[] = [
    ...RECOGNITION_PRESETS.map((entry) => ({ value: entry.label, label: entry.label })),
    ...(preset === 'custom' && saved !== undefined
      ? [{ value: 'custom', label: 'Personnalisée (' + decimal(saved) + ')' }]
      : []),
  ];
  const save = (next: number) =>
    run(
      'Exigence de la reconnaissance enregistrée.',
      () =>
        request('/api/admin/recognition', {
          method: 'PATCH',
          body: JSON.stringify({ threshold: next }),
        }),
      { key: 'recognition-threshold', payload: next },
    );
  return (
    <div className="space-y-4">
      <ChoiceGroup
        legend="Exigence de la reconnaissance"
        // Le titre de la carte le dit déjà ; la légende reste pour les lecteurs d’écran.
        hideLegend
        compact
        value={preset}
        options={options}
        disabled={saved === undefined}
        describedBy="recognition-help"
        onValueChange={(label) => {
          const entry = RECOGNITION_PRESETS.find((item) => item.label === label);
          return entry ? save(entry.threshold) : false;
        }}
      />
      <p id="recognition-help" className="text-xs leading-relaxed text-muted-foreground">
        Souple reconnaît plus facilement, de profil ou dans la pénombre, mais confond plus souvent
        deux proches. Stricte se trompe moins, mais demande d’être bien face au miroir.
      </p>
      <FineTuning hint="Valeur exacte" defaultOpen={preset === 'custom'}>
        <Field
          id="recognition-threshold"
          label="Exigence de la reconnaissance"
          help={`De ${decimal(MIN)} (souple) à ${decimal(MAX)} (stricte). L’identité est confirmée sur plusieurs images, et stabilisée lors des hésitations.`}
          className="max-w-80"
        >
          <DecimalInput
            id="recognition-threshold"
            disabled={saved === undefined}
            aria-invalid={!valid || undefined}
            value={draft.text}
            onChange={(event) => draft.setText(event.target.value)}
          />
        </Field>
      </FineTuning>
      <SaveBar
        label="Exigence de la reconnaissance"
        count={dirty ? 1 : 0}
        error={valid ? null : `Indiquez une valeur de ${decimal(MIN)} à ${decimal(MAX)}.`}
        onSave={() => void save(value)}
        onCancel={draft.reset}
      />
    </div>
  );
}
