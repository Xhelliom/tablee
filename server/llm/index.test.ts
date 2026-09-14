/**
 * La porte vers Anthropic : ce qu'on retire d'un texte avant qu'il parte.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anonymize, namesToHide } from './index.ts';

describe('ce qui part vers le modèle', () => {
  it('retire les prénoms donnés, mot entier et sans égard à la casse (I3)', () => {
    assert.equal(
      anonymize('Léa et LÉO ont pris un yaourt', ['Léa', 'Léo']),
      'quelqu’un et quelqu’un ont pris un yaourt',
    );
  });

  it('ne touche pas un mot qui contient un prénom', () => {
    assert.equal(anonymize('Léandre a mangé', ['Léa']), 'Léandre a mangé');
  });

  it('retire le jeton d’un lien Jow collé dans le texte (I6)', () => {
    const sortie = anonymize('comme https://jow.fr/fr/recipes/abc?key=SECRET hier', []);
    assert.ok(!sortie.includes('SECRET'), sortie);
  });

  it('cache les prénoms des fiches et les mots assez longs du nom du compte', () => {
    assert.deepEqual(namesToHide([{ firstName: 'Léa' }], 'Sam de Vries'), ['Léa', 'Sam', 'Vries']);
  });
});
