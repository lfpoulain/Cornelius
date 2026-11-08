import type { ToolResult } from '../../shared/addons.js';

/** Outil vocal du mot de fin : la personne clôt l’échange (« merci », « c’est tout »). */
export const END_CONVERSATION_TOOL = 'conversation__end';

export const endConversationTool = {
  name: END_CONVERSATION_TOOL,
  description:
    'Fermer la conversation quand la personne la clôt sans nouvelle demande : « merci », « merci, c’est tout », « c’est bon », « ça ira », « au revoir », « bonne nuit », « tu peux arrêter ». Pas pour un « merci » suivi d’une autre demande ni pendant une question en attente. La formule de politesse est déjà dite : n’ajoute rien après.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {},
  } as Record<string, unknown>,
};

/**
 * Mots qu'une phrase de fin peut contenir, sans rien demander d'autre. Ni « oui » ni « non » :
 * « oui merci » répond à une question de Cornelius et ne clôt rien.
 */
const closingWords = new Set([
  'merci',
  'beaucoup',
  'bien',
  'mille',
  'fois',
  'cornelius',
  'c',
  'est',
  'tout',
  'bon',
  'ok',
  'okay',
  'd',
  'accord',
  'super',
  'parfait',
  'génial',
  'top',
  'nickel',
  'cool',
  'ça',
  'ira',
  'va',
  'aller',
  'au',
  'revoir',
  'bonne',
  'nuit',
  'soirée',
  'journée',
  'à',
  'plus',
  'tard',
  'demain',
  'tu',
  'peux',
  'arrêter',
  'te',
  'reposer',
  'voilà',
  'cest',
]);
/** Ce qui fait d'une phrase une fin d'échange ; « ok » ou « super » seuls ne suffisent pas. */
const closingMarkers = [
  /merci/u,
  /c ?est tout/u,
  /ça ira/u,
  /ça va aller/u,
  /au revoir/u,
  /bonne (nuit|soirée|journée)/u,
  /à (plus|demain)/u,
  /tu peux (arrêter|te reposer)/u,
];

/**
 * La phrase de la personne clôt l'échange, sans autre demande : « merci », « merci beaucoup,
 * c'est tout », « ok au revoir ». « Merci, et la météo ? » ne clôt pas. La transcription
 * arrive par morceaux, d'où la normalisation (casse, ponctuation, apostrophes).
 */
export function isClosingPhrase(text: string): boolean {
  const words = text
    .toLocaleLowerCase('fr-FR')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length || words.length > 12) return false;
  if (!words.every((word) => closingWords.has(word))) return false;
  const phrase = words.join(' ');
  return closingMarkers.some((marker) => marker.test(phrase));
}

/** Résultat renvoyé à Luna : rien à dire de plus, la fermeture suit la fin de la réponse. */
export function endConversationResult(accepted: boolean): ToolResult {
  const summary = accepted
    ? 'Conversation fermée dès la fin de ta réponse. Ne dis rien de plus.'
    : 'La conversation ne peut pas être fermée maintenant.';
  return {
    schemaVersion: 1,
    status: accepted ? 'succeeded' : 'failed',
    result: { accepted },
    snapshotId: null,
    actionRunId: null,
    summary,
    error: accepted ? null : { code: 'unavailable', message: summary, retryable: false },
  };
}
