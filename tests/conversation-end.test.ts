import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanEndPhrases, isClosingPhrase, isNewRequest } from '../server/live/conversation-end.js';

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
    'Ça va aller, merci.',
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
    // Réponse à « comment ça va ? », pas une fin.
    'Ça va bien, merci.',
    'ça va merci',
    'merci '.repeat(13),
  ])
    assert.equal(isClosingPhrase(said), false, said);
});

test('nouvelle demande : une vraie phrase, pas une hésitation', () => {
  for (const said of [
    'Ah, et la météo de demain ?',
    'Allume le salon',
    'Attends',
    'Quelle heure ?',
  ])
    assert.equal(isNewRequest(said), true, said);
  for (const said of ['', 'Euh…', 'Oui', 'ok', 'Hein ?', 'Ah !', 'non'])
    assert.equal(isNewRequest(said), false, said);
});

test('formules du foyer : la phrase entière, à la ponctuation près, et nettoyées', () => {
  const extra = ['C’est bon Jarvis', 'ciao'];
  assert.equal(isClosingPhrase('c’est bon, Jarvis !', extra), true);
  assert.equal(isClosingPhrase('Ciao.', extra), true);
  assert.equal(isClosingPhrase('ciao, et la météo ?', extra), false);
  assert.equal(isClosingPhrase('c’est bon Jarvis', []), false);
  assert.deepEqual(cleanEndPhrases(['  ciao ', 'Ciao !', '', 'x'.repeat(61), 'à plus  tard']), [
    'ciao',
    'à plus tard',
  ]);
  assert.equal(cleanEndPhrases(Array.from({ length: 30 }, (_, i) => 'formule ' + i)).length, 20);
});
