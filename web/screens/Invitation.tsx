/**
 * L'invitation, des deux côtés.
 *
 * `AcceptInvitation` — la page qu'ouvre le lien reçu. Elle marche pour
 * quelqu'un qui n'a pas encore de compte : l'écran de connexion s'affiche
 * **sans changer l'URL**, et l'acceptation reprend une fois le compte créé. La
 * même règle que pour `/share` : ne jamais perdre ce que l'utilisateur était en
 * train de faire parce qu'il lui manquait une session.
 *
 * `InviteMembers` — le panneau côté parent. Pas de serveur SMTP ici, et c'est
 * un choix assumé (§16) : l'invitation est un lien qu'on copie et qu'on envoie
 * comme on veut.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession, type Role } from '../session.tsx';
import { IconBowl } from '../icons.tsx';

// ── Côté invité ─────────────────────────────────────────────────────────────

export function AcceptInvitationScreen({ invitationId }: { invitationId: string }): React.ReactElement {
  const { state, reload } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const accepter = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/organization/accept-invitation', { invitationId });
      setDone(true);
      await reload();
      navigate('/');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? lisible(cause)
          : 'invitation impossible à accepter',
      );
      setBusy(false);
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
        <p className="display">Vous êtes<br />invité</p>
        <p className="meta" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Quelqu’un vous invite à suivre les repas de son foyer. En acceptant,
          vous pourrez enregistrer les repas et voir les bilans de chacun.
        </p>

        {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)', marginTop: 16 }}>{error}</p> : null}

        <button
          className="btn" style={{ marginTop: 24 }}
          disabled={busy || done || state !== 'sans_foyer' && state !== 'actif'}
          onClick={() => { void accepter(); }}
        >
          {busy ? 'Un instant…' : done ? 'C’est fait' : 'Rejoindre le foyer'}
        </button>

        <button
          type="button" className="btn btn--quiet" style={{ marginTop: 14 }}
          onClick={() => navigate('/')}
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}

function lisible(error: ApiError): string {
  if (error.status === 404) return 'Cette invitation n’existe plus.';
  if (/expire/i.test(error.message)) return 'Cette invitation a expiré. Demandez-en une nouvelle.';
  if (/email/i.test(error.message)) {
    return 'Cette invitation a été envoyée à une autre adresse que la vôtre.';
  }
  return error.message;
}

// ── Côté parent ─────────────────────────────────────────────────────────────

interface Invitation {
  id: string;
  email: string;
  role: Role;
  lien: string;
}

export function InviteMembers(): React.ReactElement | null {
  const { role, household } = useSession();
  const [email, setEmail] = useState('');
  const [asParent, setAsParent] = useState(false);
  const [créées, setCréées] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Le panneau n'existe pas pour un adulte : il ne gère pas les accès, et lui
  // montrer un bouton qui refusera ne lui apprend rien.
  if (role !== 'parent') return null;

  const inviter = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const rôle: Role = asParent ? 'parent' : 'adulte';
      const invitation = await api.post<{ id: string }>(
        '/api/auth/organization/invite-member',
        { email: email.trim(), role: rôle, organizationId: household?.organizationId },
      );
      const { url } = await api.get<{ url: string }>(
        `/api/invitations/${encodeURIComponent(invitation.id)}/lien`,
      );
      setCréées((liste) => [{ id: invitation.id, email: email.trim(), role: rôle, lien: url }, ...liste]);
      setEmail('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'invitation impossible');
    }
    setBusy(false);
  };

  return (
    <section className="sec">
      <h2 className="eyebrow">Inviter quelqu’un</h2>
      <p className="meta" style={{ marginBottom: 14, lineHeight: 1.6 }}>
        Un <b>parent</b> gère les accès et le foyer. Un <b>adulte</b> enregistre
        les repas et voit tout — c’est le rôle d’une nounou ou d’un grand-parent.
      </p>

      <form
        className="stack"
        onSubmit={(e) => { e.preventDefault(); void inviter(); }}
      >
        <div>
          <label className="label" htmlFor="invite-email">Son adresse e-mail</label>
          <input
            id="invite-email" className="field" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input
            type="checkbox" checked={asParent}
            onChange={(e) => setAsParent(e.target.checked)}
          />
          <span>Parent — peut inviter et gérer les accès</span>
        </label>

        {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p> : null}

        <button className="btn" type="submit" disabled={busy || email.trim() === ''}>
          {busy ? 'Un instant…' : 'Créer l’invitation'}
        </button>
      </form>

      {créées.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <p className="meta" style={{ marginBottom: 10 }}>
            Il n’y a pas d’envoi automatique : copiez le lien et transmettez-le
            comme vous voulez. Il vaut sept jours.
          </p>
          {créées.map((invitation) => (
            <LienInvitation key={invitation.id} invitation={invitation} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LienInvitation({ invitation }: { invitation: Invitation }): React.ReactElement {
  const [copié, setCopié] = useState(false);

  useEffect(() => {
    if (!copié) return;
    const timer = window.setTimeout(() => setCopié(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copié]);

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 14 }}>
        {invitation.email}
        <span className="meta"> · {invitation.role === 'parent' ? 'parent' : 'adulte'}</span>
      </p>
      <p
        className="meta"
        style={{ wordBreak: 'break-all', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}
      >
        {invitation.lien}
      </p>
      <button
        type="button" className="btn btn--quiet" style={{ marginTop: 10 }}
        onClick={() => {
          // `clipboard` peut manquer (contexte non sécurisé, navigateur ancien).
          // Le lien reste lisible au-dessus : la copie est un confort, pas le
          // chemin.
          void navigator.clipboard?.writeText(invitation.lien)
            .then(() => setCopié(true))
            .catch(() => undefined);
        }}
      >
        {copié ? 'Copié' : 'Copier le lien'}
      </button>
    </div>
  );
}
