/**
 * Ce que voit quelqu'un qui ouvre Tablée sans session.
 *
 * Jusqu'au 15/09/2026, c'était le formulaire de connexion. Pour qui reçoit
 * l'adresse d'un ami, une porte fermée qui ne dit rien de ce qu'il y a
 * derrière : on demandait un mot de passe avant d'avoir dit à quoi il servait.
 * La page dit ce que fait l'app, puis mène à la connexion — un tap de plus pour
 * qui a déjà un compte, et c'est le prix assumé.
 *
 * Ce qu'elle refuse :
 *
 *   **Aucun bilan d'exemple.** Des barres « pour de faux » seraient des valeurs
 *   nutritionnelles sans source, et les couleurs de nutriments posées sur autre
 *   chose qu'une donnée (§8ter). L'exemple montre des assiettes de tailles
 *   différentes : c'est le partage qui distingue Tablée, pas un chiffre.
 *
 *   **Une promesse que l'app ne tient pas.** Les parts de l'exemple sont celles
 *   que propose `suggestedCoef`, et ce que l'IA ne voit pas est dit avec ses
 *   trous (dette n° 17) : les prénoms *enregistrés* sont retirés, pas tous.
 *
 * `/share` et `/invitation/…` n'y passent pas : ils ouvrent la connexion
 * directement, pour ne pas perdre ce qu'on était venu finir (`App.tsx`).
 */
import type { ReactElement } from 'react';
import { navigate } from '../router.tsx';
import { IconBowl, IconCheck } from '../icons.tsx';
import { Avatar } from '../components/Avatar.tsx';

/** Les parts suivent `suggestedCoef` : une dès 13 ans, trois quarts de 8 à 12, une demie avant. */
const TABLÉE = [
  { graine: 'tablee-exemple-1', qui: 'Adulte', part: 1, portion: 'une part' },
  { graine: 'tablee-exemple-2', qui: 'Adulte', part: 1, portion: 'une part' },
  { graine: 'tablee-exemple-3', qui: '10 ans', part: 0.75, portion: '¾ de part' },
  { graine: 'tablee-exemple-4', qui: '6 ans', part: 0.5, portion: '½ part' },
];

const ÉTAPES = [
  {
    titre: 'Partagez la recette',
    texte: 'Depuis Jow, envoyez-la à Tablée ou collez son lien : ingrédients et valeurs arrivent avec. Un plat maison s’ajoute aussi, aliment par aliment.',
  },
  {
    titre: 'Dites qui était à table',
    texte: 'Le plat se répartit entre les assiettes, selon l’âge et la portion de chacun. Les restes se retrouvent au frigo, pour un prochain repas.',
  },
  {
    titre: 'Regardez chaque assiette',
    texte: 'Chacun a son bilan du jour — protéines, glucides, lipides, fibres, part végétale —, rapporté au repère de son âge.',
  },
];

const PRINCIPES = [
  'Pas de calories à compter, pas d’objectif à tenir : on regarde la qualité et la variété.',
  'Aucune note, aucune série, aucun classement. Un bilan n’est pas un score.',
  'Quand l’IA est proposée, elle ne voit pas les fiches de la famille : ni date de naissance, ni allergie, et les prénoms enregistrés sont retirés avant l’envoi.',
];

export function LandingScreen(): ReactElement {
  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
      </header>

      <main>
        <section className="accroche">
          <h1 className="display apparait">Un plat,<br />chacun sa part.</h1>
        </section>

        <div className="sec">
          <Exemple />
          <p className="vitrine__chapo apparait" style={{ animationDelay: '120ms' }}>
            Tablée suit ce que mange la famille. Partagez une recette, dites qui
            était à table : le plat se répartit selon l’âge et la portion de
            chacun, et chaque assiette a son bilan.
          </p>
          <Entrer />
        </div>

        <section className="sec vitrine__bloc" aria-labelledby="vitrine-temps">
          <p className="eyebrow">Comment ça marche</p>
          <h2 id="vitrine-temps" className="vitrine__titre">En trois temps</h2>
          <ol className="etapes">
            {ÉTAPES.map(({ titre, texte }, i) => (
              <li key={titre}>
                <span className="etapes__num" aria-hidden="true">{i + 1}</span>
                <div>
                  <p className="etapes__titre">{titre}</p>
                  <p className="etapes__texte">{texte}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="sec vitrine__bloc" aria-labelledby="vitrine-compter">
          <p className="eyebrow">Ce que Tablée ne fait pas</p>
          <h2 id="vitrine-compter" className="vitrine__titre">Sans compter</h2>
          <ul className="card principes">
            {PRINCIPES.map((texte) => (
              <li key={texte}>
                <span className="principes__coche"><IconCheck size={13} /></span>
                {texte}
              </li>
            ))}
          </ul>
        </section>

        <section className="sec vitrine__bloc vitrine__fin" aria-labelledby="vitrine-table">
          <h2 id="vitrine-table" className="vitrine__titre">À table ?</h2>
          <p className="vitrine__texte">
            Chaque adulte a son compte ; les enfants sont à table sans en avoir
            besoin. Le foyer se crée juste après l’inscription, et les autres
            adultes s’y invitent d’un lien.
          </p>
          <Entrer />
          <p className="meta" style={{ marginTop: 22, lineHeight: 1.6 }}>
            Tablée est auto-hébergée : les repas et les fiches de la famille vivent
            sur le serveur de la personne qui l’installe.
          </p>
        </section>
      </main>
    </div>
  );
}

/**
 * Un repas du soir, vu comme l'app le pense : un plat, et une part par
 * assiette. Les parts se servent l'une après l'autre — c'est l'explication,
 * et on ne la voit qu'une fois.
 */
function Exemple(): ReactElement {
  return (
    <figure className="card exemple apparait" style={{ animationDelay: '60ms' }}>
      <div className="exemple__photo" aria-hidden="true">
        <IconBowl size={36} />
        <span className="exemple__tag">Partagé depuis Jow</span>
      </div>
      <div style={{ padding: '13px 14px 16px' }}>
        <p style={{ fontSize: 17 }}>Gratin de courgettes</p>
        <p className="meta" style={{ marginTop: 3 }}>Ce soir · qui était à table ?</p>
        <ul className="exemple__tablee">
          {TABLÉE.map(({ graine, qui, part, portion }, i) => (
            <li key={graine}>
              <span className="assiette" aria-hidden="true">
                {/* La racine : c'est la surface qui se compare à l'œil, pas le diamètre. */}
                <span
                  className="assiette__part"
                  style={{ transform: `scale(${Math.sqrt(part)})`, animationDelay: `${320 + i * 90}ms` }}
                />
                <span className="assiette__convive"><Avatar seed={graine} size={22} /></span>
              </span>
              <span style={{ fontSize: 13 }}>{qui}</span>
              <span className="meta">{portion}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

function Entrer(): ReactElement {
  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <button type="button" className="btn" onClick={() => navigate('/connexion?inscription')}>
        Créer un compte
      </button>
      <button type="button" className="btn btn--quiet" onClick={() => navigate('/connexion')}>
        J’ai déjà un compte
      </button>
    </div>
  );
}
