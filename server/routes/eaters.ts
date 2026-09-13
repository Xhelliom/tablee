/**
 * §12 — membres du foyer.
 */
import type { FastifyInstance } from 'fastify';
import { ageAt, isMinor } from '../nutrition/age.ts';
import { ApiError } from '../http/errors.ts';
import {
  body, isoDate, num, optionalStr, sex, str, stringArray, uuid,
} from '../http/validate.ts';
import { createEater, listEaters, updateEater, type Eater } from '../repo/eaters.ts';
import type { AppContext } from '../app.ts';

/**
 * Ce que l'API expose d'un membre.
 *
 * `minor` est exposé pour que le front puisse appliquer I5 sans recalculer un
 * âge de son côté : aucun objectif chiffré de calories ni de poids sur un
 * profil mineur, nulle part.
 */
function present(eater: Eater): Eater & { age: number; minor: boolean } {
  return { ...eater, age: ageAt(eater.birthDate), minor: isMinor(eater.birthDate) };
}

export function eaterRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/eaters', async (request) => {
    const eaters = await listEaters(request.db, request.householdId());
    return { eaters: eaters.map(present) };
  });

  app.post('/api/eaters', async (request, reply) => {
    const input = body(request.body);
    const eater = await createEater(request.db, request.householdId(), {
      firstName: str(input['firstName'], 'firstName', { max: 80 }),
      birthDate: isoDate(input['birthDate'], 'birthDate'),
      sex: sex(input['sex']),
      portionCoef:
        input['portionCoef'] === undefined
          ? 1
          : num(input['portionCoef'], 'portionCoef', { min: 0.01, max: 2 }),
      diets: input['diets'] === undefined ? [] : stringArray(input['diets'], 'diets'),
      color: optionalStr(input['color'], 'color', { max: 20 }),
    });
    reply.code(201);
    return { eater: present(eater) };
  });

  /**
   * Modifier un membre — **y compris son `portion_coef`**.
   *
   * R2 : aucun repas passé n'est réécrit. Un enfant qui grandit mangera plus
   * demain ; ce qu'il a mangé hier ne change pas. Le repas garde la part qui a
   * été figée au moment où il a été enregistré.
   */
  app.patch<{ Params: { id: string } }>('/api/eaters/:id', async (request) => {
    const id = uuid(request.params.id, 'id');
    const input = body(request.body);

    const eater = await updateEater(request.db, request.householdId(), id, {
      ...(input['firstName'] !== undefined && { firstName: str(input['firstName'], 'firstName', { max: 80 }) }),
      ...(input['birthDate'] !== undefined && { birthDate: isoDate(input['birthDate'], 'birthDate') }),
      ...(input['sex'] !== undefined && { sex: sex(input['sex']) }),
      ...(input['portionCoef'] !== undefined && {
        portionCoef: num(input['portionCoef'], 'portionCoef', { min: 0.01, max: 2 }),
      }),
      ...(input['diets'] !== undefined && { diets: stringArray(input['diets'], 'diets') }),
      ...(input['color'] !== undefined && { color: optionalStr(input['color'], 'color', { max: 20 }) }),
      ...(input['active'] !== undefined && { active: input['active'] === true }),
    });

    if (eater === null) throw ApiError.notFound('membre introuvable');
    return { eater: present(eater) };
  });
}
