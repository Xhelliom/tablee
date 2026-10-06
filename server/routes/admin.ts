/**
 * Super-admin (020) : l'instance entière, hors de tout foyer.
 *
 * Toutes ces routes lisent et écrivent **hors RLS**, par `ctx.pool` — c'est
 * leur raison d'être : un super-admin voit tous les comptes, tous les foyers,
 * et répare les deux sortes d'associations (convive ↔ compte, ingrédient
 * Jow ↔ aliment), y compris en masse, puis les verrouille.
 *
 * La garde est unique (`exiger`) : sans elle, un `parent` de son foyer
 * lirait les assiettes des voisins. Les écritures sur `eater` repassent par
 * `withHousehold` foyer par foyer (voir `server/repo/admin.ts`) : la RLS
 * reste effective, même ici.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertSuperAdmin } from '../auth/identity.ts';
import { ApiError } from '../http/errors.ts';
import { body, email as emailField, str, uuid } from '../http/validate.ts';
import {
  adminSetEaterLink, adminSetFoodLink, adminSetFoodLock, compterApercu, consignerAction, impacterLiens, isSuperAdmin,
  listAllHouseholds, listAllUsers, listEaterLinks, listFoodLinks, listJournal,
  listUnlinkedIngredients, pageLimite, setSuperAdmin, type StatutLien, type VerrouLien,
} from '../repo/admin.ts';
import { withHousehold } from '../db.ts';
import type { AppContext } from '../app.ts';

function exiger(request: FastifyRequest): void {
  assertSuperAdmin(request.identity(), 'réservé au super-admin de la plateforme');
}

/**
 * `?q=…&page=2&limit=50` : la recherche et la page d'une liste.
 *
 * `page` commence à 1, comme l'écran le dit (« page 2/5 ») — pas à 0 comme
 * le `offset` SQL qu'il calcule. Une valeur absurde (page 0, limite
 * négative) retombe sur la première page plutôt que sur une erreur : ce sont
 * des contrôles de navigation, pas des données.
 */
function pagination(query: Record<string, unknown>): { q: string; limit: number; offset: number; page: number } {
  const brut = query['q'];
  const q = typeof brut === 'string' ? brut.slice(0, 100).trim() : '';
  const limit = pageLimite(query['limit']);
  const demandée = Number(query['page'] ?? 1);
  const page = Number.isInteger(demandée) && demandée >= 1 ? demandée : 1;
  return { q, limit, offset: (page - 1) * limit, page };
}

function statutLien(query: Record<string, unknown>): StatutLien {
  const statut = query['statut'];
  if (statut === undefined || statut === 'toutes' || statut === 'orphelines'
    || statut === 'verrouillees' || statut === 'sans_lien') {
    return statut ?? 'toutes';
  }
  throw ApiError.badRequest('statut inconnu : toutes, orphelines, verrouillees ou sans_lien');
}

function verrouLien(query: Record<string, unknown>): VerrouLien {
  const verrou = query['verrou'];
  if (verrou === undefined || verrou === 'tous' || verrou === 'verrouilles' || verrou === 'modifiables') {
    return verrou ?? 'tous';
  }
  throw ApiError.badRequest('verrou inconnu : tous, verrouilles ou modifiables');
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Le cahier du super-admin (021) : qui a fait quoi, quand. */
  app.get('/api/admin/journal', async (request) => {
    exiger(request);
    const { q, limit, offset, page } = pagination(request.query as Record<string, unknown>);
    const { items, total } = await listJournal(ctx.pool, { q, limit, offset });
    return { journal: items, total, page, limit };
  });

  /** L'état de l'instance en chiffres : la tête de page du super-admin. */
  app.get('/api/admin/apercu', async (request) => {
    exiger(request);
    return { apercu: await compterApercu(ctx.pool) };
  });

  app.get('/api/admin/users', async (request) => {
    exiger(request);
    const { q, limit, offset, page } = pagination(request.query as Record<string, unknown>);
    const { items, total } = await listAllUsers(ctx.pool, { q, limit, offset });
    return { users: items, total, page, limit };
  });

  app.get('/api/admin/households', async (request) => {
    exiger(request);
    const { q, limit, offset, page } = pagination(request.query as Record<string, unknown>);
    const { items, total } = await listAllHouseholds(ctx.pool, { q, limit, offset });
    return { households: items, total, page, limit };
  });

  /**
   * Nommer ou révoquer un super-admin. On ne se révoque pas soi-même : se
   * verrouiller dehors de la seule porte qui répare serait un geste sans
   * retour — le dernier super-admin reste, sauf à passer par la base.
   */
  app.post('/api/admin/superadmin', async (request) => {
    exiger(request);
    const identity = request.identity();
    const input = body(request.body);
    const userId = str(input['userId'], 'userId', { max: 200 });
    const make = input['make'] === true;
    if (!make && userId === identity.userId) {
      throw ApiError.badRequest('on ne se retire pas soi-même le super-admin');
    }
    const existe = await ctx.pool.query('select 1 from "user" where "id" = $1', [userId]);
    if ((existe.rowCount ?? 0) === 0) throw ApiError.notFound('compte introuvable');
    await setSuperAdmin(ctx.pool, userId, make);
    await consignerAction(ctx.pool, identity.userId, make ? 'superadmin.nommer' : 'superadmin.revoquer', userId);
    return { ok: true };
  });

  /**
   * Supprimer un compte de la plateforme. L'assiette survit (`on delete set
   * null`, 009) : la personne a mangé, et effacer ses repas avec elle
   * fausserait les bilans du foyer. Réservé aux cas graves — doublon, compte
   * de test — et jamais un geste courant.
   */
  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (request) => {
    exiger(request);
    const identity = request.identity();
    const id = request.params.id;
    if (id === identity.userId) throw ApiError.badRequest('on ne supprime pas son propre compte par ici');
    if (await isSuperAdmin(ctx.pool, id)) {
      const { rows } = await ctx.pool.query<{ count: string }>(
        'select count(*)::text as count from platform_admin',
      );
      if (rows[0]?.count === '1') throw ApiError.badRequest('impossible : ce serait le dernier super-admin');
    }
    const cible = await ctx.pool.query<{ email: string }>(
      'select "email" as email from "user" where "id" = $1', [id],
    );
    await ctx.pool.query('delete from "user" where "id" = $1', [id]);
    await consignerAction(ctx.pool, identity.userId, 'compte.supprimer', cible.rows[0]?.email ?? id);
    return { ok: true };
  });

  // ── Associations convive ↔ compte ────────────────────────────────────────

  app.get('/api/admin/eater-links', async (request) => {
    exiger(request);
    const { q, limit, offset, page } = pagination(request.query as Record<string, unknown>);
    const statut = statutLien(request.query as Record<string, unknown>);
    const { items, total } = await listEaterLinks(ctx.pool, { q, limit, offset, statut });
    return { links: items, total, page, limit };
  });

  /**
   * Répare un lien, ou le verrouille. `userId` / `email` s'excluent, comme sur
   * la route de foyer ; `linkLocked` fige le lien (020) : ni parent, ni
   * rattachement automatique, ni `active: false` ne le toucheront plus.
   * `detacher: true` rend la fiche à personne.
   */
  app.patch<{ Params: { household: string; id: string } }>(
    '/api/admin/eater-links/:household/:id',
    async (request) => {
      exiger(request);
      const householdId = uuid(request.params.household, 'household');
      const eaterId = uuid(request.params.id, 'id');
      const input = body(request.body);

      const verrou = input['linkLocked'];
      if (verrou !== undefined && typeof verrou !== 'boolean') {
        throw ApiError.badRequest('linkLocked doit être un booléen');
      }
      const detacher = input['detacher'] === true;
      const userId = input['userId'] === undefined || input['userId'] === null
        ? undefined
        : str(input['userId'], 'userId', { max: 200 });
      const adresse = input['email'] === undefined || input['email'] === null
        ? undefined
        : emailField(input['email'], 'email');

      if (userId !== undefined && adresse !== undefined) {
        throw ApiError.badRequest('indiquez un compte ou une adresse, pas les deux');
      }
      if (detacher && (userId !== undefined || adresse !== undefined)) {
        throw ApiError.badRequest('détacher exclut tout rattachement');
      }
      if (
        detacher === false && userId === undefined && adresse === undefined && verrou === undefined
      ) {
        throw ApiError.badRequest('rien à modifier');
      }

      // Le compte visé existe-t-il vraiment ? Un `user_id` vers rien violerait
      // la clé étrangère en 500 ; on dit 404 avant.
      if (userId !== undefined) {
        const existe = await ctx.pool.query('select 1 from "user" where "id" = $1', [userId]);
        if ((existe.rowCount ?? 0) === 0) throw ApiError.notFound('compte introuvable');
      }
      const foyerExiste = await ctx.pool.query('select 1 from household where id = $1', [householdId]);
      if ((foyerExiste.rowCount ?? 0) === 0) throw ApiError.notFound('foyer introuvable');

      try {
        await adminSetEaterLink(ctx.pool, householdId, eaterId, {
          ...(detacher ? { userId: null, claimEmail: null } : {}),
          ...(userId !== undefined ? { userId, claimEmail: null } : {}),
          ...(adresse !== undefined ? { userId: null, claimEmail: adresse } : {}),
          ...(verrou !== undefined ? { linkLocked: verrou } : {}),
        });
      } catch (cause) {
        const code = (cause as { code?: string })?.code;
        if (code === '23505') {
          throw new ApiError(409, 'compte_deja_convive', 'ce compte a déjà une fiche dans ce foyer');
        }
        throw cause;
      }

      const [réparé] = await withHousehold(ctx.pool, householdId, async (client) => (await client.query(
        'select id from eater where id = $1', [eaterId],
      )).rows);
      if (réparé === undefined) throw ApiError.notFound('convive introuvable');
      const geste = verrou !== undefined
        ? (verrou ? 'lien.verrouiller' : 'lien.deverrouiller')
        : detacher ? 'lien.detacher' : 'lien.reparer';
      await consignerAction(ctx.pool, request.identity().userId, geste, `convive ${eaterId}`, {
        foyer: householdId,
        ...(userId !== undefined ? { compte: userId } : {}),
        ...(adresse !== undefined ? { reserveA: adresse } : {}),
      });
      return { ok: true };
    },
  );

  // ── Correspondances Jow ↔ aliment ─────────────────────────────────────────

  app.get('/api/admin/food-links', async (request) => {
    exiger(request);
    const { q, limit, offset, page } = pagination(request.query as Record<string, unknown>);
    const verrou = verrouLien(request.query as Record<string, unknown>);
    const { items, total } = await listFoodLinks(ctx.pool, { q, limit, offset, verrou });
    return { links: items, total, page, limit };
  });

  /**
   * Les ingrédients Jow jamais rattachés : présents dans des recettes, absents
   * de `jow_food_link`. Les rattacher ici (`PATCH` ci-dessous avec un
   * `foodId`) crée le lien et le propage — la même voie que la correction.
   */
  app.get('/api/admin/unlinked-ingredients', async (request) => {
    exiger(request);
    const { q, limit, offset, page } = pagination(request.query as Record<string, unknown>);
    const { items, total } = await listUnlinkedIngredients(ctx.pool, { q, limit, offset });
    return { unlinked: items, total, page, limit };
  });

  /**
   * Corrige une correspondance en masse : le nouveau `foodId` se propage à
   * **toutes** les lignes `recipe_ingredient` qui partagent ce `jow_food_id`,
   * tous foyers confondus. `foodId: null` détache partout et oublie la
   * correspondance. Passe outre le verrou — c'est la voie du super-admin.
   *
   * Sert aussi au premier rattachement : un ingrédient jamais rattaché
   * (section « Non rattachés ») y gagne son lien, propagé de la même façon.
   */
  app.patch<{ Params: { id: string } }>('/api/admin/food-links/:id', async (request) => {
    exiger(request);
    const jowFoodId = str(request.params.id, 'id', { max: 100 });
    const input = body(request.body);
    const foodId = input['foodId'] === null || input['foodId'] === undefined
      ? null
      : str(input['foodId'], 'foodId', { max: 100 });
    if (foodId !== null) {
      const existe = await ctx.pool.query('select 1 from food where id = $1', [foodId]);
      if ((existe.rowCount ?? 0) === 0) throw ApiError.notFound('aliment introuvable');
    }
    const connu = await ctx.pool.query('select 1 from jow_food_link where jow_food_id = $1', [jowFoodId]);
    const vu = await ctx.pool.query(
      'select 1 from recipe_ingredient where jow_food_id = $1 limit 1', [jowFoodId],
    );
    if ((connu.rowCount ?? 0) === 0 && (vu.rowCount ?? 0) === 0) {
      throw ApiError.notFound('ingrédient Jow introuvable');
    }
    const propagated = await adminSetFoodLink(ctx.pool, jowFoodId, foodId);
    await consignerAction(
      ctx.pool, request.identity().userId,
      foodId === null ? 'aliment.detacher' : 'aliment.corriger', jowFoodId,
      { ...(foodId === null ? {} : { aliment: foodId }), lignes: propagated },
    );
    return { ok: true, propagated };
  });

  /**
   * Ce que toucherait une correction en masse — sans rien écrire. Le front
   * l'affiche avant le geste définitif : un irréversible se relit.
   */
  app.post('/api/admin/food-links/impact', async (request) => {
    exiger(request);
    const input = body(request.body);
    const brut = input['ids'];
    if (!Array.isArray(brut) || brut.length === 0 || brut.length > 200) {
      throw ApiError.badRequest('ids doit être une liste de 1 à 200 identifiants');
    }
    const ids = brut.map((id, i) => {
      if (typeof id !== 'string') throw ApiError.badRequest(`ids[${i}] doit être une chaîne`);
      return str(id, `ids[${i}]`, { max: 100 });
    });
    const impacts = await impacterLiens(ctx.pool, [...new Set(ids)]);
    const { rows } = await ctx.pool.query<{ lignes: number; recettes: number; foyers: number }>(
      `select count(*)::int as lignes,
              count(distinct ri.recipe_id)::int as recettes,
              count(distinct hr.household_id)::int as foyers
       from recipe_ingredient ri
       left join household_recipe hr on hr.recipe_id = ri.recipe_id
       where ri.jow_food_id = any($1)`,
      [[...new Set(ids)]],
    );
    const totaux = rows[0] ?? { lignes: 0, recettes: 0, foyers: 0 };
    return { impacts, totaux: { ...totaux, correspondances: impacts.length } };
  });

  /** Verrouille ou déverrouille une correspondance (020). */
  app.post<{ Params: { id: string } }>('/api/admin/food-links/:id/verrou', async (request) => {
    exiger(request);
    const jowFoodId = str(request.params.id, 'id', { max: 100 });
    const input = body(request.body);
    if (typeof input['locked'] !== 'boolean') throw ApiError.badRequest('locked doit être un booléen');
    await adminSetFoodLock(ctx.pool, jowFoodId, input['locked']);
    await consignerAction(
      ctx.pool, request.identity().userId,
      input['locked'] ? 'aliment.verrouiller' : 'aliment.deverrouiller', jowFoodId,
    );
    return { ok: true };
  });
}
