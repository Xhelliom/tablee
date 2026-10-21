/**
 * Repères de fréquence du PNNS (Santé publique France, adultes) : « légumes
 * secs au moins 2 fois par semaine », « charcuterie : 150 g au plus ».
 *
 * Ce qui est compté ici, c'est ce qui est **rattaché à un aliment** : un
 * ingrédient Jow sans `food_id` n'arrive jamais dans `lines`, il ne compte pas
 * et — surtout — ne retire rien. Le compte peut donc être sous-estimé, jamais
 * abaissé par ce qu'on ignore.
 *
 * Tout se lit au niveau du **foyer** (I5) : cette fonction ne rend rien par
 * personne, et un plafond ne se calcule que sur les grammes des adultes — un
 * enfant n'a ni repère ni total ici. Elle ne touche à aucune base.
 *
 * L'alcool (`max_drinks`, 027) se compte en verres standard — 10 g d'alcool
 * pur — depuis la teneur Ciqual, et sur les seuls plats saisis : le vin d'une
 * recette Jow est un ingrédient de cuisson, pas un verre. Sans aucune boisson
 * saisie, il vaut `null`, jamais 0 : personne ne saisissait ses verres avant.
 */

export type FrequencyKind = 'min_times' | 'min_days' | 'max_grams' | 'max_drinks';

export interface FrequencyReference {
  code: string;
  label: string;
  kind: FrequencyKind;
  value: number;
  categories: string[];
  namePattern: string | null;
  source: string;
  citation: string;
}

/** Un aliment rattaché d'un repas de la fenêtre. */
export interface FrequencyLine {
  mealId: string;
  date: string;
  category: string | null;
  name: string;
  /** `null` : quantité inconnue — jamais 0 (I1). */
  grams: number | null;
  /**
   * `portion` : grammes **par convive** (ingrédient de recette Jow) ;
   * `plat` : grammes du plat entier, que `share` répartit.
   */
  basis: 'portion' | 'plat';
  /** Alcool en g/100 g (Ciqual 60000). `null` : inconnu. */
  alcoholPer100g: number | null;
}

export interface FrequencyParticipant {
  mealId: string;
  eaterId: string;
  share: number;
  adult: boolean;
}

export interface FrequencyStatus {
  code: string;
  label: string;
  kind: FrequencyKind;
  target: number;
  unit: 'fois' | 'jours' | 'g' | 'verres';
  /** `null` : rien de saisi sur la fenêtre, ou aucun adulte à table. */
  current: number | null;
  /** `null` quand `current` l'est. Un plafond tenu est « atteint » pour de bon. */
  met: boolean | null;
  /** Des grammes manquaient : le total d'un plafond est un minimum. */
  partial: boolean;
  source: string;
  citation: string;
}

export function bilanFrequences(input: {
  references: FrequencyReference[];
  lines: FrequencyLine[];
  participants: FrequencyParticipant[];
  /** Nombre de repas saisis sur la fenêtre, tous aliments confondus. */
  mealCount: number;
}): FrequencyStatus[] {
  const { references, lines, participants, mealCount } = input;
  const byMeal = new Map<string, FrequencyParticipant[]>();
  for (const p of participants) byMeal.set(p.mealId, [...(byMeal.get(p.mealId) ?? []), p]);
  const adults = new Set(participants.filter((p) => p.adult).map((p) => p.eaterId));

  return references.map((ref) => {
    const pattern = ref.namePattern === null ? null : new RegExp(ref.namePattern, 'i');
    const matching = lines.filter(
      (l) => l.category !== null && ref.categories.includes(l.category)
        && (pattern === null || pattern.test(l.name)),
    );
    const base = {
      code: ref.code, label: ref.label, kind: ref.kind, target: ref.value,
      source: ref.source, citation: ref.citation,
    };

    if (ref.kind === 'max_drinks') {
      const drinks = matching.filter((l) => l.basis === 'plat');
      if (adults.size === 0 || drinks.length === 0) {
        return { ...base, unit: 'verres' as const, current: null, met: null, partial: false };
      }
      let total = 0;
      let partial = false;
      for (const line of drinks) {
        if (line.grams === null || line.alcoholPer100g === null) { partial = true; continue; }
        const glasses = (line.grams * line.alcoholPer100g) / 100 / 10;
        for (const p of byMeal.get(line.mealId) ?? []) if (p.adult) total += glasses * p.share;
      }
      const current = Math.round((total / adults.size) * 10) / 10;
      return { ...base, unit: 'verres' as const, current, met: current <= ref.value, partial };
    }

    if (ref.kind === 'max_grams') {
      if (adults.size === 0) {
        return { ...base, unit: 'g' as const, current: null, met: null, partial: false };
      }
      const perAdult = new Map<string, number>();
      let partial = false;
      for (const line of matching) {
        if (line.grams === null) { partial = true; continue; }
        for (const p of byMeal.get(line.mealId) ?? []) {
          if (!p.adult) continue;
          const grams = line.basis === 'portion' ? line.grams : line.grams * p.share;
          perAdult.set(p.eaterId, (perAdult.get(p.eaterId) ?? 0) + grams);
        }
      }
      const total = [...perAdult.values()].reduce((a, b) => a + b, 0);
      const current = Math.round(total / adults.size);
      return { ...base, unit: 'g' as const, current, met: current <= ref.value, partial };
    }

    if (mealCount === 0) {
      return {
        ...base, unit: ref.kind === 'min_days' ? 'jours' as const : 'fois' as const,
        current: null, met: null, partial: false,
      };
    }
    const current = new Set(matching.map((l) => (ref.kind === 'min_days' ? l.date : l.mealId))).size;
    return {
      ...base, unit: ref.kind === 'min_days' ? 'jours' as const : 'fois' as const,
      current, met: current >= ref.value, partial: false,
    };
  });
}

/**
 * Les repères qu'aucun adulte du foyer ne peut atteindre à cause de son régime
 * (`eater.diets`) : ils ne s'affichent pas, plutôt que de rester « non atteints »
 * comme un reproche. Un seul adulte qui en mange suffit à les garder — les repas
 * des autres comptent. Ne remplace aucune valeur : un repère masqué n'est pas
 * réécrit (I1). Légumes secs et fruits à coque ne sont jamais masqués.
 */
const EXCLUDED_BY: { prefix: string; diets: string[] }[] = [
  { prefix: 'poisson', diets: ['vegetarien', 'vegetalien', 'sans_poisson'] },
  { prefix: 'viande', diets: ['vegetarien', 'vegetalien', 'sans_viande'] },
  { prefix: 'charcuterie', diets: ['vegetarien', 'vegetalien', 'sans_viande'] },
];

export function hiddenFrequencyCodes(adults: { diets: string[] }[], codes: string[]): Set<string> {
  const hidden = new Set<string>();
  if (adults.length === 0) return hidden;
  for (const code of codes) {
    const rule = EXCLUDED_BY.find((r) => code.startsWith(r.prefix));
    if (rule !== undefined && adults.every((a) => a.diets.some((d) => rule.diets.includes(d)))) {
      hidden.add(code);
    }
  }
  return hidden;
}
