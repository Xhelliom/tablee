/**
 * Ajouter quelqu'un à table — et, si c'est un adulte, lui ouvrir un accès
 * dans la foulée.
 *
 * ── Pourquoi les deux gestes sont sur le même écran ─────────────────────────
 *
 * Ils étaient séparés : « La famille » ajoutait des convives, « Le foyer »
 * distribuait des accès, et rien ne reliait les deux. On saisissait sa femme à
 * la main, elle s'inscrivait trois semaines plus tard, et il restait une fiche
 * d'un côté et un compte de l'autre, sans que rien ne les rejoigne.
 *
 * Ici, cocher « elle aura son propre compte » fait trois choses d'un coup : la
 * fiche est créée, elle est **réservée** à cette adresse, et l'invitation est
 * prête à envoyer. Le jour où la personne accepte, sa fiche devient la sienne —
 * avec ce qui a été saisi entre-temps. C'est le serveur qui s'en charge
 * (`claim_email`, migration 009) ; l'interface n'a rien à retenir.
 *
 * Un enfant, lui, n'a pas de compte, et la case reste décochée : `eater` est
 * une assiette, `"user"` est un compte, et les deux ensembles ne coïncident
 * pas (007).
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api, ApiError, type Eater } from '../api.ts';
import { useSession, type Role } from '../session.tsx';
import {
  draftToBody, emptyDraft, ProfileFields, type ProfileDraft,
} from './EaterForm.tsx';

/** Ce qu'il reste à faire une fois la fiche créée, et qu'il faut dire. */
export interface AddedEater {
  eater: Eater;
  /** Le lien d'invitation à transmettre, s'il a fallu en créer une. */
  invitationUrl: string | null;
  /** L'invitation n'a pas pu être créée — la fiche, elle, existe. */
  invitationError: string | null;
}

interface Props {
  onAdded: (result: AddedEater) => Promise<void> | void;
  onCancel?: () => void;
  /** Libellé du bouton principal. « Ajouter » par défaut. */
  submitLabel?: string;
}

export function AddEaterForm({ onAdded, onCancel, submitLabel = 'Ajouter' }: Props): ReactElement {
  const { role, household } = useSession();
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft());
  const [avecCompte, setAvecCompte] = useState(false);
  const [email, setEmail] = useState('');
  const [asParent, setAsParent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seul un parent distribue des accès (007). Pour les autres, la case n'a pas
  // à s'afficher : un bouton qui refusera n'apprend rien.
  const peutInviter = role === 'parent';

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const adresse = email.trim().toLowerCase();
    let créé = false;
    try {
      const { eater } = await api.post<{ eater: Eater }>('/api/eaters', {
        ...draftToBody(draft),
        ...(avecCompte && adresse !== '' ? { claimEmail: adresse } : {}),
      });

      // Déjà membre du foyer ? Le serveur a rattaché la fiche tout de suite, et
      // il n'y a personne à inviter.
      const àInviter = avecCompte && adresse !== '' && eater.userId === null;
      let invitationUrl: string | null = null;
      let invitationError: string | null = null;

      if (àInviter) {
        try {
          invitationUrl = await créerInvitation(adresse, asParent ? 'parent' : 'adulte',
                                                household?.organizationId);
        } catch (cause) {
          // La fiche est créée et réservée : l'invitation se refait depuis
          // « Le foyer ». Perdre la fiche pour ça serait absurde.
          invitationError = cause instanceof ApiError ? cause.message : 'invitation impossible';
        }
      }

      setDraft(emptyDraft());
      setAvecCompte(false);
      setEmail('');
      setAsParent(false);
      // Hors du `try` : ce qui suit rafraîchit l'écran appelant, et son échec
      // n'est pas un échec de création. Le dire « création impossible » alors
      // que la fiche est en base enverrait l'utilisateur la ressaisir.
      créé = true;
      await onAdded({ eater, invitationUrl, invitationError });
    } catch (cause) {
      setError(
        créé
          ? 'la fiche est enregistrée, mais l’écran n’a pas pu se rafraîchir'
          : cause instanceof ApiError ? cause.message : 'création impossible',
      );
    }
    setBusy(false);
  };

  return (
    <form className="card stack" style={{ padding: '14px 15px' }}
          onSubmit={(e) => { void submit(e); }}>
      <ProfileFields value={draft} onChange={setDraft} idPrefix="new" />

      {peutInviter ? (
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox" checked={avecCompte}
              onChange={(e) => setAvecCompte(e.target.checked)}
            />
            <span>Cette personne aura son propre compte</span>
          </label>
          <p className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Pour un adulte qui saisira les repas de son côté. Un enfant n’en a
            pas besoin : il est à table sans compte.
          </p>

          {avecCompte ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <div>
                <label className="label" htmlFor="new-email">Son adresse e-mail</label>
                <input
                  id="new-email" className="field" type="email" value={email}
                  required={avecCompte}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  La fiche lui est réservée. Le jour où elle s’inscrit avec
                  cette adresse et rejoint le foyer, la fiche devient la sienne
                  — avec ce que vous aurez saisi d’ici là.
                </p>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox" checked={asParent}
                  onChange={(e) => setAsParent(e.target.checked)}
                />
                <span>Parent — peut inviter et gérer les accès</span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {error !== null ? (
        <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        {onCancel !== undefined ? (
          <button type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                  onClick={onCancel}>
            Annuler
          </button>
        ) : null}
        <button type="submit" className="btn" style={{ width: 'auto', flex: 1 }}
                disabled={busy || draft.firstName.trim() === '' || draft.birthDate === ''}>
          {busy ? 'Un instant…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Crée l'invitation et rend le lien à transmettre.
 *
 * Il n'y a pas d'envoi automatique, et c'est un choix (§16) : installer un
 * relais mail pour deux invitations par décennie coûte plus cher que ça ne
 * rapporte. Le lien se copie et s'envoie comme on veut.
 */
export async function créerInvitation(
  email: string,
  role: Role,
  organizationId: string | undefined,
): Promise<string> {
  const invitation = await api.post<{ id: string }>(
    '/api/auth/organization/invite-member',
    { email, role, organizationId },
  );
  const { url } = await api.get<{ url: string }>(
    `/api/invitations/${encodeURIComponent(invitation.id)}/lien`,
  );
  return url;
}

/** Un lien d'invitation, avec sa copie. Le lien reste lisible si elle échoue. */
export function LienÀTransmettre({ url, pour }: { url: string; pour?: string }): ReactElement {
  const [copié, setCopié] = useState(false);
  return (
    <div className="card" style={{ marginTop: 10 }}>
      {/* Nommer le destinataire : deux invitations créées à la suite se
          ressemblent, et se tromper de lien envoie quelqu'un dans le mauvais
          rôle — ou dans le mauvais foyer. */}
      {pour === undefined ? null : (
        <p style={{ fontSize: 14, marginBottom: 6 }}>Invitation pour <b>{pour}</b></p>
      )}
      <p className="meta" style={{ lineHeight: 1.5 }}>
        Il n’y a pas d’envoi automatique : copiez ce lien et transmettez-le
        comme vous voulez. Il vaut sept jours.
      </p>
      <p
        className="meta"
        style={{ wordBreak: 'break-all', marginTop: 8, fontFamily: 'ui-monospace, monospace' }}
      >
        {url}
      </p>
      <button
        type="button" className="btn btn--quiet" style={{ marginTop: 10 }}
        onClick={() => {
          void navigator.clipboard?.writeText(url)
            .then(() => setCopié(true))
            .catch(() => undefined);
        }}
      >
        {copié ? 'Copié' : 'Copier le lien'}
      </button>
    </div>
  );
}
