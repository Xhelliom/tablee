/**
 * Les abonnements push (024) et le verrou des rappels déjà envoyés.
 *
 * Un appareil, une ligne : l'endpoint est unique sur toute l'instance. Le
 * seul endroit qui touche une ligne hors du foyer courant est
 * `subscribe`, par la porte étroite de la 025 — lire son en-tête avant
 * d'en ouvrir une autre.
 */
import { transaction, type HouseholdDb } from '../db.ts';

export interface PushSubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string }

/**
 * Abonne l'appareil au foyer courant. Un endpoint déjà abonné ailleurs — autre
 * compte, autre foyer — est repris : l'ancienne ligne est supprimée d'abord,
 * puisque la RLS la cache et qu'un `on conflict` ne la verrait pas.
 */
export async function subscribe(
  db: HouseholdDb, householdId: string, userId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await transaction(db, async (client) => {
    // `true` : le paramètre ne vit que le temps de cette transaction.
    await client.query("select set_config('app.push_endpoint', $1, true)", [sub.endpoint]);
    await client.query('delete from push_subscription where endpoint = $1', [sub.endpoint]);
    await client.query(
      `insert into push_subscription (household_id, user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, $4, $5)`,
      [householdId, userId, sub.endpoint, sub.p256dh, sub.auth]);
  });
}

export async function unsubscribe(db: HouseholdDb, householdId: string, endpoint: string): Promise<void> {
  await db.query('delete from push_subscription where household_id = $1 and endpoint = $2',
    [householdId, endpoint]);
}

export async function listSubscriptions(db: HouseholdDb, householdId: string): Promise<PushSubscriptionRow[]> {
  const { rows } = await db.query<PushSubscriptionRow>(
    'select id, endpoint, p256dh, auth from push_subscription where household_id = $1', [householdId]);
  return rows;
}

export async function deleteSubscription(db: HouseholdDb, householdId: string, id: string): Promise<void> {
  await db.query('delete from push_subscription where household_id = $1 and id = $2', [householdId, id]);
}

/** Le stock, dans l'ordre de l'accueil, avec la source : seuls les titres Jow se nomment. */
export async function reminderDishes(
  db: HouseholdDb, householdId: string,
): Promise<{ title: string; source: string }[]> {
  const { rows } = await db.query<{ title: string; source: string }>(
    `select r.title, r.source from upcoming_dish d join recipe r on r.id = d.recipe_id
     where d.household_id = $1 order by d.added_at, d.id`, [householdId]);
  return rows;
}

/** Le verrou : `true` pour le seul tour, le seul processus, qui prévient le foyer. */
export async function claimReminder(
  db: HouseholdDb, householdId: string, day: string, slot: 'midi' | 'soir',
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into reminder_sent (household_id, day, slot) values ($1, $2, $3)
     on conflict do nothing`, [householdId, day, slot]);
  return rowCount === 1;
}
