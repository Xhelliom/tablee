/**
 * Le foyer — la table du domaine, rattachée à son organisation better-auth.
 *
 * `household` garde son nom parce que c'est elle que référencent les dix
 * tables qui portent un `household_id` : les renommer `organization_id` ferait
 * entrer un mot d'authentification dans le vocabulaire métier pour rien.
 * L'organisation lui est rattachée, jamais l'inverse.
 *
 * Tout part d'ici : la session dit quelle organisation est active, ce module
 * dit quel foyer c'est, et c'est ce `household_id` — jamais un identifiant
 * venu du client — que reçoivent toutes les requêtes du §12.
 */
import type { Db } from '../db.ts';

export interface Household {
  id: string;
  name: string;
  timezone: string;
  organizationId: string;
}

interface Row {
  id: string;
  name: string;
  timezone: string;
  organization_id: string;
}

const toHousehold = (row: Row): Household => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone,
  organizationId: row.organization_id,
});

/**
 * Crée le foyer d'une organisation qui vient de naître. Appelé depuis le hook
 * `afterCreateOrganization` : aucune organisation ne doit exister sans son
 * foyer, sinon la session pointerait vers un foyer introuvable.
 *
 * Idempotent — rejouer le hook ne crée pas un second foyer.
 */
export async function createHouseholdForOrganization(
  db: Db,
  organizationId: string,
  name: string,
  timezone = 'Europe/Paris',
): Promise<Household> {
  const { rows } = await db.query<Row>(
    `insert into household (name, timezone, organization_id)
     values ($1, $2, $3)
     on conflict (organization_id) do update set name = excluded.name
     returning id, name, timezone, organization_id`,
    [name, timezone, organizationId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('foyer non créé');
  return toHousehold(row);
}

/**
 * Le foyer d'une organisation.
 *
 * Renvoie `null` plutôt que de lever : un foyer antérieur à la migration 007
 * n'a pas d'organisation et reste donc injoignable, ce qui est le comportement
 * voulu — ses identifiants ont disparu avec l'ancienne authentification.
 */
export async function findHouseholdByOrganization(
  db: Db,
  organizationId: string,
): Promise<Household | null> {
  const { rows } = await db.query<Row>(
    `select id, name, timezone, organization_id
     from household where organization_id = $1`,
    [organizationId],
  );
  const row = rows[0];
  return row === undefined ? null : toHousehold(row);
}

/**
 * Les foyers d'un compte, pour en changer depuis l'app. Une personne peut
 * appartenir à plusieurs foyers — parents séparés, grand-parent qui aide deux
 * familles : ce n'est pas un cas tordu, c'est un cas.
 */
export async function listHouseholdsForUser(
  db: Db,
  userId: string,
): Promise<(Household & { role: string })[]> {
  const { rows } = await db.query<Row & { role: string }>(
    `select h.id, h.name, h.timezone, h.organization_id, m."role"
     from household h
     join "member" m on m."organizationId" = h.organization_id
     where m."userId" = $1
     order by h.name`,
    [userId],
  );
  return rows.map((row) => ({ ...toHousehold(row), role: row.role }));
}

/** Le fuseau du foyer, qui découpe les journées et les mois de saisonnalité. */
export async function updateHousehold(
  db: Db,
  householdId: string,
  fields: { name?: string; timezone?: string },
): Promise<Household | null> {
  const { rows } = await db.query<Row>(
    `update household
     set name     = coalesce($2, name),
         timezone = coalesce($3, timezone)
     where id = $1
     returning id, name, timezone, organization_id`,
    [householdId, fields.name ?? null, fields.timezone ?? null],
  );
  const row = rows[0];
  return row === undefined ? null : toHousehold(row);
}
