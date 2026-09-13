/**
 * L'accueil — itération « journal » des maquettes, pas « tableau de bord ».
 *
 * Ordre d'apparition, et il compte : la date et ce qui s'est passé, la bande
 * de saison, les anneaux, puis les repas. Le chiffre n'ouvre pas l'écran.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type DashboardResponse } from '../api.ts';
import { navigate } from '../router.tsx';
import { MealCard } from '../components/MealCard.tsx';
import { NutrientRing } from '../components/NutrientRing.tsx';
import { SeasonStrip } from '../components/SeasonStrip.tsx';
import { IconPlus } from '../icons.tsx';
import {
  BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, SLOT_ORDER, longDate,
} from '../design/vocabulary.ts';

export function TodayScreen(): React.ReactElement {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<DashboardResponse>('/api/dashboard'));
    } catch {
      setError('impossible de charger la journée');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error !== null) return <p className="empty">{error}</p>;
  if (data === null) return <p className="empty">Un instant…</p>;

  const meals = [...data.meals].sort(
    (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
  );
  const [hero, ...rest] = meals;

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">{longDate(data.date)}</p>
        <p className="display" style={{ marginTop: 6 }}>{headline(meals.length)}</p>
      </div>

      <SeasonStrip produce={data.seasonal} month={data.month} />

      <div className="sec" style={{ padding: '18px 18px 16px', display: 'flex', gap: 13, flexWrap: 'wrap' }}>
        {data.dashboard.map(({ member, balance }) => (
          <button
            key={member.id}
            type="button"
            onClick={() => navigate(`/membres?membre=${member.id}`)}
            style={{ background: 'none', border: 0, padding: 0, textAlign: 'center', cursor: 'pointer' }}
          >
            <NutrientRing balance={balance} firstName={member.firstName} />
            <p style={{ marginTop: 3, fontSize: 11, color: 'var(--text-secondary)' }}>
              {member.firstName}
            </p>
          </button>
        ))}
        {data.dashboard.length === 0 ? (
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/membres')}>
            Ajouter qui vit ici
          </button>
        ) : null}
      </div>

      <Legend />

      {/* §9 — tant que `nutrient_reference` est vide, aucun pourcentage n'est
          calculable. Le dire franchement vaut mieux que des anneaux creux que
          l'on prendrait pour un bug. */}
      {!data.referencesLoaded && data.dashboard.length > 0 ? (
        <div className="sec" style={{ paddingBottom: 14 }}>
          <p style={{
            fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--bg-warning)', color: 'var(--text-warning)',
          }}>
            Les repères nutritionnels ne sont pas encore chargés : les anneaux ne
            montrent que la part végétale. Les valeurs de l’ANSES sont à saisir
            dans <code>nutrient_reference</code>, avec leur source.
          </p>
        </div>
      ) : null}

      <div className="sec stack" style={{ paddingBottom: 18 }}>
        {hero !== undefined ? (
          <MealCard meal={hero} hero onOpen={(id) => navigate(`/repas/${id}`)} />
        ) : null}
        {rest.map((meal) => (
          <MealCard key={meal.id} meal={meal} onOpen={(id) => navigate(`/repas/${id}`)} />
        ))}

        <button
          type="button"
          className="row"
          onClick={() => navigate('/ajouter')}
          style={{ border: '.5px solid rgba(216,90,48,.3)', borderRadius: 12 }}
        >
          <span className="thumb" style={{ background: 'var(--coral)', color: '#fff' }}>
            <IconPlus size={20} />
          </span>
          <span>
            <span style={{ fontSize: 14, display: 'block' }}>{addLabel(meals.length)}</span>
            <span className="meta">Ou partage depuis Jow</span>
          </span>
        </button>
      </div>
      <div className="fab-space" />
    </>
  );
}

/** Le sur-titre parle de ce qui s'est passé, pas d'un score. */
function headline(count: number): string {
  if (count === 0) return 'Rien\nà table';
  if (count === 1) return 'Un repas\nà table';
  return `${count} repas\nà table`;
}

function addLabel(count: number): string {
  return count === 0 ? 'Enregistrer un repas' : 'Ajouter un repas';
}

function Legend(): React.ReactElement {
  return (
    <div className="sec" style={{
      display: 'flex', flexWrap: 'wrap', gap: '5px 12px',
      fontSize: 11, color: 'var(--text-secondary)', paddingBottom: 14,
    }}>
      {[...BAR_NUTRIENTS.map((n) => ({ label: NUTRIENT_LABELS[n], color: NUTRIENT_COLOR[n] })),
        { label: 'Végétal', color: NUTRIENT_COLOR.plant }].map((entry) => (
        <span key={entry.label}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            marginRight: 5, background: entry.color,
          }} />
          {entry.label}
        </span>
      ))}
    </div>
  );
}
