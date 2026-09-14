/**
 * Gérer le foyer : qui a accès, les invitations en attente, le fuseau, et la
 * sortie.
 *
 * Un écran à part plutôt qu'un onglet : gérer les accès est un geste rare, la
 * saisie est quotidienne, et leur donner le même rang dans la navigation
 * mentirait sur leur fréquence. On y arrive depuis « La famille ».
 *
 * ── Ce que cet écran ne réimplémente pas ────────────────────────────────────
 *
 * Les trois manières de se verrouiller dehors de son propre foyer — se
 * rétrograder, se retirer, partir — sont **déjà refusées par better-auth**
 * quand on est le dernier parent. Vérifié plutôt que supposé. On se contente
 * donc de traduire ses refus, au lieu d'ajouter une deuxième garde qui
 * divergerait tôt ou tard de la première.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession, type Role } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { InviteMembers } from './Invitation.tsx';
import { Choix } from '../components/EaterForm.tsx';
import { readTheme, setTheme, THEMES, type Theme } from '../design/theme.ts';

interface Membre {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface InvitationEnAttente {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

const libelléRôle = (role: string): string => (role === 'parent' ? 'Parent' : 'Adulte');

export function HouseholdSettingsScreen(): React.ReactElement {
  const { user, household, role, reload, signOut } = useSession();
  const [membres, setMembres] = useState<Membre[]>([]);
  const [invitations, setInvitations] = useState<InvitationEnAttente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = household?.organizationId ?? '';
  const parent = role === 'parent';

  const charger = useCallback(async () => {
    if (orgId === '') return;
    const { members } = await api.get<{ members: Membre[] }>(
      `/api/auth/organization/list-members?organizationId=${encodeURIComponent(orgId)}`,
    );
    setMembres(members);

    // Les invitations acceptées ou expirées restent en base ; seules celles qui
    // attendent encore quelqu'un ont un sens à l'écran.
    if (parent) {
      const liste = await api
        .get<InvitationEnAttente[]>(
          `/api/auth/organization/list-invitations?organizationId=${encodeURIComponent(orgId)}`,
        )
        .catch(() => []);
      const maintenant = Date.now();
      setInvitations(
        liste.filter((i) => i.status === 'pending' && new Date(i.expiresAt).getTime() > maintenant),
      );
    }
  }, [orgId, parent]);

  useEffect(() => { void charger().catch(() => undefined); }, [charger]);

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await charger();
    } catch (cause) {
      setError(cause instanceof ApiError ? traduire(cause) : 'opération impossible');
    }
    setBusy(false);
  };

  const dernierParent = membres.filter((m) => m.role === 'parent').length <= 1;

  return (
    <div className="app">
      <ModalHeader title="Le foyer" onClose={() => navigate('/membres')} />

      <section className="sec" style={{ paddingTop: 18 }}>
        <h2 className="eyebrow">Qui a accès</h2>
        <p className="meta" style={{ marginBottom: 12, lineHeight: 1.6 }}>
          Ce sont les <b>comptes</b>, pas les convives. Un enfant est à table
          sans avoir de compte ; une nounou peut avoir un compte sans être à
          table.
        </p>

        <div className="stack">
          {membres.map((membre) => {
            const cestMoi = membre.userId === user?.id;
            return (
              <article key={membre.id} className="card" style={{ padding: '13px 15px' }}>
                <div className="spread">
                  <div>
                    <p style={{ fontSize: 15 }}>
                      {membre.user.name}
                      {cestMoi ? <span className="meta"> · vous</span> : null}
                    </p>
                    <p className="meta" style={{ marginTop: 2 }}>{membre.user.email}</p>
                  </div>
                  <span className="chip">{libelléRôle(membre.role)}</span>
                </div>

                {parent ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                      disabled={busy || (cestMoi && dernierParent)}
                      onClick={() => {
                        void agir(() => api.post('/api/auth/organization/update-member-role', {
                          memberId: membre.id,
                          role: membre.role === 'parent' ? 'adulte' : 'parent',
                          organizationId: orgId,
                        }));
                      }}
                    >
                      {membre.role === 'parent' ? 'Passer en adulte' : 'Passer en parent'}
                    </button>

                    {cestMoi ? null : (
                      <button
                        type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(
                            `Retirer l’accès de ${membre.user.name} ? Les repas qu’il a saisis restent.`,
                          )) return;
                          void agir(() => api.post('/api/auth/organization/remove-member', {
                            memberIdOrEmail: membre.id, organizationId: orgId,
                          }));
                        }}
                      >
                        Retirer l’accès
                      </button>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {parent && dernierParent ? (
          <p className="meta" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Vous êtes le seul parent : vous ne pouvez ni vous retirer, ni vous
            rétrograder, tant que personne d’autre ne l’est.
          </p>
        ) : null}
      </section>

      {parent && invitations.length > 0 ? (
        <section className="sec">
          <h2 className="eyebrow">Invitations en attente</h2>
          <div className="stack">
            {invitations.map((invitation) => (
              <article key={invitation.id} className="card" style={{ padding: '13px 15px' }}>
                <div className="spread">
                  <div>
                    <p style={{ fontSize: 15 }}>{invitation.email}</p>
                    <p className="meta" style={{ marginTop: 2 }}>
                      {libelléRôle(invitation.role)} · expire le{' '}
                      {new Date(invitation.expiresAt).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                    disabled={busy}
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        new URL(`/invitation/${invitation.id}`, window.location.origin).toString(),
                      ).catch(() => undefined);
                    }}
                  >
                    Copier le lien
                  </button>
                  <button
                    type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                    disabled={busy}
                    onClick={() => {
                      void agir(() => api.post('/api/auth/organization/cancel-invitation', {
                        invitationId: invitation.id,
                      }));
                    }}
                  >
                    Annuler
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <InviteMembers onInvited={() => { void charger(); }} />

      {parent ? <HouseholdForm onSaved={reload} /> : null}

      <Apparence />

      {error !== null ? (
        <section className="sec">
          <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
        </section>
      ) : null}

      <section className="sec">
        <h2 className="eyebrow">Quitter</h2>
        <button
          type="button" className="btn btn--quiet"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(
              'Quitter ce foyer ? Vous perdrez l’accès à ses repas. Les données du foyer, elles, restent.',
            )) return;
            void agir(async () => {
              await api.post('/api/auth/organization/leave', { organizationId: orgId });
              await reload();
              navigate('/');
            });
          }}
        >
          Quitter ce foyer
        </button>

        <button
          type="button" className="btn btn--quiet" style={{ marginTop: 10 }}
          onClick={() => { void signOut(); }}
        >
          Se déconnecter
        </button>
      </section>

      {parent ? <DeleteHousehold onDeleted={async () => { await reload(); navigate('/'); }} /> : null}

      <div className="fab-space" />
    </div>
  );
}

/**
 * Traduit les refus de better-auth, qui parlent anglais et « organization ».
 * Les trois qui arrivent vraiment sont les verrous d'auto-exclusion.
 */
function traduire(error: ApiError): string {
  const m = error.message;
  if (/without an owner|only owner/i.test(m)) {
    return 'Impossible : il doit rester au moins un parent dans le foyer.';
  }
  if (error.status === 403) return 'Vous n’avez pas les droits pour cette action.';
  if (error.status === 404) return 'Introuvable — la page est peut-être périmée.';
  return m;
}

// ── Apparence ───────────────────────────────────────────────────────────────

/**
 * Clair, sombre, ou comme le téléphone.
 *
 * Sur cet écran faute d'un meilleur endroit — c'est le seul écran de réglages —
 * mais ce n'est **pas** un réglage de foyer : il vit dans le navigateur de cet
 * appareil, et l'écran le dit. Deux personnes partagent un foyer et pas leurs
 * yeux, et la même personne peut vouloir du sombre sur son téléphone le soir et
 * du clair sur la tablette de la cuisine.
 *
 * Il n'est donc ni réservé au `parent`, ni envoyé au serveur.
 */
function Apparence(): React.ReactElement {
  const [theme, setChoisi] = useState<Theme>(readTheme);

  return (
    <section className="sec">
      <h2 className="eyebrow">Apparence</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {THEMES.map(({ value, label }) => (
          <Choix
            key={value}
            actif={theme === value}
            libellé={label}
            onClick={() => { setTheme(value); setChoisi(value); }}
          />
        ))}
      </div>
      <p className="meta" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Réglage de cet appareil, gardé dans ce navigateur. Il ne suit pas votre
        compte et ne change rien pour les autres membres du foyer.
      </p>
    </section>
  );
}

// ── Nom et fuseau ───────────────────────────────────────────────────────────

/**
 * Le fuseau n'est pas un réglage d'affichage : il décide où s'arrête une
 * journée et à quel mois appartient un repas pour la saisonnalité. Le dire
 * sous le champ, parce que personne ne le devinerait.
 */
function HouseholdForm({ onSaved }: { onSaved: () => Promise<void> }): React.ReactElement {
  const { household } = useSession();
  const [name, setName] = useState(household?.name ?? '');
  const [timezone, setTimezone] = useState(household?.timezone ?? 'Europe/Paris');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const zones = supportedTimezones(timezone);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/household', { name: name.trim(), timezone });
      await onSaved();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'enregistrement impossible');
    }
    setBusy(false);
  };

  return (
    <section className="sec">
      <h2 className="eyebrow">Le foyer</h2>
      <form className="stack" onSubmit={(e) => { void submit(e); }}>
        <div>
          <label className="label" htmlFor="h-name">Nom</label>
          <input
            id="h-name" className="field" value={name} maxLength={80}
            onChange={(e) => setName(e.target.value)} required
          />
        </div>

        <div>
          <label className="label" htmlFor="h-tz">Fuseau horaire</label>
          <select
            id="h-tz" className="field" value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <p className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Décide où s’arrête une journée, et à quel mois un repas compte pour
            la saisonnalité. Les repas déjà enregistrés ne bougent pas ; c’est
            leur regroupement par jour qui suit.
          </p>
        </div>

        {error !== null ? (
          <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
        ) : null}

        <button className="btn" type="submit" disabled={busy || name.trim() === ''}>
          {busy ? 'Un instant…' : saved ? 'Enregistré' : 'Enregistrer'}
        </button>
      </form>
    </section>
  );
}

/**
 * La liste des fuseaux du navigateur, avec le fuseau courant garanti présent.
 *
 * `Intl.supportedValuesOf` manque sur les navigateurs un peu anciens : on
 * retombe alors sur une poignée de fuseaux plutôt que sur un champ vide, ce
 * qui laisserait quelqu'un coincé sur une valeur qu'il ne peut plus changer.
 */
function supportedTimezones(courant: string): string[] {
  const secours = [
    'Europe/Paris', 'Europe/London', 'Europe/Lisbon', 'Europe/Berlin',
    'America/Montreal', 'America/New_York', 'Indian/Reunion', 'UTC',
  ];
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = secours;
  }
  return zones.includes(courant) ? zones : [courant, ...zones];
}

// ── La suppression ──────────────────────────────────────────────────────────

/**
 * Irréversible, et elle emporte tout : convives, repas, bilans, notes. Le §16
 * en fait une exigence produit — pouvoir retirer ses données d'une machine qui
 * n'est pas la sienne — mais une exigence qui se déclenche d'un tap serait un
 * piège. D'où la saisie du nom du foyer : le seul geste qu'on ne fait pas par
 * réflexe.
 */
function DeleteHousehold({ onDeleted }: { onDeleted: () => Promise<void> }): React.ReactElement {
  const { household } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const [saisi, setSaisi] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attendu = household?.name ?? '';
  const confirmé = saisi.trim() === attendu.trim() && attendu !== '';

  return (
    <section className="sec">
      <h2 className="eyebrow">Supprimer le foyer</h2>

      {!ouvert ? (
        <>
          <p className="meta" style={{ marginBottom: 12, lineHeight: 1.6 }}>
            Efface le foyer et <b>tout ce qu’il contient</b> : les convives, les
            repas, les bilans, les notes. Définitif, et sans copie.
          </p>
          <button type="button" className="btn btn--quiet" onClick={() => setOuvert(true)}>
            Supprimer le foyer…
          </button>
        </>
      ) : (
        <div className="stack">
          <p className="meta" style={{ lineHeight: 1.6 }}>
            Pour confirmer, saisissez le nom du foyer : <b>{attendu}</b>
          </p>
          <input
            className="field" value={saisi} autoComplete="off"
            onChange={(e) => setSaisi(e.target.value)}
          />
          {error !== null ? (
            <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
              onClick={() => { setOuvert(false); setSaisi(''); setError(null); }}
            >
              Annuler
            </button>
            <button
              type="button" className="btn" style={{ width: 'auto', flex: 1 }}
              disabled={!confirmé || busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void api
                  .post('/api/auth/organization/delete', {
                    organizationId: household?.organizationId,
                  })
                  .then(onDeleted)
                  .catch((cause: unknown) => {
                    setError(cause instanceof ApiError ? cause.message : 'suppression impossible');
                    setBusy(false);
                  });
              }}
            >
              {busy ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
