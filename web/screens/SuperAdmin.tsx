/**
 * Super-admin : l'instance entière, depuis le menu du compte.
 *
 * Quatre onglets, qui correspondent aux quatre gestes du rôle (020) : voir
 * tous les **comptes** de la plateforme et nommer ses pairs, voir tous les
 * **foyers** et leur volume, réparer les associations **convive ↔ compte**
 * (rattacher, détacher, résorber les réservations orphelines), et corriger en
 * masse les correspondances **ingrédient Jow ↔ aliment** — puis verrouiller
 * celles qui ne doivent plus bouger.
 *
 * ── Deux règles d'interface, qui font tenir l'écran à cent lignes comme à
 * mille ────────────────────────────────────────────────────────────────────
 *
 * 1. **Tout est cherché et paginé côté serveur** (`?q=…&statut=…&page=…`) : une
 *    liste qui charge tout tient sur une instance familiale, pas sur une
 *    instance qui vit. Le total dimensionne le pagineur, jamais l'inverse.
 * 2. **Seules les anomalies portent une couleur** — pastille ambre « à
 *    regarder », pastille bleue « rôle », pastille neutre « verrouillé ». Un
 *    état sain reste du texte : colorer le normal apprend à ignorer les
 *    couleurs, et c'est exactement l'inverse de « repérer d'éventuelles
 *    erreurs ». Les couleurs de nutriments n'y paraissent jamais (§8ter).
 *
 * Un verrou n'est pas une punition : c'est ce qui dit « celle-ci a été relue ».
 * Tant qu'il est posé, ni un parent ni le rattachement automatique ne touchent
 * au lien — seul cet écran passe outre, après déverrouillage ou directement.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { api, ApiError, type FoodSummary } from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { ConfirmButton } from '../components/ConfirmButton.tsx';

type Onglet = 'comptes' | 'foyers' | 'convives' | 'aliments' | 'journal';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  superadmin: boolean;
  households: { householdId: string; householdName: string; organizationId: string; role: string }[];
  eaterCount: number;
}

interface AdminHousehold {
  id: string;
  name: string;
  timezone: string;
  organizationId: string | null;
  memberCount: number;
  eaterCount: number;
  mealCount: number;
}

interface EaterLink {
  householdId: string;
  householdName: string;
  eaterId: string;
  firstName: string;
  birthDate: string;
  active: boolean;
  userId: string | null;
  userEmail: string | null;
  claimEmail: string | null;
  linkLocked: boolean;
  orphan: boolean;
}

interface ImpactLien {
  jowFoodId: string;
  label: string;
  lignes: number;
  recettes: number;
  foyers: number;
}

interface Impact {
  impacts: ImpactLien[];
  totaux: { correspondances: number; lignes: number; recettes: number; foyers: number };
}

interface FoodLink {
  jowFoodId: string;
  label: string;
  foodId: string;
  foodName: string;
  plantBased: boolean | null;
  locked: boolean;
  usageCount: number;
}

interface JournalLigne {
  id: string;
  at: string;
  actorEmail: string | null;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

interface Apercu {
  comptes: number;
  foyers: number;
  superadmins: number;
  orphelines: number;
  convivesVerrouilles: number;
  correspondances: number;
  alimentsVerrouilles: number;
  nonRattaches: number;
}

type StatutLien = 'toutes' | 'orphelines' | 'verrouillees' | 'sans_lien';
type VerrouLien = 'tous' | 'verrouilles' | 'modifiables';
type VueAliments = 'rattachees' | 'nonRattachees';

export function SuperAdminScreen(): ReactElement {
  const { superadmin, loading } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('comptes');
  const [error, setError] = useState<string | null>(null);
  // Quand l'aperçu envoie vers un onglet déjà filtré (« 3 orphelines »), ce
  // préréglage force le remontage de l'onglet avec le bon filtre.
  const [préréglage, setPréréglage] = useState<{
    onglet: Onglet; nonce: number; statut?: StatutLien; vueAliments?: VueAliments;
  } | null>(null);

  if (!loading && !superadmin) {
    return (
      <div className="app">
        <ModalHeader title="Super-admin" onClose={() => navigate('/')} />
        <section className="sec" style={{ paddingTop: 18 }}>
          <p className="empty">Réservé au super-admin de la plateforme.</p>
        </section>
      </div>
    );
  }

  const aller = (
    cible: Onglet,
    filtre: { statut?: StatutLien; vueAliments?: VueAliments } = {},
  ): void => {
    setOnglet(cible);
    setError(null);
    const avecPréréglage = filtre.statut !== undefined || filtre.vueAliments !== undefined;
    setPréréglage(avecPréréglage ? { onglet: cible, nonce: Date.now(), ...filtre } : null);
  };

  return (
    <div className="app">
      <ModalHeader title="Super-admin" onClose={() => navigate('/')} />

      <ApercuTête
        onAller={(cible, filtre) => aller(cible, filtre)}
      />

      <section className="sec" style={{ paddingTop: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Rubriques super-admin">
          {([
            ['comptes', 'Comptes'],
            ['foyers', 'Foyers'],
            ['convives', 'Convives ↔ comptes'],
            ['aliments', 'Jow ↔ aliments'],
            ['journal', 'Journal'],
          ] as [Onglet, string][]).map(([valeur, libellé]) => (
            <button
              key={valeur} type="button" role="tab" aria-selected={onglet === valeur}
              className="btn btn--quiet" style={{ width: 'auto', flex: '1 1 auto', opacity: onglet === valeur ? 1 : 0.6 }}
              onClick={() => aller(valeur)}
            >
              {libellé}
            </button>
          ))}
        </div>
      </section>

      {error !== null ? (
        <section className="sec">
          <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
        </section>
      ) : null}

      {onglet === 'comptes' ? <OngletComptes onError={setError} /> : null}
      {onglet === 'foyers' ? <OngletFoyers onError={setError} /> : null}
      {onglet === 'convives' ? (
        <OngletConvives
          key={préréglage?.onglet === 'convives' ? préréglage.nonce : 'convives'}
          onError={setError}
          statutInitial={préréglage?.onglet === 'convives' && préréglage.statut !== undefined ? préréglage.statut : 'toutes'}
        />
      ) : null}
      {onglet === 'aliments' ? (
        <OngletAliments
          key={préréglage?.onglet === 'aliments' ? préréglage.nonce : 'aliments'}
          onError={setError}
          vueInitiale={préréglage?.onglet === 'aliments' && préréglage.vueAliments !== undefined ? préréglage.vueAliments : 'rattachees'}
        />
      ) : null}
      {onglet === 'journal' ? <OngletJournal onError={setError} /> : null}

      <div className="fab-space" />
    </div>
  );
}

/**
 * L'état de l'instance en six chiffres. Les anomalies sont cliquables : « 3
 * orphelines » n'est pas une statistique, c'est une entrée vers l'onglet déjà
 * filtré — le super-admin vient pour un problème, pas pour lire des listes.
 */
function ApercuTête({ onAller }: {
  onAller: (cible: Onglet, filtre?: { statut?: StatutLien; vueAliments?: VueAliments }) => void;
}): ReactElement {
  const [apercu, setApercu] = useState<Apercu | null>(null);

  useEffect(() => {
    void api.get<{ apercu: Apercu }>('/api/admin/apercu')
      .then(({ apercu: a }) => setApercu(a))
      .catch(() => undefined);
  }, []);

  if (apercu === null) return <></>;

  const compteurs: {
    valeur: number; libellé: string; alerte: boolean;
    cible: Onglet | null; filtre?: { statut?: StatutLien; vueAliments?: VueAliments };
  }[] = [
    { valeur: apercu.comptes, libellé: 'Comptes', alerte: false, cible: 'comptes' },
    { valeur: apercu.foyers, libellé: 'Foyers', alerte: false, cible: 'foyers' },
    { valeur: apercu.orphelines, libellé: 'Orphelines', alerte: apercu.orphelines > 0, cible: 'convives', filtre: { statut: 'orphelines' } },
    { valeur: apercu.convivesVerrouilles, libellé: 'Liens verrouillés', alerte: false, cible: 'convives', filtre: { statut: 'verrouillees' } },
    { valeur: apercu.correspondances, libellé: 'Correspondances', alerte: false, cible: 'aliments', filtre: { vueAliments: 'rattachees' } },
    { valeur: apercu.alimentsVerrouilles, libellé: 'Verrouillées', alerte: false, cible: 'aliments', filtre: { vueAliments: 'rattachees' } },
    { valeur: apercu.nonRattaches, libellé: 'Non rattachés', alerte: apercu.nonRattaches > 0, cible: 'aliments', filtre: { vueAliments: 'nonRattachees' } },
  ];

  return (
    <section className="sec" style={{ paddingTop: 14 }}>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {compteurs.map(({ valeur, libellé, alerte, cible, filtre }) => (
          <button
            key={libellé} type="button" className="card tuile"
            style={{ padding: '10px 12px', textAlign: 'left', cursor: cible === null ? 'default' : 'pointer' }}
            onClick={cible === null ? undefined : () => onAller(cible, filtre)}
          >
            <p style={{ fontSize: 22, color: alerte ? 'var(--text-warning)' : 'var(--text-primary)' }}>
              {valeur}
            </p>
            <p className="meta" style={{ marginTop: 2 }}>{libellé}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Listes paginées ─────────────────────────────────────────────────────────

function useDélai<T>(valeur: T, ms = 250): T {
  const [retardée, setRetardée] = useState(valeur);
  useEffect(() => {
    const horloge = window.setTimeout(() => setRetardée(valeur), ms);
    return () => window.clearTimeout(horloge);
  }, [valeur, ms]);
  return retardée;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
  recharger: () => Promise<void>;
}

/**
 * Une liste serveur : `GET url?q=…&statut=…&page=…` rend `{ <clé>, total }`.
 *
 * La recherche est retardée d'une frappe : sans ça, chaque lettre relance une
 * requête par foyer — et la page revient à 1 dès que le filtre change, sinon
 * on reste sur une « page 3 » d'un résultat qui n'en a plus qu'une.
 */
function usePage<T>(
  base: string, clé: string, params: Record<string, string | number>,
  onError: (message: string | null) => void,
): Page<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limite, setLimite] = useState(50);
  const clef = JSON.stringify({ base, clé, ...params });

  const recharger = async (): Promise<void> => {
    const { base: url, clé: nom, ...reste } = JSON.parse(clef) as Record<string, string | number> & { base: string; clé: string };
    try {
      const query = new URLSearchParams(
        Object.entries(reste).map(([k, v]) => [k, String(v)]),
      ).toString();
      const corps = await api.get<Record<string, unknown>>(`${url}?${query}`);
      setItems((corps[nom] as T[]) ?? []);
      setTotal(Number(corps['total'] ?? 0));
      setPage(Number(corps['page'] ?? 1));
      setLimite(Number(corps['limit'] ?? 50));
      onError(null);
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'chargement impossible');
    }
  };

  useEffect(() => { void recharger(); }, [clef]);
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limite)));
  return { items, total, page: Math.min(page, pages), pages, recharger };
}

function Pager({ total, page, pages, onPage }: {
  total: number; page: number; pages: number; onPage: (page: number) => void;
}): ReactElement {
  return (
    <div className="spread" style={{ margin: '4px 0 12px' }}>
      <p className="meta">{total} résultat{total > 1 ? 's' : ''} · page {page}/{pages}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button" className="btn btn--quiet" style={{ width: 'auto' }}
          disabled={page <= 1} onClick={() => onPage(page - 1)}
        >
          ←
        </button>
        <button
          type="button" className="btn btn--quiet" style={{ width: 'auto' }}
          disabled={page >= pages} onClick={() => onPage(page + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
}

function Recherche({ valeur, onChange, texte }: {
  valeur: string; onChange: (q: string) => void; texte: string;
}): ReactElement {
  return (
    <input
      className="field" placeholder={texte} value={valeur} style={{ marginBottom: 8 }}
      onChange={(e) => onChange(e.target.value)} role="search"
    />
  );
}

function OngletComptes({ onError }: { onError: (m: string | null) => void }): ReactElement {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const différée = useDélai(q);
  const { items: users, total, pages, recharger } = usePage<AdminUser>(
    '/api/admin/users', 'users', { q: différée, page }, onError,
  );
  const [busy, setBusy] = useState(false);

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await recharger();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'opération impossible');
    }
    setBusy(false);
  };

  return (
    <section className="sec">
      <h2 className="eyebrow">Tous les comptes</h2>
      <p className="meta" style={{ margin: '6px 0 12px', lineHeight: 1.6 }}>
        Le premier compte connecté est devenu super-admin tout seul. Les suivants
        le deviennent ici — et seulement ici.
      </p>
      <Recherche valeur={q} onChange={(v) => { setQ(v); setPage(1); }} texte="Rechercher : nom, adresse…" />
      <Pager total={total} page={page} pages={pages} onPage={setPage} />
      <div className="stack">
        {users.map((compte) => (
          <article key={compte.id} className="card" style={{ padding: '13px 15px' }}>
            <div className="spread">
              <div>
                <p style={{ fontSize: 15 }}>{compte.name}</p>
                <p className="meta" style={{ marginTop: 2 }}>
                  {compte.email} · {compte.households.map((f) => `${f.householdName} (${f.role})`).join(', ') || 'sans foyer'} ·{' '}
                  {compte.eaterCount} fiche(s)
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {compte.superadmin ? <span className="chip chip--accent">Super-admin</span> : null}
                {compte.households.length === 0 ? <span className="chip chip--warning">Sans foyer</span> : null}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                disabled={busy}
                onClick={() => {
                  void agir(() => api.post('/api/admin/superadmin', {
                    userId: compte.id, make: !compte.superadmin,
                  }));
                }}
              >
                {compte.superadmin ? 'Retirer super-admin' : 'Nommer super-admin'}
              </button>
              {compte.superadmin ? null : (
                <ConfirmButton
                  label="Supprimer" style={{ width: 'auto' }} disabled={busy}
                  onConfirm={() => {
                    void agir(() => api.delete(`/api/admin/users/${compte.id}`));
                  }}
                />
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OngletFoyers({ onError }: { onError: (m: string | null) => void }): ReactElement {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const différée = useDélai(q);
  const { items: foyers, total, pages } = usePage<AdminHousehold>(
    '/api/admin/households', 'households', { q: différée, page }, onError,
  );

  return (
    <section className="sec">
      <h2 className="eyebrow">Tous les foyers</h2>
      <p className="meta" style={{ margin: '6px 0 12px', lineHeight: 1.6 }}>
        Lecture seule : le contenu d'un foyer se gère depuis ce foyer, par ses
        parents. Ici on prend la mesure de l'instance.
      </p>
      <Recherche valeur={q} onChange={(v) => { setQ(v); setPage(1); }} texte="Rechercher un foyer…" />
      <Pager total={total} page={page} pages={pages} onPage={setPage} />
      <div className="stack">
        {foyers.map((foyer) => (
          <article key={foyer.id} className="card" style={{ padding: '13px 15px' }}>
            <div className="spread">
              <div>
                <p style={{ fontSize: 15 }}>{foyer.name}</p>
                <p className="meta" style={{ marginTop: 4 }}>
                  {foyer.memberCount} compte(s) · {foyer.eaterCount} convive(s) · {foyer.mealCount} repas · {foyer.timezone}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {foyer.memberCount === 0 ? <span className="chip chip--warning">Sans membre</span> : null}
                {foyer.memberCount > 0 && foyer.eaterCount === 0 ? (
                  <span className="chip chip--warning">Sans convive</span>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const LIBELLÉS_STATUT: { valeur: StatutLien; libellé: string }[] = [
  { valeur: 'toutes', libellé: 'Tous les liens' },
  { valeur: 'orphelines', libellé: 'Orphelines à réparer' },
  { valeur: 'verrouillees', libellé: 'Verrouillés' },
  { valeur: 'sans_lien', libellé: 'Sans lien' },
];

function OngletConvives({ onError, statutInitial }: {
  onError: (m: string | null) => void; statutInitial: StatutLien;
}): ReactElement {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [statut, setStatut] = useState<StatutLien>(statutInitial);
  const différée = useDélai(q);
  const { items: liens, total, pages, recharger } = usePage<EaterLink>(
    '/api/admin/eater-links', 'links', { q: différée, page, statut }, onError,
  );
  // La liste des comptes pour le rattachement : large (200), première page —
  // un foyer se répare parmi des comptes connus, pas au fin fond de l'instance.
  const { items: users } = usePage<AdminUser>(
    '/api/admin/users', 'users', { q: '', page: 1, limit: 200 }, () => undefined,
  );
  const [busy, setBusy] = useState(false);
  const [édition, setÉdition] = useState<{ householdId: string; eaterId: string; email: string } | null>(null);

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      setÉdition(null);
      await recharger();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'opération impossible');
    }
    setBusy(false);
  };

  return (
    <section className="sec">
      <h2 className="eyebrow">Associations convive ↔ compte</h2>
      <p className="meta" style={{ margin: '6px 0 12px', lineHeight: 1.6 }}>
        Un lien verrouillé ne bouge plus : ni parent, ni rattachement
        automatique. Le réparer passe par ici.
      </p>
      <Recherche valeur={q} onChange={(v) => { setQ(v); setPage(1); }} texte="Filtrer : prénom, foyer, adresse…" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="tablist" aria-label="Filtrer par état">
        {LIBELLÉS_STATUT.map(({ valeur, libellé }) => (
          <button
            key={valeur} type="button"
            className="btn btn--quiet" style={{ width: 'auto', opacity: statut === valeur ? 1 : 0.6 }}
            onClick={() => { setStatut(valeur); setPage(1); }}
          >
            {libellé}
          </button>
        ))}
      </div>
      <Pager total={total} page={page} pages={pages} onPage={setPage} />
      <div className="stack">
        {liens.map((lien) => (
          <article key={`${lien.householdId}:${lien.eaterId}`} className="card" style={{ padding: '13px 15px' }}>
            <div className="spread">
              <div>
                <p style={{ fontSize: 15 }}>
                  {lien.firstName} <span className="meta">· {lien.householdName}</span>
                  {!lien.active ? <span className="meta"> · retiré</span> : null}
                </p>
                <p className="meta" style={{ marginTop: 2 }}>
                  {lien.userEmail !== null ? `lié à ${lien.userEmail}`
                    : lien.claimEmail !== null ? `réservé à ${lien.claimEmail}`
                    : 'sans compte, sans réservation'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {lien.orphan ? <span className="chip chip--warning">Orpheline</span> : null}
                {lien.linkLocked ? <span className="chip">Verrouillé</span> : null}
              </div>
            </div>
            {édition?.eaterId === lien.eaterId ? (
              <LigneRéparation
                édition={édition} setÉdition={setÉdition} busy={busy}
                comptes={users}
                onChoisir={(userId) => {
                  void agir(() => api.patch(
                    `/api/admin/eater-links/${lien.householdId}/${lien.eaterId}`, { userId },
                  ));
                }}
                onRéserver={(email) => {
                  void agir(() => api.patch(
                    `/api/admin/eater-links/${lien.householdId}/${lien.eaterId}`, { email },
                  ));
                }}
              />
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                  disabled={busy}
                  onClick={() => setÉdition({ householdId: lien.householdId, eaterId: lien.eaterId, email: lien.claimEmail ?? '' })}
                >
                  Rattacher…
                </button>
                {(lien.userId !== null || lien.claimEmail !== null) ? (
                  <button
                    type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                    disabled={busy}
                    onClick={() => {
                      void agir(() => api.patch(
                        `/api/admin/eater-links/${lien.householdId}/${lien.eaterId}`, { detacher: true },
                      ));
                    }}
                  >
                    Détacher
                  </button>
                ) : null}
                <button
                  type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                  disabled={busy}
                  onClick={() => {
                    void agir(() => api.patch(
                      `/api/admin/eater-links/${lien.householdId}/${lien.eaterId}`,
                      { linkLocked: !lien.linkLocked },
                    ));
                  }}
                >
                  {lien.linkLocked ? 'Déverrouiller' : 'Verrouiller'}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function LigneRéparation({ édition, setÉdition, busy, comptes, onChoisir, onRéserver }: {
  édition: { email: string };
  setÉdition: (édition: null) => void;
  busy: boolean;
  comptes: AdminUser[];
  onChoisir: (userId: string) => void;
  onRéserver: (email: string) => void;
}): ReactElement {
  const [email, setEmail] = useState(édition.email);
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <select
        className="field" defaultValue="" disabled={busy}
        onChange={(e) => { if (e.target.value !== '') onChoisir(e.target.value); }}
        aria-label="Rattacher à un compte existant"
      >
        <option value="">Rattacher à un compte…</option>
        {comptes.map((c) => (
          <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field" value={email} placeholder="…ou réserver à une adresse"
          onChange={(e) => setEmail(e.target.value)} disabled={busy}
        />
        <button
          type="button" className="btn btn--quiet" style={{ width: 'auto' }} disabled={busy || email.trim() === ''}
          onClick={() => onRéserver(email.trim())}
        >
          Réserver
        </button>
        <button
          type="button" className="btn btn--quiet" style={{ width: 'auto' }}
          onClick={() => setÉdition(null)}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

const LIBELLÉS_VERROU: { valeur: VerrouLien; libellé: string }[] = [
  { valeur: 'tous', libellé: 'Toutes' },
  { valeur: 'verrouilles', libellé: 'Verrouillées' },
  { valeur: 'modifiables', libellé: 'Modifiables' },
];

/**
 * Choisir l'aliment cible d'une correction en masse, par recherche dans le
 * référentiel — nom, source, catégorie — plutôt qu'en collant un UUID.
 *
 * La recherche part à chaque frappe retardée (`/api/foods/search`, la même
 * que la saisie) : ce qui s'affiche est ce qui existe vraiment, et le bouton
 * de correction dit le nom choisi plutôt qu'un identifiant illisible.
 */
function ChoixAliment({ cible, onChoisir, disabled }: {
  cible: { id: string; name: string } | null;
  onChoisir: (cible: { id: string; name: string } | null) => void;
  disabled: boolean;
}): ReactElement {
  const [texte, setTexte] = useState('');
  const [résultats, setRésultats] = useState<FoodSummary[]>([]);
  const [référentiel, setRéférentiel] = useState(true);
  const différé = useDélai(texte, 300);

  useEffect(() => {
    const q = différé.trim();
    if (q === '') {
      setRésultats([]);
      return;
    }
    void api.get<{ foods: FoodSummary[]; referentialLoaded: boolean }>(
      `/api/foods/search?q=${encodeURIComponent(q)}&limit=8`,
    )
      .then(({ foods, referentialLoaded }) => {
        setRésultats(foods);
        setRéférentiel(referentialLoaded);
      })
      .catch(() => setRésultats([]));
  }, [différé]);

  if (cible !== null) {
    return (
      <div className="spread">
        <p style={{ fontSize: 14 }}>« {cible.name} »</p>
        <button
          type="button" className="btn btn--quiet" style={{ width: 'auto' }}
          disabled={disabled} onClick={() => { onChoisir(null); setTexte(''); }}
        >
          Changer
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        className="field" placeholder="Chercher l’aliment : carotte, parmesan…"
        value={texte} onChange={(e) => setTexte(e.target.value)} disabled={disabled}
        role="search" aria-label="Chercher l’aliment cible"
      />
      {!référentiel ? (
        <p className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
          Référentiel Ciqual non chargé — voyez `npm run seed:food`.
        </p>
      ) : null}
      {texte.trim() !== '' ? (
        <div className="stack" style={{ marginTop: 8 }}>
          {résultats.map((aliment) => (
            <button
              key={aliment.id} type="button" className="card tuile"
              style={{ padding: '10px 12px', textAlign: 'left', cursor: 'pointer' }}
              disabled={disabled}
              onClick={() => onChoisir({ id: aliment.id, name: aliment.name })}
            >
              <p style={{ fontSize: 14 }}>{aliment.name}</p>
              <p className="meta" style={{ marginTop: 2 }}>
                {aliment.source}
                {aliment.category !== null ? ` · ${aliment.category}` : ''}
              </p>
            </button>
          ))}
          {résultats.length === 0 ? (
            <p className="meta">Rien trouvé — essayez un autre libellé.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OngletAliments({ onError, vueInitiale }: {
  onError: (m: string | null) => void; vueInitiale: VueAliments;
}): ReactElement {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [verrou, setVerrou] = useState<VerrouLien>('tous');
  const [vue, setVue] = useState<VueAliments>(vueInitiale);
  const différée = useDélai(q);
  const rattachees = usePage<FoodLink>(
    '/api/admin/food-links', 'links', { q: différée, page, verrou }, onError,
  );
  const orphelins = usePage<{ jowFoodId: string; label: string; usageCount: number }>(
    '/api/admin/unlinked-ingredients', 'unlinked', { q: différée, page }, onError,
  );
  const active = vue === 'rattachees' ? rattachees : orphelins;
  // La sélection survit au changement de page **et** de vue : une correction
  // en masse se prépare en feuilletant, elle s'exécute d'un coup. Les deux
  // vues partagent la même clé (`jow_food_id`) et la même voie d'écriture.
  const [sélection, setSélection] = useState<Set<string>>(new Set());
  // L'aliment cible de la correction en masse : choisi par recherche, jamais
  // collé en UUID — un identifiant qu'on ne peut pas lire est un identifiant
  // auquel on se trompe.
  const [cible, setCible] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Le récap d'impact, calculé sans rien écrire : un irréversible se relit
  // avant de s'exécuter. Il tombe dès que la sélection ou la cible bouge.
  const [impact, setImpact] = useState<Impact | null>(null);

  const changerVue = (suivante: VueAliments): void => {
    setVue(suivante);
    setPage(1);
  };

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      setSélection(new Set());
      setCible(null);
      setImpact(null);
      await rattachees.recharger();
      await orphelins.recharger();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'opération impossible');
    }
    setBusy(false);
  };

  const basculer = (id: string): void => {
    const next = new Set(sélection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSélection(next);
    setImpact(null);
  };

  const prévisualiser = async (): Promise<void> => {
    setBusy(true);
    try {
      const calculé = await api.post<Impact>('/api/admin/food-links/impact', {
        ids: [...sélection],
      });
      setImpact(calculé);
      onError(null);
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'calcul impossible');
    }
    setBusy(false);
  };

  return (
    <section className="sec">
      <h2 className="eyebrow">Correspondances Jow ↔ aliment</h2>
      <p className="meta" style={{ margin: '6px 0 12px', lineHeight: 1.6 }}>
        Corriger ici propage à <b>toutes</b> les recettes qui partagent
        l'ingrédient, tous foyers confondus. Verrouillée, une correspondance
        refuse toute modification — même par un parent. Les ingrédients jamais
        rattachés attendent dans l'autre vue : les corriger y crée le lien.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="tablist" aria-label="Rattachées ou non">
        {([
          ['rattachees', 'Rattachées'],
          ['nonRattachees', 'Non rattachés'],
        ] as [VueAliments, string][]).map(([valeur, libellé]) => (
          <button
            key={valeur} type="button"
            className="btn btn--quiet" style={{ width: 'auto', flex: 1, opacity: vue === valeur ? 1 : 0.6 }}
            onClick={() => changerVue(valeur)}
          >
            {libellé}
          </button>
        ))}
      </div>
      <Recherche valeur={q} onChange={(v) => { setQ(v); setPage(1); }} texte="Filtrer : libellé Jow, aliment…" />
      {vue === 'rattachees' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="tablist" aria-label="Filtrer par verrou">
          {LIBELLÉS_VERROU.map(({ valeur, libellé }) => (
            <button
              key={valeur} type="button"
              className="btn btn--quiet" style={{ width: 'auto', opacity: verrou === valeur ? 1 : 0.6 }}
              onClick={() => { setVerrou(valeur); setPage(1); }}
            >
              {libellé}
            </button>
          ))}
        </div>
      ) : null}
      <Pager total={active.total} page={active.page} pages={active.pages} onPage={setPage} />
      {sélection.size > 0 ? (
        <div className="card" style={{ padding: '13px 15px', marginBottom: 12 }}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>
            {sélection.size} correspondance(s) sélectionnée(s) → même aliment :
          </p>
          <ChoixAliment
            cible={cible}
            onChoisir={(c) => { setCible(c); setImpact(null); }}
            disabled={busy}
          />
          {cible !== null && impact === null ? (
            <button
              type="button" className="btn btn--quiet" style={{ width: '100%', marginTop: 8 }}
              disabled={busy}
              onClick={() => { void prévisualiser(); }}
            >
              {busy ? 'Calcul…' : 'Prévisualiser l’impact'}
            </button>
          ) : null}
          {impact !== null && cible !== null ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                « {cible.name} » toucherait <b>{impact.totaux.lignes} ligne(s)</b> dans{' '}
                <b>{impact.totaux.recettes} recette(s)</b>, vues par <b>{impact.totaux.foyers} foyer(s)</b>.
              </p>
              <ConfirmButton
                label={`Corriger ${impact.totaux.correspondances} correspondance(s)`}
                style={{ width: '100%', marginTop: 8 }}
                disabled={busy}
                onConfirm={() => {
                  const foodId = cible.id;
                  void agir(async () => {
                    for (const id of sélection) {
                      await api.patch(`/api/admin/food-links/${encodeURIComponent(id)}`, { foodId });
                    }
                  });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="stack">
        {vue === 'rattachees'
          ? rattachees.items.map((lien) => (
            <article key={lien.jowFoodId} className="card" style={{ padding: '13px 15px' }}>
              <div className="spread">
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox" checked={sélection.has(lien.jowFoodId)}
                    onChange={() => basculer(lien.jowFoodId)}
                    aria-label={`Sélectionner ${lien.label}`}
                  />
                  <span>
                    <span style={{ fontSize: 15 }}>« {lien.label} » → {lien.foodName}</span>
                    <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                      {lien.usageCount} ligne(s)
                    </span>
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {lien.usageCount === 0 ? <span className="chip chip--warning">Aucune ligne</span> : null}
                  {lien.locked ? <span className="chip">Verrouillé</span> : null}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                  disabled={busy}
                  onClick={() => {
                    void agir(() => api.post(
                      `/api/admin/food-links/${encodeURIComponent(lien.jowFoodId)}/verrou`,
                      { locked: !lien.locked },
                    ));
                  }}
                >
                  {lien.locked ? 'Déverrouiller' : 'Verrouiller'}
                </button>
                <ConfirmButton
                  label="Détacher partout" style={{ width: 'auto', flex: 1 }} disabled={busy}
                  onConfirm={() => {
                    void agir(() => api.patch(
                      `/api/admin/food-links/${encodeURIComponent(lien.jowFoodId)}`, { foodId: null },
                    ));
                  }}
                />
              </div>
            </article>
          ))
          : orphelins.items.map((lien) => (
            <article key={lien.jowFoodId} className="card" style={{ padding: '13px 15px' }}>
              <div className="spread">
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox" checked={sélection.has(lien.jowFoodId)}
                    onChange={() => basculer(lien.jowFoodId)}
                    aria-label={`Sélectionner ${lien.label}`}
                  />
                  <span>
                    <span style={{ fontSize: 15 }}>« {lien.label} »</span>
                    <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                      {lien.usageCount} ligne(s) en attente
                    </span>
                  </span>
                </label>
                <span className="chip chip--warning" style={{ flexShrink: 0 }}>Non rattaché</span>
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}

const LIBELLÉS_ACTION: Record<string, string> = {
  'superadmin.nommer': 'Nommé super-admin',
  'superadmin.revoquer': 'Super-admin retiré',
  'compte.supprimer': 'Compte supprimé',
  'lien.reparer': 'Lien réparé',
  'lien.detacher': 'Lien détaché',
  'lien.verrouiller': 'Lien verrouillé',
  'lien.deverrouiller': 'Lien déverrouillé',
  'aliment.corriger': 'Correspondance corrigée',
  'aliment.detacher': 'Correspondance détachée',
  'aliment.verrouiller': 'Correspondance verrouillée',
  'aliment.deverrouiller': 'Correspondance déverrouillée',
};

/**
 * Le cahier (021) : qui a fait quoi, quand, dans l'ordre inverse.
 *
 * Lecture seule — le journal raconte, il ne se réécrit pas. Le libellé dit le
 * geste en français, la cible dit sur quoi, et l'acteur dit qui : quand deux
 * super-admins se succèdent sur un lien, c'est ici que ça se voit.
 */
function OngletJournal({ onError }: { onError: (m: string | null) => void }): ReactElement {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const différée = useDélai(q);
  const { items: lignes, total, pages } = usePage<JournalLigne>(
    '/api/admin/journal', 'journal', { q: différée, page }, onError,
  );

  return (
    <section className="sec">
      <h2 className="eyebrow">Journal des gestes super-admin</h2>
      <Recherche valeur={q} onChange={(v) => { setQ(v); setPage(1); }} texte="Rechercher : geste, cible, acteur…" />
      <Pager total={total} page={page} pages={pages} onPage={setPage} />
      <div className="stack">
        {lignes.map((ligne) => (
          <article key={ligne.id} className="card" style={{ padding: '13px 15px' }}>
            <div className="spread">
              <div>
                <p style={{ fontSize: 15 }}>{LIBELLÉS_ACTION[ligne.action] ?? ligne.action}</p>
                <p className="meta" style={{ marginTop: 2 }}>
                  {new Date(ligne.at).toLocaleString('fr-FR')}
                  {ligne.actorEmail !== null ? ` · par ${ligne.actorEmail}` : ' · compte supprimé depuis'}
                </p>
                {ligne.target === '' ? null : (
                  <p className="meta" style={{ marginTop: 2 }}>{ligne.target}</p>
                )}
              </div>
            </div>
          </article>
        ))}
        {lignes.length === 0 ? (
          <p className="empty">Rien à raconter pour l’instant — les gestes ci-dessus s’y inscrivent.</p>
        ) : null}
      </div>
    </section>
  );
}
