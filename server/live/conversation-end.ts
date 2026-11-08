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
