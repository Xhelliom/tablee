/**
 * L'écran d'ajout rapide — le levier anti-friction du §5 et du §6bis.
 *
 * Ordre imposé par l'usage réel, pas par la richesse des fonctions :
 *
 *   1. **Habituels** — le petit-déj est identique tous les matins. Un tap.
 *   2. **Restes de…** — les plats des 3 derniers jours dont il reste quelque
 *      chose. Sans cette affordance, les restes ne sont jamais saisis et les
 *      déjeuners restent vides.
 *   3. **Coller un lien Jow** — la même chaîne que `/share`, pour quand la
 *      feuille de partage d'Android n'est pas là : ordinateur, navigateur sans
 *      PWA installée, ou recette reçue par message.
 *   4. Décrire son plat (ou, sans IA, chercher un aliment), puis saisie
 *      manuelle.
 *
 * « Si tu dois arbitrer entre un calcul plus fin et un tap de moins, prends le
 * tap de moins. »
 *
 * ⚠️ Redessiné le 15/09/2026 — l'ordre ci-dessus n'a pas bougé, la forme si.
 * Quatre titres gris de 12 px se ressemblaient tous ; les états vides des
 * raccourcis passaient devant les vraies portes d'entrée, dessinées comme des
 * champs de saisie grisés ; et « Manuel » ouvrait le même écran que « Décrire
 * son plat ». Désormais : un titre d'affichage, comme sur l'accueil ; les
 * raccourcis d'un tap seulement quand ils existent ; et chaque façon d'ajouter
 * dans une liste groupée, avec une ligne qui dit où elle mène.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  api, type Meal, type MealTemplate, type TemplateSuggestion,
} from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { dishTitle, leftoverDetail } from '../components/Leftovers.tsx';
import {
  IconBowl, IconCamera, IconChevron, IconFridge, IconLink, IconPencil, IconSearch, IconStar,
} from '../icons.tsx';
import { SLOT_LABELS, SLOT_WHEN, currentSlot } from '../design/vocabulary.ts';
import { FreeTextEntry } from './FreeTextEntry.tsx';
import { JowLink } from './JowLink.tsx';
import { Recipes } from './Recipes.tsx';

export function QuickAddScreen(): React.ReactElement {
  const { ia } = useSession();
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [leftovers, setLeftovers] = useState<Meal[]>([]);
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([]);
  /**
   * Rien sous le titre avant la réponse : les raccourcis arrivent au-dessus des
   * portes d'entrée, et les pousseraient sous le doigt au moment du tap.
   */
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'menu' | 'manuel' | 'lien' | 'recettes'>('menu');
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

  useEffect(() => {
    void load().catch(() => setError('chargement impossible')).finally(() => setLoaded(true));
  }, [load]);

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

  const makeTemplate = async (suggestion: TemplateSuggestion): Promise<void> => {
    await api.post('/api/templates', {
      mealId: suggestion.mealId,
      name: suggestion.labels.slice(0, 2).join(', ') || SLOT_LABELS[suggestion.slot],
    });
    await load();
  };

  if (mode === 'manuel') return <FreeTextEntry onClose={() => setMode('menu')} />;
  if (mode === 'lien') return <JowLink onClose={() => setMode('menu')} />;
  if (mode === 'recettes') return <Recipes onClose={() => setMode('menu')} />;

  return (
    <div className="app">
      <ModalHeader title="Ajouter un repas" onClose={() => navigate('/')} />

      {/* Le sur-titre dit le créneau que prendront les raccourcis d'un tap. */}
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">{SLOT_WHEN[currentSlot()]}</p>
        <p className="display" style={{ marginTop: 6, fontSize: 28 }}>
          {'Qu’y avait-il\nau menu ?'}
        </p>
      </div>

      {error !== null ? (
        <div className="sec" style={{ paddingTop: 14 }}>
          <p style={{
            fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--bg-warning)', color: 'var(--text-warning)',
          }}>
            {error}
          </p>
        </div>
      ) : null}

      {loaded ? (
        <>
          {templates.length > 0 || suggestions.length > 0 ? (
            <Section title="Habituels">
              {templates.length > 0 ? (
                <div className="grid2">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="card tuile"
                      onClick={() => { void applyTemplate(template); }}
                      disabled={busy}
                      style={{ padding: 12, textAlign: 'left', cursor: 'pointer', width: '100%' }}
                    >
                      <span style={{ ...pastille, width: 30, height: 30, borderRadius: 8 }}>
                        <IconStar size={16} />
                      </span>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 500, lineHeight: 1.3, marginTop: 10 }}>
                        {template.name}
                      </span>
                      <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                        {template.useCount === 0 ? 'Jamais utilisé' : `Utilisé ${template.useCount} fois`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* V2 — « ce repas revient souvent, en faire un habituel ? » Le
                  pointillé dessine la place de la tuile qu'il deviendrait. */}
              {suggestions.map((suggestion) => (
                <div key={suggestion.mealId} style={{
                  display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px',
                  marginTop: templates.length > 0 ? 8 : 0,
                  border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)',
                }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, lineHeight: 1.3 }}>
                      {suggestion.labels.slice(0, 3).join(', ') || SLOT_LABELS[suggestion.slot]}
                    </span>
                    <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                      Enregistré {suggestion.occurrences} fois ce mois-ci
                    </span>
                  </span>
                  <button type="button" className="chip"
                          style={{
                            flexShrink: 0, cursor: 'pointer',
                            background: 'var(--coral-50)', color: 'var(--coral-600)',
                          }}
                          onClick={() => { void makeTemplate(suggestion); }}>
                    En faire un habituel
                  </button>
                </div>
              ))}
            </Section>
          ) : null}

          {leftovers.length > 0 ? (
            <Section title="Restes de…">
              <div className="card groupe">
                {leftovers.map((meal) => (
                  <Porte
                    key={meal.id}
                    icon={meal.imageUrl !== null ? (
                      <img src={meal.imageUrl} alt="" style={{ ...pastille, objectFit: 'cover' }} />
                    ) : <span style={pastille}><IconFridge size={18} /></span>}
                    title={dishTitle(meal)}
                    detail={leftoverDetail(meal)}
                    disabled={busy}
                    onClick={() => navigate(`/restes/${meal.id}`)}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Recettes">
            {/* Devant le collage : ce qui est déjà connu se rejoue sans réseau, et
                c'est le cas le plus fréquent une fois quelques plats enregistrés. */}
            <div className="card groupe">
              <Porte
                icon={<span style={pastille}><IconBowl size={18} /></span>}
                title="Mes recettes"
                detail="Celles que le foyer connaît déjà"
                onClick={() => setMode('recettes')}
              />
              <Porte
                icon={<span style={pastille}><IconLink size={18} /></span>}
                title="Coller un lien Jow"
                detail="Ou, depuis Jow : « Partager », puis Tablée"
                onClick={() => setMode('lien')}
              />
            </div>
          </Section>

          <Section title="Sans recette">
            {/* « Manuel » n'a plus sa ligne : il ouvrait ce même écran, où la
                saisie à la main se trouve sous la description. */}
            <div className="card groupe">
              <Porte
                icon={<span style={pastille}>{ia ? <IconPencil size={18} /> : <IconSearch size={18} />}</span>}
                title={ia ? 'Décrire son plat' : 'Chercher un aliment'}
                detail={ia
                  ? 'L’IA le découpe, ou aliment par aliment'
                  : 'Aliment par aliment, avec les quantités'}
                onClick={() => setMode('manuel')}
              />
              <Porte
                icon={<span style={pastille}><IconCamera size={18} /></span>}
                title="Photo"
                detail="Bientôt"
                disabled
              />
            </div>
          </Section>

          {templates.length === 0 ? (
            <p className="meta sec" style={{ paddingTop: 18, lineHeight: 1.5 }}>
              Un repas qui revient souvent&nbsp;? Depuis son détail, « En faire un
              habituel » le place en haut de cet écran&nbsp;: un tap suffira ensuite.
            </p>
          ) : null}
        </>
      ) : null}
      <div className="fab-space" />
    </div>
  );
}

/** Une ligne de liste groupée : une pastille, ce qu'elle fait, où elle mène. */
function Porte({ icon, title, detail, onClick, disabled = false }: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick?: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button type="button" className="row porte" onClick={onClick} disabled={disabled}>
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, lineHeight: 1.3 }}>{title}</span>
        <span className="meta" style={{ display: 'block', marginTop: 2, lineHeight: 1.4 }}>{detail}</span>
      </span>
      {disabled ? null : <IconChevron size={17} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="sec" style={{ paddingTop: 22 }}>
      <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

/** Le terracotta discret des portes d'entrée — la marque, jamais un nutriment. */
const pastille: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--coral-50)', color: 'var(--coral-600)',
};
