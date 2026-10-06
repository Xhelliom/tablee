/**
 * Super-admin : ce qui dépasse un foyer.
 *
 * Les rôles `parent` / `adulte` sont des rôles **de foyer** (007) : ils ne
 * voient que le foyer actif, à travers `request.db` filtré par la RLS (008).
 * Le super-admin est un rôle **de plateforme** (020) : il lit tous les
 * comptes, tous les foyers, et répare les deux sortes d'associations —
 * convive ↔ compte, ingrédient Jow ↔ aliment — y compris en masse, et les
 * verrouille quand elles ne doivent plus bouger.
 *
 * ── Pourquoi `withHousehold` par foyer, et pas un accès direct ─────────────
 *
 * `eater` est sous RLS forcée : une lecture depuis le pool nu ne rend **rien**,
 * en silence. Contourner la RLS demanderait un rôle qui la contourne — et le
 * garde-fou du démarrage (`server/db/guard.ts`) refuse justement les rôles qui
 * la contournent. On agrège donc foyer par foyer, chacun dans son client
 * marqué : c'est plus de requêtes, mais la garantie reste la même pour tout
 * le monde, super-admin compris.
 *
 * `jow_food_link`, lui, est délibérément hors RLS (en-tête de la 008) : c'est
 * une donnée globale, comme `food`. Le pool nu suffit.
 *
 * Ce module ne fait que du SQL. La garde « est-on super-admin » est dans la
 * route (`server/routes/admin.ts`), pas ici.
 */
import { withHousehold, type UnscopedDb } from '../db.ts';

/** Le premier compte connecté devient super-admin, une seule fois. */
export async function ensureFirstSuperAdmin(db: UnscopedDb, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>(
    'select count(*)::text as count from platform_admin',
  );
  if (rows[0]?.count !== '0') {
    const existing = await db.query('select 1 from platform_admin where user_id = $1', [userId]);
    return (existing.rowCount ?? 0) > 0;
  }
  await db.query(
    'insert into platform_admin (user_id) values ($1) on conflict do nothing',
    [userId],
  );
  return true;
}

export async function isSuperAdmin(db: UnscopedDb, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    'select exists (select 1 from platform_admin where user_id = $1) as ok',
    [userId],
  );
  return rows[0]?.ok === true;
}

/** Une page de résultats : les lignes, et le total qui dimensionne le pagineur. */
export interface Page<T> {
  items: T[];
  total: number;
}

export interface ListOptions {
  /** Recherche libre, insensible à la casse et aux accents. `''` : tout. */
  q?: string;
  /** 1..200, 50 par défaut : une page d'admin se balaye, elle ne s'imprime pas. */
  limit?: number;
  /** Décalage, calculé depuis `page` par la route. */
  offset?: number;
}

const PAGE_DEFAUT = 50;
const PAGE_MAX = 200;

export function pageLimite(limit: unknown): number {
  const n = typeof limit === 'string' ? Number(limit) : typeof limit === 'number' ? limit : NaN;
  if (!Number.isInteger(n)) return PAGE_DEFAUT;
  return Math.min(Math.max(n, 1), PAGE_MAX);
}

/**
 * Échappe `%, _, \` d'une recherche pour `LIKE … ESCAPE '\'`.
 *
 * Sans ça, taper `%` liste toute la table — pas une fuite (l'appelant est
 * déjà super-admin), mais un pagineur qui ment sur ce qu'on cherchait.
 */
function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** `unaccent(lower(col)) LIKE unaccent(lower($n))` : « pates » trouve « pâtes ». */
function contient(colonne: string, param: number): string {
  return `unaccent(lower(${colonne})) like unaccent(lower($${param})) escape '\\'`;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  superadmin: boolean;
  households: { householdId: string; householdName: string; organizationId: string; role: string }[];
  eaterCount: number;
}

export async function listAllUsers(db: UnscopedDb, options: ListOptions = {}): Promise<Page<AdminUser>> {
  const q = (options.q ?? '').trim();
  const limit = pageLimite(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  const filtre = q === '' ? null : like(q);

  const where = filtre === null
    ? ''
    : `where ${contient('u."name"', 1)} or ${contient('u."email"', 1)}`;
  const params = filtre === null ? [] : [filtre];

  const { rows: total } = await db.query<{ n: string }>(
    `select count(*)::text as n from "user" u ${where}`, params,
  );
  const { rows } = await db.query<{
    id: string; name: string; email: string; emailVerified: boolean;
    createdAt: Date; superadmin: boolean;
  }>(
    `select u."id", u."name", u."email", u."emailVerified", u."createdAt",
            (pa.user_id is not null) as superadmin
     from "user" u
     left join platform_admin pa on pa.user_id = u."id"
     ${where}
     order by u."createdAt"
     limit ${limit} offset ${offset}`,
    params,
  );
  if (rows.length === 0) return { items: [], total: Number(total[0]?.n ?? 0) };
  const ids = rows.map((r) => r.id);

  const memberships = await db.query<{
    userId: string; householdId: string; householdName: string; organizationId: string; role: string;
  }>(
    `select m."userId" as "userId", h.id as "householdId", h.name as "householdName",
            h.organization_id as "organizationId", m."role"
     from "member" m
     join household h on h.organization_id = m."organizationId"
     where m."userId" = any($1)
     order by h.name`,
    [ids],
  );
  // `eater` est sous RLS : la compter depuis le pool nu rendrait 0, en
  // silence. On passe par chaque foyer de la page — plus de requêtes, mais un
  // chiffre vrai plutôt qu'un zéro décoratif.
  const fiches = new Map<string, number>();
  const foyersVus = [...new Set(memberships.rows.map((m) => m.householdId))];
  for (const foyer of foyersVus) {
    const comptées = await withHousehold(db as import('pg').Pool, foyer, async (client) => (await client.query<{
      userId: string; count: string;
    }>(
      `select user_id as "userId", count(*)::text as count
       from eater where user_id = any($1) group by user_id`,
      [ids],
    )).rows).catch(() => []);
    for (const c of comptées) fiches.set(c.userId, (fiches.get(c.userId) ?? 0) + Number(c.count));
  }
  const householdsByUser = new Map<string, AdminUser['households']>();
  for (const m of memberships.rows) {
    const list = householdsByUser.get(m.userId) ?? [];
    list.push({
      householdId: m.householdId, householdName: m.householdName,
      organizationId: m.organizationId, role: m.role,
    });
    householdsByUser.set(m.userId, list);
  }
  return {
    total: Number(total[0]?.n ?? 0),
    items: rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt.toISOString(),
      superadmin: u.superadmin,
      households: householdsByUser.get(u.id) ?? [],
      eaterCount: fiches.get(u.id) ?? 0,
    })),
  };
}

export interface AdminHousehold {
  id: string;
  name: string;
  timezone: string;
  organizationId: string | null;
  memberCount: number;
  eaterCount: number;
  mealCount: number;
}

export async function listAllHouseholds(
  db: UnscopedDb, options: ListOptions = {},
): Promise<Page<AdminHousehold>> {
  const q = (options.q ?? '').trim();
  const limit = pageLimite(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  const filtre = q === '' ? null : like(q);
  const where = filtre === null ? '' : `where ${contient('name', 1)}`;
  const params = filtre === null ? [] : [filtre];

  const { rows: total } = await db.query<{ n: string }>(
    `select count(*)::text as n from household ${where}`, params,
  );
  const { rows } = await db.query<{
    id: string; name: string; timezone: string; organization_id: string | null;
  }>(
    `select id, name, timezone, organization_id from household ${where}
     order by name limit ${limit} offset ${offset}`,
    params,
  );
  const out: AdminHousehold[] = [];
  for (const h of rows) {
    const members = h.organization_id === null
      ? 0
      : (await db.query('select count(*)::int as n from "member" where "organizationId" = $1', [h.organization_id])).rows[0]?.n ?? 0;
    // `eater` et `meal` sont sous RLS : on les compte depuis leur foyer.
    const counts = await withHousehold(db as import('pg').Pool, h.id, async (client) => {
      const e = await client.query<{ n: number }>('select count(*)::int as n from eater');
      const m = await client.query<{ n: number }>('select count(*)::int as n from meal');
      return { eaters: e.rows[0]?.n ?? 0, meals: m.rows[0]?.n ?? 0 };
    }).catch(() => ({ eaters: 0, meals: 0 }));
    out.push({
      id: h.id, name: h.name, timezone: h.timezone, organizationId: h.organization_id,
      memberCount: Number(members), eaterCount: counts.eaters, mealCount: counts.meals,
    });
  }
  return { items: out, total: Number(total[0]?.n ?? 0) };
}

export interface AdminEaterLink {
  householdId: string;
  householdName: string;
  eaterId: string;
  firstName: string;
  birthDate: string;
  active: boolean;
  userId: string | null;
  userEmail: string | null;
  claimEmail: string | null;
  linkLocked: boolean;
  /** `orphelin` : réservée à une adresse qui a pourtant un compte. */
  orphan: boolean;
}

export type StatutLien = 'toutes' | 'orphelines' | 'verrouillees' | 'sans_lien';

export interface EaterLinkOptions extends ListOptions {
  statut?: StatutLien;
}

export async function listEaterLinks(
  db: UnscopedDb, options: EaterLinkOptions = {},
): Promise<Page<AdminEaterLink>> {
  const q = (options.q ?? '').trim();
  const statut = options.statut ?? 'toutes';
  const limit = pageLimite(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  const filtre = q === '' ? null : like(q);

  // Les comptes existants, pour repérer les réservations orphelines.
  const emails = await db.query<{ email: string }>('select lower("email") as email from "user"');
  const connues = new Set(emails.rows.map((r) => r.email));

  const foyers = await db.query<{ id: string; name: string }>('select id, name from household order by name');
  const tout: AdminEaterLink[] = [];
  for (const foyer of foyers.rows) {
    // `eater` est sous RLS : foyer par foyer, chacun dans son client marqué.
    // Les filtres texte/verrou partent dans le SQL ; `orphelines` se tranche
    // en mémoire (ça dépend des comptes de toute l'instance, pas du foyer).
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filtre !== null) {
      params.push(filtre);
      const n = params.length;
      conditions.push(
        `(${contient('e.first_name', n)} or ${contient('e.claim_email', n)} or ${contient('u."email"', n)})`,
      );
    }
    if (statut === 'verrouillees') conditions.push('e.link_locked = true');
    if (statut === 'sans_lien') conditions.push('e.user_id is null and e.claim_email is null');
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';

    const rows = await withHousehold(db as import('pg').Pool, foyer.id, async (client) => (await client.query<{
      id: string; first_name: string; birth_date: string; active: boolean;
      user_id: string | null; user_email: string | null;
      claim_email: string | null; link_locked: boolean;
    }>(
      `select e.id, e.first_name, e.birth_date, e.active, e.user_id,
              u."email" as user_email, e.claim_email, e.link_locked
       from eater e
       left join "user" u on u."id" = e.user_id
       ${where}
       order by e.first_name`,
      params,
    )).rows).catch(() => []);
    for (const r of rows) {
      const orphan = r.claim_email !== null && connues.has(r.claim_email.toLowerCase());
      if (statut === 'orphelines' && !orphan) continue;
      tout.push({
        householdId: foyer.id,
        householdName: foyer.name,
        eaterId: r.id,
        firstName: r.first_name,
        birthDate: r.birth_date,
        active: r.active,
        userId: r.user_id,
        userEmail: r.user_email,
        claimEmail: r.claim_email,
        linkLocked: r.link_locked,
        orphan,
      });
    }
  }
  // Le tri global est celui des foyers puis des prénoms (boucle ci-dessus) ;
  // la page s'y découpe en mémoire — des centaines de fiches au plus sur une
  // instance familiale, pas des millions.
  return { items: tout.slice(offset, offset + limit), total: tout.length };
}

export interface AdminFoodLink {
  jowFoodId: string;
  label: string;
  foodId: string;
  foodName: string;
  plantBased: boolean | null;
  locked: boolean;
  usageCount: number;
}

export type VerrouLien = 'tous' | 'verrouilles' | 'modifiables';

export interface FoodLinkOptions extends ListOptions {
  verrou?: VerrouLien;
}

export async function listFoodLinks(
  db: UnscopedDb, options: FoodLinkOptions = {},
): Promise<Page<AdminFoodLink>> {
  const q = (options.q ?? '').trim();
  const verrou = options.verrou ?? 'tous';
  const limit = pageLimite(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  const filtre = q === '' ? null : like(q);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filtre !== null) {
    params.push(filtre);
    conditions.push(`(${contient('l.label', params.length)} or ${contient('f.name', params.length)})`);
  }
  if (verrou === 'verrouilles') conditions.push('l.locked = true');
  if (verrou === 'modifiables') conditions.push('l.locked = false');
  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';

  const { rows: total } = await db.query<{ n: string }>(
    `select count(*)::text as n from jow_food_link l join food f on f.id = l.food_id ${where}`,
    params,
  );
  const { rows } = await db.query<{
    jow_food_id: string; label: string; food_id: string;
    food_name: string; plant_based: boolean | null; locked: boolean;
  }>(
    `select l.jow_food_id, l.label, l.food_id, f.name as food_name,
            f.plant_based, l.locked
     from jow_food_link l
     join food f on f.id = l.food_id
     ${where}
     order by l.label
     limit ${limit} offset ${offset}`,
    params,
  );
  const usages = rows.length === 0
    ? []
    : (await db.query<{ jow_food_id: string; count: string }>(
      `select jow_food_id, count(*)::text as count from recipe_ingredient
       where jow_food_id = any($1) group by jow_food_id`,
      [rows.map((r) => r.jow_food_id)],
    )).rows;
  const parId = new Map(usages.map((r) => [r.jow_food_id, Number(r.count)]));
  return {
    total: Number(total[0]?.n ?? 0),
    items: rows.map((r) => ({
      jowFoodId: r.jow_food_id,
      label: r.label,
      foodId: r.food_id,
      foodName: r.food_name,
      plantBased: r.plant_based,
      locked: r.locked,
      usageCount: parId.get(r.jow_food_id) ?? 0,
    })),
  };
}

/**
 * La tête de page du super-admin : l'état de l'instance en six chiffres.
 *
 * Les comptes sur les liens convive passent par les foyers un par un —
 * `eater` est sous RLS, et un `count(*)` depuis le pool nu rendrait 0 en
 * silence. Un aller-retour par foyer, avec des `filter` qui comptent tout
 * d'un coup : c'est ce qui rend la page d'accueil lisible sans mentir.
 */
export interface Apercu {
  comptes: number;
  foyers: number;
  superadmins: number;
  orphelines: number;
  convivesVerrouilles: number;
  correspondances: number;
  alimentsVerrouilles: number;
  /** Ingrédients Jow présents dans des recettes mais sans correspondance. */
  nonRattaches: number;
}

export async function compterApercu(db: UnscopedDb): Promise<Apercu> {
  const comptes = await db.query<{ n: string }>('select count(*)::text as n from "user"');
  const foyers = await db.query<{ id: string }>('select id from household');
  const superadmins = await db.query<{ n: string }>('select count(*)::text as n from platform_admin');
  const correspondances = await db.query<{ n: string; v: string }>(
    `select count(*)::text as n,
            count(*) filter (where locked)::text as v
     from jow_food_link`,
  );
  const nonRattaches = await db.query<{ n: string }>(
    `select count(*)::text as n from (
       select ri.jow_food_id
       from recipe_ingredient ri
       left join jow_food_link l on l.jow_food_id = ri.jow_food_id
       where ri.jow_food_id is not null and l.jow_food_id is null
       group by ri.jow_food_id
     ) manquants`,
  );
  const emails = await db.query<{ email: string }>('select lower("email") as email from "user"');
  const connues = emails.rows.map((r) => r.email);

  let orphelines = 0;
  let convivesVerrouilles = 0;
  for (const foyer of foyers.rows) {
    const stats = await withHousehold(db as import('pg').Pool, foyer.id, async (client) => (await client.query<{
      orphelines: string; verrouilles: string;
    }>(
      `select count(*) filter (
                where claim_email is not null and user_id is null
                  and lower(claim_email) = any($1)
              )::text as orphelines,
              count(*) filter (where link_locked)::text as verrouilles
       from eater`,
      [connues],
    )).rows[0]).catch(() => undefined);
    orphelines += Number(stats?.orphelines ?? 0);
    convivesVerrouilles += Number(stats?.verrouilles ?? 0);
  }

  return {
    comptes: Number(comptes.rows[0]?.n ?? 0),
    foyers: foyers.rows.length,
    superadmins: Number(superadmins.rows[0]?.n ?? 0),
    orphelines,
    convivesVerrouilles,
    correspondances: Number(correspondances.rows[0]?.n ?? 0),
    alimentsVerrouilles: Number(correspondances.rows[0]?.v ?? 0),
    nonRattaches: Number(nonRattaches.rows[0]?.n ?? 0),
  };
}

export interface AdminUnlinked {
  jowFoodId: string;
  label: string;
  /** Lignes `recipe_ingredient` en attente d'un rattachement, toutes recettes confondues. */
  usageCount: number;
}

/**
 * Les ingrédients Jow jamais rattachés : un `jow_food_id` présent dans des
 * recettes mais absent de `jow_food_link`.
 *
 * C'est l'angle mort de la liste des correspondances — elle ne montre que ce
 * qui est déjà attaché. Groupés par identifiant stable : rattacher ici crée
 * le lien **et** le propage à toutes les lignes, comme la voie du parent.
 */
export async function listUnlinkedIngredients(
  db: UnscopedDb, options: ListOptions = {},
): Promise<Page<AdminUnlinked>> {
  const q = (options.q ?? '').trim();
  const limit = pageLimite(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  const filtre = q === '' ? null : like(q);
  const whereQ = filtre === null ? '' : `and ${contient('ri.label', 1)}`;
  const params = filtre === null ? [] : [filtre];

  const { rows: total } = await db.query<{ n: string }>(
    `select count(*)::text as n from (
       select ri.jow_food_id
       from recipe_ingredient ri
       left join jow_food_link l on l.jow_food_id = ri.jow_food_id
       where ri.jow_food_id is not null and l.jow_food_id is null ${whereQ}
       group by ri.jow_food_id
     ) manquants`,
    params,
  );
  const { rows } = await db.query<{ jow_food_id: string; label: string; usage: number }>(
    `select ri.jow_food_id, min(ri.label) as label, count(*)::int as usage
     from recipe_ingredient ri
     left join jow_food_link l on l.jow_food_id = ri.jow_food_id
     where ri.jow_food_id is not null and l.jow_food_id is null ${whereQ}
     group by ri.jow_food_id
     order by usage desc, label
     limit ${limit} offset ${offset}`,
    params,
  );
  return {
    total: Number(total[0]?.n ?? 0),
    items: rows.map((r) => ({ jowFoodId: r.jow_food_id, label: r.label, usageCount: r.usage })),
  };
}

/**
 * Corrige une correspondance Jow ↔ aliment en masse, et la propage à toutes
 * les lignes qui partagent cet identifiant — le même geste que le parent dans
 * son foyer, mais sans s'arrêter au verrou.
 */
export async function adminSetFoodLink(
  db: UnscopedDb, jowFoodId: string, foodId: string | null,
): Promise<number> {
  if (foodId === null) {
    await db.query('delete from jow_food_link where jow_food_id = $1', [jowFoodId]);
  } else {
    const label = (await db.query<{ label: string }>(
      'select label from recipe_ingredient where jow_food_id = $1 order by position limit 1',
      [jowFoodId],
    )).rows[0]?.label
      ?? (await db.query<{ label: string }>(
        'select label from jow_food_link where jow_food_id = $1', [jowFoodId],
      )).rows[0]?.label
      ?? jowFoodId;
    await db.query(
      `insert into jow_food_link (jow_food_id, food_id, label, confirmed_by)
       values ($1, $2, $3, null)
       on conflict (jow_food_id) do update set food_id = excluded.food_id,
         label = excluded.label, created_at = now()`,
      [jowFoodId, foodId, label],
    );
  }
  const propagated = await db.query(
    'update recipe_ingredient set food_id = $2 where jow_food_id = $1', [jowFoodId, foodId],
  );
  return propagated.rowCount ?? 0;
}

export async function adminSetFoodLock(db: UnscopedDb, jowFoodId: string, locked: boolean): Promise<void> {
  await db.query('update jow_food_link set locked = $2 where jow_food_id = $1', [jowFoodId, locked]);
}

export interface ImpactLien {
  jowFoodId: string;
  label: string;
  /** Lignes `recipe_ingredient` que la correction réécrirait. */
  lignes: number;
  /** Recettes distinctes concernées. */
  recettes: number;
  /** Foyers qui connaissent ces recettes — ceux qui verront changer quelque chose. */
  foyers: number;
}

/**
 * Ce qu'une correction en masse toucherait, **sans rien écrire**.
 *
 * Le foyer se compte via `household_recipe` (les recettes que chacun
 * connaît) : une correspondance Jow est globale, et « 14 lignes » ne dit pas
 * qui les verra bouger. Le récap affiché avant le geste définitif vient
 * d'ici — un irréversible se relit avant de s'exécuter.
 */
export async function impacterLiens(db: UnscopedDb, ids: string[]): Promise<ImpactLien[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<{
    jow_food_id: string; label: string; lignes: number; recettes: number; foyers: number;
  }>(
    `select ri.jow_food_id,
            min(coalesce(l.label, ri.label)) as label,
            count(*)::int as lignes,
            count(distinct ri.recipe_id)::int as recettes,
            count(distinct hr.household_id)::int as foyers
     from recipe_ingredient ri
     left join jow_food_link l on l.jow_food_id = ri.jow_food_id
     left join household_recipe hr on hr.recipe_id = ri.recipe_id
     where ri.jow_food_id = any($1)
     group by ri.jow_food_id
     order by lignes desc`,
    [ids],
  );
  return rows.map((r) => ({
    jowFoodId: r.jow_food_id, label: r.label,
    lignes: r.lignes, recettes: r.recettes, foyers: r.foyers,
  }));
}

/**
 * Répare un lien convive ↔ compte, en passant outre le verrou — c'est le
 * super-admin qui répare, pas le foyer qui contourne.
 */
export async function adminSetEaterLink(
  db: UnscopedDb, householdId: string, eaterId: string,
  patch: { userId?: string | null; claimEmail?: string | null; linkLocked?: boolean },
): Promise<void> {
  await withHousehold(db as import('pg').Pool, householdId, async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [eaterId];
    if (patch.userId !== undefined) {
      params.push(patch.userId);
      sets.push(`user_id = $${params.length}`);
    }
    if (patch.claimEmail !== undefined) {
      params.push(patch.claimEmail === null ? null : patch.claimEmail.toLowerCase());
      sets.push(`claim_email = $${params.length}`);
    }
    if (patch.linkLocked !== undefined) {
      params.push(patch.linkLocked);
      sets.push(`link_locked = $${params.length}`);
    }
    if (sets.length === 0) return;
    // Le lien seul : quand on touche au compte ou à la réservation, l'autre
    // tombe — comme `updateEater`, sans sa garde du verrou.
    if (patch.userId !== undefined || patch.claimEmail !== undefined) {
      if (patch.userId !== undefined && patch.claimEmail === undefined) {
        sets.push('claim_email = null');
      }
      if (patch.claimEmail !== undefined && patch.userId === undefined) {
        sets.push('user_id = null');
      }
    }
    await client.query(`update eater set ${sets.join(', ')} where id = $1`, params);
  });
}

export async function setSuperAdmin(db: UnscopedDb, userId: string, make: boolean): Promise<void> {
  if (make) {
    await db.query('insert into platform_admin (user_id) values ($1) on conflict do nothing', [userId]);
  } else {
    await db.query('delete from platform_admin where user_id = $1', [userId]);
  }
}

/**
 * Le cahier du super-admin (021) : qui a fait quoi, quand, sur quel lien.
 *
 * Appelé par les routes d'écriture, jamais par le domaine : le journal
 * raconte, il n'autorise rien — la garde reste `assertSuperAdmin` dans la
 * route. `detail` porte l'avant et l'après quand la route les a sous la
 * main, sans aller les chercher plus loin.
 */
export async function consignerAction(
  db: UnscopedDb,
  actorUserId: string,
  action: string,
  target: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `insert into admin_action (actor_user_id, action, target, detail)
     values ($1, $2, $3, $4)`,
    [actorUserId, action, target, JSON.stringify(detail)],
  );
}

export interface JournalLigne {
  id: string;
  at: string;
  actorEmail: string | null;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

export async function listJournal(
  db: UnscopedDb, options: ListOptions = {},
): Promise<Page<JournalLigne>> {
  const q = (options.q ?? '').trim();
  const limit = pageLimite(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  const filtre = q === '' ? null : like(q);
  const where = filtre === null
    ? ''
    : `where ${contient('a.action', 1)} or ${contient('a.target', 1)} or ${contient('u."email"', 1)}`;
  const params = filtre === null ? [] : [filtre];

  const { rows: total } = await db.query<{ n: string }>(
    `select count(*)::text as n
     from admin_action a
     left join "user" u on u."id" = a.actor_user_id
     ${where}`,
    params,
  );
  const { rows } = await db.query<{
    id: string; at: Date; actor_email: string | null;
    action: string; target: string; detail: Record<string, unknown>;
  }>(
    `select a.id, a.at, u."email" as actor_email, a.action, a.target, a.detail
     from admin_action a
     left join "user" u on u."id" = a.actor_user_id
     ${where}
     order by a.at desc
     limit ${limit} offset ${offset}`,
    params,
  );
  return {
    total: Number(total[0]?.n ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actorEmail: r.actor_email,
      action: r.action,
      target: r.target,
      detail: r.detail ?? {},
    })),
  };
}
