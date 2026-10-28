/**
 * Le besoin énergétique d'un majeur, estimé depuis ses propres mesures : si
 * la tendance du poids est stable pendant que l'apport moyen vaut X, le
 * besoin vaut à peu près X ; si elle bouge, l'écart se déduit de la pente.
 *
 * Décidé avec le propriétaire le 28/10/2026 : l'estimation s'affiche **à côté**
 * du BNM, elle ne le remplace pas — la barre reste en % d'un repère sourcé.
 * Ce que ce calcul refuse :
 *
 *   - **un mineur** (I5) : la route ne l'appelle pas, et sans pesée il n'a
 *     de toute façon rien à calculer ;
 *   - **les journées non marquées complètes** : une journée saisie en partie
 *     tire l'apport vers le bas, donc le besoin aussi (dette n° 20) ;
 *   - **un chiffre sous les seuils** : `kcal` vaut `null`, et les seuils
 *     voyagent avec la réponse pour que l'écran dise ce qui manque. Ces seuils
 *     sont des choix, pas une source (dette n° 30) ;
 *   - **une confiance `haute`** : c'est une estimation, au mieux `moyenne`.
 */
import type { Confidence } from '../jow/types.ts';

/**
 * 32,2 MJ par kg de poids (« 3 500 kcal par livre »), converti à 4,184 kJ/kcal.
 * Hall KD, *What is the required energy deficit per unit weight loss?*,
 * Int J Obes 2008;32:573-576, doi:10.1038/sj.ijo.0803720. L'article montre
 * que la règle vaut au-delà de 30 kg de masse grasse et **surestime** en
 * deçà ; l'app ne connaît pas la masse grasse (dette n° 30).
 */
export const KCAL_PAR_KG = 32_200 / 4.184;

export const SEUILS = {
  /** « Trois à quatre semaines » : la fenêtre, jusqu'à aujourd'hui inclus. */
  windowDays: 28,
  completeDays: 14,
  weighings: 4,
  /** Écart minimal entre la première et la dernière pesée de la fenêtre. */
  spanDays: 14,
} as const;

export interface EnergyNeed {
  /** kcal par jour, arrondi à 50. `null` sous les seuils. */
  kcal: number | null;
  confidence: Confidence | null;
  /** Journées complètes de la fenêtre dont l'énergie est connue. */
  completeDays: number;
  weighings: number;
  seuils: typeof SEUILS;
}

export function besoinEstime(input: {
  /** Apport moyen des seules journées complètes, kcal/j ; `null` sans aucune. */
  intake: number | null;
  completeDays: number;
  /** Les pesées de la fenêtre, triées, et la tendance au même jour. */
  pesées: { day: string; trendKg: number }[];
}): EnergyNeed {
  const { intake, completeDays, pesées } = input;
  const base = { completeDays, weighings: pesées.length, seuils: SEUILS };
  const first = pesées[0];
  const last = pesées.at(-1);
  if (intake === null || first === undefined || last === undefined
    || completeDays < SEUILS.completeDays || pesées.length < SEUILS.weighings) {
    return { ...base, kcal: null, confidence: null };
  }
  const span = (Date.parse(last.day) - Date.parse(first.day)) / 86_400_000;
  if (span < SEUILS.spanDays) return { ...base, kcal: null, confidence: null };

  const delta = last.trendKg - first.trendKg;
  // Un poids qui monte dit que l'apport dépasse le besoin.
  const kcal = intake - (delta / span) * KCAL_PAR_KG;
  // Le facteur ne compte que si le poids bouge, et c'est lui le moins sûr.
  const confidence: Confidence =
    completeDays >= 21 && Math.abs(delta) <= 1 ? 'moyenne' : 'basse';
  return { ...base, kcal: Math.round(kcal / 50) * 50, confidence };
}
