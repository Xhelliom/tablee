/**
 * §12 — templates et suggestions.
 *
 * Appliquer un template doit tenir en deux taps depuis l'accueil : ouvrir
 * l'ajout rapide, appuyer sur « Petit-déj famille ». D'où `POST /apply` qui
 * crée le repas complet sans rien demander d'autre — pas de formulaire de
 * confirmation, pas d'écran intermédiaire.
 */
import type { FastifyInstance } from 'fastify';
import { transaction } from '../db.ts';
import { ApiError } from '../http/errors.ts';
import { body, int, isoDateTime, participants, slot, uuid } from '../http/validate.ts';
import { getMeal } from '../repo/meals.ts';
import {
  applyTemplate, deleteTemplate, listTemplates, suggestTemplates,
} from '../repo/templates.ts';
import type { AppContext } from '../app.ts';

export function templateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/templates', async (request) => ({
    templates: await listTemplates(ctx.pool, request.householdId()),
  }));

  app.post<{ Params: { id: string } }>('/api/templates/:id/apply', async (request, reply) => {
    const id = uuid(request.params.id, 'id');
    const householdId = request.householdId();
    const input = request.body === undefined || request.body === null ? {} : body(request.body);

    const mealId = await transaction(ctx.pool, (client) =>
      applyTemplate(client, householdId, id, {
        ...(input['eatenAt'] !== undefined && { eatenAt: isoDateTime(input['eatenAt'], 'eatenAt') }),
        ...(input['slot'] !== undefined && { slot: slot(input['slot']) }),
        ...(input['participants'] !== undefined && {
          participants: participants(input['participants']),
        }),
        ...(input['guestCount'] !== undefined && {
          guestCount: int(input['guestCount'], 'guestCount', { min: 0, max: 50 }),
        }),
      }),
    );

    if (mealId === null) throw ApiError.notFound('template introuvable');
    reply.code(201);
    return { meal: await getMeal(ctx.pool, householdId, mealId) };
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (request) => {
    const deleted = await deleteTemplate(ctx.pool, request.householdId(), uuid(request.params.id, 'id'));
    if (!deleted) throw ApiError.notFound('template introuvable');
    return { ok: true };
  });

  /**
   * V2 — « ce repas revient souvent, en faire un bouton ? »
   *
   * Suggestion, pas création automatique : un template créé dans le dos de
   * l'utilisateur encombre l'écran d'ajout rapide, qui ne vaut que par sa
   * brièveté.
   */
  app.get('/api/templates/suggestions', async (request) => ({
    suggestions: await suggestTemplates(ctx.pool, request.householdId()),
  }));
}
