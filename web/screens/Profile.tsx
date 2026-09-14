/**
 * Votre profil : ce que le compte connecté sait de la personne qui le tient.
 *
 * Trois blocs, qui ne se confondent pas : le **compte** — le prénom et
 * l'adresse avec lesquels on entre —, les **foyers** où ce compte a accès et
 * le rôle qu'il y tient, et la **fiche à table** rattachée au compte, s'il en
 * a une. Un compte n'est pas un convive (007) : une nounou a un compte sans
 * fiche, et l'écran le dit au lieu de laisser un trou.
 *
 * Un écran à part, comme « Le foyer », et non un onglet : on y passe rarement,
 * et rien ici ne sert la saisie. On y arrive par le menu du compte.
 *
 * ── Ce que cet écran tait, exprès ───────────────────────────────────────────
 *
 * **Aucune donnée d'une autre personne.** Seule la fiche du compte connecté
 * apparaît. Ses mesures s'affichent datées, jamais comme une cible, et le
 * serveur ne les rend pas sur un profil mineur (I5).
 *
 * **Ce que better-auth garde sans que ça dise rien à la personne** : la photo
 * Google (`user.image`), la date d'inscription, l'adresse confirmée ou non.
 * `/api/me` ne les rend pas, et ce n'est pas un oubli.
 *
 * **Le thème reste sur « Le foyer ».** C'est un réglage de l'appareil, pas du
 * compte : il ne suit pas la personne d'un téléphone à l'autre.
 */
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { coefLabel } from '../components/EaterForm.tsx';
import { dietLabel } from '../design/vocabulary.ts';
import { ÉditionFiche, Mesures } from './Eaters.tsx';

export function ProfileScreen(): ReactElement {
  const { user, household, households, switchHousehold, eaters, refreshEaters } = useSession();
  const [édition, setÉdition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fiche = eaters.find((eater) => eater.isMe) ?? null;

  return (
    <div className="app">
      <ModalHeader title="Votre profil" onClose={() => navigate('/')} />

      <section className="sec" style={{ paddingTop: 18 }}>
        <h2 className="eyebrow">Votre compte</h2>
        <dl className="card" style={{ margin: 0, padding: '2px 15px' }}>
          <Ligne libellé="Prénom">{user?.name}</Ligne>
          <Ligne libellé="Adresse e-mail">{user?.email}</Ligne>
        </dl>
      </section>

      <section className="sec">
        <h2 className="eyebrow">Vos foyers</h2>
        <div className="stack">
          {households.map((foyer) => {
            const ouvert = foyer.id === household?.id;
            return (
              <article key={foyer.id} className="card" style={{ padding: '13px 15px' }}>
                <div className="spread">
                  <div>
                    <p style={{ fontSize: 15 }}>{foyer.name}</p>
                    {ouvert ? <p className="meta" style={{ marginTop: 2 }}>Le foyer ouvert</p> : null}
                  </div>
                  <span className="chip">{foyer.role === 'parent' ? 'Parent' : 'Adulte'}</span>
                </div>
                {ouvert ? null : (
                  <button
                    type="button" className="btn btn--quiet" style={{ marginTop: 12 }}
                    onClick={() => { void switchHousehold(foyer.organizationId ?? ''); }}
                  >
                    Ouvrir ce foyer
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="sec">
        <h2 className="eyebrow">Votre fiche à table</h2>
        {fiche === null ? (
          <>
            <p className="meta" style={{ marginBottom: 12, lineHeight: 1.6 }}>
              Aucune fiche n’est rattachée à votre compte dans ce foyer.
            </p>
            <button type="button" className="btn btn--ghost" onClick={() => navigate('/bienvenue')}>
              Créer ma fiche
            </button>
          </>
        ) : (
          <article className="card" style={{ padding: '2px 15px 14px' }}>
            {édition ? (
              <ÉditionFiche
                eater={fiche}
                onCancel={() => setÉdition(false)}
                onSaved={async () => { setÉdition(false); await refreshEaters(); }}
                onError={setError}
              />
            ) : (
              <>
                <dl style={{ margin: 0 }}>
                  <Ligne libellé="Prénom">{fiche.firstName}</Ligne>
                  <Ligne libellé="Naissance">
                    {fiche.birthDate.split('-').reverse().join('/')} · {fiche.age} ans
                  </Ligne>
                  <Ligne libellé="Sexe">{fiche.sex === 'F' ? 'Féminin' : 'Masculin'}</Ligne>
                  <Ligne libellé="Portion">{coefLabel(fiche.portionCoef)}</Ligne>
                  <Ligne libellé="Régime">
                    {fiche.diets.length > 0 ? fiche.diets.map(dietLabel).join(', ') : 'Aucun'}
                  </Ligne>
                </dl>
                <Mesures eater={fiche} />
                <button
                  type="button" className="btn btn--quiet" style={{ marginTop: 12 }}
                  onClick={() => setÉdition(true)}
                >
                  Modifier ma fiche
                </button>
              </>
            )}
          </article>
        )}
        {error !== null ? (
          <p style={{ fontSize: 13, color: 'var(--text-warning)', marginTop: 10 }}>{error}</p>
        ) : null}
      </section>

      <div className="fab-space" />
    </div>
  );
}

function Ligne({ libellé, children }: { libellé: string; children: ReactNode }): ReactElement {
  return (
    <div className="spread" style={{ padding: '10px 0' }}>
      <dt className="meta">{libellé}</dt>
      <dd style={{ margin: 0, fontSize: 14, textAlign: 'right' }}>{children}</dd>
    </div>
  );
}
