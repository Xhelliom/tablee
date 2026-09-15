/**
 * V3, §5 voie 2 — un repas décrit en texte libre, découpé en aliments par un
 * LLM : « 2 œufs, une tartine beurrée » devient des lignes à valider.
 *
 * ── Ce que le modèle produit, et ce qu'il ne produit pas ────────────────────
 *
 * Par ligne : ce qui a été dit, des mots à chercher dans Ciqual, et un poids
 * estimé. **Aucune valeur nutritionnelle** (R1) : le rapprochement avec `food`
 * passe ensuite par la recherche plein texte du dépôt, et les teneurs viennent
 * de l'ANSES. Le poids est une estimation et se dit comme telle : le repas qui
 * en sort porte la source `ia`, que `calculerNutrition` plafonne à « moyenne »
 * (R6), et chaque ligne se corrige à l'écran avant d'être enregistrée.
 *
 * ── Puis il choisit, par numéro, parmi les candidats de Ciqual ──────────────
 *
 * ⚠️ Ajouté le 14/09/2026. À nombre de mots égal, la recherche range le nom le
 * plus court en tête, et le radical français confond « pâte » et « pâtes » :
 * « pâtes cuites », un terme juste, rendait « Pâte à pizza cuite », les vraies
 * pâtes septièmes ; « pomme », « Pomme, sèche ». Un second appel reçoit donc
 * chaque ligne et ses quinze premiers candidats, des **noms** sans valeurs, et
 * désigne le bon par son numéro — le procédé de `recettes.ts` —, ou répond
 * qu'aucun ne convient : rien n'est alors présélectionné. Un numéro hors liste
 * est ignoré, un appel qui échoue laisse l'ordre de la recherche : le choix
 * range des aliments qui existent, il n'en invente aucun.
 *
 * ── Ce qui part chez Anthropic ──────────────────────────────────────────────
 *
 * Le texte tapé et pour combien de personnes le plat a été préparé, rien
 * d'autre (R5) : un compte, pas qui — ni prénom, ni âge. Le texte ne part
 * qu'une fois passé par `anonymize` — le type l'exige. Un texte tapé peut contenir un prénom ou un
 * lien Jow et son jeton : voir `server/llm/index.ts`, la seule porte vers
 * Anthropic, et la dette n° 17 pour ce que le filtre laisse passer.
 *
 * ── Pour combien de personnes ───────────────────────────────────────────────
 *
 * ⚠️ Ajouté le 15/09/2026. Le repas enregistré est réparti entre tous ceux qui
 * étaient à table, et le modèle ne le savait pas : « des pâtes » rendait une
 * portion individuelle, ensuite partagée entre quatre. Il reçoit donc le
 * « Cuisiné pour » de l'écran, et estime le plat entier. Changer ce nombre
 * ensuite remet les grammes à l'échelle côté écran : on ne rappelle pas le
 * modèle pour une règle de trois.
 */
import type { FoodSummary } from '../repo/foods.ts';
import type { Anonymized, Ask } from './index.ts';

/** Une ligne proposée par le modèle, avant tout rapprochement avec `food`. */
export interface ProposedItem {
  /** Ce qui a été dit : « 2 œufs ». C'est ce qu'enregistre `meal_item.label`. */
  label: string;
  /** Des mots pour la recherche Ciqual : « oeuf ». */
  search: string;
  /** Estimé, jamais mesuré. `null` quand rien ne permet de l'estimer. */
  grams: number | null;
}

export type SplitMeal = (text: Anonymized, personnes: number) => Promise<ProposedItem[]>;

/** Le modèle a décliné, ou rendu quelque chose d'inexploitable. Réessayer n'y changera rien. */
export class SplitRefused extends Error {}

const CONSIGNE = `Tu reçois la description d'un repas, écrite en français par un membre d'une famille. Découpe-la en aliments.

Pour chaque aliment :
- label : l'aliment tel que le texte le dit, avec sa quantité s'il y en a une (« 2 œufs », « un bol de lait »).
- search : un à trois mots pour le retrouver dans la table de composition Ciqual de l'ANSES — le nom de l'aliment au singulier, sans quantité, sans marque ni article (« oeuf », « lait demi-écrémé », « pain baguette »).
- grams : le poids en grammes pour le plat entier, préparé pour le nombre de personnes indiqué avant la description. Sans quantité précisée, une portion courante par personne. Une quantité qui décrit l'assiette de chacun (« un yaourt ») vaut pour chacun ; une quantité partagée (« une pizza », « un plat de lasagnes ») vaut pour le plat entier. null seulement si rien ne permet de l'estimer.

Un plat nommé sans autre détail reste une seule ligne (« lasagnes »). Quand le texte en nomme les composants (« tartine beurrée »), une ligne par composant.
N'ajoute aucun aliment que le texte ne mentionne pas. Les boissons comptent.`;

const FORMAT = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          search: { type: 'string' },
          grams: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['label', 'search', 'grams'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export function mealSplitter(ask: Ask): SplitMeal {
  return async (text, personnes) => {
    // Effort bas et 30 s : la tâche est courte, et au-delà la personne a déjà
    // tapé ses aliments un par un.
    const réponse = await ask({
      system: CONSIGNE,
      messages: [{
        role: 'user',
        content: `Cuisiné pour ${personnes} personne${personnes > 1 ? 's' : ''}\n\n${text}`,
      }],
      effort: 'low',
      timeout: 30_000,
      schema: FORMAT,
    });
    if (réponse === null) throw new SplitRefused('le modèle a décliné la demande');

    let parsed: unknown;
    try {
      parsed = JSON.parse(réponse);
    } catch {
      // Une réponse vide, ou coupée par `max_tokens`, finit ici.
      throw new SplitRefused('réponse illisible');
    }
    return readSplit(parsed);
  };
}

/**
 * La sortie structurée garantit la forme, pas le bon sens. Ce qui revient du
 * modèle est une entrée comme une autre : vérifié ici, pas cru sur parole.
 */
export function readSplit(raw: unknown): ProposedItem[] {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new SplitRefused('réponse sans liste d’aliments');

  return items.slice(0, 20).flatMap((item: unknown): ProposedItem[] => {
    const { label, search, grams } = (item ?? {}) as Record<string, unknown>;
    if (typeof label !== 'string' || label.trim() === '') return [];
    const mots = typeof search === 'string' && search.trim() !== '' ? search : label;
    return [{
      label: label.trim().slice(0, 200),
      search: mots.trim().slice(0, 100),
      // Un poids nul, négatif ou délirant n'est pas une estimation : il reste
      // à préciser plutôt que d'être corrigé en silence.
      grams: typeof grams === 'number' && grams > 0 && grams <= 5000 ? Math.round(grams) : null,
    }];
  });
}

/** Une ligne découpée et ses candidats Ciqual, le plus probable en tête. */
export interface MatchedItem {
  label: string;
  grams: number | null;
  foods: FoodSummary[];
}

/** La réponse JSON du modèle, à lire par `applyChoices` ; `null` s'il a décliné. */
export type ChooseFoods = (lines: Anonymized) => Promise<unknown>;

/** Les candidats que voit le modèle par ligne : les vraies pâtes arrivaient septièmes. */
export const CANDIDATES = 15;

/** Ceux que garde la liste de l'écran, l'aliment choisi compris. */
const SHOWN = 5;

/** Des noms d'aliments sous chaque ligne, jamais leurs valeurs : le modèle choisit un aliment, pas une teneur. */
export function describeCandidates(items: MatchedItem[]): string {
  return items.map((item, i) => [
    `Ligne ${i + 1} : ${item.label.replace(/\s+/g, ' ')}`,
    ...(item.foods.length === 0
      ? ['(aucun candidat)']
      : item.foods.map((food, n) => `${n + 1}. ${food.name}`)),
  ].join('\n')).join('\n\n');
}

/** Une ligne telle que la rend la route : ses candidats, et celui à présélectionner. */
export interface ChosenItem extends MatchedItem {
  /**
   * Le choix du modèle, à défaut le premier de la recherche. `null` quand le
   * modèle a répondu qu'aucun ne convient : présélectionner le premier venu
   * compterait « Truffe au chocolat » pour une truffe.
   */
  foodId: string | null;
}

/**
 * Chaque ligne, l'aliment choisi en tête et les autres dans l'ordre de la
 * recherche. Un numéro absent ou hors de la ligne laisse cet ordre : un choix
 * illisible ne doit pas emporter les autres. `null`, lui, est une réponse.
 */
export function applyChoices(items: MatchedItem[], output: unknown): ChosenItem[] {
  const choix = (output as { choix?: unknown } | null)?.choix;
  const chosen = new Map<number, number | null>();
  for (const entry of Array.isArray(choix) ? choix : []) {
    const { ligne, numero } = (entry ?? {}) as { ligne?: unknown; numero?: unknown };
    if (typeof ligne !== 'number' || chosen.has(ligne)) continue;
    if (numero === null || typeof numero === 'number') chosen.set(ligne, numero);
  }
  return items.map((item, i) => {
    const numero = chosen.get(i + 1);
    const food = typeof numero === 'number' ? item.foods[numero - 1] : undefined;
    const foods = food === undefined ? item.foods : [food, ...item.foods.filter((other) => other !== food)];
    return { ...item, foods: foods.slice(0, SHOWN), foodId: numero === null ? null : (foods[0]?.id ?? null) };
  });
}

const CONSIGNE_CHOIX = `Tu reçois les aliments d'un repas. Sous chacun, des aliments de la table de composition Ciqual de l'ANSES, numérotés. Pour chaque ligne, donne le numéro de celui qui correspond à ce qui a été mangé.

Juge sur le sens, pas sur la ressemblance des mots : des « pâtes » sont des pâtes alimentaires, pas une pâte à pizza.
Sans autre précision, préfère l'aliment tel qu'on le mange d'ordinaire : nature plutôt que transformé, cuit s'il se mange cuit, cru s'il se mange cru, la variété la plus courante.
Si aucun ne convient, numero vaut null. Jamais un numéro qui n'est pas sous la ligne.`;

const FORMAT_CHOIX = {
  type: 'object',
  properties: {
    choix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ligne: { type: 'integer' },
          numero: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
        required: ['ligne', 'numero'],
        additionalProperties: false,
      },
    },
  },
  required: ['choix'],
  additionalProperties: false,
};

export function foodChooser(ask: Ask): ChooseFoods {
  return async (lines) => {
    // Effort bas, 10 s et sans nouvel essai : le découpage a déjà pris sa part
    // des 60 s de l'ingress, et un choix manqué ne coûte qu'un ordre de
    // recherche gardé.
    const réponse = await ask({
      system: CONSIGNE_CHOIX,
      messages: [{ role: 'user', content: lines }],
      effort: 'low',
      timeout: 10_000,
      retries: 0,
      schema: FORMAT_CHOIX,
    });
    if (réponse === null || réponse === '') return null;
    try {
      return JSON.parse(réponse) as unknown;
    } catch {
      return null;
    }
  };
}
