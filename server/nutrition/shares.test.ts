import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculerShares } from './shares.ts';

const sum = (shares: { share: number }[]): number =>
  Math.round(shares.reduce((t, s) => t + s.share, 0) * 1000) / 1000;

describe('calculerShares', () => {
  // ── Test structurant n° 1 (§15) ────────────────────────────────────────────
  it('Σ des share d’un repas sans invité vaut exactement 1', () => {
    const familles = [
      [1, 1],
      [1, 1, 0.75, 0.5],
      [1, 1, 1],                 // le cas qui casse un arrondi naïf : 0,333 × 3
      [1],
      [0.5, 0.5, 0.5],
      [1, 0.75, 0.75, 0.5, 0.5, 0.25, 1.25],
      [2, 0.05],
    ];
    for (const coefs of familles) {
      const shares = calculerShares(
        coefs.map((portionCoef, i) => ({ memberId: `m${i}`, portionCoef })),
        0,
      );
      assert.equal(sum(shares), 1, `coefs ${coefs.join('/')} → Σ = ${sum(shares)}`);
    }
  });

  it('répartit proportionnellement aux coefficients', () => {
    const shares = calculerShares([
      { memberId: 'papa', portionCoef: 1 },
      { memberId: 'lea', portionCoef: 0.5 },
    ]);
    assert.deepEqual(shares, [
      { memberId: 'papa', share: 0.667 },
      { memberId: 'lea', share: 0.333 },
    ]);
  });

  // ── Test structurant n° 2 (§15) ────────────────────────────────────────────
  it('avec des invités, Σ < 1 et les assiettes du foyer ne gonflent pas', () => {
    const foyer = [
      { memberId: 'papa', portionCoef: 1 },
      { memberId: 'maman', portionCoef: 1 },
      { memberId: 'lea', portionCoef: 0.5 },
    ];
    const sans = calculerShares(foyer, 0);
    const avec = calculerShares(foyer, 2);

    assert.equal(sum(sans), 1);
    assert.ok(sum(avec) < 1, `Σ avec invités = ${sum(avec)}`);
    // 2,5 coefs de foyer sur 4,5 au total.
    assert.equal(sum(avec), 0.556);

    // Aucune assiette du foyer ne grossit du fait des invités : chacune rétrécit.
    for (const [i, part] of avec.entries()) {
      const reference = sans[i];
      assert.ok(reference !== undefined);
      assert.equal(part.memberId, reference.memberId);
      assert.ok(part.share < reference.share, `${part.memberId} a gonflé`);
    }
  });

  it('un invité compte pour un adulte de référence', () => {
    const seul = calculerShares([{ memberId: 'papa', portionCoef: 1 }], 1);
    assert.deepEqual(seul, [{ memberId: 'papa', share: 0.5 }]);
  });

  it('ne rend rien quand personne n’était à table', () => {
    assert.deepEqual(calculerShares([], 0), []);
    assert.deepEqual(calculerShares([], 3), []);
  });

  it('refuse un coefficient ou un nombre d’invités absurde', () => {
    assert.throws(() => calculerShares([{ memberId: 'x', portionCoef: 0 }]));
    assert.throws(() => calculerShares([{ memberId: 'x', portionCoef: -1 }]));
    assert.throws(() => calculerShares([{ memberId: 'x', portionCoef: 1 }], -1));
    assert.throws(() => calculerShares([{ memberId: 'x', portionCoef: 1 }], 1.5));
  });

  it('ne dépend pas de l’ordre des convives à reste égal', () => {
    const a = calculerShares([
      { memberId: 'a', portionCoef: 1 },
      { memberId: 'b', portionCoef: 1 },
      { memberId: 'c', portionCoef: 1 },
    ]);
    // Le millième surnuméraire va au premier entré, de façon déterministe.
    assert.deepEqual(a.map((s) => s.share), [0.334, 0.333, 0.333]);
    assert.equal(sum(a), 1);
  });

  it('tient dans numeric(4,3)', () => {
    for (const shares of [
      calculerShares([{ memberId: 'a', portionCoef: 2 }, { memberId: 'b', portionCoef: 0.05 }]),
      calculerShares([{ memberId: 'a', portionCoef: 1 }], 99),
    ]) {
      for (const { share } of shares) {
        assert.ok(share >= 0 && share <= 9.999);
        assert.equal(share, Math.round(share * 1000) / 1000);
      }
    }
  });
});
