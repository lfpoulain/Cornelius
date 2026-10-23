import { DEFAULT_SCREENSAVER } from '../../shared/screensaver';
import type { MirrorState, SessionPhase } from '../../shared/types';

/**
 * Vrai quand l’orbe doit revenir devant l’écran de veille.
 *
 * - « presence » (au moindre mouvement) : dès qu’une personne passe devant le miroir.
 * - « opening » (selon le réveil de Cornelius) : quand Cornelius s’éveillerait, d’après
 *   « Quand il écoute » — une personne qui se présente, une personne qui regarde le miroir, ou
 *   le mot « Cornelius » (la conversation qui s’ouvre). Réservée aux membres du foyer,
 *   l’ouverture ne compte qu’une personne reconnue. La présence ou le regard suffisent même
 *   quand la conversation ne peut pas s’ouvrir (clé absente, OpenAI bloqué) : la personne voit
 *   alors la ligne d’état.
 *
 * Le regard est celui du serveur (presence.state « engaged »), qui ouvre aussi la
 * conversation : il n’est attribué à une personne précise que si elle est seule ou active.
 * Une conversation ouverte (ou en cours d’ouverture) réveille toujours l’orbe.
 */
export function screensaverWoken(state: MirrorState, phase: SessionPhase): boolean {
  if (phase !== 'idle') return true;
  const presence = state.presence;
  if (presence.health !== 'ok' || presence.state === 'absent') return false;
  if ((state.screensaver?.wake ?? DEFAULT_SCREENSAVER.wake) === 'presence') return true;
  const opening = state.opening;
  if (!opening || opening.trigger === 'voice') return false;
  const allowed =
    opening.audience === 'everyone' || presence.people.some((person) => person.profileId !== null);
  return allowed && (opening.trigger === 'presence' || presence.state === 'engaged');
}
