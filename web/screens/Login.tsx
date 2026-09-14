/**
 * Connexion et inscription.
 *
 * Le §7 a été renversé : chacun son compte, et l'inscription est **ouverte** —
 * des amis doivent pouvoir créer leur foyer sans passer par l'hébergeur (§16).
 *
 * Un seul écran pour les deux gestes, parce que la question « ai-je déjà un
 * compte ? » n'a pas à coûter une navigation. Le formulaire change, pas la
 * page. Le mot de passe oublié en est un troisième, pour la même raison.
 *
 * Google, quand l'instance l'a branché (`GOOGLE_CLIENT_ID`) : un bouton qui
 * vaut connexion et inscription à la fois, puisque c'est Google qui sait si le
 * compte existe. Il quitte la page, et y revient avec `?error=…` quand la
 * connexion n'a pas abouti.
 *
 * `ResetPasswordScreen` — la page qu'ouvre le lien de réinitialisation reçu
 * par mail. Elle n'existe que sur une instance qui en envoie (`TABLEE_MAIL`) ;
 * ailleurs, le serveur refuse la demande et l'écran dit à qui s'adresser.
 */
import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { navigate, useRoute } from '../router.tsx';
import { useSession } from '../session.tsx';
import { IconBowl } from '../icons.tsx';
// Le seul import du serveur : une expurgation I6, pas deux qui divergeraient.
import { redactRequestUrl } from '../../server/jow/share.ts';

/** Même minimum que le serveur. Le dire avant, pas après le refus. */
const MIN_MOT_DE_PASSE = 12;

type Mode = 'connexion' | 'inscription' | 'oubli';

export function LoginScreen(): React.ReactElement {
  const { signIn, signUp, google } = useSession();
  const { query } = useRoute();
  const [mode, setMode] = useState<Mode>('connexion');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => erreurGoogle(query.get('error')));
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inscription = mode === 'inscription';
  const oubli = mode === 'oubli';

  const changer = (suivant: Mode): void => {
    setMode(suivant);
    setError(null);
    setInfo(null);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (oubli) {
        await api.post('/api/auth/request-password-reset', { email, redirectTo: '/reinitialiser' });
        // La même phrase que le compte existe ou non : le serveur ne le dit
        // pas, l'écran non plus.
        setInfo('Si un compte existe avec cette adresse, un lien vient de partir. Il vaut une heure.');
        setBusy(false);
      } else if (inscription) {
        if (await signUp(email, password, name.trim())) {
          setMode('connexion');
          setPassword('');
          setInfo(`Un lien de confirmation vient de partir à ${email}. Ouvrez-le pour entrer.`);
          setBusy(false);
        }
      } else {
        await signIn(email, password);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? messageLisible(cause, mode)
          : inscription
            ? 'inscription impossible'
            : 'connexion impossible',
      );
      setBusy(false);
    }
  };

  // Pas de `busy` ici : la page s'en va, et un retour arrière depuis Google la
  // ressortirait du cache avec un bouton resté grisé.
  const avecGoogle = async (): Promise<void> => {
    setError(null);
    setInfo(null);
    try {
      // L'URL entière, pour qu'un partage Jow reçu sans session survive à
      // l'aller-retour. better-auth la garde en base le temps de celui-ci, et
      // le texte partagé porte les jetons `key` et `userId` (I6) : ils partent
      // avant. L'identifiant de recette, seul utile au serveur, reste.
      const retour = redactRequestUrl(window.location.pathname + window.location.search);
      const { url } = await api.post<{ url: string }>('/api/auth/sign-in/social', {
        provider: 'google', callbackURL: retour, errorCallbackURL: retour,
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'connexion impossible');
    }
  };

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
      </header>

      <div className="sec" style={{ paddingTop: 28 }}>
        <p className="display">
          {inscription ? <>Bienvenue<br />à table</> : oubli ? <>Mot de passe<br />oublié</> : <>Bonjour<br />la maison</>}
        </p>
        <p className="meta" style={{ marginTop: 10 }}>
          {inscription
            ? 'Un compte par personne. Le foyer se crée juste après.'
            : oubli
              ? 'Un lien part à votre adresse pour en choisir un nouveau.'
              : 'Le suivi alimentaire de la famille, un plat à la fois.'}
        </p>

        <form onSubmit={(e) => { void submit(e); }} style={{ marginTop: 24 }} className="stack">
          {inscription ? (
            <div>
              <label className="label" htmlFor="name">Votre prénom</label>
              <input
                id="name" className="field" value={name} autoComplete="given-name"
                onChange={(e) => setName(e.target.value)} required
              />
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="email">Adresse e-mail</label>
            <input
              id="email" className="field" type="email" value={email}
              autoComplete={inscription ? 'email' : 'username'}
              onChange={(e) => setEmail(e.target.value)} required
            />
          </div>

          {oubli ? null : (
            <div>
              <label className="label" htmlFor="password">Mot de passe</label>
              <input
                id="password" className="field" type="password" value={password}
                autoComplete={inscription ? 'new-password' : 'current-password'}
                minLength={inscription ? MIN_MOT_DE_PASSE : undefined}
                onChange={(e) => setPassword(e.target.value)} required
              />
              {inscription ? (
                <p className="meta" style={{ marginTop: 6 }}>
                  {MIN_MOT_DE_PASSE} caractères au moins.
                </p>
              ) : null}
            </div>
          )}

          {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p> : null}
          {info !== null ? <p className="meta" style={{ lineHeight: 1.6 }}>{info}</p> : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy
              ? 'Un instant…'
              : inscription ? 'Créer mon compte' : oubli ? 'Recevoir un lien' : 'Entrer'}
          </button>
        </form>

        {google && !oubli ? (
          <button
            type="button" className="btn btn--ghost" style={{ marginTop: 14 }}
            disabled={busy} onClick={() => { void avecGoogle(); }}
          >
            Continuer avec Google
          </button>
        ) : null}

        {mode === 'connexion' ? (
          <button
            type="button" className="btn btn--quiet" style={{ marginTop: 14 }}
            onClick={() => changer('oubli')}
          >
            Mot de passe oublié
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn--quiet"
          style={{ marginTop: 14 }}
          onClick={() => changer(mode === 'connexion' ? 'inscription' : 'connexion')}
        >
          {mode === 'connexion' ? 'Créer un compte' : 'J’ai déjà un compte'}
        </button>
      </div>
    </div>
  );
}

/**
 * Les messages de better-auth sont en anglais et parlent de « credentials ».
 * Les cas qui arrivent vraiment méritent une phrase qui aide.
 */
function messageLisible(error: ApiError, mode: Mode): string {
  if (error.code === 'EMAIL_NOT_VERIFIED') {
    return 'Votre adresse n’est pas encore confirmée : un nouveau lien vient de partir.';
  }
  if (error.code === 'RESET_PASSWORD_DISABLED') {
    return 'Cette installation n’envoie pas de mail. Demandez à la personne qui l’héberge de changer votre mot de passe.';
  }
  if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD') {
    return 'Adresse ou mot de passe incorrect.';
  }
  if (error.status === 422 || /exist/i.test(error.message)) {
    return mode === 'inscription'
      ? 'Un compte existe déjà avec cette adresse.'
      : error.message;
  }
  return error.message;
}

/**
 * Ce que Google laisse dans `?error=…` en ramenant sur la page.
 * `access_denied`, c'est la personne qui a renoncé chez Google : rien à dire.
 */
function erreurGoogle(code: string | null): string | null {
  if (code === null || code === 'access_denied') return null;
  if (code === 'account_not_linked') {
    return 'Un compte existe déjà avec cette adresse. Entrez avec votre mot de passe, puis liez Google depuis votre profil.';
  }
  return 'La connexion avec Google n’a pas abouti. Réessayez, ou entrez avec votre adresse.';
}

// ── Le lien reçu par mail ───────────────────────────────────────────────────

const LIEN_PÉRIMÉ = 'Ce lien n’est plus valable. Redemandez-en un depuis l’écran de connexion.';

export function ResetPasswordScreen(): React.ReactElement {
  const { query } = useRoute();
  // better-auth a déjà vérifié le jeton avant de rediriger ici : il pose
  // `token` s'il est bon, `error` sinon.
  const token = query.get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(token === null ? LIEN_PÉRIMÉ : null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset-password', { newPassword: password, token });
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'INVALID_TOKEN'
          ? LIEN_PÉRIMÉ
          : cause instanceof ApiError ? cause.message : 'changement impossible',
      );
    }
    setBusy(false);
  };

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
      </header>

      <div className="sec" style={{ paddingTop: 28 }}>
        <p className="display">Nouveau<br />mot de passe</p>

        {done ? (
          <>
            <p className="meta" style={{ marginTop: 10, lineHeight: 1.6 }}>
              C’est fait. Vos autres appareils ont été déconnectés.
            </p>
            <button className="btn" style={{ marginTop: 24 }} onClick={() => navigate('/', { replace: true })}>
              Me connecter
            </button>
          </>
        ) : (
          <form onSubmit={(e) => { void submit(e); }} style={{ marginTop: 24 }} className="stack">
            <div>
              <label className="label" htmlFor="new-password">Mot de passe</label>
              <input
                id="new-password" className="field" type="password" value={password}
                autoComplete="new-password" minLength={MIN_MOT_DE_PASSE}
                onChange={(e) => setPassword(e.target.value)} required disabled={token === null}
              />
              <p className="meta" style={{ marginTop: 6 }}>
                {MIN_MOT_DE_PASSE} caractères au moins.
              </p>
            </div>

            {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p> : null}

            <button className="btn" type="submit" disabled={busy || token === null}>
              {busy ? 'Un instant…' : 'Enregistrer'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
