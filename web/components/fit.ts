/**
 * Mise en page selon le contenu : un module écrit ce qu’il veut dans les limites du contrat
 * (une valeur de 120 caractères, une ligne de 160), le miroir choisit la taille et le repli.
 * La longueur du texte décide, sans mesure à l’écran : le rendu est juste dès le premier affichage.
 */

/** Au-delà, une valeur principale est une phrase : petite, sur deux lignes au plus. */
const VALUE_LONG = 24;
/** Au-delà, la valeur d’une ligne est une phrase (un titre, un message), plus un chiffre. */
const ROW_TEXT = 20;

/**
 * Valeur principale : sa longueur en caractères (l’icône en compte deux), que la feuille de
 * style divise par la largeur réelle de la tuile pour choisir la taille, et `long` quand c’est
 * une phrase.
 */
export function valueFit(value: string, icon = false): { chars: number; long: boolean } {
  const length = [...value.trim()].length;
  return { chars: length + (icon ? 2 : 0), long: length > VALUE_LONG };
}

/**
 * Forme d’une ligne : `pair` (étiquette qui cède, valeur courte entière à droite) ou `text`
 * (étiquette courte, valeur qui se replie sur deux lignes).
 */
export function rowKind(item: { value: string }): 'pair' | 'text' {
  return [...item.value.trim()].length > ROW_TEXT ? 'text' : 'pair';
}
