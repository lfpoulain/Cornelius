import { useEffect, useState } from 'react';
import {
  DEFAULT_SILENCE_CLOSE,
  SILENCE_CLOSE_MAX_MS,
  SILENCE_CLOSE_MIN_MS,
  isSilenceClose,
} from '../../../shared/conversation';
import { currentOpening, voiceOnlyOpening } from '../../../shared/opening';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { FineTuning } from './FineTuning';
import { decimalText, parseDecimal } from './format';
import { DecimalInput, Field, SaveBar } from './shared';
import { ChoiceGroup, type ChoiceOption } from '../ui/choice-card';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Délais proposés d’un geste ; toute autre valeur se règle dans « Réglage fin ». */
export const SILENCE_CLOSE_PRESETS_MS = [10_000, 20_000, 30_000, 60_000, 120_000, 300_000];

/** « 45 s », « 1 min », « 1 min 30 s ». */
export function silenceDelayLabel(delayMs: number): string {
  const seconds = Math.round(delayMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return seconds + ' s';
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Valeur affichée par la liste : « never », un préréglage, ou « custom ». */
export function silenceChoice(settings: { enabled: boolean; delayMs: number }, forced: boolean) {
  if (!settings.enabled && !forced) return 'never';
  return SILENCE_CLOSE_PRESETS_MS.includes(settings.delayMs) ? String(settings.delayMs) : 'custom';
}

/** Fin de parole : la conversation se ferme après un silence, même devant le miroir. */
export function SilenceCloseSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const saved = state.silenceClose ?? DEFAULT_SILENCE_CLOSE;
  // « Cornelius » pour tout le monde : la présence ne termine jamais la conversation, la fin
  // sur silence reste donc toujours active.
  const forced = voiceOnlyOpening(currentOpening(state));
  const choice = silenceChoice(saved, forced);
  const [seconds, setSeconds] = useState(decimalText(saved.delayMs / 1000));
  useEffect(() => {
    setSeconds(decimalText(saved.delayMs / 1000));
  }, [saved.delayMs]);
  const delayMs = Math.round(parseDecimal(seconds) * 1000);
  const valid = Number.isFinite(delayMs) && isSilenceClose({ enabled: true, delayMs });
  // « 20,0 » pour 20 s n’est pas une modification ; une saisie vide ou invalide en est une.
  const dirty =
    seconds !== decimalText(saved.delayMs / 1000) && !(valid && delayMs === saved.delayMs);
  const save = (next: { enabled: boolean; delayMs: number }) =>
    run(
      next.enabled
        ? 'Fin de parole : après ' + silenceDelayLabel(next.delayMs) + ' de silence.'
        : 'Fin de parole : jamais sur un silence.',
      () => api.silenceClose(next),
      { key: 'silence-close', payload: next },
    );
  const options: ChoiceOption<string>[] = [
    { value: 'never', label: 'Jamais', disabled: forced },
    ...SILENCE_CLOSE_PRESETS_MS.map((ms) => ({ value: String(ms), label: silenceDelayLabel(ms) })),
    ...(choice === 'custom'
      ? [{ value: 'custom', label: silenceDelayLabel(saved.delayMs) + ' (personnalisé)' }]
      : []),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fin de parole</CardTitle>
        <CardDescription>
          Fermer la conversation après un silence, même si la personne reste devant le miroir. Le
          délai repart quand la personne parle et attend la fin de la réponse de Cornelius.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChoiceGroup
          legend="Fermer après un silence de"
          compact
          value={choice}
          options={options}
          describedBy="silence-close-help"
          onValueChange={(value) => {
            if (value === 'custom') return false;
            return save(
              value === 'never'
                ? { enabled: false, delayMs: saved.delayMs }
                : { enabled: true, delayMs: Number(value) },
            );
          }}
        />
        <p id="silence-close-help" className="text-xs leading-relaxed text-muted-foreground">
          {forced
            ? '« Jamais » n’est pas disponible avec « Cornelius » pour tout le monde : la caméra éteinte ne voit pas la personne partir, seul le silence termine la conversation.'
            : 'Pour reprendre après la fermeture : regarder à nouveau le miroir, s’éloigner puis revenir, ou dire « Cornelius » s’il ouvre la conversation.'}
        </p>
        <label className="admin-mode-option admin-wake-option">
          <input
            type="checkbox"
            aria-label="Fermer après la première réponse"
            aria-describedby="reply-close-detail"
            checked={state.replyClose === true}
            onChange={(event) => {
              const enabled = event.target.checked;
              void run(
                enabled
                  ? 'Fin de parole : après la première réponse.'
                  : 'Fin de parole : la conversation continue après la réponse.',
                () => api.replyClose(enabled),
                { key: 'reply-close', payload: { enabled } },
              );
            }}
          />
          <span className="admin-mode-card">
            <span className="admin-mode-top">
              <strong>Fermer après la première réponse</strong>
              <span className="admin-checkbox" aria-hidden="true" />
            </span>
            <span className="admin-mode-detail" id="reply-close-detail">
              Une question, une réponse : la conversation se ferme dès que Cornelius a fini de
              répondre à la première demande. L’accueil ne compte pas comme une réponse. Si personne
              ne parle, seul le silence réglé ci-dessus ferme la conversation.
            </span>
          </span>
        </label>
        <label className="admin-mode-option admin-wake-option">
          <input
            type="checkbox"
            aria-label="Fermer quand on dit merci"
            aria-describedby="end-word-detail"
            checked={state.endWord === true}
            onChange={(event) => {
              const enabled = event.target.checked;
              void run(
                enabled
                  ? 'Fin de parole : quand on dit merci.'
                  : 'Fin de parole : « merci » ne ferme plus la conversation.',
                () => api.endWord(enabled),
                { key: 'end-word', payload: { enabled } },
              );
            }}
          />
          <span className="admin-mode-card">
            <span className="admin-mode-top">
              <strong>Fermer quand on dit merci</strong>
              <span className="admin-checkbox" aria-hidden="true" />
            </span>
            <span className="admin-mode-detail" id="end-word-detail">
              « Merci », « c’est tout », « au revoir » : Cornelius répond d’un mot puis ferme la
              conversation, même si quelqu’un parle encore dans la pièce. Un « merci » suivi d’une
              autre demande ne ferme pas. Vaut pour la conversation suivante.
            </span>
          </span>
        </label>
        <FineTuning hint="Délai personnalisé" defaultOpen={choice === 'custom'}>
          <Field
            id="silence-close-delay"
            label="Délai de silence (s)"
            help={`De ${SILENCE_CLOSE_MIN_MS / 1000} à ${SILENCE_CLOSE_MAX_MS / 1000} s. Enregistrer ce délai active la fin de parole.`}
            className="max-w-56"
          >
            <DecimalInput
              id="silence-close-delay"
              value={seconds}
              aria-invalid={!valid || undefined}
              onChange={(event) => setSeconds(event.target.value)}
            />
          </Field>
        </FineTuning>
        <SaveBar
          label="Délai de silence"
          count={dirty ? 1 : 0}
          error={
            valid
              ? null
              : `Indiquez un délai de ${SILENCE_CLOSE_MIN_MS / 1000} à ${SILENCE_CLOSE_MAX_MS / 1000} s.`
          }
          onSave={() => void save({ enabled: true, delayMs })}
          onCancel={() => setSeconds(decimalText(saved.delayMs / 1000))}
        />
      </CardContent>
    </Card>
  );
}
