import { stripAccents } from './text.js';

/**
 * Deux membres du foyer ne portent pas le même nom : Cornelius les appelle par ce nom et
 * l’administration les choisit dans des listes. La comparaison ignore la casse, les accents et
 * les espaces répétés (« Élodie » et « elodie » sont le même nom).
 */
export function profileNameKey(name: string): string {
  return stripAccents(name).toLocaleLowerCase('fr').replace(/\s+/gu, ' ').trim();
}

/** Profil déjà nommé ainsi, en dehors de `exceptId` (le profil que l’on renomme). */
export function sameNameProfile<T extends { id: string; name: string }>(
  profiles: readonly T[],
  name: string,
  exceptId: string | null = null,
): T | null {
  const key = profileNameKey(name);
  if (!key) return null;
  return (
    profiles.find((profile) => profile.id !== exceptId && profileNameKey(profile.name) === key) ??
    null
  );
}

/** Message commun au serveur et à l’administration quand un nom est déjà pris. */
export function duplicateNameMessage(existing: string, requested: string): string {
  const name = requested.trim();
  const example = name.charAt(0).toLocaleUpperCase('fr') + name.slice(1) + ' B.';
  return `« ${existing} » fait déjà partie du foyer. Ajoutez une initiale pour les distinguer, par exemple « ${example} ».`;
}
