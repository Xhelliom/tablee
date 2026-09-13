/**
 * §4 — réception d'un partage Jow. Le chemin critique de l'app.
 *
 * Android ouvre `/share?title=…&text=…&url=…` par-dessus Jow. Objectif du §13 :
 * **enregistrer en trois taps** — choisir le créneau, cocher qui était là,
 * valider. Tout est donc pré-rempli : le créneau selon l'heure, les parts selon
 * ce que Jow prévoit, les convives selon les membres actifs.
 *
 * I6 : le texte partagé porte `key` et `userId`, qui sont des jetons de compte.
 * Il n'est jamais affiché tel quel, jamais mis dans l'URL après coup, et le
 * serveur ne persiste que sa version expurgée.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Meal, type ResolveResponse, type Slot } from '../api.ts';
import { navigate, useRoute } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { ConfidenceBadge, Warnings } from '../components/Confidence.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import { IconBowl } from '../icons.tsx';
import { SLOT_ORDER, SLOT_WHEN, currentSlot } from '../design/vocabulary.ts';

export function ShareScreen(): React.ReactElement {
  const { query } = useRoute();
  const { members } = useSession();

  // Jow met le titre **et** l'URL dans `text` : c'est `text` qu'il faut parser,
  // pas seulement `url` (§4).
  const shared = useMemo(
    () => [query.get('text'), query.get('url'), query.get('title')]
      .filter((v): v is string => v !== null && v.length > 0)
      .join('\n'),
    [query],
  );

  const [state, setState] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot>(() => currentSlot());
  const [servings, setServings] = useState(1);
  const [guestCount, setGuestCount] = useState(0);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPresent(new Set(members.map((m) => m.id)));
  }, [members]);

  useEffect(() => {
    if (shared.length === 0) {
      setError('Aucun contenu partagé.');
      return;
    }
    void api
      .post<ResolveResponse>('/api/recipes/resolve', { text: shared })
      .then((response) => {
        setState(response);
        if (response.recipe !== null) setServings(response.recipe.baseServings);
      })
      .catch(() => setError('La recette n’a pas pu être lue. Le repas peut être saisi à la main.'));
  }, [shared]);

  const toggle = useCallback((memberId: string) => {
    setPresent((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const { meal } = await api.post<{ meal: Meal }>('/api/meals', {
        eatenAt: new Date().toISOString(),
        slot,
        source: 'jow',
        recipeId: state?.recipe?.id ?? null,
        servings,
        guestCount,
        participants: [...present].map((memberId) => ({ memberId, present: true })),
        // Expurgé côté serveur avant insertion, et de nouveau ici par principe.
        rawInput: shared,
      });
      navigate(`/repas/${meal.id}`, { replace: true });
    } catch {
      setError('Le repas n’a pas pu être enregistré.');
      setSaving(false);
    }
  };

  const recipe = state?.recipe ?? null;
  const title = recipe?.title ?? state?.parsed?.title ?? 'Repas partagé';
  const confidence = recipe?.confidence ?? state?.parsed?.confidence ?? 'basse';

  return (
    <div className="app">
      <ModalHeader title="Reçu depuis Jow" onClose={() => navigate('/')} />

      {state === null && error === null ? (
        <p className="empty">Lecture de la recette…</p>
      ) : null}

      {error !== null ? (
        <div className="sec" style={{ paddingTop: 16 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{error}</p>
          <button type="button" className="btn btn--ghost" style={{ marginTop: 14 }}
                  onClick={() => navigate('/ajouter')}>
            Saisir le repas à la main
          </button>
        </div>
      ) : null}

      {state !== null ? (
        <>
          <section style={{ padding: '14px 16px', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {recipe?.imageUrl != null ? (
                <img src={recipe.imageUrl} alt=""
                     style={{ width: 54, height: 54, borderRadius: 'var(--radius)', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <span className="thumb" style={{ width: 54, height: 54 }}><IconBowl size={24} /></span>
              )}
              <div>
                <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{title}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <ConfidenceBadge confidence={confidence}
                                   label={confidence === 'haute' ? 'Résolue' : undefined} />
                  {recipe?.nutriScore != null ? (
                    <span className="meta">Nutri-Score {recipe.nutriScore}</span>
                  ) : null}
                  {state.seasonal > 0 ? (
                    <span className="meta">
                      {state.seasonal} produit{state.seasonal > 1 ? 's' : ''} de saison
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {recipe !== null ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                {recipe.ingredients.map((ingredient) => (
                  <span
                    key={ingredient.id}
                    className={ingredient.quantityG === null ? 'chip chip--warning' : 'chip'}
                  >
                    {ingredient.label}
                    {ingredient.quantityG !== null
                      ? ` ${formatGrams(ingredient.quantityG)}`
                      : ingredient.quantity !== null && ingredient.unit !== null
                        ? ` ${trim(ingredient.quantity)} ${ingredient.unit.toLowerCase()} ?`
                        : ''}
                  </span>
                ))}
              </div>
            ) : null}

            {/* « Une donnée manquante doit se voir » — §6 du contrat Jow. */}
            <Warnings warnings={state.warnings} />
          </section>

          <section className="spread" style={row}>
            <span style={{ fontSize: 14 }}>Quel repas</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {SLOT_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSlot(option)}
                  style={{
                    fontSize: 13, padding: '5px 11px', borderRadius: 'var(--radius)',
                    border: option === slot ? '.5px solid var(--coral)' : '.5px solid var(--border)',
                    background: option === slot ? 'var(--coral)' : 'transparent',
                    color: option === slot ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {SLOT_WHEN[option]}
                </button>
              ))}
            </div>
          </section>

          <section className="spread" style={row}>
            <div>
              <p style={{ fontSize: 14 }}>Pour combien&nbsp;?</p>
              {recipe !== null ? (
                <p className="meta">Recette prévue pour {recipe.baseServings}</p>
              ) : null}
            </div>
            <Stepper value={servings} onChange={setServings} min={0.5} max={20} step={0.5}
                     label="Parts préparées" />
          </section>

          <section style={{ ...row, paddingBottom: 14 }}>
            <WhoWasThere
              members={members}
              present={present}
              onToggle={toggle}
              guestCount={guestCount}
              onGuestCount={setGuestCount}
            />
          </section>

          <section style={row}>
            <button type="button" className="btn" onClick={() => { void save(); }}
                    disabled={saving || present.size === 0}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {present.size === 0 ? (
              <p className="meta" style={{ marginTop: 8, textAlign: 'center' }}>
                Coche au moins une personne.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

const row: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '.5px solid var(--border)',
  background: 'var(--surface-2)',
};

const trim = (value: number): string => String(Math.round(value * 100) / 100);

function formatGrams(grams: number): string {
  return grams >= 1000 ? `${trim(grams / 1000)} kg` : `${trim(grams)} g`;
}
