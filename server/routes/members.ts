/**
 * §12 — membres du foyer.
 */
import type { FastifyInstance } from 'fastify';
import { ageAt, isMinor } from '../nutrition/age.ts';
import { ApiError } from '../http/errors.ts';
import {
  body, isoDate, num, optionalStr, sex, str, stringArray, uuid,
} from '../http/validate.ts';
import { createMember, listMembers, updateMember, type Member } from '../repo/members.ts';
import type { AppContext } from '../app.ts';

/**
 * Ce que l'API expose d'un membre.
 *
 * `minor` est exposé pour que le front puisse appliquer I5 sans recalculer un
 * âge de son côté : aucun objectif chiffré de calories ni de poids sur un
 * profil mineur, nulle part.
 */
function present(member: Member): Member & { age: number; minor: boolean } {
  return { ...member, age: ageAt(member.birthDate), minor: isMinor(member.birthDate) };
}

export function memberRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/members', async (request) => {
    const members = await listMembers(ctx.pool, request.householdId());
    return { members: members.map(present) };
  });

  app.post('/api/members', async (request, reply) => {
    const input = body(request.body);
    const member = await createMember(ctx.pool, request.householdId(), {
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
    return { member: present(member) };
  });

  /**
   * Modifier un membre — **y compris son `portion_coef`**.
   *
   * R2 : aucun repas passé n'est réécrit. Un enfant qui grandit mangera plus
   * demain ; ce qu'il a mangé hier ne change pas. Le repas garde la part qui a
   * été figée au moment où il a été enregistré.
   */
  app.patch<{ Params: { id: string } }>('/api/members/:id', async (request) => {
    const id = uuid(request.params.id, 'id');
    const input = body(request.body);

    const member = await updateMember(ctx.pool, request.householdId(), id, {
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

    if (member === null) throw ApiError.notFound('membre introuvable');
    return { member: present(member) };
  });
}
