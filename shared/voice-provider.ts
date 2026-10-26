export const VOICE_PROVIDERS = ['openai', 'mistral'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export const voiceProviderLabel = (provider: VoiceProvider) =>
  provider === 'mistral' ? 'Mistral · Voxtral 3' : 'OpenAI · GPT Live';
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'openai' || value === 'mistral';
}
