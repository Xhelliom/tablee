/**
 * Les pesées d'un majeur et leur tendance (029).
 *
 * ⚠️ Renverse le « ni séries » de la 009 pour le poids des majeurs, et pour
 * lui seul — lire l'en-tête de la 029 avant d'y toucher. Ce que ces routes
 * refusent :
 *
 *   - **un mineur** : l'écriture répond 422, la lecture une courbe vide, même
 *     si des pesées traînaient en base ;
 *   - **la courbe d'un autre à un `adulte`** : 403, comme le poids qu'il ne
 *     voyait déjà pas (`present()` dans `eaters.ts`). Un `parent` voit tout ;
 *   - **une cible** : la réponse ne porte aucun objectif, aucun écart, aucun
 *     IMC. La courbe tracée est la tendance, pas les pesées.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isMinor } from '../nutrition/age.ts';
import { ApiError } from '../http/errors.ts';
import { body, isoDate, num, uuid } from '../http/validate.ts';
import { shiftDay, todayIn } from '../http/tz.ts';
import { findMembers, type Eater } from '../repo/eaters.ts';
import { householdTimezone } from '../repo/dashboard.ts';
import { deleteWeight, listWeights, recordWeight, type WeightMeasure } from '../repo/weights.ts';
import type { AppContext } from '../app.ts';

/** La fenêtre tracée. La tendance se calcule sur tout l'historique, pour ne pas repartir de zéro au bord. */
const JOURS_TRACÉS = 90;

/**
 * Moyenne mobile exponentielle à 10 % par jour (« Hacker's Diet ») : une pesée
 * isolée ne déplace la tendance que d'un dixième de son écart. Les pesées sont
 * irrégulières, la pondération suit donc l'écart en jours, pas le rang.
 */
export function tendance(pesées: WeightMeasure[]): { day: string; kg: number }[] {
  let kg = 0;
  let veille: string | null = null;
  return pesées.map(({ day, weightKg }) => {
    if (veille === null) kg = weightKg;
    else kg += (1 - 0.9 ** ((Date.parse(day) - Date.parse(veille)) / 86_400_000)) * (weightKg - kg);
    veille = day;
    return { day, kg: Math.round(kg * 10) / 10 };
  });
}

/** La fiche, si celui qui demande a le droit d'en voir le poids. */
async function ficheVisible(request: FastifyRequest<{ Params: { id: string } }>): Promise<Eater> {
  const identity = request.identity();
  const [eater] = await findMembers(request.db, identity.householdId, [uuid(request.params.id, 'id')]);
  if (eater === undefined) throw ApiError.notFound('convive introuvable');
  if (identity.role !== 'parent' && eater.userId !== identity.userId) {
    throw new ApiError(403, 'droits_insuffisants', 'le poids d’un autre ne se consulte pas');
  }
  return eater;
}

export function weightRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get<{ Params: { id: string } }>('/api/eaters/:id/weights', async (request) => {
    const eater = await ficheVisible(request);
    // Second filet : une pesée restée en base ne sort pas d'un profil mineur.
    if (isMinor(eater.birthDate)) return { tendance: [], pesees: [] };

    const householdId = request.householdId();
    const pesées = await listWeights(request.db, householdId, eater.id);
    const depuis = shiftDay(todayIn(await householdTimezone(request.db, householdId)), -JOURS_TRACÉS);
    return {
      tendance: tendance(pesées).filter((point) => point.day >= depuis),
      // Pour corriger une saisie, pas pour tracer.
      pesees: pesées.filter((p) => p.day >= depuis),
    };
  });

  app.put<{ Params: { id: string; day: string } }>('/api/eaters/:id/weights/:day', async (request) => {
    const eater = await ficheVisible(request);
    if (isMinor(eater.birthDate)) {
      throw new ApiError(422, 'poids_interdit_mineur', 'le poids n’est pas suivi sur un profil mineur');
    }
    const householdId = request.householdId();
    const day = isoDate(request.params.day, 'day');
    if (day > todayIn(await householdTimezone(request.db, householdId))) {
      throw ApiError.badRequest('une pesée ne se date pas dans le futur');
    }
    const weightKg = num(body(request.body)['weightKg'], 'weightKg', { min: 1, max: 400 });
    if (!await recordWeight(request.db, householdId, eater.id, day, weightKg)) {
      throw ApiError.notFound('convive introuvable');
    }
    return { day, weightKg };
  });

  app.delete<{ Params: { id: string; day: string } }>('/api/eaters/:id/weights/:day', async (request) => {
    const eater = await ficheVisible(request);
    await deleteWeight(request.db, request.householdId(), eater.id, isoDate(request.params.day, 'day'));
    return { deleted: true };
  });
}
