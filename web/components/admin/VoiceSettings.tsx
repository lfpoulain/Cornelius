import { voiceProviderLabel, VOICE_PROVIDERS } from '../../../shared/voice-provider';
import type { MirrorState } from '../../../shared/types';
import {
  DEFAULT_LIVE_VOICE,
  FRENCH_VOICES,
  LIVE_VOICES,
  isLiveVoice,
  voiceLabel,
} from '../../../shared/voices';
import { api } from '../../api';
import type { RunAction } from './types';
import { Field } from './shared';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Voix de Cornelius : les deux voix conseillées pour le français d’abord. */
export function VoiceSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const voice = isLiveVoice(state.speechVoice) ? state.speechVoice : DEFAULT_LIVE_VOICE;
  const others = LIVE_VOICES.filter((item) => !FRENCH_VOICES.includes(item));
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
          help="Ajoutez sa clé dans Mise en route → Clés et jetons. Le changement s’applique à la prochaine conversation."
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
            <Field
              className="max-w-sm"
              id="speech-voice"
              label="Voix"
              help={
                FRENCH_VOICES.includes(voice)
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
                  const next = event.target.value;
                  void run(
                    `Voix : ${voiceLabel(next as typeof voice)}.`,
                    () => api.speechVoice(next),
                    {
                      key: 'speech-voice',
                      payload: next,
                    },
                  );
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
