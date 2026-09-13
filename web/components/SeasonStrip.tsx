/**
 * §8bis — la bande « De saison en <mois> », en haut de l'accueil.
 *
 * Information passive : on doit la voir sans aller la chercher. Les produits
 * déjà mangés dans le mois sont cochés, les autres en pointillé, et la ligne
 * du dessous dit ce qui part bientôt — c'est elle qui transforme un catalogue
 * en fenêtre qui se ferme.
 *
 * ⚠️ `seasonal_produce` est livrée **vide** (§17) : elle demande une saisie
 * manuelle d'une quarantaine de produits, et aucune source automatisable n'a
 * été identifiée. Tant qu'elle l'est, la bande ne s'affiche pas du tout —
 * plutôt qu'un cadre vide qui donnerait l'impression d'un bug.
 */
import type { SeasonalProduce } from '../api.ts';
import { IconCheck, IconLeaf } from '../icons.tsx';
import { monthName } from '../design/vocabulary.ts';

interface Props {
  produce: SeasonalProduce[];
  month: number;
}

export function SeasonStrip({ produce, month }: Props): React.ReactElement | null {
  if (produce.length === 0) return null;

  const leaving = produce
    .filter((p) => p.lastMonth === month || p.lastMonth === (month % 12) + 1)
    .sort((a, b) => Number(a.lastMonth === month) - Number(b.lastMonth === month))[0];

  return (
    <section className="strip" style={{ marginTop: 20 }}>
      <div className="sec spread" style={{ alignItems: 'baseline', marginBottom: 13 }}>
        <p style={{ fontSize: 14 }}>De saison en {monthName(month)}</p>
      </div>
      <div className="sec" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }}>
        {produce.map((item) => (
          <div key={item.id} style={{ textAlign: 'center', width: 56, flexShrink: 0 }}>
            <div
              style={{
                width: 52, height: 52, borderRadius: '50%', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: item.eatenThisMonth ? 'var(--green-100)' : 'var(--surface-1)',
                border: item.eatenThisMonth ? 'none' : '.5px dashed var(--border-strong)',
                color: item.eatenThisMonth ? 'var(--green-900)' : 'var(--text-muted)',
              }}
            >
              <IconLeaf size={24} />
              {item.eatenThisMonth ? (
                <span style={{
                  position: 'absolute', bottom: -1, right: -1, width: 17, height: 17,
                  borderRadius: '50%', background: 'var(--green-600)',
                  border: '2px solid var(--surface-2)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <IconCheck size={9} />
                </span>
              ) : null}
            </div>
            <p style={{
              marginTop: 5, fontSize: 11, lineHeight: 1.25,
              color: item.eatenThisMonth ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>
              {item.name}
            </p>
          </div>
        ))}
      </div>
      {leaving !== undefined ? (
        <p className="sec meta" style={{ marginTop: 13 }}>
          {`${leaving.name} part fin ${monthName(leaving.lastMonth)}`}
        </p>
      ) : null}
    </section>
  );
}
