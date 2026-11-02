import { useCallback, useState, type ReactNode } from 'react';
import { AlarmClock, RefreshCw } from 'lucide-react';
import {
  ALARM_DAYS,
  ALARM_EVERY_DAY,
  ALARM_KIND_LABELS,
  ALARM_LABEL_MAX,
  ALARM_WEEKDAYS,
  alarmRepeatLabel,
  type AlarmKind,
  type AlarmRequest,
  type AlarmsView,
  type AlarmView,
} from '../../../shared/alarms';
import type { Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Switch } from '../ui/switch';
import { ConfirmAction, Field, LoadingCard, ModulePanel, PresetButton } from './shared';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';

const ringChoices = [1, 2, 3, 5, 10, 15, 20, 30];

interface Draft {
  kind: AlarmKind;
  profileId: string | null;
  label: string;
  time: string;
  date: string;
  days: number;
  minutes: string;
}

const emptyDraft: Draft = {
  kind: 'alarm',
  profileId: null,
  label: '',
  time: '07:00',
  date: '',
  days: 0,
  minutes: '10',
};

/** Ce que le serveur attend pour ce brouillon ; les champs d'un autre type restent vides. */
function request(draft: Draft): Omit<AlarmRequest, 'target'> {
  const timer = draft.kind === 'timer';
  return {
    kind: draft.kind,
    profileId: draft.profileId,
    label: draft.label,
    time: timer ? null : draft.time,
    date: timer || draft.days || !draft.date ? null : draft.date,
    days: timer ? 0 : draft.days,
    durationMs: timer ? Math.round(Number(draft.minutes.replace(',', '.')) * 60_000) || 0 : null,
    inMinutes: null,
  };
}

function stateBadge(alarm: AlarmView) {
  if (alarm.state === 'ringing') return <Badge>Sonne</Badge>;
  if (alarm.state === 'snoozed') return <Badge variant="secondary">Repoussé</Badge>;
  if (alarm.state === 'done') return <Badge variant="outline">Terminé</Badge>;
  if (alarm.state === 'missed') return <Badge variant="outline">Manqué</Badge>;
  return null;
}

function AlarmRow({
  alarm,
  owner,
  run,
  onView,
}: {
  alarm: AlarmView;
  owner: string;
  run: RunAction;
  onView: (view: AlarmsView) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const repeat = alarmRepeatLabel(alarm.days);
  const name = alarm.label || ALARM_KIND_LABELS[alarm.kind].toLowerCase();
  return (
    <li className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{ALARM_KIND_LABELS[alarm.kind]}</Badge>
        {stateBadge(alarm)}
        <span className="font-medium">{alarm.label || ALARM_KIND_LABELS[alarm.kind]}</span>
        <span className="text-sm text-muted-foreground">· {owner}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {alarm.atLocal
          ? `${alarm.state === 'snoozed' ? 'Revient' : 'Prochaine fois'} : ${alarm.atLocal}`
          : 'Plus d’échéance.'}
        {repeat && ` · ${repeat}`}
        {alarm.missedAtLocal && ` · manqué le ${alarm.missedAtLocal}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {(alarm.state === 'ringing' || alarm.state === 'snoozed') && (
          <Button
            size="sm"
            onClick={() =>
              void run('Sonnerie arrêtée.', async () => onView(await api.stopAlarm(alarm.id)))
            }
          >
            Arrêter
          </Button>
        )}
        <Button
          size="sm"
          variant="danger-outline"
          aria-label={`Supprimer ${name}`}
          onClick={() => setConfirming(true)}
        >
          Supprimer
        </Button>
      </div>
      {confirming && (
        <ConfirmAction
          message={`Supprimer ${name} ? ${repeat ? 'Ses prochaines occurrences sont aussi supprimées.' : ''}`}
          confirmLabel="Supprimer"
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void run('Échéance supprimée.', async () => onView(await api.deleteAlarm(alarm.id)))
          }
        />
      )}
    </li>
  );
}

/** Module natif « Alarmes et rappels » : réveils, minuteurs et pense-bêtes du foyer. */
export function AlarmSettings({
  profiles,
  run,
  hidden,
  action,
}: {
  profiles: readonly Profile[];
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const load = useCallback(() => api.alarms(), []);
  const { data, error: loadError, loading, reload } = useAdminResource<AlarmsView>(load);
  const [view, setView] = useState<AlarmsView | null>(null);
  const current = view ?? data;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [addError, setAddError] = useState<string | null>(null);

  const active = current?.alarms.filter(
    (alarm) => alarm.state !== 'done' && alarm.state !== 'missed',
  );
  const badge = !current ? null : !current.settings.enabled ? (
    <Badge variant="outline">Désactivé</Badge>
  ) : active?.length ? (
    <Badge variant="secondary">{active.length} en cours</Badge>
  ) : null;

  const panel = (children: ReactNode) => (
    <ModulePanel
      id="module-alarms"
      icon={AlarmClock}
      title="Alarmes et rappels"
      subtitle="Réveils, minuteurs et pense-bêtes, pour le foyer ou une personne"
      badge={badge}
      action={action}
      hidden={hidden}
    >
      {children}
    </ModulePanel>
  );
  if (!current)
    return panel(
      loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="gap-3">
            <p>{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <LoadingCard label="Lecture des alarmes…" />
      ),
    );

  const show = (next: AlarmsView) => {
    setView(next);
    setAddError(null);
  };
  const edit = (patch: Partial<Draft>) => {
    setAddError(null);
    setDraft({ ...draft, ...patch });
  };
  const ownerName = (profileId: string | null) =>
    profileId === null
      ? 'le foyer'
      : (profiles.find((profile) => profile.id === profileId)?.name ?? 'profil supprimé');
  const timer = draft.kind === 'timer';
  const minutes = Number(draft.minutes.replace(',', '.'));
  const ready = timer
    ? Number.isFinite(minutes) && minutes > 0
    : /^\d{2}:\d{2}$/u.test(draft.time) && (draft.kind !== 'reminder' || !!draft.label.trim());
  const toggleDay = (index: number) => edit({ days: draft.days ^ (1 << index), date: '' });

  return panel(
    <>
      <p className="text-sm text-muted-foreground">
        Cornelius garde les réveils, minuteurs et rappels du foyer et de chaque personne. Ils
        sonnent sur le miroir à l’heure dite, même sans conversation en cours. Une échéance passée
        pendant un arrêt du serveur sonne encore si elle a moins d’un quart d’heure de retard ;
        sinon elle est notée manquée.
      </p>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="alarms-enabled">Activer les alarmes et rappels</Label>
          <p className="text-xs text-muted-foreground">
            {current.settings.enabled
              ? 'Les échéances sonnent à l’heure dite.'
              : 'Désactivé : rien ne sonne. Au retour, ce qui a plus d’un quart d’heure de retard est noté manqué.'}
          </p>
        </div>
        <Switch
          id="alarms-enabled"
          checked={current.settings.enabled}
          onCheckedChange={(enabled) =>
            void run(enabled ? 'Alarmes activées.' : 'Alarmes désactivées.', async () =>
              show(await api.saveAlarmSettings({ enabled })),
            )
          }
        />
      </div>

      <Field
        id="alarms-ring"
        label="Durée de la sonnerie"
        help="Sans réponse, la sonnerie s’arrête seule après ce temps et l’échéance est notée manquée."
      >
        <NativeSelect
          id="alarms-ring"
          value={String(current.settings.ringMinutes)}
          onChange={(event) =>
            void run('Durée de la sonnerie enregistrée.', async () =>
              show(await api.saveAlarmSettings({ ringMinutes: Number(event.target.value) })),
            )
          }
        >
          {ringChoices.map((value) => (
            <NativeSelectOption key={value} value={String(value)}>
              {value} min
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <section
        className="space-y-4 rounded-lg border border-dashed p-4"
        aria-labelledby="alarms-new"
      >
        <h4 id="alarms-new" className="font-medium">
          Nouvelle échéance
        </h4>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
          {(['alarm', 'timer', 'reminder'] as const).map((kind) => (
            <PresetButton key={kind} active={draft.kind === kind} onClick={() => edit({ kind })}>
              {ALARM_KIND_LABELS[kind]}
            </PresetButton>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="alarms-new-owner" label="Pour">
            <NativeSelect
              id="alarms-new-owner"
              wrapperClassName="w-full"
              className="w-full"
              value={draft.profileId ?? ''}
              onChange={(event) => edit({ profileId: event.target.value || null })}
            >
              <NativeSelectOption value="">Le foyer</NativeSelectOption>
              {profiles.map((profile) => (
                <NativeSelectOption key={profile.id} value={profile.id}>
                  {profile.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {timer ? (
            <Field id="alarms-new-minutes" label="Durée (minutes)">
              <Input
                id="alarms-new-minutes"
                inputMode="decimal"
                value={draft.minutes}
                onChange={(event) => edit({ minutes: event.target.value })}
              />
            </Field>
          ) : (
            <>
              <Field id="alarms-new-time" label="Heure">
                <Input
                  id="alarms-new-time"
                  type="time"
                  value={draft.time}
                  onChange={(event) => edit({ time: event.target.value })}
                />
              </Field>
              <Field
                id="alarms-new-date"
                label="Date"
                help={
                  draft.days
                    ? 'Les jours cochés remplacent la date.'
                    : 'Vide : la prochaine fois que l’heure arrive.'
                }
              >
                <Input
                  id="alarms-new-date"
                  type="date"
                  value={draft.date}
                  disabled={!!draft.days}
                  onChange={(event) => edit({ date: event.target.value })}
                />
              </Field>
            </>
          )}
          <Field
            id="alarms-new-label"
            label={draft.kind === 'reminder' ? 'Texte du rappel' : 'Nom (facultatif)'}
            className="sm:col-span-3"
          >
            <Input
              id="alarms-new-label"
              value={draft.label}
              maxLength={ALARM_LABEL_MAX}
              placeholder={
                draft.kind === 'reminder'
                  ? 'ex. Sortir les poubelles'
                  : timer
                    ? 'ex. pâtes'
                    : 'ex. travail'
              }
              onChange={(event) => edit({ label: event.target.value })}
            />
          </Field>
        </div>
        {!timer && (
          <div className="space-y-2">
            <p className="text-sm font-medium" id="alarms-new-days">
              Répéter
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="alarms-new-days">
              {ALARM_DAYS.map((day, index) => (
                <PresetButton
                  key={day}
                  active={!!(draft.days & (1 << index))}
                  onClick={() => toggleDay(index)}
                >
                  <span aria-label={day}>{day.slice(0, 3)}</span>
                </PresetButton>
              ))}
              <PresetButton
                active={draft.days === ALARM_WEEKDAYS}
                onClick={() => edit({ days: ALARM_WEEKDAYS, date: '' })}
              >
                En semaine
              </PresetButton>
              <PresetButton
                active={draft.days === ALARM_EVERY_DAY}
                onClick={() => edit({ days: ALARM_EVERY_DAY, date: '' })}
              >
                Tous les jours
              </PresetButton>
            </div>
          </div>
        )}
        {addError && <p className="text-sm text-destructive">{addError}</p>}
        <Button
          size="sm"
          disabled={!ready}
          onClick={() =>
            void run(
              'Échéance ajoutée.',
              async () => {
                show(await api.createAlarm(request(draft)));
                setDraft({ ...emptyDraft, kind: draft.kind, profileId: draft.profileId });
              },
              { onError: (failure) => setAddError(errorMessage(failure)) },
            )
          }
        >
          Ajouter
        </Button>
      </section>

      <section className="space-y-3" aria-labelledby="alarms-list">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="alarms-list" className="font-medium">
            Échéances
          </h4>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              setView(null);
              void reload();
            }}
          >
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
            Actualiser
          </Button>
        </div>
        {current.alarms.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune échéance.</p>
        ) : (
          <ul className="space-y-3">
            {current.alarms.map((alarm) => (
              <AlarmRow
                key={alarm.id + alarm.updatedAt}
                alarm={alarm}
                owner={ownerName(alarm.profileId)}
                run={run}
                onView={show}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Les échéances terminées ou manquées restent affichées une semaine.
        </p>
      </section>
    </>,
  );
}
