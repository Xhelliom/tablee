import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseShareText, redactShareText, redactUrl, slugify } from './share.ts';

/** Forme observée d'un partage Jow : une phrase, le titre, puis le lien. */
const SHARE_TEXT = [
  'Découvre cette recette sur Jow :',
  'Galette végé, purée de carotte & tzatziki',
  'https://app.jow.com/EC0U?recipeId=650b16ade7cc8d0013ce4a6e&key=s3cr3t-de-compte&userId=507f1f77bcf86cd799439011',
].join('\n');

describe('expurgation des secrets (I6)', () => {
  it('retire key et userId, garde recipeId', () => {
    const clean = redactShareText(SHARE_TEXT);
    assert.ok(!clean.includes('s3cr3t-de-compte'), 'le token key a fuité');
    assert.ok(!clean.includes('507f1f77bcf86cd799439011'), 'le userId a fuité');
    assert.ok(clean.includes('recipeId=650b16ade7cc8d0013ce4a6e'));
  });

  it('expurge aussi une URL non parsable', () => {
    const clean = redactUrl('jow://open?recipeId=650b16ade7cc8d0013ce4a6e&key=abc');
    assert.ok(!clean.includes('abc'));
  });

  it('ne laisse aucun secret dans ce que le parseur renvoie', () => {
    const share = parseShareText(SHARE_TEXT);
    assert.ok(!JSON.stringify(share).includes('s3cr3t-de-compte'));
    assert.ok(!JSON.stringify(share).includes('507f1f77bcf86cd799439011'));
  });
});

describe('parseShareText', () => {
  it('extrait identifiant, titre et URL', () => {
    const share = parseShareText(SHARE_TEXT);
    assert.equal(share.jowRecipeId, '650b16ade7cc8d0013ce4a6e');
    assert.equal(share.title, 'Galette végé, purée de carotte & tzatziki');
    assert.ok(share.url?.startsWith('https://app.jow.com/EC0U'));
  });

  it('ne lève pas sur un texte sans rien d’exploitable', () => {
    const share = parseShareText('coucou');
    assert.equal(share.jowRecipeId, null);
    assert.equal(share.title, 'coucou');
  });

  it('ne lève pas sur une chaîne vide', () => {
    assert.doesNotThrow(() => parseShareText(''));
  });
});

describe('slugify', () => {
  it('reproduit le slug publié par Jow', () => {
    assert.equal(
      slugify('Galette végé, purée de carotte & tzatziki'),
      'galette-vege-puree-de-carotte-et-tzatziki',
    );
  });
});
