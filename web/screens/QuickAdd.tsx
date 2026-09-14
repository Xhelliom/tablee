/**
 * L'écran d'ajout rapide — le levier anti-friction du §5 et du §6bis.
 *
 * Ordre imposé par l'usage réel, pas par la richesse des fonctions :
 *
 *   1. **Habituels** — le petit-déj est identique tous les matins. Un tap.
 *   2. **Restes de…** — les repas des 3 derniers jours ayant une recette.
 *      Sans cette affordance, les restes ne sont jamais saisis et les déjeuners
 *      restent vides.
 *   3. **Coller un lien Jow** — la même chaîne que `/share`, pour quand la
 *      feuille de partage d'Android n'est pas là : ordinateur, navigateur sans
 *      PWA installée, ou recette reçue par message.
 *   4. Recherche texte, puis saisie manuelle.
 *
 * « Si tu dois arbitrer entre un calcul plus fin et un tap de moins, prends le
 * tap de moins. »
 */
import { useCallback, useEffect, useState } from 'react';
import {
  api, type Meal, type MealTemplate, type TemplateSuggestion,
} from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import {
  IconCamera, IconChevron, IconFridge, IconLink, IconPencil, IconSearch, IconStar,
} from '../icons.tsx';
import { SLOT_LABELS, currentSlot, relativeDay } from '../design/vocabulary.ts';
import { FreeTextEntry } from './FreeTextEntry.tsx';
import { JowLink } from './JowLink.tsx';

export function QuickAddScreen(): React.ReactElement {
  const { eaters } = useSession();
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [leftovers, setLeftovers] = useState<Meal[]>([]);
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([]);
  const [mode, setMode] = useState<'menu' | 'manuel' | 'lien'>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, l, s] = await Promise.all([
      api.get<{ templates: MealTemplate[] }>('/api/templates'),
      api.get<{ meals: Meal[] }>('/api/meals/leftovers?days=3'),
      api.get<{ suggestions: TemplateSuggestion[] }>('/api/templates/suggestions'),
    ]);
    setTemplates(t.templates);
    setLeftovers(l.meals);
    setSuggestions(s.suggestions);
  }, []);

  useEffect(() => { void load().catch(() => setError('chargement impossible')); }, [load]);

  /** Deux taps depuis l'accueil : ouvrir cet écran, appuyer sur le template. */
  const applyTemplate = async (template: MealTemplate): Promise<void> => {
    setBusy(true);
    try {
      const { meal } = await api.post<{ meal: Meal }>(`/api/templates/${template.id}/apply`, {
        eatenAt: new Date().toISOString(),
        slot: template.slot ?? currentSlot(),
      });
      navigate(`/repas/${meal.id}`, { replace: true });
    } catch {
      setError('le template n’a pas pu être appliqué');
      setBusy(false);
    }
  };

  /**
   * « Restes de… » : un second repas pointant la même recette (§6bis), pas un
   * repas fractionné. Le nombre de parts repart à 1 et les convives sont ceux
   * cochés par défaut — on corrige ensuite si besoin, depuis le détail.
   */
  const logLeftover = async (meal: Meal): Promise<void> => {
    setBusy(true);
    try {
      const { meal: created } = await api.post<{ meal: Meal }>('/api/meals', {
        eatenAt: new Date().toISOString(),
        slot: currentSlot(),
        source: meal.source,
        recipeId: meal.recipe?.id ?? null,
        servings: 1,
        leftoverOf: meal.id,
        participants: eaters.map((m) => ({ eaterId: m.id, present: true })),
      });
      navigate(`/repas/${created.id}`, { replace: true });
    } catch {
      setError('les restes n’ont pas pu être enregistrés');
      setBusy(false);
    }
  };

  const makeTemplate = async (suggestion: TemplateSuggestion): Promise<void> => {
    await api.post('/api/templates', {
      mealId: suggestion.mealId,
      name: suggestion.labels.slice(0, 2).join(', ') || SLOT_LABELS[suggestion.slot],
    });
    await load();
  };

  if (mode === 'manuel') return <FreeTextEntry onClose={() => setMode('menu')} />;
  if (mode === 'lien') return <JowLink onClose={() => setMode('menu')} />;

  return (
    <div className="app">
      <ModalHeader title="Ajouter un repas" onClose={() => navigate('/')} />

      {error !== null ? <p className="empty">{error}</p> : null}

      {/* V2 — « ce repas revient souvent, en faire un bouton ? » */}
      {suggestions.length > 0 ? (
        <div className="sec" style={{ paddingTop: 14 }}>
          {suggestions.map((suggestion) => (
            <div key={suggestion.mealId} className="card"
                 style={{ display: 'flex', gap: 11, padding: '12px 13px', marginBottom: 8 }}>
              <span style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: 'var(--coral-50)', color: 'var(--coral-600)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <IconStar size={18} />
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13 }}>
                  {suggestion.labels.slice(0, 3).join(', ') || SLOT_LABELS[suggestion.slot]}
                </p>
                <p className="meta">Enregistré {suggestion.occurrences} fois ce mois-ci</p>
              </div>
              <button type="button" className="chip"
                      style={{ alignSelf: 'center', cursor: 'pointer' }}
                      onClick={() => { void makeTemplate(suggestion); }}>
                En faire un bouton
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Section title="Habituels">
        {templates.length === 0 ? (
          <p className="meta" style={{ lineHeight: 1.5 }}>
            Aucun pour l’instant. Depuis le détail d’un repas, « En faire un
            habituel » le place ici — un tap suffira ensuite.
          </p>
        ) : (
          <div className="grid2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="card"
                onClick={() => { void applyTemplate(template); }}
                disabled={busy}
                style={{ padding: '12px 11px', textAlign: 'left', cursor: 'pointer' }}
              >
                <p style={{ fontSize: 13, fontWeight: 500 }}>{template.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {template.useCount === 0
                    ? 'Jamais utilisé'
                    : `Utilisé ${template.useCount} fois`}
                </p>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Restes de…">
        {leftovers.length === 0 ? (
          <p className="meta" style={{ lineHeight: 1.5 }}>
            Rien à resservir : aucun plat avec recette ces trois derniers jours.
          </p>
        ) : (
          <div className="stack">
            {leftovers.map((meal) => (
              <button key={meal.id} type="button" className="card row" disabled={busy}
                      onClick={() => { void logLeftover(meal); }}>
                <IconFridge size={18} style={{ color: 'var(--text-secondary)', marginLeft: 4 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, display: 'block' }}>
                    {meal.recipe?.title ?? 'Plat'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {capitalize(relativeDay(meal.eatenAt))} · {trim(meal.servings)} part
                    {meal.servings > 1 ? 's' : ''} préparée{meal.servings > 1 ? 's' : ''}
                  </span>
                </span>
                <IconChevron size={17} style={{ color: 'var(--text-muted)' }} />
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Depuis Jow">
        <button type="button" onClick={() => setMode('lien')} style={entry}>
          <IconLink size={17} />
          <span style={{ fontSize: 14 }}>Coller un lien Jow</span>
        </button>
        <p className="meta" style={{ lineHeight: 1.5 }}>
          Depuis l’app Jow, « Partager » puis Tablée fait la même chose sans
          copier-coller.
        </p>
      </Section>

      <Section title="Autre">
        <button type="button" onClick={() => setMode('manuel')} style={entry}>
          <IconSearch size={17} />
          <span style={{ fontSize: 14 }}>Chercher un aliment</span>
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="card"
                  style={{ ...secondary, opacity: .55, cursor: 'not-allowed' }}
                  disabled
                  title="La saisie par photo arrive en V3">
            <IconCamera size={17} />
            Photo
          </button>
          <button type="button" className="card" style={secondary} onClick={() => setMode('manuel')}>
            <IconPencil size={17} />
            Manuel
          </button>
        </div>
      </Section>
      <div className="fab-space" />
    </div>
  );
}

/** Une porte d'entrée pleine largeur : le lien Jow, la recherche d'aliment. */
const entry: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%',
  padding: '11px 12px', borderRadius: 'var(--radius)',
  border: '.5px solid var(--border-strong)', background: 'var(--surface-2)',
  marginBottom: 8, cursor: 'pointer', color: 'var(--text-muted)',
};

const secondary: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  padding: 10, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer',
};

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="sec" style={{ paddingTop: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

const trim = (value: number): string => String(Math.round(value * 100) / 100);
const capitalize = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1);
