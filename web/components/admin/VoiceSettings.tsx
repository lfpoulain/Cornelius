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
  if (state.setup?.aiProvider === 'groq')
    return (
      <Card>
        <CardHeader>
          <CardTitle>Voix de Cornelius</CardTitle>
          <CardDescription>
            Groq utilise une voix française locale du navigateur qui affiche le miroir. Installez
            une voix française sur cet appareil et vérifiez sa disponibilité dans le navigateur. Les
            voix GPT-Live ne s’appliquent pas à ce mode. Attendez la fin de la réponse avant de
            parler.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Voix de Cornelius</CardTitle>
        <CardDescription>
          La nouvelle voix s’entend à la prochaine conversation : celle en cours garde la sienne.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              void run(`Voix : ${voiceLabel(next as typeof voice)}.`, () => api.speechVoice(next), {
                key: 'speech-voice',
                payload: next,
              });
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
      </CardContent>
    </Card>
  );
}
