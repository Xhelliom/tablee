/**
 * §12 — bilan du jour, par membre, en pourcentage des repères (R3).
 *
 * Toute la logique de calcul est dans `server/nutrition/` ; cette route ne
 * fait que rassembler les données et appeler `bilanJournalier`. C'est
 * volontaire : le même calcul doit valoir pour l'API, les tests et, un jour,
 * la synthèse hebdomadaire.
 */
import type { FastifyInstance } from 'fastify';
import { ageAt, isMinor } from '../nutrition/age.ts';
import { bilanJournalier } from '../nutrition/daily.ts';
import { ApiError } from '../http/errors.ts';
import { listEaters } from '../repo/eaters.ts';
import { loadReferences, seasonalForMonth } from '../repo/refs.ts';
import {
  householdPlantAverage, householdTimezone, mealsForDay, weekGrid,
} from '../repo/dashboard.ts';
import { listMeals } from '../repo/meals.ts';
import { mondayOf, nextDay, startOfDay, todayIn } from '../http/tz.ts';
import type { AppContext } from '../app.ts';

export function dashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { date?: string } }>('/api/dashboard', async (request) => {
    const householdId = request.householdId();
    const timezone = await householdTimezone(request.db, householdId);
    const date = request.query.date ?? todayIn(timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw ApiError.badRequest('« date » doit être une date AAAA-MM-JJ');
    }

    const [eaters, references, meals, plantAverage] = await Promise.all([
      listEaters(request.db, householdId),
      loadReferences(request.db),
      mealsForDay(request.db, householdId, date, timezone),
      householdPlantAverage(request.db, householdId, 7),
    ]);

    const byMember = new Map<string, typeof meals>();
    for (const meal of meals) {
      byMember.set(meal.eaterId, [...(byMember.get(meal.eaterId) ?? []), meal]);
    }

    const dashboard = eaters.map((eater) => ({
      eater: {
        id: eater.id,
        firstName: eater.firstName,
        color: eater.color,
        age: ageAt(eater.birthDate),
        // I5 : le front s'en sert pour n'afficher aucun objectif chiffré de
        // calories ni de poids sur un profil mineur.
        minor: isMinor(eater.birthDate),
      },
      balance: bilanJournalier({
        sex: eater.sex,
        age: ageAt(eater.birthDate, new Date(`${date}T12:00:00Z`)),
        meals: byMember.get(eater.id) ?? [],
        references,
        householdPlantAverage7d: plantAverage,
      }),
    }));

    const [year, month] = date.split('-');
    return {
      date,
      dashboard,
      meals: await listMeals(
        request.db, householdId,
        startOfDay(date, timezone),
        startOfDay(nextDay(date), timezone),
      ),
      // §8bis — la bande « De saison en <mois> ». Vide tant que
      // `seasonal_produce` n'est pas saisie (§17) : la bande ne s'affiche
      // alors pas, plutôt que de s'afficher creuse.
      seasonal: await seasonalForMonth(request.db, householdId, Number(month), Number(year)),
      month: Number(month),
      year: Number(year),
      /** Les repères manquent-ils entièrement ? L'écran doit pouvoir le dire. */
      referencesLoaded: references.length > 0,
    };
  });

  /** V2 — grille 7 jours × membres. */
  app.get<{ Querystring: { from?: string; days?: string } }>('/api/week', async (request) => {
    const householdId = request.householdId();
    const timezone = await householdTimezone(request.db, householdId);
    const days = Math.min(Number(request.query.days ?? 7) || 7, 31);
    const from = request.query.from ?? mondayOf(todayIn(timezone));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      throw ApiError.badRequest('« from » doit être une date AAAA-MM-JJ');
    }

    const [eaters, cells] = await Promise.all([
      listEaters(request.db, householdId),
      weekGrid(request.db, householdId, from, days, timezone),
    ]);
    return {
      from,
      days,
      eaters: eaters.map((m) => ({ id: m.id, firstName: m.firstName, color: m.color })),
      cells,
    };
  });
}
