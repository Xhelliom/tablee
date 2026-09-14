/**
 * V3 — l'assistant : on lui pose une question sur les repas du foyer, il
 * répond à partir d'un résumé de la semaine.
 *
 * ⚠️ Hors de la roadmap d'origine, décidé le 14/09/2026 : le §15 voulait des
 * semaines de repas réels avant tout conseil. Ce qui reste juste dans cette
 * prudence est passé dans la consigne — la saisie est incomplète, et un
 * pourcentage bas ne prouve aucun manque.
 *
 * ── Ce qu'il sait du foyer ──────────────────────────────────────────────────
 *
 * Ce que le §14 fixe, et `describeHousehold` s'y tient : des tranches d'âge,
 * des régimes, des moyennes **du foyer** et des libellés de plats (R5). Pas de
 * moyenne par personne : « l'enfant de 6-9 ans est à 40 % de ses fibres » est
 * à un pas de « il mange mal » (I2), et le modèle le franchirait. Ni prénom, ni
 * date de naissance, ni poids, ni allergène (I3) — les allergènes ne sont
 * d'ailleurs saisis nulle part, et l'écran le dit. Pas l'énergie non plus :
 * les calories ne sont jamais la métrique mise en avant (R7, I5).
 *
 * ── Ce qu'il refuse de faire ────────────────────────────────────────────────
 *
 * Rien n'est gardé, ni la conversation ni les réponses : une réponse relue
 * une semaine plus tard se lirait comme un fait sur la famille (I2). Rien ne
 * part tout seul : l'assistant répond quand on lui demande, jamais après un
 * repas (I4).
 *
 * La consigne interdit tout chiffre absent des faits, repères compris (R1,
 * I1), et tout jugement. Une consigne n'est pas une garantie — rien ne relit la
 * réponse avant l'écran (dette n° 17).
 */
import { ageBracket } from '../nutrition/age.ts';
import type { Anonymized, Ask } from './index.ts';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export type Advise = (
  facts: Anonymized,
  conversation: { role: Turn['role']; content: Anonymized }[],
) => Promise<string>;

/**
 * Les nutriments dont le modèle reçoit la moyenne. L'énergie n'en est pas.
 * Exportés pour les recettes de l'accueil, qui visent les mêmes (`recettes.ts`).
 */
export const ADVICE_NUTRIENTS = ['proteinG', 'carbG', 'fatG', 'fiberG'] as const;
type AdviceNutrient = (typeof ADVICE_NUTRIENTS)[number];

export const NUTRIENT_WORDS: Record<AdviceNutrient, string> = {
  proteinG: 'protéines', carbG: 'glucides', fatG: 'lipides', fiberG: 'fibres',
};

/**
 * `eater.diets` est libre ; les valeurs que l'écran propose, en toutes lettres.
 * Recopiées de `DIET_CHOICES` (`web/design/vocabulary.ts`), que le serveur ne
 * peut pas importer : un régime ajouté là-bas part ici sous sa valeur brute.
 */
const DIET_WORDS: Record<string, string> = {
  vegetarien: 'végétarien', vegetalien: 'végétalien', sans_porc: 'sans porc',
  sans_gluten: 'sans gluten', sans_lactose: 'sans lactose',
};

export interface HouseholdFacts {
  /** Un âge par convive à table. */
  ages: number[];
  /** Les régimes déclarés, tous convives confondus, doublons compris. */
  diets: string[];
  /** Repas saisis depuis une semaine, aujourd'hui compris. */
  mealCount: number;
  /** Plats et aliments de ces repas. */
  dishes: string[];
  /**
   * % du repère, un par journée et par convive, sur les sept jours
   * **précédents** : la journée en cours, pas finie, tirerait tout vers le bas.
   */
  percents: Record<AdviceNutrient, number[]>;
  plant7d: number | null;
  plant28d: number | null;
}

const compter = (valeurs: string[]): Map<string, number> => {
  const compte = new Map<string, number>();
  for (const valeur of valeurs) compte.set(valeur, (compte.get(valeur) ?? 0) + 1);
  return compte;
};

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Le texte que le modèle reçoit — la forme du prompt du §14. */
export function describeHousehold(facts: HouseholdFacts): string {
  const composition = [...compter(facts.ages.map(ageBracket))].map(([tranche, n]) =>
    tranche === 'adulte' ? pluriel(n, 'adulte') : `${pluriel(n, 'enfant')} de ${tranche}`,
  );
  const lines = [`Foyer : ${composition.length === 0 ? 'personne n’est enregistré' : composition.join(', ')}.`];

  const régimes = [...compter(facts.diets)].map(([diet, n]) => `${n} ${DIET_WORDS[diet] ?? diet}`);
  if (régimes.length > 0) lines.push(`Régimes : ${régimes.join(', ')}.`);

  if (facts.mealCount === 0) {
    lines.push('Aucun repas saisi depuis une semaine.');
    return lines.join('\n');
  }

  lines.push(`Depuis une semaine : ${pluriel(facts.mealCount, 'repas saisi')}. La saisie peut être incomplète.`);
  if (facts.plant7d !== null) {
    const tendance = facts.plant28d === null ? '' : ` (quatre semaines : ${Math.round(facts.plant28d)} %)`;
    lines.push(`- part végétale : ${Math.round(facts.plant7d)} %${tendance}`);
  }
  for (const nutrient of ADVICE_NUTRIENTS) {
    const valeurs = facts.percents[nutrient];
    if (valeurs.length === 0) continue;
    const moyenne = Math.round(valeurs.reduce((a, b) => a + b, 0) / valeurs.length);
    lines.push(
      `- ${NUTRIENT_WORDS[nutrient]} : ${moyenne} % du repère du jour, en moyenne sur ${pluriel(valeurs.length, 'journée')} de convives`,
    );
  }
  if (facts.dishes.length > 0) lines.push(`Plats et aliments : ${facts.dishes.join(' ; ')}.`);
  return lines.join('\n');
}

const CONSIGNE = `Tu es l’assistant de Tablée, une application où une famille note ses repas. On te pose des questions sur l’alimentation du foyer : idées de repas, variété, équilibre de la semaine.

Tu ne connais du foyer que les faits donnés plus bas : ni prénoms, ni âges exacts, ni poids, ni allergies, ni ce que chacun a mangé. Dis-le simplement quand une question le demande.

Règles, sans exception :
- N’avance aucun chiffre absent des faits : ni calories, ni grammes, ni pourcentages, ni repère chiffré comme un nombre de portions ou de fois par semaine. Tu peux commenter les chiffres qu’on te donne.
- Aucun objectif de calories ou de poids, pour personne, et jamais pour un enfant. Pas de vocabulaire de régime amaigrissant.
- Aucun jugement sur une personne ou sur la famille : des constats et des suggestions, jamais de reproche. On parle de qualité et de variété.
- La saisie est souvent incomplète : un pourcentage bas peut vouloir dire qu’un repas n’a pas été noté. N’en conclus pas qu’il manque quelque chose.
- Quand tu proposes des plats, rappelle une fois, en une phrase, de vérifier les allergies et intolérances du foyer, que tu ne connais pas.
- Pour une question de santé — maladie, allergie, trouble alimentaire, croissance, grossesse — renvoie vers un médecin ou un diététicien, sans diagnostic.
- Réponds en français, en quelques phrases courtes. Ni titres, ni gras, ni tableaux ; une courte liste à tirets si tu proposes plusieurs idées.`;

export function advisor(ask: Ask): Advise {
  return async (facts, conversation) => {
    // Effort moyen et une minute, et non l'effort bas et les 30 s du découpage :
    // une réponse réfléchie est plus longue à venir qu'une liste d'aliments.
    const réponse = await ask({
      system: `${CONSIGNE}\n\nCe que Tablée sait du foyer :\n${facts}`,
      messages: conversation,
      effort: 'medium',
      timeout: 60_000,
    });
    if (réponse === null) return 'Je ne peux pas répondre à cette question. Essayez de la formuler autrement.';
    return réponse === '' ? 'Je n’ai pas de réponse à proposer.' : réponse;
  };
}
