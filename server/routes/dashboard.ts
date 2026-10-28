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
import { bilanFrequences, hiddenFrequencyCodes } from '../nutrition/frequency.ts';
import { diversityByEater, familyDays, weeklyMeans } from '../nutrition/weekly.ts';
import { ApiError } from '../http/errors.ts';
import { listEaters } from '../repo/eaters.ts';
import { loadFrequencyReferences, loadReferences, seasonalForMonth } from '../repo/refs.ts';
import {
  diversityRows, frequencyInputs, householdPlantAverage, householdTimezone, mealsForDay,
  mealsForRange, weekGrid,
} from '../repo/dashboard.ts';
import { listMeals } from '../repo/meals.ts';
import { completeDays, markDayComplete, unmarkDayComplete } from '../repo/days.ts';
import { isoDate, uuid } from '../http/validate.ts';
import { mondayOf, nextDay, shiftDay, startOfDay, todayIn } from '../http/tz.ts';
import type { AppContext } from '../app.ts';

export function dashboardRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get<{ Querystring: { date?: string } }>('/api/dashboard', async (request) => {
    const householdId = request.householdId();
    const timezone = await householdTimezone(request.db, householdId);
    const date = request.query.date ?? todayIn(timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw ApiError.badRequest('« date » doit être une date AAAA-MM-JJ');
    }

    const [eaters, references, meals, plantAverage, weekMeals, complete] = await Promise.all([
      listEaters(request.db, householdId),
      loadReferences(request.db),
      mealsForDay(request.db, householdId, date, timezone),
      householdPlantAverage(request.db, householdId, 7),
      mealsForRange(request.db, householdId, shiftDay(date, -6), 7, timezone),
      completeDays(request.db, householdId, shiftDay(date, -6), date),
    ]);

    const byMember = new Map<string, typeof meals>();
    for (const meal of meals) {
      byMember.set(meal.eaterId, [...(byMember.get(meal.eaterId) ?? []), meal]);
    }

    const weekDates = Array.from({ length: 7 }, (_, i) => shiftDay(date, i - 6));
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
      /** « J'ai tout saisi » pour ce jour-là : un état de la saisie, jamais un compte. */
      complete: complete.has(`${date} ${eater.id}`),
      balance: bilanJournalier({
        sex: eater.sex,
        age: ageAt(eater.birthDate, new Date(`${date}T12:00:00Z`)),
        meals: byMember.get(eater.id) ?? [],
        references,
        householdPlantAverage7d: plantAverage,
        energyWeek: weekDates.map((day) =>
          weekMeals.filter((row) => row.eaterId === eater.id && row.date === day)),
        completeWeek: weekDates.map((day) => complete.has(`${day} ${eater.id}`)),
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

  /**
   * Dette n° 20 — « j'ai tout saisi ce jour-là », par convive (028). Tout
   * membre le pose ou le retire, comme il saisit un repas pour un autre.
   */
  app.put<{ Params: { id: string; date: string } }>('/api/eaters/:id/days/:date/complete', async (request) => {
    const marked = await markDayComplete(request.db, request.householdId(),
      uuid(request.params.id, 'id'), isoDate(request.params.date, 'date'));
    if (!marked) throw ApiError.notFound('convive introuvable');
    return { complete: true };
  });

  app.delete<{ Params: { id: string; date: string } }>('/api/eaters/:id/days/:date/complete', async (request) => {
    await unmarkDayComplete(request.db, request.householdId(),
      uuid(request.params.id, 'id'), isoDate(request.params.date, 'date'));
    return { complete: false };
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

    const [eaters, cells, references, ranged, frequencyRefs, frequency, diversity] = await Promise.all([
      listEaters(request.db, householdId),
      weekGrid(request.db, householdId, from, days, timezone),
      loadReferences(request.db),
      mealsForRange(request.db, householdId, from, days, timezone),
      loadFrequencyReferences(request.db),
      frequencyInputs(request.db, householdId, from, days, timezone),
      diversityRows(request.db, householdId, from, days, timezone),
    ]);

    // Les tendances du foyer (§15, 10/2026) : moyennes des % du repère par
    // jour, jamais par personne. Les graphes par convive restent végétaux.
    const byDay = new Map<string, typeof ranged>();
    for (const row of ranged) byDay.set(row.date, [...(byDay.get(row.date) ?? []), row]);
    const dates = Array.from({ length: days }, (_, i) => shiftDay(from, i));
    const nutrients = weeklyMeans(
      dates.map((date) => ({
        date,
        members: eaters.map((eater) => ({
          sex: eater.sex,
          age: ageAt(eater.birthDate, new Date(`${date}T12:00:00Z`)),
          meals: (byDay.get(date) ?? []).filter((row) => row.eaterId === eater.id),
        })),
      })),
      references,
    );

    // Un repère que le régime de tous les adultes exclut ne s'affiche pas.
    const hidden = hiddenFrequencyCodes(
      eaters.filter((e) => e.active && !isMinor(e.birthDate)),
      frequencyRefs.map((r) => r.code),
    );
    const shownFrequencies = frequencyRefs.filter((r) => !hidden.has(r.code));

    return {
      from,
      days,
      eaters: eaters.map((m) => ({ id: m.id, firstName: m.firstName, color: m.color })),
      cells,
      nutrients,
      // Repères de fréquence (SPF, adultes) : au niveau du foyer seulement, et
      // aucun par convive — un plafond n'a rien à faire sur la fiche d'un enfant.
      // L'alcool n'est pas mentionné tant qu'aucun verre n'est saisi (027).
      frequencies: bilanFrequences({ references: shownFrequencies, ...frequency })
        .filter((f) => f.kind !== 'max_drinks' || f.current !== null),
      diversity: { ...diversityByEater(diversity), families: familyDays(diversity) },
    };
  });
}
