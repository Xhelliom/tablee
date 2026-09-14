/**
 * §12 — membres du foyer.
 *
 * ── Trois choses que cet écran d'API doit tenir ensemble ────────────────────
 *
 * 1. **Un convive n'est pas un compte** (007). Le lien `eater.user_id` dit
 *    seulement *laquelle de ces assiettes est la vôtre* ; il ne fusionne rien.
 * 2. **I5** — aucun objectif chiffré de calories ni de poids sur un profil
 *    mineur. Poids et taille sont donc refusés à l'écriture pour un mineur, et
 *    masqués à la lecture si un profil le devenait par correction de date.
 * 3. **Les rôles de la 007 s'appliquent enfin ici.** `ROLES.adulte` ne porte
 *    aucune permission `eater`, et pourtant ces routes n'en vérifiaient
 *    aucune : n'importe quel membre pouvait modifier n'importe quelle fiche.
 *    Désormais un `parent` gère la composition du foyer, un `adulte` ne
 *    modifie que **son** assiette — celle qui porte son compte.
 */
import type { FastifyInstance } from 'fastify';
import { ageAt, isMinor } from '../nutrition/age.ts';
import { ApiError } from '../http/errors.ts';
import {
  body, email as emailField, isoDate, num, optionalStr, sex, str, stringArray, uuid,
} from '../http/validate.ts';
import {
  createEater, findMembers, listEaters, updateEater, type Eater,
} from '../repo/eaters.ts';
import type { Identity } from '../auth/identity.ts';
import type { HouseholdDb } from '../db.ts';
import type { AppContext } from '../app.ts';

/**
 * Ce que l'API expose d'un membre.
 *
 * `minor` est exposé pour que le front puisse appliquer I5 sans recalculer un
 * âge de son côté : aucun objectif chiffré de calories ni de poids sur un
 * profil mineur, nulle part.
 *
 * `isMe` dit si cette assiette est celle du compte qui regarde. C'est ce qui
 * permet à un `adulte` de modifier sa fiche sans pouvoir toucher aux autres,
 * et à l'app d'afficher « c'est vous » plutôt qu'un prénom parmi d'autres.
 *
 * ⚠️ **Le poids et la taille ne sortent pas de deux cas.** Ils sont retirés :
 *
 *   - d'un profil **mineur**, même s'ils sont en base. L'écriture les refuse
 *     déjà ; ce second filet couvre le seul chemin qui reste — une date de
 *     naissance corrigée après coup, qui fait redevenir mineur quelqu'un qui
 *     ne l'était pas ;
 *   - de la vue d'un **`adulte`** sur la fiche de quelqu'un d'autre. Une
 *     nounou a besoin des allergènes, pas du poids des parents. Un `parent`
 *     voit tout : c'est lui qui compose le foyer, et deux conjoints qui se
 *     cachent leur poids ne sont pas un problème que le logiciel arbitre.
 */
function present(
  eater: Eater,
  viewer: { userId: string; role: Identity['role'] },
): Eater & { age: number; minor: boolean; isMe: boolean } {
  const minor = isMinor(eater.birthDate);
  const isMe = eater.userId !== null && eater.userId === viewer.userId;
  const cache = minor || (viewer.role !== 'parent' && !isMe);
  return {
    ...eater,
    ...(cache ? { weightKg: null, weightRecordedAt: null, heightCm: null } : {}),
    age: ageAt(eater.birthDate),
    minor,
    isMe,
  };
}

const parentSeul = (identity: Identity, geste: string): void => {
  if (identity.role !== 'parent') {
    throw new ApiError(403, 'droits_insuffisants', `seul un parent peut ${geste}`);
  }
};

/**
 * Traduit les deux collisions que la 009 rend possibles, plutôt que de les
 * laisser sortir en 500. Ce sont des situations légitimes de l'interface —
 * deux fiches pour la même personne, deux réservations pour la même adresse —
 * et l'utilisateur doit lire ce qui bloque.
 */
function traduireCollision(cause: unknown): never {
  const code = (cause as { code?: string } | null)?.code;
  const contrainte = (cause as { constraint?: string } | null)?.constraint;
  if (code === '23505' && contrainte === 'eater_un_compte_par_foyer') {
    throw new ApiError(409, 'compte_deja_convive', 'ce compte a déjà une fiche dans ce foyer');
  }
  if (code === '23505' && contrainte === 'eater_une_reservation_par_adresse') {
    throw new ApiError(
      409, 'adresse_deja_reservee',
      'une autre fiche attend déjà cette adresse e-mail',
    );
  }
  throw cause;
}

/**
 * Le compte de ce foyer qui porte cette adresse, s'il y en a un.
 *
 * Sert au cas « je réserve l'assiette de quelqu'un qui est **déjà** entré » :
 * l'invitation a été acceptée avant que la fiche n'existe, et aucun crochet ne
 * repassera. On rattache donc tout de suite plutôt que d'attendre un événement
 * qui n'aura pas lieu.
 *
 * Les tables de better-auth ne sont pas sous RLS (008) : ce `join` voit tous
 * les comptes, d'où le filtre sur `organizationId` — c'est lui qui borne au
 * foyer courant, et il vient de la session, jamais du client.
 */
async function compteDuFoyer(
  db: HouseholdDb,
  organizationId: string,
  adresse: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select u."id"
       from "user" u
       join "member" m on m."userId" = u."id"
      where m."organizationId" = $1 and lower(u."email") = $2`,
    [organizationId, adresse],
  );
  return rows[0]?.id ?? null;
}

/** Poids et taille : majeurs seulement, et jamais une cible (I5). */
function corps(
  input: Record<string, unknown>,
  birthDate: string,
): { weightKg?: number | null; heightCm?: number | null } {
  const donné = input['weightKg'] !== undefined || input['heightCm'] !== undefined;
  if (!donné) return {};

  if (isMinor(birthDate)) {
    throw new ApiError(
      422, 'poids_interdit_mineur',
      'le poids et la taille ne sont pas suivis sur un profil mineur',
    );
  }

  return {
    ...(input['weightKg'] === undefined
      ? {}
      : {
          weightKg: input['weightKg'] === null
            ? null
            : num(input['weightKg'], 'weightKg', { min: 1, max: 400 }),
        }),
    ...(input['heightCm'] === undefined
      ? {}
      : {
          heightCm: input['heightCm'] === null
            ? null
            : num(input['heightCm'], 'heightCm', { min: 31, max: 260 }),
        }),
  };
}

export function eaterRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/eaters', async (request) => {
    const identity = request.identity();
    const eaters = await listEaters(request.db, identity.householdId);
    return { eaters: eaters.map((eater) => present(eater, identity)) };
  });

  /**
   * Créer un convive.
   *
   * Deux façons d'y attacher un compte, et une seule à la fois :
   *
   *   `self: true`    c'est moi. Le cas de l'inscription : on crée son compte,
   *                   puis son assiette, et l'app cesse d'être vide.
   *   `claimEmail`    c'est quelqu'un qui n'est pas encore inscrit. L'assiette
   *                   lui est réservée ; elle se rattachera d'elle-même le jour
   *                   où cette adresse entrera dans le foyer.
   */
  app.post('/api/eaters', async (request, reply) => {
    const identity = request.identity();
    const input = body(request.body);

    const self = input['self'] === true;
    const claim = input['claimEmail'] === undefined || input['claimEmail'] === null
      ? null
      : emailField(input['claimEmail'], 'claimEmail');

    if (self && claim !== null) {
      throw ApiError.badRequest('une fiche est à vous, ou réservée à quelqu’un — pas les deux');
    }
    // Se créer sa propre assiette est le geste d'arrivée de n'importe qui.
    // Tout le reste — ajouter un convive, réserver une place — est la
    // composition du foyer, et relève du parent.
    if (!self) parentSeul(identity, 'ajouter un convive');

    const birthDate = isoDate(input['birthDate'], 'birthDate');

    // Une adresse déjà membre du foyer se rattache tout de suite : la garder
    // « en attente » laisserait une réservation qu'aucun crochet ne viendrait
    // honorer.
    const déjàLà = claim === null ? null : await compteDuFoyer(request.db, identity.organizationId, claim);

    const eater = await createEater(request.db, identity.householdId, {
      firstName: str(input['firstName'], 'firstName', { max: 80 }),
      birthDate,
      sex: sex(input['sex']),
      portionCoef:
        input['portionCoef'] === undefined
          ? 1
          : num(input['portionCoef'], 'portionCoef', { min: 0.01, max: 2 }),
      diets: input['diets'] === undefined ? [] : stringArray(input['diets'], 'diets'),
      color: optionalStr(input['color'], 'color', { max: 20 }),
      userId: self ? identity.userId : déjàLà,
      claimEmail: déjàLà === null ? claim : null,
      ...corps(input, birthDate),
    }).catch(traduireCollision);

    reply.code(201);
    return { eater: present(eater, identity) };
  });

  /**
   * Modifier un membre — **y compris son `portion_coef`**.
   *
   * R2 : aucun repas passé n'est réécrit. Un enfant qui grandit mangera plus
   * demain ; ce qu'il a mangé hier ne change pas. Le repas garde la part qui a
   * été figée au moment où il a été enregistré.
   */
  app.patch<{ Params: { id: string } }>('/api/eaters/:id', async (request) => {
    const identity = request.identity();
    const id = uuid(request.params.id, 'id');
    const input = body(request.body);

    const [existant] = await findMembers(request.db, identity.householdId, [id]);
    if (existant === undefined) throw ApiError.notFound('membre introuvable');

    // Un `adulte` tient sa fiche à jour, et rien d'autre. `active` reste au
    // parent : retirer quelqu'un de la table est un geste de composition du
    // foyer, pas un réglage personnel.
    const sienne = existant.userId !== null && existant.userId === identity.userId;
    if (identity.role !== 'parent') {
      if (!sienne) {
        throw new ApiError(
          403, 'droits_insuffisants',
          'vous ne pouvez modifier que votre propre fiche',
        );
      }
      if (input['active'] !== undefined) {
        throw new ApiError(403, 'droits_insuffisants', 'seul un parent retire un convive');
      }
    }

    const birthDate = input['birthDate'] === undefined
      ? existant.birthDate
      : isoDate(input['birthDate'], 'birthDate');

    // Une date corrigée peut faire redevenir mineur un profil qui portait un
    // poids. On ne le garde pas « au cas où » : I5 dit qu'il n'a rien à faire
    // là, et une donnée de santé d'enfant conservée par inadvertance est
    // exactement ce que l'interdit vise.
    const redevenuMineur =
      isMinor(birthDate) && (existant.weightKg !== null || existant.heightCm !== null);

    const eater = await updateEater(request.db, identity.householdId, id, {
      ...(input['firstName'] !== undefined && { firstName: str(input['firstName'], 'firstName', { max: 80 }) }),
      ...(input['birthDate'] !== undefined && { birthDate }),
      ...(input['sex'] !== undefined && { sex: sex(input['sex']) }),
      ...(input['portionCoef'] !== undefined && {
        portionCoef: num(input['portionCoef'], 'portionCoef', { min: 0.01, max: 2 }),
      }),
      ...(input['diets'] !== undefined && { diets: stringArray(input['diets'], 'diets') }),
      ...(input['color'] !== undefined && { color: optionalStr(input['color'], 'color', { max: 20 }) }),
      ...(input['active'] !== undefined && { active: input['active'] === true }),
      ...(redevenuMineur ? { weightKg: null, heightCm: null } : corps(input, birthDate)),
    }).catch(traduireCollision);

    if (eater === null) throw ApiError.notFound('membre introuvable');
    return { eater: present(eater, identity) };
  });

  /**
   * Rattacher une fiche à un compte — le geste de « ma femme s'inscrit ».
   *
   * Trois formes, une seule à la fois :
   *
   *   `{ self: true }`      cette fiche est la mienne.
   *   `{ email }`           cette fiche est à cette personne. Si elle est déjà
   *                         dans le foyer, c'est immédiat ; sinon la fiche lui
   *                         est réservée et le rattachement se fera à son
   *                         arrivée, sans que personne n'y repense.
   *   `DELETE` (ci-dessous) cette fiche n'est à personne.
   *
   * Réservé au `parent` : décider quelle assiette appartient à qui est de la
   * composition du foyer. Sans cette garde, un compte `adulte` pourrait
   * s'attribuer la fiche d'un enfant et gagner le droit de la modifier.
   */
  app.put<{ Params: { id: string } }>('/api/eaters/:id/compte', async (request) => {
    const identity = request.identity();
    parentSeul(identity, 'rattacher une fiche à un compte');

    const id = uuid(request.params.id, 'id');
    const input = body(request.body);
    const self = input['self'] === true;
    const adresse = input['email'] === undefined || input['email'] === null
      ? null
      : emailField(input['email'], 'email');

    if (self && adresse !== null) {
      throw ApiError.badRequest('indiquez « self » ou une adresse e-mail, pas les deux');
    }
    if (!self && adresse === null) {
      throw ApiError.badRequest('indiquez « self » ou une adresse e-mail');
    }

    const compte = self
      ? identity.userId
      : await compteDuFoyer(request.db, identity.organizationId, adresse as string);

    const eater = await updateEater(request.db, identity.householdId, id, {
      userId: compte,
      claimEmail: compte === null ? adresse : null,
    }).catch(traduireCollision);

    if (eater === null) throw ApiError.notFound('membre introuvable');
    return {
      eater: present(eater, identity),
      // Le front en a besoin pour dire la vérité : « rattachée » n'est pas
      // « réservée, en attente qu'elle s'inscrive ».
      lié: eater.userId !== null,
    };
  });

  /** Détacher : la fiche n'est plus à personne, et n'attend plus personne. */
  app.delete<{ Params: { id: string } }>('/api/eaters/:id/compte', async (request) => {
    const identity = request.identity();
    parentSeul(identity, 'détacher une fiche d’un compte');
    const id = uuid(request.params.id, 'id');

    const eater = await updateEater(request.db, identity.householdId, id, {
      userId: null,
      claimEmail: null,
    });
    if (eater === null) throw ApiError.notFound('membre introuvable');
    return { eater: present(eater, identity) };
  });
}
