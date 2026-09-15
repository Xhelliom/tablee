/**
 * L'image d'un plat : l'étiquette qui évite de la redessiner, et la lecture de
 * la réponse du modèle.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dishTag, readImage } from './image.ts';

describe('l’image d’un plat', () => {
  it('étiquette les ingrédients sans ordre ni doublon, l’aliment Ciqual avant le libellé', () => {
    const oeuf = (label: string): { foodId: string; label: string } => ({ foodId: 'oeuf', label });
    assert.equal(
      dishTag([oeuf('2 œufs'), { foodId: null, label: 'Truffe' }]),
      dishTag([{ foodId: null, label: ' truffe ' }, oeuf('3 œufs'), oeuf('un œuf')]),
    );
    assert.notEqual(dishTag([oeuf('2 œufs')]), dishTag([oeuf('2 œufs'), { foodId: null, label: 'truffe' }]));
  });

  it('lit l’image de la réponse, et rien qu’un navigateur exécuterait', () => {
    const réponse = (mimeType: string): unknown => ({
      candidates: [{ content: { parts: [
        { text: 'Voici le plat.' },
        { inlineData: { mimeType, data: Buffer.from('png').toString('base64') } },
      ] } }],
    });
    assert.deepEqual(readImage(réponse('image/png')), { mimeType: 'image/png', bytes: Buffer.from('png') });
    assert.equal(readImage(réponse('text/html')), null);
    assert.equal(readImage({ candidates: [] }), null);
    assert.equal(readImage(null), null);
  });
});
