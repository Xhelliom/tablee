/**
 * Le dessin qui désigne une personne — DiceBear, style « Sprouts », CC0 :
 * aucune attribution due. Tiré dans le navigateur à partir d'une graine : rien
 * ne sort du foyer, rien n'est stocké, et il s'affiche hors ligne.
 *
 * ⚠️ Changé le 14/09/2026 — des initiales, puis « Lorelei » (des visages au
 * trait), puis Sprouts à la demande du propriétaire, qui pèse deux fois moins
 * (53 ko contre 118). Deux initiales se confondaient (Léa, Léo), deux dessins
 * non.
 *
 * **Une personne, un dessin, partout.** La graine est l'identifiant de son
 * convive ; celui du compte seulement pour qui n'a pas d'assiette, une nounou
 * par exemple (`accountSeed`). Jamais le prénom : le dessin survit à une
 * correction, et deux Léa de deux foyers n'ont pas le même.
 *
 * Le fond crème remplace ceux de Sprouts, et il est écrit dans l'image. Ses
 * fonds sont des aplats saturés — violet, orange, bleu, vert — qui, posés à
 * côté d'une barre, se liraient comme le code des nutriments (§8ter). Et un
 * fond qui basculerait la nuit ferait disparaître l'encre sombre du dessin :
 * c'est une image, comme une photo Jow, pas un aplat de l'interface. Pour la
 * même raison, le dessin ne va jamais au centre d'un anneau de bilan.
 *
 * Décoratif, d'où `alt=""` : le prénom est toujours écrit à côté, ou porté par
 * le nom accessible de ce qui l'entoure.
 */
import { Avatar as DiceBear, Style } from '@dicebear/core';
import sprouts from '@dicebear/styles/sprouts.json';

const style = new Style(sprouts);
const drawings = new Map<string, string>();

export function Avatar({ seed, size = 22 }: { seed: string; size?: number }): React.ReactElement {
  let uri = drawings.get(seed);
  if (uri === undefined) {
    uri = new DiceBear(style, { seed, backgroundColor: ['#FAECE7'] }).toDataUri();
    drawings.set(seed, uri);
  }
  return (
    <img src={uri} alt="" width={size} height={size} style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, display: 'block',
      border: '.5px solid var(--border-strong)',
    }} />
  );
}

/** Un compte se dessine comme son convive s'il en a un : c'est la même personne. */
export function accountSeed(userId: string, eaters: { id: string; userId: string | null }[]): string {
  return eaters.find((eater) => eater.userId === userId)?.id ?? userId;
}
