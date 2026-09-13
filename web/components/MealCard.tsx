/**
 * Une carte de repas.
 *
 * Deux formats, pas une grille uniforme : une carte héros avec photo pour le
 * plat du jour, une vignette pour le reste. « Une grille uniforme ne dit pas
 * ce qui compte » (§8ter).
 *
 * Les aplats colorés sont des placeholders pour les photos Jow
 * (`recipe.image_url`). Une fois la photo en place, le terracotta recule de la
 * zone d'image et reste sur le chrome, sinon l'écran devient orange sur orange.
 */
import type { Meal } from '../api.ts';
import { IconBowl, IconLeaf } from '../icons.tsx';
import { SLOT_LABELS } from '../design/vocabulary.ts';

interface Props {
  meal: Meal;
  hero?: boolean;
  seasonalCount?: number;
  onOpen: (id: string) => void;
}

export function MealCard({ meal, hero = false, seasonalCount = 0, onOpen }: Props): React.ReactElement {
  const title = meal.recipe?.title ?? mealTitle(meal);
  const who = describeWho(meal);

  if (!hero) {
    return (
      <button type="button" className="card row" onClick={() => onOpen(meal.id)}>
        {meal.recipe?.imageUrl != null ? (
          <img className="thumb" src={meal.recipe.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="thumb"><IconBowl size={22} /></span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, display: 'block' }}>{title}</span>
          <span className="meta" style={{ display: 'block' }}>
            {SLOT_LABELS[meal.slot]} · {who}
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="card"
      onClick={() => onOpen(meal.id)}
      style={{ overflow: 'hidden', borderRadius: 14, padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        height: 118, background: 'var(--green-100)', color: 'var(--green-900)',
      }}>
        {meal.recipe?.imageUrl != null ? (
          <img src={meal.recipe.imageUrl} alt=""
               style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <IconBowl size={40} />
        )}
        {seasonalCount > 0 ? (
          <span style={{
            position: 'absolute', top: 10, left: 10, fontSize: 11, padding: '3px 9px',
            borderRadius: 999, background: 'var(--green-900)', color: 'var(--green-100)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <IconLeaf size={12} />
            {seasonalCount} {seasonalCount > 1 ? 'produits' : 'produit'} de saison
          </span>
        ) : null}
      </span>
      <span style={{ display: 'block', padding: '13px 14px' }}>
        <span style={{ fontSize: 17, display: 'block' }}>{title}</span>
        <span className="meta" style={{ display: 'block', marginTop: 4 }}>
          {SLOT_LABELS[meal.slot]} · {who}
        </span>
      </span>
    </button>
  );
}

/** Un repas sans recette se nomme par ce qu'il contient. */
function mealTitle(meal: Meal): string {
  if (meal.items.length === 0) return SLOT_LABELS[meal.slot];
  return meal.items.slice(0, 3).map((item) => item.label).join(', ');
}

/**
 * « toute la famille » quand tout le monde y était, sinon les prénoms. Plus
 * court à lire, et c'est l'information utile.
 */
function describeWho(meal: Meal): string {
  const names = meal.participants.map((p) => p.firstName);
  if (names.length === 0) return 'personne d’enregistré';
  if (names.length >= 4) return 'toute la famille';
  const withGuests = meal.guestCount > 0
    ? `${names.join(', ')} + ${meal.guestCount} invité${meal.guestCount > 1 ? 's' : ''}`
    : names.join(', ');
  return withGuests;
}
