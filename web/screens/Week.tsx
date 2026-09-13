/**
 * V2 — la vue semaine : 7 jours × membres.
 *
 * Ce qu'elle montre : la régularité de la **saisie** et la tendance de la part
 * végétale. Ce qu'elle ne montre pas, et ne montrera pas : ni série, ni score
 * par personne (§14bis, I5). Un « 12 jours d'affilée » sur la ligne d'un
 * enfant transforme les repas en performance.
 *
 * Une case vide se lit « rien de saisi », jamais « rien mangé » — d'où
 * l'absence de zéro.
 */
import { useEffect, useState } from 'react';
import { api, type WeekResponse } from '../api.ts';
import { NUTRIENT_COLOR, shortDay } from '../design/vocabulary.ts';

export function WeekScreen(): React.ReactElement {
  const [data, setData] = useState<WeekResponse | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const from = shiftWeeks(offset);
    void api.get<WeekResponse>(`/api/week?from=${from}&days=7`).then(setData).catch(() => setData(null));
  }, [offset]);

  if (data === null) return <p className="empty">Un instant…</p>;

  const days = Array.from({ length: data.days }, (_, i) => addDays(data.from, i));
  const cell = (date: string, memberId: string) =>
    data.cells.find((c) => c.date === date && c.memberId === memberId);

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">La semaine</p>
        <p className="display" style={{ marginTop: 6 }}>{weekLabel(data.from)}</p>
      </div>

      <div className="sec spread" style={{ paddingTop: 14 }}>
        <button type="button" className="chip" style={{ cursor: 'pointer' }}
                onClick={() => setOffset((o) => o - 1)}>
          Semaine précédente
        </button>
        {offset < 0 ? (
          <button type="button" className="chip" style={{ cursor: 'pointer' }}
                  onClick={() => setOffset((o) => o + 1)}>
            Suivante
          </button>
        ) : null}
      </div>

      <div className="sec" style={{ paddingTop: 16, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>&nbsp;</th>
              {days.map((date) => (
                <th key={date} style={th}>{shortDay(date).slice(0, 2)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.id}>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>{member.firstName}</td>
                {days.map((date) => {
                  const found = cell(date, member.id);
                  return (
                    <td key={date} style={td}>
                      <DayCell meals={found?.meals ?? 0} plantRatio={found?.plantRatio ?? null} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data.members.length === 0 ? (
          <p className="empty">Personne n’est encore enregistré.</p>
        ) : null}
      </div>

      <p className="sec meta" style={{ paddingTop: 14, lineHeight: 1.5 }}>
        La hauteur de chaque case est la part végétale du jour. Une case vide
        veut dire « rien de saisi ».
      </p>
      <div className="fab-space" />
    </>
  );
}

function DayCell({ meals, plantRatio }: { meals: number; plantRatio: number | null }): React.ReactElement {
  if (meals === 0) {
    return (
      <span style={{
        display: 'block', width: 22, height: 26, margin: '0 auto',
        borderRadius: 4, border: '.5px dashed var(--border-strong)',
      }} />
    );
  }
  return (
    <span
      title={plantRatio === null ? `${meals} repas` : `${meals} repas · ${plantRatio} % végétal`}
      style={{
        display: 'flex', alignItems: 'flex-end', width: 22, height: 26, margin: '0 auto',
        borderRadius: 4, background: 'var(--surface-2)', border: '.5px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <span style={{
        width: '100%',
        height: plantRatio === null ? 3 : Math.max(3, (plantRatio / 100) * 26),
        background: plantRatio === null ? 'var(--border-strong)' : NUTRIENT_COLOR.plant,
      }} />
    </span>
  );
}

const th: React.CSSProperties = {
  padding: '6px 2px', fontWeight: 400, color: 'var(--text-muted)', textAlign: 'center',
};
const td: React.CSSProperties = { padding: '5px 2px', textAlign: 'center' };

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Lundi de la semaine courante, décalé de `weeks`. */
function shiftWeeks(weeks: number): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weeks * 7);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function weekLabel(from: string): string {
  const end = addDays(from, 6);
  const format = (date: string, withMonth: boolean): string =>
    new Intl.DateTimeFormat('fr-FR', withMonth ? { day: 'numeric', month: 'long' } : { day: 'numeric' })
      .format(new Date(`${date}T12:00:00`));
  return `Du ${format(from, false)}\nau ${format(end, true)}`;
}
