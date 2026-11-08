/** Temps de conversation d’une période, et son coût estimé si un prix est saisi. */
export interface VoiceUsagePeriod {
  seconds: number;
  sessions: number;
  /** Arrondi au centime ; null sans prix par minute. */
  cost: number | null;
}

export interface VoiceUsageView {
  today: VoiceUsagePeriod;
  month: VoiceUsagePeriod;
  previousMonth: VoiceUsagePeriod;
  /** Prix par minute saisi dans l’administration ; null : pas d’estimation. */
  perMinute: number | null;
  currency: '$' | '€';
}
