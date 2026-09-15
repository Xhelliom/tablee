/**
 * Templates — le levier anti-friction du §6bis.
 *
 * « Sans un bouton "Mon petit-déj" à un tap, quatre saisies par jour
 * deviennent une corvée et l'usage s'arrête en deux semaines. » Ce fichier est
 * donc aussi important que le calcul nutritionnel, et moins spectaculaire.
 *
 * Un template porte un `payload` : des items et des convives pré-remplis. Il
 * ne porte **pas** de parts — celles-ci sont recalculées à l'application,
 * depuis les `portion_coef` du jour. Un template gelé en janvier ne doit pas
 * ressortir des parts de janvier au mois d'août (R2 fige le passé, pas le
 * futur).
 */
import type { HouseholdDb } from '../db.ts';
import {
  createMeal, portionOfItems, type MealItemInput, type MealSource, type Slot,
} from './meals.ts';

export interface TemplatePayload {
  source: MealSource;
  recipeId: string | null;
  servings: number;
  guestCount: number;
  items: MealItemInput[];
  participants: { eaterId: string; present: boolean }[];
}

export interface MealTemplate {
  id: string;
  name: string;
  slot: Slot | null;
  payload: TemplatePayload;
  useCount: number;
  lastUsedAt: string | null;
}

interface Row {
  id: string; name: string; slot: Slot | null; payload: TemplatePayload;
  use_count: number; last_used_at: Date | null;
}

const toTemplate = (row: Row): MealTemplate => ({
  id: row.id,
  name: row.name,
  slot: row.slot,
  payload: row.payload,
  useCount: row.use_count,
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
});

/**
 * Templates du foyer, **les plus utilisés d'abord** (§12). C'est l'ordre qui
 * fait le « deux taps » : le petit-déj quotidien doit être en haut de l'écran
 * sans qu'on ait à le chercher.
 */
export async function listTemplates(db: HouseholdDb, householdId: string): Promise<MealTemplate[]> {
  const { rows } = await db.query<Row>(
    `select id, name, slot, payload, use_count, last_used_at
     from meal_template where household_id = $1
     order by use_count desc, last_used_at desc nulls last, name`,
    [householdId],
  );
  return rows.map(toTemplate);
}

export async function getTemplate(
  db: HouseholdDb,
  householdId: string,
  id: string,
): Promise<MealTemplate | null> {
  const { rows } = await db.query<Row>(
    `select id, name, slot, payload, use_count, last_used_at
     from meal_template where household_id = $1 and id = $2`,
    [householdId, id],
  );
  const row = rows[0];
  return row === undefined ? null : toTemplate(row);
}

/** Crée un template depuis un repas existant : l'usage réel, pas un formulaire. */
export async function createTemplateFromMeal(
  db: HouseholdDb,
  householdId: string,
  mealId: string,
  name: string,
): Promise<MealTemplate | null> {
  const { rows: mealRows } = await db.query<{
    slot: Slot; source: MealSource; recipe_id: string | null;
    servings: number; guest_count: number;
  }>(
    `select slot, source, recipe_id, servings, guest_count
     from meal where household_id = $1 and id = $2`,
    [householdId, mealId],
  );
  const meal = mealRows[0];
  if (meal === undefined) return null;

  const { rows: participants } = await db.query<{ eater_id: string }>(
    'select eater_id from meal_participant where meal_id = $1',
    [mealId],
  );

  const payload: TemplatePayload = {
    // Un template rejoue une habitude : sa source est le template, même si le
    // repas d'origine venait de Jow. La recette, elle, est conservée.
    source: 'template',
    recipeId: meal.recipe_id,
    servings: meal.servings,
    guestCount: meal.guest_count,
    // Une habitude rejoue ce qui a été mangé, pas le plat servi : un plat dont
    // il restait un quart ne se rejoue pas entier (§6bis).
    items: await portionOfItems(db, householdId, mealId, 'eaten'),
    participants: participants.map((p) => ({ eaterId: p.eater_id, present: true })),
  };

  const { rows } = await db.query<Row>(
    `insert into meal_template (household_id, name, slot, payload)
     values ($1, $2, $3, $4)
     returning id, name, slot, payload, use_count, last_used_at`,
    [householdId, name, meal.slot, JSON.stringify(payload)],
  );
  const row = rows[0];
  return row === undefined ? null : toTemplate(row);
}

export async function deleteTemplate(db: HouseholdDb, householdId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'delete from meal_template where household_id = $1 and id = $2',
    [householdId, id],
  );
  return (rowCount ?? 0) > 0;
}

export interface ApplyOptions {
  eatenAt?: string;
  slot?: Slot;
  /** Permet de corriger qui est là sans défaire le template. */
  participants?: { eaterId: string; present: boolean }[];
  guestCount?: number;
}

/**
 * Applique un template : un repas, tout de suite.
 *
 * Les parts sont recalculées depuis les `portion_coef` **du jour** — c'est une
 * écriture de repas comme une autre, donc R2 s'applique normalement.
 */
export async function applyTemplate(
  client: HouseholdDb,
  householdId: string,
  templateId: string,
  options: ApplyOptions = {},
): Promise<string | null> {
  const template = await getTemplate(client, householdId, templateId);
  if (template === null) return null;

  const mealId = await createMeal(client, householdId, {
    eatenAt: options.eatenAt ?? new Date().toISOString(),
    slot: options.slot ?? template.slot ?? 'collation',
    source: template.payload.source,
    recipeId: template.payload.recipeId,
    servings: template.payload.servings,
    guestCount: options.guestCount ?? template.payload.guestCount,
    items: template.payload.items,
    participants: options.participants ?? template.payload.participants,
  });

  await client.query(
    'update meal_template set use_count = use_count + 1, last_used_at = now() where id = $1',
    [templateId],
  );
  return mealId;
}

export interface TemplateSuggestion {
  /** Signature du repas répété — libellés triés, pour l'affichage. */
  labels: string[];
  slot: Slot;
  occurrences: number;
  /** Repas le plus récent de la série, à transformer en template. */
  mealId: string;
}

/**
 * V2 — repérer un repas qui revient, pour proposer d'en faire un template.
 *
 * La signature d'un repas est l'ensemble trié de ses `food_id` (ou de sa
 * recette), pas son libellé : « 2 œufs » et « œufs ×2 » sont le même
 * petit-déjeuner. Trois occurrences sur trente jours suffisent à parler
 * d'habitude, et proposer plus tôt ferait de la suggestion un bruit.
 *
 * Les repas déjà couverts par un template existant sont écartés : on ne
 * propose pas de créer ce qui existe.
 */
export async function suggestTemplates(
  db: HouseholdDb,
  householdId: string,
  { minOccurrences = 3, days = 30 } = {},
): Promise<TemplateSuggestion[]> {
  const { rows } = await db.query<{
    signature: string; slot: Slot; occurrences: number; meal_id: string; labels: string[];
  }>(
    `with signed as (
       select m.id, m.slot, m.eaten_at,
              coalesce(m.recipe_id::text, '') || ':' ||
              coalesce(
                (select string_agg(distinct coalesce(mi.food_id::text, lower(mi.label)), ',' order by coalesce(mi.food_id::text, lower(mi.label)))
                 from meal_item mi where mi.meal_id = m.id),
                ''
              ) as signature
       from meal m
       where m.household_id = $1
         and m.eaten_at > now() - ($2 || ' days')::interval
     ),
     grouped as (
       select signature, slot, count(*)::int as occurrences,
              (array_agg(id order by eaten_at desc))[1] as meal_id
       from signed
       where signature <> ':'
       group by signature, slot
       having count(*) >= $3
     )
     select g.signature, g.slot, g.occurrences, g.meal_id,
            coalesce(
              (select array_agg(mi.label order by mi.position)
               from meal_item mi where mi.meal_id = g.meal_id),
              '{}'
            ) as labels
     from grouped g
     where not exists (
       select 1 from meal_template t
       where t.household_id = $1 and t.slot is not distinct from g.slot
         and t.payload -> 'items' is not null
         and (
           select coalesce(string_agg(distinct coalesce(item ->> 'foodId', lower(item ->> 'label')), ',' order by coalesce(item ->> 'foodId', lower(item ->> 'label'))), '')
           from jsonb_array_elements(t.payload -> 'items') as item
         ) = split_part(g.signature, ':', 2)
     )
     order by g.occurrences desc
     limit 3`,
    [householdId, String(days), minOccurrences],
  );

  return rows.map((r) => ({
    labels: r.labels,
    slot: r.slot,
    occurrences: r.occurrences,
    mealId: r.meal_id,
  }));
}
