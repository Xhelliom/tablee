/**
 * §15, vue semaine — les tendances du **foyer**, jamais d'une personne.
 *
 * La semaine trace par personne la seule part végétale : « dans le repère 5
 * jours sur 7 » serait un score (§14bis). Les quatre autres barres ne s'y
 * lisent donc qu'en moyenne du foyer — la même agrégation que les compteurs
 * de l'accueil (« pour 3 assiettes sur 4 ») et les moyennes de l'assistant.
 *
 * Ce que rend cette fonction : par jour, la moyenne des **% du repère**
 * (R3 — jamais des grammes) des convives renseignés, pour les quatre macros.
 * L'énergie en est absente comme partout où le bilan se résume : I5.
 *
 * Elle ne touche à aucune base et ne connaît aucun foyer : les lignes viennent
 * du repo, les repères du référentiel, et l'appelant assemble les deux.
 */
import { bilanJournalier, type DailyMeal } from './daily.ts';
import { NUTRIENTS, type Nutrient } from './compute.ts';
import type { ReferenceTable } from './references.ts';

/** Les quatre barres que la semaine peut moyenner — tout sauf l'énergie. */
export type WeekNutrient = Exclude<Nutrient, 'kcal'>;

const WEEK_NUTRIENTS = NUTRIENTS.filter((nutrient): nutrient is WeekNutrient => nutrient !== 'kcal');

export interface WeekDayInput {
  date: string;
  members: { sex: 'F' | 'M'; age: number; meals: DailyMeal[] }[];
}

export interface WeekDayMeans {
  date: string;
  /**
   * Moyenne des % du repère des convives renseignés, par macro. `null` quand
   * personne ne l'est : pas de barre, surtout pas un zéro.
   */
  means: Record<WeekNutrient, number | null>;
  /** Convives ayant mangé ce jour-là — 0 : la colonne reste en pointillés. */
  eaters: number;
}

export function weeklyMeans(days: WeekDayInput[], references: ReferenceTable[]): WeekDayMeans[] {
  return days.map(({ date, members }) => {
    const means = {} as Record<WeekNutrient, number | null>;
    for (const nutrient of WEEK_NUTRIENTS) {
      const percents: number[] = [];
      for (const member of members) {
        const bar = bilanJournalier({
          sex: member.sex, age: member.age, meals: member.meals, references,
        }).bars.find((b) => b.nutrient === nutrient);
        if (bar?.percent !== null && bar?.percent !== undefined) percents.push(bar.percent);
      }
      means[nutrient] =
        percents.length === 0 ? null : Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);
    }
    return {
      date,
      means,
      eaters: members.filter((member) => member.meals.length > 0).length,
    };
  });
}

/** Une ligne par (repas, convive, aliment rattaché) ; `foodId` nul : repas sans aliment rattaché. */
export interface DiversityRow {
  mealId: string;
  eaterId: string;
  foodId: string | null;
  category: string | null;
}

export interface Diversity {
  foods: number;
  families: number;
  /** Repas dont aucun aliment n'est rattaché : signalés, jamais comptés comme « zéro aliment ». */
  mealsWithoutFood: number;
}

/**
 * §8, diversité alimentaire sur la fenêtre : combien d'aliments et de familles
 * (`food.category`) distincts. Aucun repère, aucun pourcentage — un compte.
 * Un rattachement manquant sous-estime, il ne fausse pas : le compte ne peut
 * que monter.
 */
export function diversity(rows: DiversityRow[]): Diversity {
  const foods = new Set<string>();
  const families = new Set<string>();
  const bare = new Set<string>();
  for (const row of rows) {
    if (row.foodId === null) { bare.add(row.mealId); continue; }
    foods.add(row.foodId);
    if (row.category !== null) families.add(row.category);
  }
  return { foods: foods.size, families: families.size, mealsWithoutFood: bare.size };
}

/** Le foyer, puis chaque convive qui a mangé — un convive absent de la fenêtre n'a pas d'entrée. */
export function diversityByEater(rows: DiversityRow[]): { household: Diversity; byEater: Record<string, Diversity> } {
  const groups = new Map<string, DiversityRow[]>();
  for (const row of rows) groups.set(row.eaterId, [...(groups.get(row.eaterId) ?? []), row]);
  return {
    household: diversity(rows),
    byEater: Object.fromEntries([...groups].map(([id, g]) => [id, diversity(g)])),
  };
}
