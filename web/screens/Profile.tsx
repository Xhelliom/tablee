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
 * compte : il ne suit pas la personne d'un téléphone à l'autre. La liaison
 * Google, elle, en est partie le 14/09/2026 pour venir ici : c'est le compte
 * qu'on lie, pas le foyer.
 */
import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { api, ApiError } from '../api.ts';
import { navigate, useRoute } from '../router.tsx';
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

      <ConnexionGoogle />

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

/**
 * Lier Google à un compte ouvert par mot de passe, pour entrer ensuite d'un tap.
 *
 * C'est la porte des comptes que la connexion Google refuse de relier d'elle-
 * même : une adresse jamais confirmée — sans `TABLEE_MAIL`, toutes. Ici la
 * session prouve le compte et Google prouve le sien, si bien que les deux
 * adresses peuvent différer. Sur un appareil sans session, le mot de passe
 * continue de marcher : lier n'enlève rien.
 *
 * Tout passe par better-auth (`link-social`, `list-accounts`) : la liaison
 * pose une ligne `account` sur le compte connecté, et c'est elle que
 * « Continuer avec Google » retrouve ensuite — pas de second compte.
 */
function ConnexionGoogle(): ReactElement | null {
  const { google } = useSession();
  const { query } = useRoute();
  const [lié, setLié] = useState<boolean | null>(null);
  // Google ramène ici avec `?error=…` quand la liaison n'a pas abouti.
  const [error, setError] = useState<string | null>(() => erreurLiaison(query.get('error')));

  useEffect(() => {
    if (!google) return;
    void api.get<{ providerId: string }[]>('/api/auth/list-accounts')
      .then((comptes) => setLié(comptes.some((c) => c.providerId === 'google')))
      .catch(() => setLié(null));
  }, [google]);

  if (!google || lié === null) return null;

  const lier = async (): Promise<void> => {
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>('/api/auth/link-social', {
        provider: 'google', callbackURL: '/profil', errorCallbackURL: '/profil',
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'liaison impossible');
    }
  };

  return (
    <section className="sec">
      <h2 className="eyebrow">Connexion avec Google</h2>
      {lié ? (
        <p className="meta" style={{ lineHeight: 1.6 }}>
          Votre compte Google est lié : « Continuer avec Google » vous fait
          entrer d’un tap.
        </p>
      ) : (
        <>
          <p className="meta" style={{ marginBottom: 12, lineHeight: 1.6 }}>
            Aucun compte Google n’est lié. Liez-en un pour entrer d’un tap ;
            votre mot de passe continue de marcher.
          </p>
          <button type="button" className="btn btn--ghost" onClick={() => { void lier(); }}>
            Lier mon compte Google
          </button>
        </>
      )}
      {error !== null ? (
        <p style={{ fontSize: 13, color: 'var(--text-warning)', marginTop: 10 }}>{error}</p>
      ) : null}
    </section>
  );
}

/** `access_denied`, c'est la personne qui a renoncé chez Google : rien à dire. */
function erreurLiaison(code: string | null): string | null {
  if (code === null || code === 'access_denied') return null;
  if (code === 'account_already_linked_to_different_user') {
    return 'Ce compte Google est déjà lié à un autre compte Tablée.';
  }
  return 'La liaison avec Google n’a pas abouti. Réessayez.';
}

function Ligne({ libellé, children }: { libellé: string; children: ReactNode }): ReactElement {
  return (
    <div className="spread" style={{ padding: '10px 0' }}>
      <dt className="meta">{libellé}</dt>
      <dd style={{ margin: 0, fontSize: 14, textAlign: 'right' }}>{children}</dd>
    </div>
  );
}
