/**
 * La chaîne complète — texte partagé → recette — et ses deux entrées.
 *
 * La feuille de partage d'Android donne un ObjectId ; le lien **copié depuis
 * le site** donne l'URL canonique à suffixe, qui n'en porte aucun. Les deux
 * doivent aboutir, sans quoi « coller un lien Jow » ne sert à rien.
 *
 * Rien ne part sur le vrai réseau ici : `fetchImpl` est fourni, et le test
 * vérifie aussi les cas où **aucune** requête ne doit être émise.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { resolveShare } from './index.ts';

const DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(`${DIR}risotto-aux-poireaux.json`, 'utf8'),
) as { url: string; recipe: Record<string, unknown> };

const ID = String(FIXTURE.recipe['id']);
const CANONIQUE = FIXTURE.url;

const PAGE = `<html><body><script id="__NEXT_DATA__" type="application/json">${
  JSON.stringify({ props: { pageProps: { recipe: FIXTURE.recipe } } })
}</script></body></html>`;

/** Un `fetch` de mensonge, qui note ce qu'on lui a demandé. */
function faux(routes: Record<string, string>): { impl: typeof fetch; vues: string[] } {
  const vues: string[] = [];
  const impl = ((url: string | URL) => {
    const key = String(url);
    vues.push(key);
    const body = routes[key];
    return Promise.resolve(
      body === undefined ? new Response('', { status: 404 }) : new Response(body, { status: 200 }),
    );
  }) as unknown as typeof fetch;
  return { impl, vues };
}

describe('resolveShare — les deux entrées', () => {
  it('résout le texte de la feuille de partage par son ObjectId', async () => {
    const { impl, vues } = faux({ [`https://jow.fr/fr/recipes/${ID}`]: PAGE });

    const recipe = await resolveShare(
      `Regarde cette recette : https://jow.fr/fr/recipes/${ID}?key=SECRET`,
      { fetchImpl: impl },
    );

    assert.equal(recipe.confidence, 'haute', recipe.warnings.join(' | '));
    assert.equal(recipe.jowRecipeId, ID);
    assert.deepEqual(vues, [`https://jow.fr/fr/recipes/${ID}`], 'le jeton ne part pas non plus');
  });

  it('résout une URL canonique collée à la main, qui ne porte pas d’ObjectId', async () => {
    assert.doesNotMatch(new URL(CANONIQUE).pathname, /[a-f0-9]{24}/, 'fixture inattendue');
    const { impl, vues } = faux({ [CANONIQUE]: PAGE });

    const recipe = await resolveShare(CANONIQUE, { fetchImpl: impl });

    assert.equal(recipe.confidence, 'haute', recipe.warnings.join(' | '));
    // L'identifiant vient de la page : la recette se dédoublonne comme les
    // autres, qu'elle soit arrivée par un partage ou par un copier-coller.
    assert.equal(recipe.jowRecipeId, ID);
    assert.deepEqual(vues, [CANONIQUE]);
  });
});

describe('resolveShare — ce qui ne part pas sur le réseau', () => {
  for (const [cas, texte] of [
    ['un texte sans lien', 'des pâtes au beurre'],
    ['une URL hors de Jow', 'https://exemple.test/recipes/ma-tarte'],
    ['une page Jow qui n’est pas une recette', 'https://jow.fr/fr/panier'],
    ['un hôte qui imite Jow', 'https://jow.fr.exemple.test/recipes/tarte'],
  ] as const) {
    it(`${cas} : repli en saisie manuelle, sans requête`, async () => {
      const { impl, vues } = faux({});
      const recipe = await resolveShare(texte, { fetchImpl: impl });

      assert.equal(recipe.confidence, 'basse');
      assert.equal(recipe.ingredients.length, 0, 'rien n’est inventé');
      assert.deepEqual(vues, []);
    });
  }
});
