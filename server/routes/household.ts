/**
 * Le foyer lui-même : son nom, et son fuseau horaire.
 *
 * Tout le reste de la gestion — qui a accès, les rôles, les invitations, la
 * suppression — est servi par better-auth sous `/api/auth/organization/*`.
 * Cette route existe pour ce qui est au **domaine** et qu'il ne connaît pas.
 *
 * ── Pourquoi le fuseau mérite une route à lui ───────────────────────────────
 *
 * Ce n'est pas un réglage d'affichage. `household.timezone` découpe les
 * journées et les mois de saisonnalité, dans le SQL lui-même :
 *
 *     extract(month from (m.eaten_at at time zone h.timezone))
 *
 * Le changer déplace la frontière entre hier et aujourd'hui. Un fuseau invalide
 * ferait donc échouer, ou pire, fausser silencieusement tous les bilans — d'où
 * la validation stricte ci-dessous plutôt qu'un texte libre.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { body, optionalStr } from '../http/validate.ts';
import { updateHousehold } from '../repo/households.ts';
import type { AppContext } from '../app.ts';

/**
 * Un identifiant de fuseau IANA, et rien d'autre.
 *
 * `Intl.DateTimeFormat` lève sur une valeur inconnue : c'est la même base que
 * celle de Postgres pour les noms courants, et s'appuyer dessus évite de
 * maintenir une liste qui vieillirait mal — les fuseaux changent, les pays en
 * créent et en suppriment.
 */
function timezone(value: unknown, field: string): string {
  const raw = optionalStr(value, field, { max: 64 });
  if (raw === undefined || raw === null) {
    throw ApiError.badRequest(`${field} est requis`);
  }
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: raw });
  } catch {
    throw ApiError.badRequest(
      `« ${raw} » n’est pas un fuseau horaire connu`,
      'fuseau_inconnu',
    );
  }
  return raw;
}

export function householdRoutes(app: FastifyInstance, _ctx: AppContext): void {
  /**
   * Le foyer tel qu'il est. `GET /api/me` le donne déjà — celle-ci existe pour
   * que l'écran de gestion puisse se rafraîchir sans recharger la session
   * entière.
   */
  app.get('/api/household', async (request) => {
    const identity = request.identity();
    return {
      household: {
        id: identity.householdId,
        name: identity.householdName,
        timezone: identity.timezone,
        organizationId: identity.organizationId,
      },
      role: identity.role,
    };
  });

  app.patch('/api/household', async (request) => {
    const identity = request.identity();
    // Un `adulte` saisit et lit ; il ne redéfinit pas ce qu'est une journée
    // pour tout le foyer.
    if (identity.role !== 'parent') {
      throw new ApiError(403, 'droits_insuffisants', 'seul un parent modifie le foyer');
    }

    const input = body(request.body);
    const patch: { name?: string; timezone?: string } = {};

    const name = optionalStr(input['name'], 'name', { max: 80 });
    if (name !== undefined && name !== null) {
      if (name.trim().length === 0) throw ApiError.badRequest('le nom du foyer ne peut pas être vide');
      patch.name = name.trim();
    }
    if (input['timezone'] !== undefined) {
      patch.timezone = timezone(input['timezone'], 'timezone');
    }

    if (patch.name === undefined && patch.timezone === undefined) {
      throw ApiError.badRequest('rien à modifier');
    }

    const updated = await updateHousehold(request.db, identity.householdId, patch);
    if (updated === null) throw ApiError.notFound('foyer introuvable');
    return { household: updated };
  });
}
