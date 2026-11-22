export const VOICE_PROVIDERS = ['openai', 'mistral', 'local'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export const voiceProviderLabel = (provider: VoiceProvider) =>
  provider === 'local'
    ? 'Local · Ollama + Whisper + Piper'
    : provider === 'mistral'
      ? 'Mistral · Voxtral 3'
      : 'OpenAI · GPT Live';
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'openai' || value === 'mistral' || value === 'local';
}
