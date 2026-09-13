/**
 * V2 — historique, récents, favoris.
 *
 * Trois entrées sur la même idée : retrouver un repas déjà saisi pour le
 * resaisir. C'est ce qui fait passer de « on a testé » à « on l'utilise ».
 *
 * Aucun compteur de régularité ici. Ce qui est mis en avant, ce sont les plats
 * les plus repris — une collection, pas une performance (§14bis).
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Meal, type MealTemplate } from '../api.ts';
import { navigate } from '../router.tsx';
import { MealCard } from '../components/MealCard.tsx';
import { IconStar } from '../icons.tsx';
import { SLOT_ORDER, longDate } from '../design/vocabulary.ts';

export function HistoryScreen(): React.ReactElement {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - days);
    const [m, t] = await Promise.all([
      api.get<{ meals: Meal[] }>(`/api/meals?from=${iso(from)}&to=${iso(to)}`),
      api.get<{ templates: MealTemplate[] }>('/api/templates'),
    ]);
    setMeals(m.meals);
    setTemplates(t.templates);
    setLoading(false);
  }, [days]);

  useEffect(() => { void load().catch(() => setLoading(false)); }, [load]);

  const byDay = new Map<string, Meal[]>();
  for (const meal of meals) {
    const day = meal.eatenAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), meal]);
  }

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">Historique</p>
        <p className="display" style={{ marginTop: 6 }}>Ce qu’on<br />a mangé</p>
      </div>

      {templates.length > 0 ? (
        <section className="strip" style={{ marginTop: 20 }}>
          <p className="sec" style={{ fontSize: 14, marginBottom: 11 }}>Les plus repris</p>
          <div className="sec" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
            {templates.slice(0, 6).map((template) => (
              <span key={template.id} className="chip" style={{ flexShrink: 0, gap: 6 }}>
                <IconStar size={13} />
                {template.name}
                <span style={{ color: 'var(--text-muted)' }}>{template.useCount}×</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sec" style={{ paddingTop: 16, display: 'flex', gap: 6 }}>
        {[7, 14, 30].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDays(option)}
            className="chip"
            style={{
              cursor: 'pointer',
              background: option === days ? 'var(--coral)' : 'var(--surface-1)',
              color: option === days ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {option} jours
          </button>
        ))}
      </div>

      {loading ? <p className="empty">Un instant…</p> : null}
      {!loading && meals.length === 0 ? (
        <p className="empty">Rien d’enregistré sur cette période.</p>
      ) : null}

      {[...byDay.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, dayMeals]) => (
          <section key={day} className="sec" style={{ paddingTop: 18 }}>
            <p className="eyebrow" style={{ marginBottom: 9 }}>{longDate(day)}</p>
            <div className="stack">
              {[...dayMeals]
                .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
                .map((meal) => (
                  <MealCard key={meal.id} meal={meal} onOpen={(id) => navigate(`/repas/${id}`)} />
                ))}
            </div>
          </section>
        ))}
      <div className="fab-space" />
    </>
  );
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);
