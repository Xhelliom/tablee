/**
 * La tendance du poids d'un majeur (029), et la saisie des pesées.
 *
 * Trace la moyenne lissée calculée par le serveur, **jamais les pesées** :
 * elles bougent d'un matin à l'autre avec l'eau et le sel, et une pesée isolée
 * lue comme un verdict est exactement ce que la tendance évite. Ni cible, ni
 * écart, ni couleur de nutriment : ce n'est pas une donnée nutritionnelle.
 *
 * Absent — pas grisé — sur un profil mineur, et sur la fiche d'un autre pour
 * un `adulte` : le serveur refuserait de toute façon (I5).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { api, ApiError, type Eater, type WeightsResponse } from '../api.ts';
import { useSession } from '../session.tsx';

const kg = (valeur: number): string => `${valeur.toString().replace('.', ',')} kg`;
const jour = (day: string): string => day.split('-').reverse().slice(0, 2).join('/');

export function PoidsTendance({ eater }: { eater: Eater }): ReactElement | null {
  const { role } = useSession();
  const visible = !eater.minor && (role === 'parent' || eater.isMe);
  const [data, setData] = useState<WeightsResponse | null>(null);
  const [day, setDay] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setData(await api.get<WeightsResponse>(`/api/eaters/${eater.id}/weights`));
  }, [eater.id]);

  useEffect(() => {
    if (visible) charger().catch(() => setErreur('les pesées n’ont pas pu être chargées'));
  }, [visible, charger]);

  if (!visible) return null;

  const agir = async (geste: () => Promise<unknown>): Promise<void> => {
    setErreur(null);
    try {
      await geste();
      await charger();
    } catch (cause) {
      setErreur(cause instanceof ApiError ? cause.message : 'la pesée n’a pas pu être enregistrée');
    }
  };

  const noter = (): Promise<void> => agir(async () => {
    await api.put(`/api/eaters/${eater.id}/weights/${day}`, { weightKg: Number(saisie.replace(',', '.')) });
    setSaisie('');
  });

  const points = data?.tendance ?? [];
  const dernier = points.at(-1);

  return (
    <div style={{ marginTop: 12 }}>
      <span className="label">Poids — tendance sur 90 jours</span>
      {dernier !== undefined ? (
        <>
          <Courbe points={points} />
          <p className="meta">
            {kg(dernier.kg)} au {jour(dernier.day)} — une moyenne lissée : une pesée isolée ne la
            déplace que d’un dixième. Ni cible, ni écart.
          </p>
        </>
      ) : (
        <p className="meta">Aucune pesée sur les 90 derniers jours.</p>
      )}

      <div className="grid2" style={{ marginTop: 8 }}>
        <input
          className="field" type="date" aria-label="Jour de la pesée"
          value={day} max={new Date().toLocaleDateString('sv-SE')}
          onChange={(e) => setDay(e.target.value)}
        />
        <input
          className="field" inputMode="decimal" placeholder="kg" aria-label="Poids en kilogrammes"
          value={saisie} onChange={(e) => setSaisie(e.target.value)}
        />
      </div>
      <button
        type="button" className="btn btn--quiet" style={{ marginTop: 8 }}
        disabled={saisie.trim() === '' || day === ''} onClick={() => void noter()}
      >
        Noter la pesée
      </button>
      {erreur !== null ? <p className="meta" role="alert">{erreur}</p> : null}

      {data !== null && data.pesees.length > 0 ? (
        <details style={{ marginTop: 8 }}>
          <summary className="meta">Corriger une pesée</summary>
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
            {data.pesees.slice(-7).reverse().map((p) => (
              <li key={p.day} className="spread meta" style={{ padding: '3px 0' }}>
                <span>{jour(p.day)} · {kg(p.weightKg)}</span>
                <button
                  type="button" className="btn btn--quiet"
                  onClick={() => void agir(() => api.delete(`/api/eaters/${eater.id}/weights/${p.day}`))}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Une ligne, sans axe ni repère : l'échelle suit les valeurs, pas une norme. */
function Courbe({ points }: { points: WeightsResponse['tendance'] }): ReactElement {
  const x = points.map((p) => Date.parse(p.day));
  const y = points.map((p) => p.kg);
  const [x0, x1] = [Math.min(...x), Math.max(...x)];
  // Un demi-kilo de marge au moins : sans elle, 100 g de variation rempliraient la hauteur.
  const [y0, y1] = [Math.min(...y) - 0.5, Math.max(...y) + 0.5];
  const coords = points.map((_, i) => [
    x1 === x0 ? 150 : ((x[i]! - x0) / (x1 - x0)) * 296 + 2,
    58 - ((y[i]! - y0) / (y1 - y0)) * 56,
  ] as const);

  return (
    <svg
      viewBox="0 0 300 60" width="100%" height="60" role="img" style={{ display: 'block', margin: '6px 0' }}
      aria-label={`Tendance du poids, de ${kg(y[0]!)} à ${kg(y.at(-1)!)}`}
    >
      {coords.length === 1 ? (
        <circle cx={coords[0]![0]} cy={coords[0]![1]} r={3} fill="var(--text-secondary)" />
      ) : (
        <polyline
          points={coords.map(([a, b]) => `${a},${b}`).join(' ')} fill="none"
          stroke="var(--text-secondary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
