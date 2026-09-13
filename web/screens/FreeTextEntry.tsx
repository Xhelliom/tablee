/**
 * §5, voie 2 — saisie texte avec recherche dans `food`.
 *
 * En V1 la recherche est plein texte sur le référentiel Ciqual : on cherche
 * « courgette », on choisit, on donne une quantité. L'éclatement automatique
 * d'un « big mac + frites moyennes » par un LLM est prévu en V3, avec
 * validation — pas avant.
 *
 * La quantité en grammes est demandée, pas devinée. Quand l'aliment porte ses
 * propres équivalences (`food.unit_weights`), elles sont proposées ; sinon
 * c'est le gramme, parce que `unit_default` est vide et qu'inventer le poids
 * d'une poignée est exactement ce qu'interdit I1.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FoodSummary, type Meal, type Slot } from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { GramsInput } from '../components/GramsInput.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import { IconClose, IconSearch } from '../icons.tsx';
import { SLOT_ORDER, SLOT_WHEN, currentSlot } from '../design/vocabulary.ts';

interface Draft {
  foodId: string | null;
  label: string;
  grams: number | null;
}

export function FreeTextEntry({ onClose }: { onClose: () => void }): React.ReactElement {
  const { members } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [items, setItems] = useState<Draft[]>([]);
  const [slot, setSlot] = useState<Slot>(() => currentSlot());
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [guestCount, setGuestCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { setPresent(new Set(members.map((m) => m.id))); }, [members]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    // Une frappe = une requête serait du bruit ; 200 ms suffisent à ne pas
    // sentir l'attente.
    timer.current = window.setTimeout(() => {
      void api
        .get<{ foods: FoodSummary[] }>(`/api/foods/search?q=${encodeURIComponent(query)}`)
        .then((response) => setResults(response.foods))
        .catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(timer.current);
  }, [query]);

  const add = (food: FoodSummary): void => {
    setItems((current) => [...current, { foodId: food.id, label: food.name, grams: null }]);
    setQuery('');
    setResults([]);
  };

  const addFreeText = (): void => {
    const label = query.trim();
    if (label.length === 0) return;
    // Aucun aliment rattaché : le repas sera enregistré, sa nutrition restera
    // inconnue et son badge le dira. Mieux que de perdre la saisie.
    setItems((current) => [...current, { foodId: null, label, grams: null }]);
    setQuery('');
  };

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
        source: 'texte',
        servings: 1,
        guestCount,
        participants: [...present].map((memberId) => ({ memberId, present: true })),
        items: items.map((item) => ({
          foodId: item.foodId,
          label: item.label,
          quantity: item.grams,
          unit: item.grams === null ? null : 'g',
          quantityG: item.grams,
        })),
      });
      navigate(`/repas/${meal.id}`, { replace: true });
    } catch {
      setError('Le repas n’a pas pu être enregistré.');
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <ModalHeader title="Saisir un repas" onClose={onClose} />

      <section style={{ padding: '14px 16px', background: 'var(--surface-2)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px',
          borderRadius: 'var(--radius)', border: '.5px solid var(--border-strong)',
        }}>
          <IconSearch size={17} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addFreeText(); }}
            placeholder="Courgette, pain complet, yaourt…"
            aria-label="Chercher un aliment"
            style={{
              border: 0, outline: 'none', flex: 1, fontSize: 15,
              background: 'transparent', fontFamily: 'inherit', minWidth: 0,
            }}
          />
        </div>

        {results.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
            {results.slice(0, 8).map((food) => (
              <li key={food.id}>
                <button type="button" onClick={() => add(food)} style={resultRow}>
                  <span style={{ fontSize: 14 }}>{food.name}</span>
                  {food.kcal100g === null ? (
                    <span className="meta">valeur inconnue</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {results.length === 0 && query.trim().length >= 2 ? (
          <button type="button" className="btn btn--quiet" style={{ marginTop: 10 }}
                  onClick={addFreeText}>
            Ajouter « {query.trim()} » sans valeurs
          </button>
        ) : null}
      </section>

      {items.length > 0 ? (
        <section style={{ ...row, paddingBottom: 6 }}>
          <p className="label">Dans l’assiette</p>
          <div className="stack">
            {items.map((item, index) => (
              <div key={`${item.label}-${index}`} className="spread">
                <span style={{ fontSize: 14, flex: 1, minWidth: 0 }}>
                  {item.label}
                  {/* Dire avant l'enregistrement ce qui ne sera pas compté, plutôt
                      que de le découvrir après coup sur un badge « à vérifier ». */}
                  {item.foodId === null ? (
                    <span className="meta" style={{ display: 'block' }}>
                      aliment non rattaché — sans valeurs nutritionnelles
                    </span>
                  ) : item.grams === null ? (
                    <span className="meta" style={{ display: 'block' }}>
                      quantité à préciser — sans elle, l’aliment n’est pas compté
                    </span>
                  ) : null}
                </span>
                <GramsInput
                  value={item.grams}
                  label={item.label}
                  resetKey={`${item.label}-${index}`}
                  onCommit={(grams) =>
                    setItems((current) =>
                      current.map((draft, i) => (i === index ? { ...draft, grams } : draft)),
                    )
                  }
                />
                <button type="button" className="appbar__action"
                        style={{ color: 'var(--text-muted)' }}
                        aria-label={`Retirer ${item.label}`}
                        onClick={() => setItems((c) => c.filter((_, i) => i !== index))}>
                  <IconClose size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
                color: option === slot ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              {SLOT_WHEN[option]}
            </button>
          ))}
        </div>
      </section>

      <section style={{ ...row, paddingBottom: 14 }}>
        <WhoWasThere members={members} present={present} onToggle={toggle}
                     guestCount={guestCount} onGuestCount={setGuestCount} />
      </section>

      <section style={row}>
        {error !== null ? (
          <p style={{ fontSize: 13, color: 'var(--text-warning)', marginBottom: 8 }}>{error}</p>
        ) : null}
        <button type="button" className="btn" disabled={saving || present.size === 0 || items.length === 0}
                onClick={() => { void save(); }}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
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

const resultRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  width: '100%', padding: '9px 2px', background: 'none', border: 0,
  borderBottom: '.5px solid var(--border)', textAlign: 'left', cursor: 'pointer',
};
