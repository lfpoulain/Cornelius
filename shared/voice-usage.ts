export type VoiceProvider = 'openai' | 'mistral';

/** Temps de conversation d’une période, et son coût estimé si un prix est saisi. */
export interface VoiceUsagePeriod {
  /** Tous fournisseurs confondus. */
  seconds: number;
  sessions: number;
  /** Temps passé avec le fournisseur facturé à la durée, seul à entrer dans le coût. */
  meteredSeconds: number;
  /** Arrondi au centime, sur meteredSeconds seulement ; null sans prix par minute. */
  cost: number | null;
}

export interface VoiceUsageView {
  today: VoiceUsagePeriod;
  month: VoiceUsagePeriod;
  previousMonth: VoiceUsagePeriod;
  /** Prix par minute du fournisseur facturé à la durée ; null : pas d’estimation. */
  perMinute: number | null;
  currency: '$' | '€';
  /** Fournisseur vocal choisi aujourd’hui. */
  provider: VoiceProvider;
  /** Fournisseur dont le coût est estimé (facturé à la minute). */
  meteredProvider: VoiceProvider;
}
