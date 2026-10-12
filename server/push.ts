/**
 * Les rappels « Aujourd'hui, lequel ? » : web push (VAPID), à midi et le soir.
 *
 * Ce fichier refuse trois choses. Il ne lit pas les clés ailleurs que dans
 * l'environnement : la clé privée ne touche jamais le front, qui ne reçoit que
 * la publique. Il n'écrit dans le message ni prénom ni valeur nutritionnelle —
 * des titres de recettes **Jow** seulement, le titre d'une recette saisie à la
 * main étant écrit par le foyer et pouvant porter un prénom. Et il n'envoie
 * rien à un foyer dont le stock est vide : un rappel sans choix à faire est du
 * bruit, et le bruit fait désactiver les notifications.
 */
import type pg from 'pg';
import webpush from 'web-push';
import { withHousehold } from './db.ts';
import { todayIn } from './http/tz.ts';
import { claimReminder, deleteSubscription, listSubscriptions, reminderDishes } from './repo/push.ts';

/** Les horaires sont fixes, en heure du foyer (`household.timezone`) — dette n° 27. */
export const REMINDER_SLOTS = [
  { slot: 'midi', hour: 12, minute: 0 },
  { slot: 'soir', hour: 19, minute: 0 },
] as const;

/** Un créneau manqué (serveur arrêté, tour en retard) se rattrape dans ce délai. */
const CATCH_UP_MINUTES = 30;

export interface PushSubscriptionInput { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; url: string }
/** `'gone'` : le service push dit que l'appareil s'est désabonné. */
export type SendPush = (sub: PushSubscriptionInput, message: PushMessage) => Promise<'ok' | 'gone'>;

export interface Push { publicKey: string; send: SendPush }

export class PushConfigError extends Error {}

/** `TABLEE_VAPID_PUBLIC`, `TABLEE_VAPID_PRIVATE`, `TABLEE_VAPID_SUBJECT` : les trois, ou aucune. */
export function buildPush(env: NodeJS.ProcessEnv): Push | null {
  const publicKey = env['TABLEE_VAPID_PUBLIC'] ?? '';
  const privateKey = env['TABLEE_VAPID_PRIVATE'] ?? '';
  const subject = env['TABLEE_VAPID_SUBJECT'] ?? '';
  if (publicKey === '' && privateKey === '' && subject === '') return null;
  if (publicKey === '' || privateKey === '' || subject === '') {
    throw new PushConfigError(
      'TABLEE_VAPID_PUBLIC, TABLEE_VAPID_PRIVATE et TABLEE_VAPID_SUBJECT vont ensemble : les trois, ou aucune.\n'
        + 'En générer :  npx web-push generate-vapid-keys   (le sujet : mailto:vous@exemple.fr)',
    );
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (error) {
    throw new PushConfigError(`Clés VAPID inutilisables : ${(error as Error).message}`);
  }
  return {
    publicKey,
    send: async (sub, message) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(message),
          { TTL: 3600 },
        );
        return 'ok';
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return 'gone';
        throw error;
      }
    },
  };
}

/** Le texte : titres Jow seulement, jamais de prénom ni de valeur. */
export function reminderMessage(titles: string[], total: number): PushMessage {
  const shown = titles.slice(0, 3);
  const rest = total - shown.length;
  const body = shown.length === 0
    ? `${total} plat${total > 1 ? 's' : ''} au programme.`
    : shown.join(', ') + (rest > 0 ? ` et ${rest} autre${rest > 1 ? 's' : ''}` : '');
  return { title: 'Aujourd’hui, lequel ?', body, url: '/' };
}

/** Le créneau échu à cet instant, dans ce fuseau — `null` hors des fenêtres. */
function dueSlot(timezone: string, now: Date): { slot: 'midi' | 'soir'; day: string } | null {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now).split(':').map(Number) as [number, number];
  const minutes = h * 60 + m;
  for (const s of REMINDER_SLOTS) {
    const since = minutes - (s.hour * 60 + s.minute);
    if (since >= 0 && since < CATCH_UP_MINUTES) return { slot: s.slot, day: todayIn(timezone, now) };
  }
  return null;
}

/**
 * Un tour : à appeler chaque minute. Rend le nombre de notifications parties.
 * `household` est hors RLS ; tout le reste passe par `withHousehold`.
 */
export async function runReminders(pool: pg.Pool, send: SendPush, now = new Date()): Promise<number> {
  const { rows: households } = await pool.query<{ id: string; timezone: string }>(
    'select id, timezone from household');
  let sent = 0;
  for (const h of households) {
    const due = dueSlot(h.timezone, now);
    if (due === null) continue;
    try {
      sent += await withHousehold(pool, h.id, async (db) => {
        const dishes = await reminderDishes(db, h.id);
        if (dishes.length === 0) return 0;
        const subs = await listSubscriptions(db, h.id);
        if (subs.length === 0) return 0;
        if (!await claimReminder(db, h.id, due.day, due.slot)) return 0;

        const jow = dishes.filter((d) => d.source === 'jow').map((d) => d.title);
        const message = reminderMessage(jow, dishes.length);
        let ok = 0;
        for (const sub of subs) {
          try {
            if (await send(sub, message) === 'gone') {
              await deleteSubscription(db, h.id, sub.id);
            } else ok++;
          } catch (error) {
            console.error('push : envoi échoué', (error as Error).message);
          }
        }
        return ok;
      });
    } catch (error) {
      console.error('rappels : foyer ignoré', (error as Error).message);
    }
  }
  return sent;
}
