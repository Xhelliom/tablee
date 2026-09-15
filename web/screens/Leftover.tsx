/**
 * Resservir un reste (§6bis) : ce qui restait, qui le mange, s'il en reste
 * encore.
 *
 * ⚠️ Jusqu'au 15/09/2026, un tap sur « Restes de… » enregistrait d'office une
 * part pour tout le foyer, et ouvrait un détail sans bouton « Enregistrer ».
 * La spec disait pourtant « un tap, on choisit qui mange, c'est enregistré » :
 * c'est cette étape-là qui revient, pas un formulaire de plus.
 *
 * Qui mange part de **votre** fiche, pas du foyer : un reste se mange rarement
 * à tous. Sans fiche rattachée au compte, tout le foyer est coché, comme au
 * partage Jow.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Meal } from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import {
  RemainsPicker, UNCOUNTED_HINT, dishTitle, eatenHint, split,
} from '../components/Leftovers.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import { IconBowl } from '../icons.tsx';
import { currentSlot, relativeDay } from '../design/vocabulary.ts';

export function LeftoverScreen({ mealId }: { mealId: string }): React.ReactElement {
  const { eaters } = useSession();
  const [source, setSource] = useState<Meal | null>(null);
  const [base, setBase] = useState(1);
  const [remains, setRemains] = useState(0);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [guestCount, setGuestCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.get<{ meal: Meal }>(`/api/meals/${mealId}`)
      .then(({ meal }) => {
        setSource(meal);
        // Sans recette, pas de parts : ce qui sort du frigo est « le plat ».
        setBase(meal.recipe === null ? 1 : meal.remainingServings ?? 1);
      })
      .catch(() => setError('ce plat est introuvable'));
  }, [mealId]);

  useEffect(() => {
    const mine = eaters.filter((eater) => eater.isMe);
    setPresent(new Set((mine.length > 0 ? mine : eaters).map((eater) => eater.id)));
  }, [eaters]);

  const toggle = useCallback((eaterId: string) => {
    setPresent((current) => {
      const next = new Set(current);
      if (next.has(eaterId)) next.delete(eaterId);
      else next.add(eaterId);
      return next;
    });
  }, []);

  const parts = split(base, remains);

  const save = async (): Promise<void> => {
    if (source === null) return;
    setSaving(true);
    try {
      await api.post('/api/meals', {
        eatenAt: new Date().toISOString(),
        slot: currentSlot(),
        source: source.source,
        recipeId: source.recipe?.id ?? null,
        // Sans `items`, le serveur reprend la composition du plat, réduite à
        // ce qui restait.
        leftoverOf: source.id,
        ...parts,
        guestCount,
        participants: [...present].map((eaterId) => ({ eaterId, present: true })),
      });
      // L'accueil, comme après toute saisie : le frigo s'y met à jour.
      navigate('/', { replace: true });
    } catch {
      setError('les restes n’ont pas pu être enregistrés');
      setSaving(false);
    }
  };

  const close = (): void => navigate('/');

  if (source === null) {
    return (
      <div className="app">
        <ModalHeader title="Restes" onClose={close} />
        <p className="empty">{error ?? 'Un instant…'}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <ModalHeader title="Restes" onClose={close} />

      <section style={{ padding: '14px 16px', background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {source.recipe?.imageUrl != null ? (
            <img src={source.recipe.imageUrl} alt=""
                 style={{ width: 54, height: 54, borderRadius: 'var(--radius)', objectFit: 'cover' }} />
          ) : (
            <span className="thumb" style={{ width: 54, height: 54 }}><IconBowl size={24} /></span>
          )}
          <div>
            <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>
              {dishTitle(source)}
            </p>
            <p className="meta" style={{ marginTop: 4 }}>Servi {relativeDay(source.eatenAt)}</p>
          </div>
        </div>
      </section>

      {source.recipe !== null ? (
        <section className="spread" style={row}>
          <div>
            <p style={{ fontSize: 14 }}>Il restait</p>
            <p className="meta">Parts sorties du frigo</p>
          </div>
          <Stepper value={base} onChange={setBase} min={0.1} max={20} step={0.5} label="Il restait" />
        </section>
      ) : null}

      <section className="spread" style={row}>
        <RemainsPicker
          label="Il en reste encore ?"
          hint={source.recipe !== null ? eatenHint(parts.servings) : UNCOUNTED_HINT}
          value={remains} onChange={setRemains}
        />
      </section>

      <section style={{ ...row, paddingBottom: 14 }}>
        <WhoWasThere eaters={eaters} present={present} onToggle={toggle}
                     guestCount={guestCount} onGuestCount={setGuestCount} />
      </section>

      <section style={row}>
        {error !== null ? (
          <p style={{ fontSize: 13, color: 'var(--text-warning)', marginBottom: 8 }}>{error}</p>
        ) : null}
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
      <div className="fab-space" />
    </div>
  );
}

const row: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '.5px solid var(--border)',
  background: 'var(--surface-2)',
};
