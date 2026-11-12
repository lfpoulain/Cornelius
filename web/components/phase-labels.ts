import type { SessionPhase } from '../../shared/types';

// Module sans dépendance : l’administration lit ces libellés sans charger le miroir
// (three.js, pile audio).
export const phaseLabels: Record<SessionPhase, string> = {
  idle: 'En veille',
  connecting: 'Connexion en cours',
  ready: 'Prêt',
  closing: 'Fermeture en cours',
  blocked: 'Session indisponible',
};
