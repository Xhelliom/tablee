import type {
  Confidence,
  ParsedIngredient,
  ParsedNutrition,
  ParsedRecipe,
} from './types.ts';

/**
 * Parseur des pages publiques Jow.
 *
 * Principe directeur : **il ne lève jamais**. Une structure inattendue produit
 * une recette à `confidence: 'basse'` avec des champs `null` et des warnings ;
 * c'est l'appelant qui bascule en saisie manuelle. Un parseur qui plante sur un
 * changement de markup ferait perdre le repas que l'utilisateur essayait de
 * saisir — c'est le pire résultat possible pour une app dont le seul vrai
 * risque est la friction.
 *
 * Les chemins exacts sont documentés dans `docs/jow-contract.md`.
 */

const NEXT_DATA =
  /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

/**
 * Identifiants de nutriments Jow (norme INFOODS) → colonnes de `recipe`.
 * Les unités attendues sont vérifiées : une valeur dont l'unité a changé est
 * rejetée (`null` + warning) plutôt que réinterprétée (I1).
 */
const NUTRIENTS = {
  ENERC: { field: 'kcal', unit: 'kcal' },
  PRO: { field: 'proteinG', unit: 'g' },
  CHOAVL: { field: 'carbG', unit: 'g' },
  FAT: { field: 'fatG', unit: 'g' },
  FIBTG: { field: 'fiberG', unit: 'g' },
} as const satisfies Record<string, { field: keyof ParsedNutrition; unit: string }>;

/**
 * Unités Jow convertibles en grammes **sans hypothèse**.
 *
 * Volontairement limité aux unités de masse. `Litre` / `Millilitre` exigeraient
 * une densité, `Pièce` / `Poignée` / `Bouquet` un poids moyen : ces conversions
 * relèvent de `unit_default`, qui exige une `source` (§6, I1). Une poignée de
 * salade ne pèse pas 30 g parce que ça paraît raisonnable.
 */
const MASS_UNITS: Record<string, number> = {
  gramme: 1,
  grammes: 1,
  g: 1,
  kilogramme: 1000,
  kilogrammes: 1000,
  kg: 1000,
  milligramme: 0.001,
  milligrammes: 0.001,
  mg: 0.001,
};

const EMPTY_NUTRITION: ParsedNutrition = {
  kcal: null,
  proteinG: null,
  carbG: null,
  fatG: null,
  fiberG: null,
};

export interface ParseContext {
  /** URL finale (après redirection), utilisée pour renseigner `jow_slug`. */
  url?: string | null;
  /** ObjectId connu par le lien de partage, si la page ne le donne pas. */
  jowRecipeId?: string | null;
  /** Titre connu par le texte de partage, repli si la page est illisible. */
  title?: string | null;
}

/** Extrait le blob `__NEXT_DATA__`. `null` si absent ou non parsable. */
export function extractNextData(html: string): unknown {
  const raw = html.match(NEXT_DATA)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Point d'entrée : HTML brut d'une page recette → `ParsedRecipe`. */
export function parseRecipeHtml(html: string, ctx: ParseContext = {}): ParsedRecipe {
  const data = extractNextData(html);
  if (data === null) {
    return fallback(ctx, ['__NEXT_DATA__ introuvable ou non parsable']);
  }
  const node = get(data, ['props', 'pageProps', 'recipe']);
  if (!isRecord(node)) {
    return fallback(ctx, ['props.pageProps.recipe absent du payload']);
  }
  return parseRecipeNode(node, ctx);
}

/** Parse le nœud `props.pageProps.recipe` déjà extrait (utilisé par les tests). */
export function parseRecipeNode(node: unknown, ctx: ParseContext = {}): ParsedRecipe {
  const warnings: string[] = [];
  if (!isRecord(node)) return fallback(ctx, ['nœud recette absent']);

  const title = asString(node['title']) ?? ctx.title ?? null;
  if (title === null) warnings.push('titre absent du payload');

  const { nutrition, missing } = parseNutrition(node['nutritionalFacts'], warnings);
  const ingredients = parseIngredients(node['constituents'], warnings);

  const url = asString(ctx.url) ?? null;
  const jowSlug = asString(node['slug']) ?? slugFromUrl(url);

  // `coversCount` est le nombre de parts **prévu par Jow** pour la recette
  // (le « Recette prévue pour 4 » de la maquette), pas un facteur d'échelle :
  // `nutritionalFacts` reste par portion et `quantityPerCover` par convive,
  // quelle que soit sa valeur. Vérifié sur les échantillons figés — voir
  // `docs/jow-contract.md`.
  const covers = asNumber(node['coversCount']);
  if (covers === null || covers <= 0) {
    warnings.push('coversCount absent ou invalide, 1 part retenue par défaut');
  }

  const recipe: ParsedRecipe = {
    title: title ?? 'Recette Jow',
    servings: covers !== null && covers > 0 ? covers : 1,
    ingredients,
    nutrition,
    jowRecipeId: asString(node['id']) ?? asString(ctx.jowRecipeId) ?? null,
    jowSlug,
    url,
    imageUrl: asString(node['imageUrl']) ?? null,
    nutriScore: score(node['nutritionalRatingScores'], 'nutriscore'),
    greenScore: score(node['nutritionalRatingScores'], 'greenscore'),
    confidence: 'haute',
    warnings,
  };

  recipe.confidence = rate({ title, missing, ingredients, warnings });
  return recipe;
}

function rate(input: {
  title: string | null;
  missing: number;
  ingredients: ParsedIngredient[];
  warnings: string[];
}): Confidence {
  // Pas de titre, ou aucune valeur nutritionnelle : la recette n'est pas
  // exploitable telle quelle, l'utilisateur doit reprendre la main.
  if (input.title === null) return 'basse';
  if (input.missing === Object.keys(NUTRIENTS).length) return 'basse';
  // Valeurs partielles, ou plus aucun ingrédient : utilisable, mais à vérifier.
  if (input.missing > 0 || input.ingredients.length === 0) return 'moyenne';
  return 'haute';
}

function parseNutrition(
  raw: unknown,
  warnings: string[],
): { nutrition: ParsedNutrition; missing: number } {
  const nutrition: ParsedNutrition = { ...EMPTY_NUTRITION };
  if (!Array.isArray(raw)) {
    warnings.push('nutritionalFacts absent : aucune valeur nutritionnelle');
    return { nutrition, missing: Object.keys(NUTRIENTS).length };
  }

  for (const fact of raw) {
    if (!isRecord(fact)) continue;
    const id = asString(fact['id'])?.toUpperCase();
    if (id === undefined || !(id in NUTRIENTS)) continue;
    const spec = NUTRIENTS[id as keyof typeof NUTRIENTS];
    const amount = asNumber(fact['amount']);
    const unit = asString(fact['unit'])?.toLowerCase();

    if (amount === null) {
      warnings.push(`${id} : valeur absente ou non numérique`);
      continue;
    }
    // Unité inattendue → on ne convertit pas, on ne garde pas (I1).
    if (unit !== spec.unit) {
      warnings.push(`${id} : unité « ${unit ?? 'absente'} » au lieu de « ${spec.unit} », valeur ignorée`);
      continue;
    }
    nutrition[spec.field] = amount;
  }

  const missing = Object.values(NUTRIENTS).filter(
    (spec) => nutrition[spec.field] === null,
  ).length;
  if (missing > 0 && missing < Object.keys(NUTRIENTS).length) {
    warnings.push(`${missing} valeur(s) nutritionnelle(s) sur 5 absente(s)`);
  }
  return { nutrition, missing };
}

function parseIngredients(raw: unknown, warnings: string[]): ParsedIngredient[] {
  if (!Array.isArray(raw)) {
    warnings.push('constituents absent : aucun ingrédient');
    return [];
  }

  const out: ParsedIngredient[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) return;
    const label = asString(item['name']);
    if (label === null) {
      warnings.push(`ingrédient #${index + 1} sans libellé, ignoré`);
      return;
    }

    const quantity = asNumber(item['quantityPerCover']);
    const unit = unitName(item['unit']);
    const quantityG = toGrams(quantity, unit);

    if (quantity !== null && unit !== null && quantityG === null) {
      // Cas nominal chez Jow (« 1 poignée »), pas une anomalie : on le signale
      // pour que l'UI demande, on ne comble pas le trou.
      warnings.push(`« ${label} » : ${quantity} ${unit} non convertible en grammes sans source`);
    }

    out.push({
      jowFoodId: asString(item['id']) ?? null,
      label,
      quantity,
      unit,
      quantityG,
      optional: item['isOptional'] === true,
      position: index,
    });
  });
  return out;
}

/** Convertit en grammes, ou `null` si l'unité n'est pas une unité de masse. */
export function toGrams(quantity: number | null, unit: string | null): number | null {
  if (quantity === null || unit === null) return null;
  const factor = MASS_UNITS[unit.trim().toLowerCase()];
  if (factor === undefined) return null;
  return round(quantity * factor, 2);
}

function unitName(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (isRecord(raw)) return asString(raw['name']);
  return null;
}

function score(raw: unknown, id: string): string | null {
  if (!Array.isArray(raw)) return null;
  const found = raw.find((s) => isRecord(s) && asString(s['id'])?.toLowerCase() === id);
  return isRecord(found) ? asString(found['score']) : null;
}

function slugFromUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ?? null;
  } catch {
    return null;
  }
}

/** Recette minimale quand la page est illisible : titre seul, rien d'inventé. */
export function fallback(ctx: ParseContext, warnings: string[]): ParsedRecipe {
  return {
    title: asString(ctx.title) ?? 'Recette Jow',
    servings: 1,
    ingredients: [],
    nutrition: { ...EMPTY_NUTRITION },
    jowRecipeId: asString(ctx.jowRecipeId) ?? null,
    jowSlug: slugFromUrl(asString(ctx.url) ?? null),
    url: asString(ctx.url) ?? null,
    imageUrl: null,
    nutriScore: null,
    greenScore: null,
    confidence: 'basse',
    warnings,
  };
}

// ── accesseurs défensifs ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function get(source: unknown, path: string[]): unknown {
  let cur: unknown = source;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
