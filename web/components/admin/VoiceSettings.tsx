import { voiceProviderLabel, VOICE_PROVIDERS } from '../../../shared/voice-provider';
import type { MirrorState } from '../../../shared/types';
import {
  DEFAULT_LIVE_VOICE,
  FRENCH_VOICES,
  LIVE_VOICES,
  LOCALIVE_VOICE_BY_GENDER,
  isLiveVoice,
  localiveGender,
  voiceLabel,
  type LiveVoice,
} from '../../../shared/voices';
import { api } from '../../api';
import type { RunAction } from './types';
import { Field } from './shared';
import { LiveEndpointSettings } from './LiveEndpointSettings';
import { useLiveEndpoint } from './liveEndpointStore';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Voix de Cornelius : les deux voix conseillées pour le français d’abord. */
export function VoiceSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const voice = isLiveVoice(state.speechVoice) ? state.speechVoice : DEFAULT_LIVE_VOICE;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Voix de Cornelius</CardTitle>
        <CardDescription>
          La nouvelle voix s’entend à la prochaine conversation : celle en cours garde la sienne.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field
          id="voice-provider"
          label="Fournisseur de la conversation"
          help="Ajoutez sa clé dans Clés et accès → Clés et jetons. Le changement s’applique à la prochaine conversation."
        >
          <NativeSelect
            id="voice-provider"
            value={state.voiceProvider ?? 'openai'}
            onChange={(event) => {
              const provider = event.target.value;
              void run('Fournisseur vocal enregistré.', () => api.voiceProvider(provider), {
                key: 'voice-provider',
                payload: provider,
              });
            }}
          >
            {VOICE_PROVIDERS.map((provider) => (
              <NativeSelectOption key={provider} value={provider}>
                {voiceProviderLabel(provider)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {state.voiceProvider === 'mistral' ? (
          <p className="text-sm text-muted-foreground">
            Voxtral 3 écoute et répond en français avec la voix Marie. La clé OpenAI reste
            disponible pour les images.
          </p>
        ) : (
          <>
            <LiveEndpointSettings run={run} />
            <SpeechVoiceField voice={voice} run={run} />
            <WaitForReplyField enabled={state.waitForReply === true} run={run} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Localive seulement : le micro est ignoré de la fin de la demande au début de la réponse.
 * Localive l’applique lui-même, au moment où il valide la fin de la phrase.
 */
function WaitForReplyField({ enabled, run }: { enabled: boolean; run: RunAction }) {
  const { view } = useLiveEndpoint();
  if (view?.kind !== 'localive') return null;
  return (
    <label className="admin-mode-option admin-wake-option">
      <input
        type="checkbox"
        aria-label="Attendre la réponse avant de réécouter"
        aria-describedby="wait-for-reply-detail"
        checked={enabled}
        onChange={(event) => {
          const next = event.target.checked;
          void run(
            next
              ? 'Cornelius attendra sa réponse avant de réécouter.'
              : 'Cornelius écoute aussi pendant qu’il réfléchit.',
            () => api.waitForReply(next),
            { key: 'wait-for-reply', payload: { enabled: next } },
          );
        }}
      />
      <span className="admin-mode-card">
        <span className="admin-mode-top">
          <strong>Attendre la réponse avant de réécouter</strong>
          <span className="admin-checkbox" aria-hidden="true" />
        </span>
        <span className="admin-mode-detail" id="wait-for-reply-detail">
          Une fois votre demande comprise, Cornelius n’écoute plus pendant qu’il réfléchit : une
          voix dans la pièce ne peut ni l’interrompre ni remplacer votre demande. Une phrase
          d’attente (« Je cherche ça… ») ne rouvre pas le micro ; la réponse le rouvre, et vous
          pouvez alors la couper. S’applique à la prochaine conversation.
        </span>
      </span>
    </label>
  );
}

const others = LIVE_VOICES.filter((item) => !FRENCH_VOICES.includes(item));

/**
 * Voix demandée au serveur Live. OpenAI parle avec la voix choisie ; Localive avec ses propres
 * voix (Phonon), dont il ne retient que le genre : on ne propose alors que ce choix.
 */
function SpeechVoiceField({ voice, run }: { voice: LiveVoice; run: RunAction }) {
  const { view } = useLiveEndpoint();
  const choose = (next: LiveVoice, label: string) =>
    void run(label, () => api.speechVoice(next), { key: 'speech-voice', payload: next });
  if (view?.kind === 'localive') {
    const gender = localiveGender(voice);
    return (
      <Field
        className="max-w-sm"
        id="speech-voice"
        label="Voix de Localive"
        help="Localive parle avec ses propres voix : choisissez-les dans son administration (Voix). Cornelius lui demande seulement la voix féminine ou masculine."
      >
        <NativeSelect
          id="speech-voice"
          wrapperClassName="w-full"
          className="w-full"
          value={gender}
          onChange={(event) => {
            const next = event.target.value === 'male' ? 'male' : 'female';
            choose(
              LOCALIVE_VOICE_BY_GENDER[next],
              next === 'male' ? 'Voix masculine de Localive.' : 'Voix féminine de Localive.',
            );
          }}
        >
          <NativeSelectOption value="female">Voix féminine</NativeSelectOption>
          <NativeSelectOption value="male">Voix masculine</NativeSelectOption>
        </NativeSelect>
      </Field>
    );
  }
  const compatible = view?.kind === 'compatible';
  return (
    <Field
      className="max-w-sm"
      id="speech-voice"
      label="Voix"
      help={
        compatible
          ? 'Voix d’OpenAI : un serveur compatible peut la remplacer par la sienne.'
          : FRENCH_VOICES.includes(voice)
            ? 'Conseillée pour le français : sans accent étranger marqué.'
            : 'Cette voix peut garder un léger accent anglais en français. Cedar et Marin sont conseillées.'
      }
    >
      <NativeSelect
        id="speech-voice"
        wrapperClassName="w-full"
        className="w-full"
        value={voice}
        onChange={(event) => {
          const next = event.target.value as LiveVoice;
          choose(next, `Voix : ${voiceLabel(next)}.`);
        }}
      >
        <optgroup label="Conseillées pour le français">
          {FRENCH_VOICES.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {voiceLabel(item)}
              {item === DEFAULT_LIVE_VOICE ? ' (par défaut)' : ''}
            </NativeSelectOption>
          ))}
        </optgroup>
        <optgroup label="Autres voix">
          {others.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {voiceLabel(item)}
            </NativeSelectOption>
          ))}
        </optgroup>
      </NativeSelect>
    </Field>
  );
}
