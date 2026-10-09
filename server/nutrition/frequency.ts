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
 */

export type FrequencyKind = 'min_times' | 'min_days' | 'max_grams';

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
  unit: 'fois' | 'jours' | 'g';
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
