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
 * ── Ce qui part chez Anthropic ──────────────────────────────────────────────
 *
 * Le texte tapé, rien d'autre (R5), et seulement une fois passé par
 * `anonymize` — le type l'exige. Un texte tapé peut contenir un prénom ou un
 * lien Jow et son jeton : voir `server/llm/index.ts`, la seule porte vers
 * Anthropic, et la dette n° 17 pour ce que le filtre laisse passer.
 */
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

export type SplitMeal = (text: Anonymized) => Promise<ProposedItem[]>;

/** Le modèle a décliné, ou rendu quelque chose d'inexploitable. Réessayer n'y changera rien. */
export class SplitRefused extends Error {}

const CONSIGNE = `Tu reçois la description d'un repas, écrite en français par un membre d'une famille. Découpe-la en aliments.

Pour chaque aliment :
- label : l'aliment tel que le texte le dit, avec sa quantité s'il y en a une (« 2 œufs », « un bol de lait »).
- search : un à trois mots pour le retrouver dans la table de composition Ciqual de l'ANSES — le nom de l'aliment au singulier, sans quantité, sans marque ni article (« oeuf », « lait demi-écrémé », « pain baguette »).
- grams : le poids en grammes de ce que le texte décrit pour tout le repas. Sans quantité précisée, une portion individuelle courante. null seulement si rien ne permet de l'estimer.

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
  return async (text) => {
    // Effort bas et 30 s : la tâche est courte, et au-delà la personne a déjà
    // tapé ses aliments un par un.
    const réponse = await ask({
      system: CONSIGNE,
      messages: [{ role: 'user', content: text }],
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
