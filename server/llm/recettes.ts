/**
 * V3 — « Demander à l'assistant des recettes », le bouton de l'accueil : des
 * plats qui rapprochent la semaine des repères les moins atteints.
 *
 * ── Il choisit dans le stock du foyer ───────────────────────────────────────
 *
 * Le modèle **choisit** parmi les recettes Jow que le foyer connaît déjà. Ce
 * qui s'affiche d'elles vient de la base, et leurs valeurs sont celles que Jow
 * publie (R1) : une proposition qui ne désigne pas une recette de la liste est
 * jetée, une raison qui contient un chiffre est retirée (§14). Les recettes
 * manuelles restent dehors : leur titre est écrit par le foyer, et
 * « Blanquette de mamie Jeanne » porte un prénom.
 *
 * ── Et il avance des idées, sans aucune valeur ──────────────────────────────
 *
 * Une ou deux idées de plats hors de la liste, à la demande du propriétaire du
 * dépôt (14/09/2026) : un nom et une phrase, rien qui se mesure, marqués « à
 * vérifier » à l'écran (R6). Une idée qui contient un chiffre est écartée
 * entière — elle n'a aucune valeur sourcée pour le démentir. Ce qu'on accepte
 * en connaissance de cause : son « pourquoi » vient de ce que le modèle sait
 * des aliments, pas d'une source (dette n° 20).
 *
 * ── Ce qu'il sait du foyer ──────────────────────────────────────────────────
 *
 * Ce que sait l'assistant des Conseils, par le même `describeHousehold` : des
 * moyennes du foyer et jamais par personne, ni l'énergie (en-tête de
 * `conseil.ts`). S'y ajoutent l'ordre de ces repères et la liste numérotée des
 * recettes. Tout passe par `anonymize`, et rien n'est gardé.
 */
import type { RecipeSummary } from '../repo/recipes.ts';
import { ADVICE_NUTRIENTS, NUTRIENT_WORDS, type HouseholdFacts } from './conseil.ts';
import type { Anonymized, Ask } from './index.ts';

/** La réponse JSON du modèle, à lire par `readProposals` et `readIdeas` ; `null` s'il a décliné. */
export type SuggestRecipes = (facts: Anonymized) => Promise<unknown>;

export interface Proposal {
  recipe: RecipeSummary;
  /** `null` quand le modèle n'a rien donné de lisible, ou a glissé un chiffre. */
  reason: string | null;
}

/** Un plat hors de la liste : un nom et une phrase, rien qui se mesure. */
export interface Idea {
  title: string;
  reason: string;
}

const MAX_PROPOSALS = 3;
const MAX_IDEAS = 2;

/** Les recettes où le modèle choisit : Jow, et qui publient au moins une valeur visée. */
export function recipeCandidates(recipes: RecipeSummary[]): RecipeSummary[] {
  return recipes.filter(
    (recipe) => recipe.source === 'jow' && ADVICE_NUTRIENTS.some((n) => recipe.perServing[n] !== null),
  );
}

/**
 * Les repères, du moins atteint au plus atteint.
 *
 * Sans cet ordre, le modèle a retenu un risotto à 4 g de fibres quand les
 * fibres étaient à 12 %, et laissé la galette qui en portait 12 g. `null`
 * quand aucun repère n'a de moyenne : il n'y a rien à viser.
 */
export function describePriorities(percents: HouseholdFacts['percents']): string | null {
  const ranked = ADVICE_NUTRIENTS
    .filter((n) => percents[n].length > 0)
    .map((n) => ({ n, average: percents[n].reduce((a, b) => a + b, 0) / percents[n].length }))
    .sort((a, b) => a.average - b.average)
    .map(({ n }) => NUTRIENT_WORDS[n]);
  return ranked.length === 0 ? null : `Repères du moins atteint au plus atteint : ${ranked.join(', ')}.`;
}

/** La liste numérotée : le modèle désigne une recette par son numéro, jamais par son titre. */
export function describeRecipes(candidates: RecipeSummary[]): string {
  const lines = ['Recettes que le foyer connaît, valeurs par portion publiées par Jow :'];
  if (candidates.length === 0) lines.push('(aucune)');
  candidates.forEach((recipe, index) => {
    const values = ADVICE_NUTRIENTS.map((n) => {
      const value = recipe.perServing[n];
      return `${NUTRIENT_WORDS[n]} ${value === null ? 'n.c.' : `${value} g`}`;
    }).join(', ');
    const eaten = recipe.timesEaten === 0 ? 'jamais à table' : `à table ${recipe.timesEaten} fois`;
    lines.push(`${index + 1}. ${recipe.title.replace(/\s+/g, ' ')} — ${values} ; ${eaten}`);
  });
  return lines.join('\n');
}

/**
 * Ce que le modèle a répondu, réduit à ce qui tient : un numéro de la liste,
 * pas deux fois le même, trois au plus. Le reste est ignoré plutôt que refusé
 * — une proposition illisible ne doit pas emporter les autres.
 */
export function readProposals(output: unknown, candidates: RecipeSummary[]): Proposal[] {
  const items = (output as { propositions?: unknown } | null)?.propositions;
  if (!Array.isArray(items)) return [];

  const seen = new Set<number>();
  const proposals: Proposal[] = [];
  for (const item of items) {
    const { numero, raison } = (item ?? {}) as { numero?: unknown; raison?: unknown };
    if (typeof numero !== 'number' || !Number.isInteger(numero) || seen.has(numero)) continue;
    const recipe = candidates[numero - 1];
    if (recipe === undefined) continue;
    seen.add(numero);
    // Une raison chiffrée est retirée ; la recette reste, ses valeurs
    // viennent de Jow.
    proposals.push({ recipe, reason: readableText(raison, 280) });
    if (proposals.length === MAX_PROPOSALS) break;
  }
  return proposals;
}

/**
 * Les idées de plats hors de la liste, deux au plus.
 *
 * Plus strict que pour une recette : une idée n'a aucune valeur sourcée pour
 * démentir un chiffre, donc un chiffre — dans le nom ou dans la phrase —
 * l'écarte entière, au lieu de ne retirer que la phrase.
 */
export function readIdeas(output: unknown): Idea[] {
  const items = (output as { idees?: unknown } | null)?.idees;
  if (!Array.isArray(items)) return [];

  const ideas: Idea[] = [];
  for (const item of items) {
    const { titre, raison } = (item ?? {}) as { titre?: unknown; raison?: unknown };
    const title = readableText(titre, 80);
    const reason = readableText(raison, 280);
    if (title === null || reason === null) continue;
    ideas.push({ title, reason });
    if (ideas.length === MAX_IDEAS) break;
  }
  return ideas;
}

/**
 * Le modèle ne produit aucun chiffre (§14) : un texte qui en porte un est
 * écarté, comme un texte vide ou trop long pour ce qu'il doit dire.
 */
function readableText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' || text.length > max || /\d/.test(text) ? null : text;
}

const CONSIGNE = [
  'Tu aides un foyer à rendre sa semaine plus équilibrée, en choisissant parmi ses recettes.',
  'Les repères sont donnés du moins atteint au plus atteint. Vise d’abord le premier : préfère les recettes qui en apportent le plus par portion, comparées aux autres recettes de la liste. Une recette qui aide aussi le suivant vaut mieux qu’une qui n’aide que le premier.',
  'Écarte une recette dont l’apport principal porte sur un repère déjà atteint, ou qui ne respecte pas un régime du foyer.',
  'À apport comparable, préfère une recette jamais à table ou peu servie, et différente des plats de la semaine : la variété compte.',
  'Les moyennes ne portent que sur les repas saisis : une journée peut être incomplète.',
  'Choisis au plus trois recettes, de la plus utile à la moins utile, désignées par leur numéro dans la liste. Rien qui n’y figure. Si aucune n’aide vraiment le premier repère, propose-en moins.',
  'Pour chacune, une phrase courte qui dit quel repère elle aide à rejoindre, en termes de qualité et de variété.',
  'Ajoute ensuite une ou deux idées de plats qui ne sont pas dans la liste, pour le premier repère et dans le respect des régimes : un nom de plat courant, sans marque, et une phrase. Si la liste est vide, ne propose que des idées.',
  'Aucun chiffre, ni dans les noms ni dans les phrases : les valeurs affichées viennent de Jow, et une idée n’en a aucune de vérifiée. Parle de familles d’aliments plutôt que de quantités.',
  'Un ton de constat et de suggestion, jamais de reproche, sans vocabulaire de régime amaigrissant, de calories ni de poids.',
].join('\n');

const FORMAT = {
  type: 'object',
  properties: {
    propositions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { numero: { type: 'integer' }, raison: { type: 'string' } },
        required: ['numero', 'raison'],
        additionalProperties: false,
      },
    },
    idees: {
      type: 'array',
      items: {
        type: 'object',
        properties: { titre: { type: 'string' }, raison: { type: 'string' } },
        required: ['titre', 'raison'],
        additionalProperties: false,
      },
    },
  },
  required: ['propositions', 'idees'],
  additionalProperties: false,
};

export function recipeSuggester(ask: Ask): SuggestRecipes {
  return async (facts) => {
    // Effort moyen et une minute, comme les Conseils : un choix raisonné dans
    // une liste, pas une liste d'aliments à recopier.
    const réponse = await ask({
      system: CONSIGNE,
      messages: [{ role: 'user', content: facts }],
      effort: 'medium',
      timeout: 60_000,
      schema: FORMAT,
    });
    if (réponse === null || réponse === '') return null;
    try {
      return JSON.parse(réponse) as unknown;
    } catch {
      // Une réponse coupée par `max_tokens` : rien à proposer, pas une panne.
      return null;
    }
  };
}
