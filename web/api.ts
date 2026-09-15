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

/**
 * Deux formats d'erreur cohabitent, et les confondre rend l'app muette.
 *
 * Les routes du §12 répondent `{ error: { code, message } }`. Celles de
 * better-auth, sous `/api/auth/*`, répondent `{ message, code }` à plat. Sans
 * ce second cas, **toutes** les erreurs d'authentification — mot de passe
 * faux, adresse déjà prise, invitation expirée, « il doit rester un parent » —
 * se réduisaient à « le serveur a refusé la demande », et les traductions des
 * écrans ne voyaient jamais le vrai message.
 */
function toApiError(status: number, payload: unknown): ApiError {
  const enveloppé = (payload as ApiErrorBody | undefined)?.error;
  if (enveloppé !== undefined && enveloppé !== null) {
    return new ApiError(status, enveloppé.code ?? 'erreur', enveloppé.message ?? 'le serveur a refusé la demande');
  }

  const plat = payload as { message?: unknown; code?: unknown } | undefined;
  const message = typeof plat?.message === 'string' ? plat.message : null;
  const code = typeof plat?.code === 'string' ? plat.code : null;
  return new ApiError(
    status,
    code ?? 'erreur',
    message ?? 'le serveur a refusé la demande',
  );
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
    throw toApiError(response.status, payload);
  }
  return payload as T;
}

/**
 * Une réponse en Server-Sent Events (`POST /api/assistant`) : chaque `texte`
 * part dans `onText` dès qu'il arrive, et la promesse rend la donnée de `fin`.
 *
 * Lue à la main, parce qu'`EventSource` ne sait faire que des GET. Un flux qui
 * se termine sans `fin` — réseau coupé, serveur tombé — est une erreur et non
 * une réponse courte. Et le serveur plafonne une réponse à une minute : un flux
 * encore muet au-delà est un réseau mort, pas un modèle lent.
 */
async function events<T>(path: string, body: unknown, onText: (delta: string) => void): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok || response.body === null) {
    throw toApiError(response.status, await response.json().catch(() => undefined));
  }

  const coupé = new ApiError(response.status, 'flux_coupe', 'la réponse a été coupée en route — réessayez');
  const lecteur = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let tampon = '';
  for (;;) {
    const { done, value } = await lecteur.read().catch(() => { throw coupé; });
    if (done) throw coupé;
    tampon += value;
    for (let limite = tampon.indexOf('\n\n'); limite !== -1; limite = tampon.indexOf('\n\n')) {
      const bloc = tampon.slice(0, limite);
      tampon = tampon.slice(limite + 2);
      const event = /^event: (.*)$/m.exec(bloc)?.[1];
      const data: unknown = JSON.parse(/^data: (.*)$/m.exec(bloc)?.[1] ?? 'null');
      if (event === 'texte') onText(data as string);
      else if (event === 'fin') return data as T;
      else if (event === 'erreur') throw toApiError(502, data);
    }
  }
}

export const api = {
  events,
  get: <T,>(path: string): Promise<T> => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body),
  patch: <T,>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body),
  delete: <T,>(path: string): Promise<T> => request<T>('DELETE', path),
};

// ── Types partagés avec le serveur ──────────────────────────────────────────
// Recopiés plutôt qu'importés : le front et le serveur ne partagent pas de
// build, et un import direct ferait entrer `pg` et Fastify dans le bundle.

export type Confidence = 'haute' | 'moyenne' | 'basse';
export type Slot = 'petit_dej' | 'dejeuner' | 'gouter' | 'diner' | 'collation';
export type MealSource = 'jow' | 'texte' | 'photo' | 'template' | 'manuel' | 'ia';
export type Nutrient = 'kcal' | 'proteinG' | 'carbG' | 'fatG' | 'fiberG';
/**
 * `encadre` — la source ne donne qu'un intervalle (« < 0,5 g » chez Ciqual).
 * `partiel` — un aliment échappe au référentiel : le total ne peut que monter.
 */
export type BarState = 'disponible' | 'encadre' | 'partiel' | 'indisponible';

export interface Eater {
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
  /**
   * Le compte de ce convive, s'il en a un. `null` est l'état normal : un
   * enfant est à table sans compte. Un convive n'est pas un compte (007).
   */
  userId: string | null;
  /** Vrai quand cette assiette est celle du compte connecté. */
  isMe: boolean;
  /**
   * L'adresse à qui la fiche est réservée, en attendant que cette personne
   * s'inscrive. Le rattachement se fera tout seul à son arrivée.
   */
  claimEmail: string | null;
  /**
   * Majeurs uniquement, et **toujours `null` sur un profil mineur** — le
   * serveur les retire à la lecture (I5). Une mesure, jamais une cible : ni
   * barre, ni série, ni écart à un poids « idéal ».
   */
  weightKg: number | null;
  weightRecordedAt: string | null;
  heightCm: number | null;
}

export interface NutrientReference {
  nutrient: string;
  value: number;
  unit: string;
  kind: 'AS' | 'RNP' | 'RN' | 'IR_MIN' | 'IR_MAX';
  basis: 'absolu' | 'pct_aet';
  /** Calculée à partir d'autres lignes sourcées, pas recopiée d'un tableau. */
  derived: boolean;
  source: string;
  /**
   * Les documents cités, sans le détail arithmétique. C'est ce qui s'affiche :
   * la chaîne complète contient un nombre de calories, qui n'a rien à faire
   * sur la fiche d'un mineur (I5).
   */
  citations: string[];
}

/** Où en est la journée : ce qui manque, ce qui est atteint, ce qui est dépassé. */
export type Standing = 'sous' | 'dans' | 'au_dela';

export interface NutrientBar {
  nutrient: Nutrient;
  state: BarState;
  /** Borne basse : ce qui est garanti atteint. */
  consumed: number | null;
  /** Borne haute. `null` quand rien ne la borne. */
  consumedMax: number | null;
  missingMeals: number;
  /** La cible du jour, à atteindre. */
  reference: NutrientReference | null;
  /** Le plafond, quand la source publie un intervalle. `null` pour les fibres. */
  referenceMax: NutrientReference | null;
  percent: number | null;
  percentMax: number | null;
  /** Grammes restants pour atteindre la cible. `0` une fois atteinte. */
  remaining: number | null;
  /** Grammes au-delà du plafond. `null` tant qu'il n'est pas dépassé. */
  excess: number | null;
  standing: Standing | null;
  /** L'intervalle publié par l'ANSES, en % de l'énergie de la journée. */
  energyShare: { min: number | null; max: number | null } | null;
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
  /** Parts laissées dans le plat. `null` : rien n'a été dit, pas « rien ». */
  remainingServings: number | null;
  guestCount: number;
  leftoverOf: string | null;
  note: string | null;
  recipe: { id: string; title: string; imageUrl: string | null; nutriScore: string | null } | null;
  items: MealItem[];
  participants: { eaterId: string; firstName: string; share: number }[];
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
    eater: { id: string; firstName: string; color: string | null; age: number; minor: boolean };
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
  /**
   * Quand les grammes sont estimés depuis une cuillère, une pièce, un litre :
   * `moyenne` pour une conversion propre à l'aliment, `basse` pour un repli par
   * défaut. `null` quand ils sont mesurés.
   */
  estimate: 'moyenne' | 'basse' | null;
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

/** Une recette du foyer, telle que la liste « Mes recettes » la montre. */
export interface RecipeSummary {
  id: string;
  title: string;
  imageUrl: string | null;
  baseServings: number;
  nutriScore: string | null;
  confidence: Confidence;
  /** `null` = lue depuis Jow, jamais enregistrée comme repas. */
  lastEatenAt: string | null;
  timesEaten: number;
  url: string | null;
}

/**
 * Une recette choisie par l'assistant. Tout vient de la base, sauf `reason` :
 * le modèle choisit et justifie, il ne donne aucune valeur (R1).
 */
export interface RecipeProposal {
  recipe: RecipeSummary;
  /** `null` quand le modèle n'a rien donné de lisible, ou a glissé un chiffre. */
  reason: string | null;
}

export interface AssistantRecipesResponse {
  proposals: RecipeProposal[];
  /**
   * Des plats hors de la liste, inventés par le modèle : un nom et une phrase,
   * **aucune valeur**. L'écran les marque « à vérifier ».
   */
  ideas: { title: string; reason: string }[];
  /** Le texte exact envoyé au modèle — ce qui est sorti du foyer. */
  facts: string;
}

export interface ResolveResponse {
  recipe: Recipe | null;
  /** Présent seulement si la recette n'a pas pu être persistée. */
  parsed?: { title: string; warnings: string[]; confidence: Confidence };
  seasonal: number;
  fetched: boolean;
  warnings: string[];
}

/**
 * Ce que le serveur reconnaît dans un texte partagé **sans accès réseau**.
 * L'URL en ressort déjà expurgée de `key` et `userId` (I6).
 */
export interface ShareInput {
  jowRecipeId: string | null;
  title: string | null;
  url: string | null;
}

export interface PeekResponse {
  share: ShareInput;
  /** Le texte d'entrée expurgé : la seule forme qui peut circuler ensuite. */
  redacted: string;
}

export interface FoodSearchResponse {
  foods: FoodSummary[];
  /** Faux quand la table Ciqual n'a jamais été importée — voir `npm run seed:food`. */
  referentialLoaded: boolean;
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
    participants: { eaterId: string; present: boolean }[];
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
  eaters: { id: string; firstName: string; color: string | null }[];
  cells: { date: string; eaterId: string; meals: number; plantRatio: number | null }[];
}
