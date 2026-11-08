import assert from 'node:assert/strict';
import test from 'node:test';
import { isClosingPhrase } from '../server/live/conversation-end.js';

test('phrase de fin : formules qui clôturent l’échange', () => {
  for (const said of [
    'Merci.',
    'merci beaucoup',
    'Merci Cornelius !',
    'Ok, merci, c’est tout.',
    "C'est tout, merci",
    'cest tout',
    'Au revoir',
    'Bonne nuit Cornelius',
    'Super, merci mille fois',
    'Ça ira, merci.',
    'Tu peux arrêter.',
  ])
    assert.equal(isClosingPhrase(said), true, said);
});

test('phrase de fin : une demande, une réponse ou un mot seul ne clôturent pas', () => {
  for (const said of [
    '',
    'Ok',
    'Super !',
    'Oui merci',
    'Merci, et la météo ?',
    'Merci, éteins aussi le salon',
    'Allume le gyrophare',
    'Non merci',
    'merci '.repeat(13),
  ])
    assert.equal(isClosingPhrase(said), false, said);
});
