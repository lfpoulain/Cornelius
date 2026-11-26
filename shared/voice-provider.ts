export const VOICE_PROVIDERS = ['openai', 'mistral', 'xai'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export const voiceProviderLabel = (provider: VoiceProvider) =>
  provider === 'mistral'
    ? 'Mistral · Voxtral 3'
    : provider === 'xai'
      ? 'xAI · Grok Voice'
      : 'OpenAI · GPT Live';
/** Nom court du fournisseur, pour les messages (« Clé xAI absente »). */
export const voiceProviderName = (provider: VoiceProvider) =>
  provider === 'mistral' ? 'Mistral' : provider === 'xai' ? 'xAI' : 'OpenAI';
/** Variable de la clé du fournisseur vocal. */
export const voiceProviderKey = (provider: VoiceProvider) =>
  provider === 'mistral'
    ? 'MISTRAL_API_KEY'
    : provider === 'xai'
      ? 'XAI_API_KEY'
      : 'OPENAI_API_KEY';
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'openai' || value === 'mistral' || value === 'xai';
}

/** Voix de Grok Voice (xAI) proposées dans l'administration, avec leur style annoncé par xAI. */
export const XAI_VOICES = [
  { id: 'eve', label: 'Eve · féminine, énergique' },
  { id: 'ara', label: 'Ara · féminine, chaleureuse' },
  { id: 'sal', label: 'Sal · neutre, posée' },
  { id: 'rex', label: 'Rex · masculine, assurée' },
  { id: 'leo', label: 'Leo · masculine, grave' },
] as const;
export type XaiVoice = (typeof XAI_VOICES)[number]['id'];
export const DEFAULT_XAI_VOICE: XaiVoice = 'eve';
export function isXaiVoice(value: unknown): value is XaiVoice {
  return XAI_VOICES.some((voice) => voice.id === value);
}
