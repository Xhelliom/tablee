/**
 * Client HTTP du front. Une seule porte d'entrée vers le serveur, pour que
 * l'expiration de session et le format d'erreur du §12 soient traités une
 * fois.
 */

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'reponse_illisible', 'réponse du serveur illisible');
  }

  if (!response.ok) {
    const error = (payload as ApiErrorBody).error;
    throw new ApiError(
      response.status,
      error?.code ?? 'erreur',
      error?.message ?? 'le serveur a refusé la demande',
    );
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string): Promise<T> => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  patch: <T,>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body),
  delete: <T,>(path: string): Promise<T> => request<T>('DELETE', path),
};

// ── Types partagés avec le serveur ──────────────────────────────────────────
// Recopiés plutôt qu'importés : le front et le serveur ne partagent pas de
// build, et un import direct ferait entrer `pg` et Fastify dans le bundle.

export type Confidence = 'haute' | 'moyenne' | 'basse';
export type Slot = 'petit_dej' | 'dejeuner' | 'gouter' | 'diner' | 'collation';
export type MealSource = 'jow' | 'texte' | 'photo' | 'template' | 'manuel';
export type Nutrient = 'kcal' | 'proteinG' | 'carbG' | 'fatG' | 'fiberG';
/**
 * `encadre` — la source ne donne qu'un intervalle (« < 0,5 g » chez Ciqual).
 * `partiel` — un aliment échappe au référentiel : le total ne peut que monter.
 */
export type BarState = 'disponible' | 'encadre' | 'partiel' | 'indisponible';

export interface Member {
  id: string;
  firstName: string;
  birthDate: string;
  sex: 'F' | 'M';
  portionCoef: number;
  diets: string[];
  color: string | null;
  active: boolean;
  age: number;
  /** I5 : aucun objectif chiffré de calories ni de poids sur ce profil. */
  minor: boolean;
}

export interface NutrientBar {
  nutrient: Nutrient;
  state: BarState;
  /** Borne basse : ce qui est garanti atteint. */
  consumed: number | null;
  /** Borne haute. `null` quand rien ne la borne. */
  consumedMax: number | null;
  missingMeals: number;
  reference: { nutrient: string; value: number; unit: string; source: string } | null;
  percent: number | null;
  percentMax: number | null;
}

export interface PlantBar {
  state: BarState;
  percent: number | null;
  coverage: number | null;
  householdAverage7d: number | null;
}

export interface DailyBalance {
  bars: NutrientBar[];
  plant: PlantBar;
  mealCount: number;
}

export interface MealItem {
  id: string;
  foodId: string | null;
  label: string;
  quantity: number | null;
  unit: string | null;
  quantityG: number | null;
  position: number;
  foodName: string | null;
  plantBased: boolean | null;
}

export interface Meal {
  id: string;
  eatenAt: string;
  slot: Slot;
  source: MealSource;
  servings: number;
  guestCount: number;
  leftoverOf: string | null;
  note: string | null;
  recipe: { id: string; title: string; imageUrl: string | null; nutriScore: string | null } | null;
  items: MealItem[];
  participants: { memberId: string; firstName: string; share: number }[];
  /** Produits de saison de la recette ce mois-ci — 0 tant que la table est vide. */
  seasonalCount: number;
  nutrition: {
    kcal: number | null;
    proteinG: number | null;
    carbG: number | null;
    fatG: number | null;
    fiberG: number | null;
    /** Bornes hautes. `null` = non bornée. */
    max: {
      kcal: number | null;
      proteinG: number | null;
      carbG: number | null;
      fatG: number | null;
      fiberG: number | null;
    };
    plantRatio: number | null;
    gramsTotal: number | null;
    gramsPlant: number | null;
    gramsClassified: number | null;
    confidence: Confidence;
  } | null;
}

export interface SeasonalProduce {
  id: string;
  name: string;
  kind: 'legume' | 'fruit';
  months: number[];
  foodId: string | null;
  eatenThisMonth: boolean;
  lastMonth: number;
}

export interface DashboardResponse {
  date: string;
  month: number;
  year: number;
  dashboard: {
    member: { id: string; firstName: string; color: string | null; age: number; minor: boolean };
    balance: DailyBalance;
  }[];
  meals: Meal[];
  seasonal: SeasonalProduce[];
  referencesLoaded: boolean;
}

export interface RecipeIngredient {
  id: string;
  label: string;
  foodId: string | null;
  jowFoodId: string | null;
  quantity: number | null;
  unit: string | null;
  quantityG: number | null;
  optional: boolean;
  position: number;
}

export interface Recipe {
  id: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  baseServings: number;
  nutriScore: string | null;
  greenScore: string | null;
  confidence: Confidence;
  snapshot: {
    perServing: Record<Nutrient, number | null>;
    confidence: Confidence;
  };
  ingredients: RecipeIngredient[];
}

export interface ResolveResponse {
  recipe: Recipe | null;
  /** Présent seulement si la recette n'a pas pu être persistée. */
  parsed?: { title: string; warnings: string[]; confidence: Confidence };
  seasonal: number;
  fetched: boolean;
  warnings: string[];
}

export interface FoodSummary {
  id: string;
  name: string;
  source: string;
  category: string | null;
  plantBased: boolean | null;
  kcal100g: number | null;
  units: string[];
}

export interface MealTemplate {
  id: string;
  name: string;
  slot: Slot | null;
  useCount: number;
  lastUsedAt: string | null;
  payload: {
    items: { foodId: string | null; label: string }[];
    participants: { memberId: string; present: boolean }[];
  };
}

export interface TemplateSuggestion {
  labels: string[];
  slot: Slot;
  occurrences: number;
  mealId: string;
}

export interface WeekResponse {
  from: string;
  days: number;
  members: { id: string; firstName: string; color: string | null }[];
  cells: { date: string; memberId: string; meals: number; plantRatio: number | null }[];
}
