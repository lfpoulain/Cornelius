/**
 * Texte sans accents ni autres signes combinants (« Élodie » devient « Elodie »), pour comparer
 * ou chercher des mots sans dépendre de la façon dont ils ont été saisis ou entendus.
 */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}
