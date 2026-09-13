/**
 * §11 — `calculerShares`.
 *
 * R2 : la part de chacun est calculée **à l'écriture d'un repas, une seule
 * fois**, puis figée dans `meal_participant.share`. Elle n'est jamais
 * recalculée ensuite. Un enfant qui grandit voit son `portion_coef` monter ;
 * si l'historique suivait, les tendances passées deviendraient
 * ininterprétables — on ne saurait plus si une hausse vient de ce qu'il a
 * mangé ou de ce qu'on a décidé qu'il mangeait.
 *
 * C'est la seule fonction autorisée à produire une valeur de `share`.
 */

/** Précision de `meal_participant.share` : `numeric(4,3)`. */
const SCALE = 3;
const FACTOR = 10 ** SCALE;

export interface SharePerson {
  memberId: string;
  portionCoef: number;
}

export interface ComputedShare {
  memberId: string;
  share: number;
}

/**
 * Répartit un repas entre les convives présents.
 *
 * ```
 * somme_coefs = Σ portion_coef des présents + guestCount × 1.0
 * share       = portion_coef / somme_coefs
 * ```
 *
 * Les invités entrent au **dénominateur** sans figurer au résultat : leur part
 * est consommée, mais attribuée à personne. La somme des `share` est donc
 * strictement inférieure à 1 dès qu'il y a un invité, et vaut exactement 1
 * sinon. C'est voulu (§6bis) : on ne gonfle pas les assiettes du foyer avec ce
 * qu'ont mangé les convives.
 *
 * Les parts sont arrondies au millième — la précision de la colonne — par la
 * **méthode du plus fort reste**, et non chacune dans son coin : trois
 * convives à coefficient égal donneraient sinon 0,333 × 3 = 0,999, et le
 * repas perdrait un millième de lui-même à chaque enregistrement.
 */
export function calculerShares(
  present: SharePerson[],
  guestCount = 0,
): ComputedShare[] {
  if (present.length === 0) return [];
  if (!Number.isInteger(guestCount) || guestCount < 0) {
    throw new Error('guestCount doit être un entier positif ou nul');
  }
  for (const person of present) {
    if (!(person.portionCoef > 0)) {
      throw new Error(`portion_coef invalide pour ${person.memberId}`);
    }
  }

  const householdCoefs = present.reduce((sum, p) => sum + p.portionCoef, 0);
  // Un invité compte pour un adulte de référence : on ne connaît ni son âge ni
  // son appétit, et lui inventer un coefficient serait une valeur de plus tirée
  // de nulle part.
  const total = householdCoefs + guestCount;

  const exact = present.map((p) => ({ memberId: p.memberId, value: p.portionCoef / total }));
  const target = Math.round((householdCoefs / total) * FACTOR);

  return largestRemainder(exact, target);
}

/**
 * Arrondit une répartition au millième en conservant sa somme.
 *
 * Chaque part est d'abord tronquée, puis les millièmes restants sont donnés
 * aux plus forts restes. À reste égal, l'ordre d'entrée tranche : le résultat
 * ne dépend donc que des données, jamais de l'ordre d'itération d'une Map.
 */
function largestRemainder(
  exact: { memberId: string; value: number }[],
  target: number,
): ComputedShare[] {
  const scaled = exact.map((e, index) => {
    const raw = e.value * FACTOR;
    const floor = Math.floor(raw);
    return { memberId: e.memberId, floor, remainder: raw - floor, index };
  });

  let left = target - scaled.reduce((sum, s) => sum + s.floor, 0);
  const byRemainder = [...scaled].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (const item of byRemainder) {
    if (left <= 0) break;
    item.floor += 1;
    left -= 1;
  }

  return scaled.map((s) => ({ memberId: s.memberId, share: s.floor / FACTOR }));
}
