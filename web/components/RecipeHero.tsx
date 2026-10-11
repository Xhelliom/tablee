/**
 * Le hero d'une recette : l'image en grand en tête de page, le titre en
 * affichage dessous.
 *
 * ── Pourquoi ce composant existe ───────────────────────────────────────────
 *
 * Deux écrans ouvrent une recette — la confirmation d'un partage Jow
 * (`Share.tsx`) et la fiche d'un repas (`MealDetail.tsx`) — et tous deux
 * montraient la même vignette 54×54 à côté du titre. L'image d'un plat, la
 * photo Jow comme le dessin de l'IA, est ce qu'on vient voir : elle passe en
 * grand, en haut de la page.
 *
 * Elle reprend la langue de la carte de l'accueil : l'image en aplat, coins
 * arrondis, sans cadre. Ouvrir une recette déplie la carte qu'on venait de
 * taper — le hero naît de là où l'on était (cohérence spatiale), et le titre
 * prend sa place d'affichage, en serif 28 px (§8ter).
 *
 * Sans image, le bol dessiné occupe la même surface : la page ne saute pas
 * quand Jow n'a rien rendu ou que le modèle n'existe pas encore.
 */
import { IconBowl } from '../icons.tsx';

export function RecipeHero({
  imageUrl, title, children,
}: {
  imageUrl: string | null;
  title: string;
  /** Ce qui suit le titre : date, badge de confiance, ingrédients… */
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="hero apparait">
      <div className="hero__photo">
        {imageUrl !== null ? (
          <img src={imageUrl} alt="" />
        ) : (
          <span className="hero__vide"><IconBowl size={46} /></span>
        )}
      </div>
      {/* Le titre est un moment d'affichage, pas une ligne de liste. */}
      <p className="hero__titre">{title}</p>
      {children}
    </section>
  );
}