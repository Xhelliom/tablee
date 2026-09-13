/**
 * §7 — sessions de foyer.
 *
 * Cookie opaque plutôt que JWT : la session vit de toute façon en base (il
 * faut pouvoir la révoquer), et un JWT ajouterait une signature à vérifier
 * pour la même garantie en moins bonne — un JWT volé reste valable jusqu'à
 * expiration, une ligne supprimée ne l'est plus.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.ts';

export const COOKIE_NAME = 'tablee_session';
/** §7 : session longue. Un foyer ne se reconnecte pas toutes les semaines. */
export const SESSION_DAYS = 30;

export interface Session {
  token: string;
  householdId: string;
  expiresAt: Date;
}

/** 256 bits d'aléa — la spec le demande explicitement au §10. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(db: Db, householdId: string): Promise<Session> {
  const token = newToken();
  const { rows } = await db.query<{ expires_at: Date }>(
    `insert into session (token, household_id, expires_at)
     values ($1, $2, now() + ($3 || ' days')::interval)
     returning expires_at`,
    [token, householdId, String(SESSION_DAYS)],
  );
  const expiresAt = rows[0]?.expires_at;
  if (expiresAt === undefined) throw new Error('session non créée');
  return { token, householdId, expiresAt };
}

/**
 * Résout un cookie de session. Une session expirée est traitée comme absente
 * — et supprimée au passage, pour que la table ne devienne pas un cimetière.
 */
export async function findSession(db: Db, token: string | undefined): Promise<Session | null> {
  if (token === undefined || token.length === 0) return null;
  const { rows } = await db.query<{ token: string; household_id: string; expires_at: Date }>(
    'select token, household_id, expires_at from session where token = $1',
    [token],
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (row.expires_at.getTime() <= Date.now()) {
    await destroySession(db, token);
    return null;
  }
  return { token: row.token, householdId: row.household_id, expiresAt: row.expires_at };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query('delete from session where token = $1', [token]);
}

/** À appeler au démarrage : les sessions mortes n'ont aucune raison de rester. */
export async function purgeExpiredSessions(db: Db): Promise<number> {
  const { rowCount } = await db.query('delete from session where expires_at <= now()');
  return rowCount ?? 0;
}

/**
 * Comparaison à temps constant, pour les cas où l'on compare deux jetons hors
 * de la base (tests, jetons d'invitation à venir). Une comparaison naïve
 * laisse fuir la longueur du préfixe commun.
 */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
