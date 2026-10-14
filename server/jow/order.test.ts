/** Le lien de commande : reconnaissance, lecture des plats, aucune fuite du jeton. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchOrderRecipeIds, parseOrderLink } from './order.ts';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const LIEN = 'https://jow.fr/cooking/recipes-selection/s123?key=CLE&userId=U1';

describe('parseOrderLink', () => {
  it('reconnaît le lien dans un texte de partage', () => {
    assert.deepEqual(parseOrderLink(`Ma commande : ${LIEN}`),
      { sharingId: 's123', key: 'CLE', userId: 'U1' });
  });
  it('reconnaît la forme app.jow.com avec sharingId en paramètre', () => {
    assert.deepEqual(
      parseOrderLink('https://app.jow.com/abc?action=menuSharing&sharingId=s456&userId=U2&key=CLE2'),
      { sharingId: 's456', key: 'CLE2', userId: 'U2' });
  });
  it('refuse une recette, un autre domaine ou un lien sans clé', () => {
    assert.equal(parseOrderLink(`https://jow.fr/recipes/x-${'c'.repeat(20)}`), null);
    assert.equal(parseOrderLink('https://exemple.test/cooking/recipes-selection/s?key=a&userId=b'), null);
    assert.equal(parseOrderLink('https://jow.fr/cooking/recipes-selection/s'), null);
  });
});

describe('fetchOrderRecipeIds', () => {
  const ok = (body: unknown, vues: string[] = []): typeof fetch =>
    ((u: URL) => { vues.push(String(u)); return Promise.resolve(Response.json(body)); }) as never;

  it('rend les ObjectId des plats, dans l’ordre, et écarte le reste', async () => {
    const ids = await fetchOrderRecipeIds(parseOrderLink(LIEN)!, {
      fetchImpl: ok({ meals: [{ recipe: { id: A } }, { recipe: {} }, { recipe: { id: B } }, { recipe: { id: A } }] }),
    });
    assert.deepEqual(ids, [A, B, A]);
  });

  it('appelle l’API avec les trois paramètres', async () => {
    const vues: string[] = [];
    await fetchOrderRecipeIds(parseOrderLink(LIEN)!, { fetchImpl: ok({ meals: [] }, vues) });
    const u = new URL(vues[0]!);
    assert.equal(u.origin + u.pathname, 'https://api.jow.fr/public/share/link/details');
    assert.deepEqual([...u.searchParams], [['key', 'CLE'], ['userId', 'U1'], ['sharingId', 's123']]);
  });

  it('ne reprend jamais le jeton dans une erreur', async () => {
    const refus = (() => Promise.resolve(new Response('', { status: 403 }))) as unknown as typeof fetch;
    const panne = (() => Promise.reject(new Error('https://api.jow.fr/?key=CLE'))) as unknown as typeof fetch;
    for (const fetchImpl of [refus, panne]) {
      await assert.rejects(fetchOrderRecipeIds(parseOrderLink(LIEN)!, { fetchImpl }),
        (e: Error) => !/CLE|U1/.test(e.message));
    }
  });
});
