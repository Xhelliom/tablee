/**
 * La seule porte vers Anthropic (V3).
 *
 * Trois usages passent par ici — le découpage d'un texte libre (`decoupage.ts`),
 * l'assistant (`conseil.ts`) et les recettes de l'accueil (`recettes.ts`) — et
 * un quatrième devra en faire autant. Ce que ce module garantit à tous :
 *
 * - **Rien ne part sans être passé par `anonymize`.** `SplitMeal`,
 *   `ChooseFoods`, `Advise` et `SuggestRecipes` n'acceptent que des
 *   `Anonymized`, une marque que seul
 *   `anonymize` pose — la même idée que `HouseholdDb` pour la RLS : un oubli ne
 *   compile pas (I3, I6). La marque dit que le filtre est passé, pas qu'il est
 *   complet (dette n° 17).
 * - **Un client, un modèle, un repli.** La clé est lue une fois ; le modèle
 *   (`TABLEE_LLM_MODEL`), le repli côté serveur et la lecture d'un refus ne
 *   divergent pas d'un usage à l'autre.
 * - **Sans clé, pas d'IA, et rien ne casse.** `buildLlm` rend `null`, le
 *   serveur démarre, et les routes IA répondent 503 — contrairement au mail,
 *   il n'y a pas de configuration à moitié remplie qui ferait croire à un
 *   envoi.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '../http/errors.ts';
import { redactShareText } from '../jow/share.ts';
import { advisor, type Advise } from './conseil.ts';
import { foodChooser, mealSplitter, type ChooseFoods, type SplitMeal } from './decoupage.ts';
import { recipeSuggester, type SuggestRecipes } from './recettes.ts';

/** Un texte dont les prénoms du foyer et les jetons Jow ont été retirés. */
export type Anonymized = string & { readonly __anonymized: true };

export interface Llm {
  splitMeal: SplitMeal;
  chooseFoods: ChooseFoods;
  advise: Advise;
  suggestRecipes: SuggestRecipes;
}

/** Un appel au modèle : le texte de la réponse, ou `null` s'il a décliné. */
export type Ask = (request: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  effort: 'low' | 'medium';
  /** En millisecondes : c'est un téléphone qui attend. */
  timeout: number;
  /** Nouveaux essais après un échec, dépassement de délai compris ; un par défaut. */
  retries?: number;
  /** Un schéma JSON, pour une réponse structurée. */
  schema?: Record<string, unknown>;
  /** Pour recevoir la réponse au fil de sa génération plutôt que d'un bloc. */
  stream?: TextStream;
}) => Promise<string | null>;

/** Une réponse suivie morceau par morceau, et le signal qui l'interrompt. */
export interface TextStream {
  onText: (delta: string) => void;
  signal: AbortSignal;
}

/**
 * Chaque appel se paie, et l'inscription est ouverte (§16) : les 300 requêtes
 * par minute du reste de l'API seraient une facture, pas un plafond. Posé sur
 * chaque route IA, et compté **par route** : chaque route IA a le sien.
 */
export const LLM_RATE_LIMIT = { max: 10, timeWindow: 60_000 };

export function buildLlm(env: NodeJS.ProcessEnv): Llm | null {
  const apiKey = env['ANTHROPIC_API_KEY'] ?? '';
  if (apiKey === '') return null;

  // ⚠️ Changé le 14/09/2026 : `claude-opus-5` était écrit ici. Le propriétaire
  // a demandé Sonnet 5, et un modèle qui se change sans toucher au code. Celui
  // qu'on pose doit accepter `effort`, la sortie structurée et le repli
  // `default` ci-dessous — vérifié par un appel réel pour Sonnet 5.
  const model = env['TABLEE_LLM_MODEL'] || 'claude-sonnet-5';

  // Un seul nouvel essai : au-delà, la personne a déjà renoncé.
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  const ask: Ask = async ({ system, messages, effort, timeout, retries, schema, stream }) => {
    const params = {
      model,
      max_tokens: 16000,
      // Une demande déclinée est rejouée côté serveur sur le modèle de repli
      // recommandé, plutôt que de rendre un refus à quelqu'un qui décrit son
      // petit-déjeuner.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      output_config: {
        effort,
        ...(schema === undefined ? {} : { format: { type: 'json_schema' as const, schema } }),
      },
      system,
      messages,
    };
    const options = { timeout, ...(retries === undefined ? {} : { maxRetries: retries }) };

    // Le découpage et les recettes restent d'un bloc : en flux, un modèle qui
    // décline en cours de route laisse son début de réponse, que le repli
    // **continue** — un JSON recollé ainsi ne se lit plus.
    if (stream === undefined) {
      const response = await client.beta.messages.create(params, options);
      if (response.stop_reason === 'refusal') return null;
      return response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
    }

    // En flux, le `timeout` du SDK ne couvre que l'attente des en-têtes : sans
    // plafond sur la réponse entière, un flux figé laisserait l'écran attendre
    // sans fin. Le texte rendu est celui qui s'est affiché, et non les blocs
    // de la réponse finale joints : après un repli en cours de route, le saut
    // de ligne tomberait au milieu d'une phrase.
    let texte = '';
    const flux = client.beta.messages.stream(params, {
      ...options,
      signal: AbortSignal.any([stream.signal, AbortSignal.timeout(timeout)]),
    });
    flux.on('text', (delta) => {
      texte += delta;
      stream.onText(delta);
    });
    const response = await flux.finalMessage();
    return response.stop_reason === 'refusal' ? null : texte.trim();
  };

  return {
    splitMeal: mealSplitter(ask),
    chooseFoods: foodChooser(ask),
    advise: advisor(ask),
    suggestRecipes: recipeSuggester(ask),
  };
}

/** Le refus commun aux routes IA d'une instance sans clé. */
export function requireLlm(llm: Llm | null | undefined): Llm {
  if (llm === null || llm === undefined) {
    throw new ApiError(503, 'ia_non_configuree', 'l’IA n’est pas configurée sur ce serveur');
  }
  return llm;
}

/**
 * Les noms à retirer avant tout envoi : les prénoms des fiches du foyer —
 * retirées comprises, un prénom ne cesse pas d'en être un — et les mots du nom
 * du compte, assez longs pour ne pas effacer un « de ».
 */
export function namesToHide(eaters: { firstName: string }[], accountName: string): string[] {
  return [
    ...eaters.map((eater) => eater.firstName),
    ...accountName.split(/\s+/).filter((part) => part.length >= 3),
  ];
}

/**
 * Ce qui peut partir chez Anthropic : le texte sans les prénoms donnés, et
 * sans jeton Jow.
 *
 * Mot entier et sans égard à la casse — `\b` ignore que « é » est une lettre,
 * d'où les classes Unicode : « Léa » disparaît, « Léandre » reste.
 */
export function anonymize(text: string, names: string[]): Anonymized {
  let sortie = redactShareText(text);
  for (const name of new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))) {
    const motif = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sortie = sortie.replace(new RegExp(`(?<![\\p{L}\\p{N}])${motif}(?![\\p{L}\\p{N}])`, 'giu'), 'quelqu’un');
  }
  // La seule ligne du dépôt où un texte devient un `Anonymized`.
  return sortie as Anonymized;
}
