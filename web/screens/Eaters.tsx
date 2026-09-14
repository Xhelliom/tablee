/**
 * La famille : fiches, coefficients de portion, régimes, et le rattachement
 * d'une fiche à un compte.
 *
 * **I5 — aucun objectif chiffré de calories ni de poids sur un profil
 * mineur.** Nulle part sur cet écran. Le poids existe depuis la 009, il est
 * demandé et affiché **aux adultes seulement**, comme une mesure datée et
 * jamais comme une cible : pas de série, pas de courbe, pas d'écart à un poids
 * « idéal ».
 *
 * **I2 — aucun jugement stocké.** Les régimes et préférences se disent en
 * faits : « végétarien », « aime », « n'aime pas ». Jamais « mange mal ».
 *
 * Le `portion_coef` est modifiable ici. Le changer ne touche **aucun repas
 * passé** (R2) : l'écran le dit, parce que c'est contre-intuitif et que la
 * question se posera.
 *
 * ── Convive et compte, côte à côte mais pas confondus ───────────────────────
 *
 * Chaque fiche dit où elle en est : à personne, réservée à une adresse, ou
 * rattachée à un compte. C'est ce qui permet à quelqu'un d'être saisi
 * aujourd'hui et de récupérer sa fiche le jour où il s'inscrit — sans
 * ressaisie, et sans que `eater` et `"user"` deviennent la même table (007).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { api, ApiError, type DailyBalance, type DashboardResponse, type Eater } from '../api.ts';
import { useSession } from '../session.tsx';
import { NutrientBars } from '../components/NutrientBars.tsx';
import { IconPlus } from '../icons.tsx';
import { dietLabel, NUTRIENT_COLOR } from '../design/vocabulary.ts';
import { navigate } from '../router.tsx';
import { AddEaterForm, créerInvitation, LienÀTransmettre } from '../components/AddEater.tsx';
import { ConfirmButton } from '../components/ConfirmButton.tsx';
import {
  Choix, COEF_CHOICES, coefLabel, draftToBody, ProfileFields, type ProfileDraft,
} from '../components/EaterForm.tsx';

const draftFrom = (eater: Eater): ProfileDraft => ({
  firstName: eater.firstName,
  birthDate: eater.birthDate,
  sex: eater.sex,
  portionCoef: eater.portionCoef,
  coefAuto: false,
  diets: eater.diets,
  weightKg: eater.weightKg === null ? '' : String(eater.weightKg),
  heightCm: eater.heightCm === null ? '' : String(eater.heightCm),
});

export function EatersScreen(): ReactElement {
  const { eaters, refreshEaters, role } = useSession();
  const [balances, setBalances] = useState<Map<string, DailyBalance>>(new Map());
  const [adding, setAdding] = useState(false);
  const [lien, setLien] = useState<{ url: string; pour: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parent = role === 'parent';

  const load = useCallback(async () => {
    const data = await api.get<DashboardResponse>('/api/dashboard');
    setBalances(new Map(data.dashboard.map((entry) => [entry.eater.id, entry.balance])));
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load, eaters]);

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">La famille</p>
        <p className="display" style={{ marginTop: 6 }}>Qui mange<br />à la maison</p>
      </div>

      {error !== null ? <p className="sec meta" style={{ paddingTop: 10 }}>{error}</p> : null}

      <div className="sec stack" style={{ paddingTop: 18 }}>
        {eaters.map((eater) => (
          <FicheConvive
            key={eater.id}
            eater={eater}
            balance={balances.get(eater.id) ?? null}
            onChanged={refreshEaters}
            onError={setError}
            onInvitation={setLien}
          />
        ))}

        {eaters.length === 0 && !adding ? (
          <p className="empty" style={{ padding: '10px 0' }}>
            Personne n’est encore enregistré. Sans convive, impossible de dire
            qui était à table.
          </p>
        ) : null}

        {lien !== null ? <LienÀTransmettre url={lien.url} pour={lien.pour} /> : null}

        {adding ? (
          <AddEaterForm
            onAdded={async (result) => {
              setAdding(false);
              setLien(
                result.invitationUrl === null
                  ? null
                  : { url: result.invitationUrl, pour: result.eater.firstName },
              );
              if (result.invitationError !== null) setError(result.invitationError);
              await refreshEaters();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : parent ? (
          <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>
            <IconPlus size={17} />
            Ajouter quelqu’un
          </button>
        ) : null}
      </div>

      <div className="sec" style={{ paddingTop: 18 }}>
        <p className="meta" style={{ lineHeight: 1.6 }}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: NUTRIENT_COLOR.plant, marginRight: 6,
          }} />
          Les barres montrent la journée en cours, en pourcentage du repère du
          jour. Une barre grise veut dire que le repère n’existe pas pour cet
          âge, ou que la valeur n’est pas connue — pas qu’elle vaut zéro.
        </p>
      </div>

      {/*
        Les accès, après les convives, et pas avant : la question courante est
        « qui mange », pas « qui a un compte ». Un convive n'est pas un compte
        — les enfants sont ici sans en avoir, et une nounou peut avoir un
        compte sans figurer au-dessus.
      */}
      <AccessSection />
      <div className="fab-space" />
    </>
  );
}

// ── Une fiche ───────────────────────────────────────────────────────────────

function FicheConvive({
  eater, balance, onChanged, onError, onInvitation,
}: {
  eater: Eater;
  balance: DailyBalance | null;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
  onInvitation: (lien: { url: string; pour: string } | null) => void;
}): ReactElement {
  const { role } = useSession();
  const [édition, setÉdition] = useState(false);

  // Un `adulte` tient sa fiche à jour, et rien d'autre — c'est exactement ce
  // que le serveur autorise depuis la 009. Montrer des commandes qui
  // refuseraient n'apprendrait rien à personne.
  const modifiable = role === 'parent' || eater.isMe;

  const patch = async (corps: Record<string, unknown>): Promise<void> => {
    onError(null);
    try {
      await api.patch(`/api/eaters/${eater.id}`, corps);
      await onChanged();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'la modification n’a pas pu être enregistrée');
    }
  };

  return (
    <article className="card" style={{ padding: '14px 15px' }}>
      <div className="spread">
        <div>
          <p style={{ fontSize: 16 }}>
            {eater.firstName}
            {eater.isMe ? <span className="meta"> · vous</span> : null}
          </p>
          <p className="meta" style={{ marginTop: 2 }}>
            {eater.age} ans
            {eater.diets.length > 0 ? ` · ${eater.diets.map(dietLabel).join(', ')}` : ''}
          </p>
          <Mesures eater={eater} />
        </div>
        {balance !== null ? (
          <NutrientBars balance={balance} firstName={eater.firstName} />
        ) : null}
      </div>

      {édition ? (
        <ÉditionFiche
          eater={eater}
          onCancel={() => setÉdition(false)}
          onSaved={async () => { setÉdition(false); await onChanged(); }}
          onError={onError}
        />
      ) : (
        <>
          <div style={{ marginTop: 14 }}>
            <p className="label">Combien cette personne mange, par rapport à un adulte</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {COEF_CHOICES.map((coef) => (
                <Choix
                  key={coef}
                  actif={eater.portionCoef === coef}
                  libellé={coefLabel(coef)}
                  onClick={() => {
                    if (!modifiable) {
                      onError('vous ne pouvez modifier que votre propre fiche');
                      return;
                    }
                    void patch({ portionCoef: coef });
                  }}
                />
              ))}
            </div>
            <p className="meta" style={{ marginTop: 7, lineHeight: 1.45 }}>
              Change les repas à venir. Les repas déjà enregistrés gardent la
              part qui leur a été donnée le jour même.
            </p>
          </div>

          <SectionCompte eater={eater} onChanged={onChanged} onError={onError}
                         onInvitation={onInvitation} />

          {modifiable ? (
            <button
              type="button" className="btn btn--quiet" style={{ marginTop: 12 }}
              onClick={() => setÉdition(true)}
            >
              Modifier la fiche
            </button>
          ) : null}
        </>
      )}
    </article>
  );
}

/**
 * Poids et taille, quand ils existent.
 *
 * Datés, et sans comparaison d'aucune sorte : « pesé le 14/09 » dit ce que la
 * valeur est — une mesure d'un jour — là où un nombre nu se lirait comme un
 * état permanent. Rien ne s'affiche sur un profil mineur : le serveur ne rend
 * même pas la valeur (I5).
 */
function Mesures({ eater }: { eater: Eater }): ReactElement | null {
  if (eater.weightKg === null && eater.heightCm === null) return null;
  const morceaux = [
    eater.weightKg === null ? null : `${eater.weightKg.toString().replace('.', ',')} kg`,
    eater.heightCm === null ? null : `${eater.heightCm.toString().replace('.', ',')} cm`,
  ].filter((m): m is string => m !== null);

  return (
    <p className="meta" style={{ marginTop: 2 }}>
      {morceaux.join(' · ')}
      {eater.weightRecordedAt !== null
        ? ` — pesé le ${new Date(eater.weightRecordedAt).toLocaleDateString('fr-FR')}`
        : ''}
    </p>
  );
}

function ÉditionFiche({
  eater, onCancel, onSaved, onError,
}: {
  eater: Eater;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}): ReactElement {
  const { role } = useSession();
  const [draft, setDraft] = useState<ProfileDraft>(draftFrom(eater));
  const [busy, setBusy] = useState(false);

  const envoyer = async (corps: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await api.patch(`/api/eaters/${eater.id}`, corps);
      await onSaved();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'enregistrement impossible');
      setBusy(false);
    }
  };

  return (
    <form className="stack" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); void envoyer(draftToBody(draft)); }}>
      <ProfileFields value={draft} onChange={setDraft} idPrefix={`e-${eater.id}`} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn" style={{ width: 'auto', flex: 1 }} disabled={busy}>
          {busy ? 'Un instant…' : 'Enregistrer'}
        </button>
      </div>

      {/*
        Retirer, et pas supprimer : les repas passés gardent la part figée de
        cette personne (R2). La fiche quitte la table et les bilans à venir.
      */}
      {role === 'parent' ? (
        <>
          <ConfirmButton
            label="Retirer du foyer" disabled={busy}
            onConfirm={() => { void envoyer({ active: false }); }}
          />
          <p className="meta" style={{ lineHeight: 1.5 }}>
            Les repas déjà enregistrés gardent sa part.
          </p>
        </>
      ) : null}
    </form>
  );
}

/**
 * Où en est cette fiche vis-à-vis des comptes : à personne, réservée, ou
 * rattachée.
 *
 * Les trois états se disent explicitement. « Réservée » n'est pas
 * « rattachée » : tant que la personne ne s'est pas inscrite, elle ne voit
 * rien, et laisser croire le contraire ferait attendre pour rien.
 */
function SectionCompte({
  eater, onChanged, onError, onInvitation,
}: {
  eater: Eater;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
  onInvitation: (lien: { url: string; pour: string } | null) => void;
}): ReactElement | null {
  const { role, household } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const parent = role === 'parent';

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'opération impossible');
    }
    setBusy(false);
  };

  if (eater.userId !== null) {
    return (
      <div style={{ marginTop: 12 }}>
        <p className="meta">
          {eater.isMe ? 'Cette fiche est la vôtre.' : 'Rattachée à un compte.'}
        </p>
        {parent ? (
          <button
            type="button" className="btn btn--quiet" style={{ marginTop: 8 }} disabled={busy}
            onClick={() => {
              void agir(() => api.delete(`/api/eaters/${eater.id}/compte`));
            }}
          >
            Détacher du compte
          </button>
        ) : null}
      </div>
    );
  }

  if (eater.claimEmail !== null) {
    return (
      <div style={{ marginTop: 12 }}>
        <p className="meta" style={{ lineHeight: 1.5 }}>
          Réservée à <b>{eater.claimEmail}</b>. La fiche deviendra la sienne dès
          qu’elle aura rejoint le foyer avec cette adresse — d’ici là, elle ne
          voit rien.
        </p>
        {parent ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
              disabled={busy}
              onClick={() => {
                void agir(async () => {
                  const url = await créerInvitation(
                    eater.claimEmail as string, 'adulte', household?.organizationId,
                  );
                  onInvitation({ url, pour: eater.firstName });
                });
              }}
            >
              Renvoyer une invitation
            </button>
            <button
              type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
              disabled={busy}
              onClick={() => { void agir(() => api.delete(`/api/eaters/${eater.id}/compte`)); }}
            >
              Annuler la réservation
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // Personne. On ne propose rien sur un profil mineur : `jeune` est une valeur
  // de rôle réservée, sans écran, et un enfant qui a un compte est un autre
  // produit (007).
  if (!parent || eater.minor) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {ouvert ? (
        <div className="stack">
          <div>
            <label className="label" htmlFor={`compte-${eater.id}`}>
              Son adresse e-mail
            </label>
            <input
              id={`compte-${eater.id}`} className="field" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Si cette personne est déjà dans le foyer, le rattachement est
              immédiat. Sinon la fiche lui est réservée.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--quiet" style={{ width: 'auto', flex: 1 }}
                    onClick={() => { setOuvert(false); setEmail(''); }}>
              Annuler
            </button>
            <button
              type="button" className="btn" style={{ width: 'auto', flex: 1 }}
              disabled={busy || email.trim() === ''}
              onClick={() => {
                const adresse = email.trim().toLowerCase();
                void agir(async () => {
                  const { lié } = await api.put<{ lié: boolean }>(
                    `/api/eaters/${eater.id}/compte`, { email: adresse },
                  );
                  setOuvert(false);
                  setEmail('');
                  // Pas encore dans le foyer : la fiche lui est réservée, et il
                  // reste à lui transmettre de quoi entrer.
                  if (!lié) {
                    onInvitation({
                      url: await créerInvitation(adresse, 'adulte', household?.organizationId),
                      pour: eater.firstName,
                    });
                  }
                });
              }}
            >
              Rattacher
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--quiet" onClick={() => setOuvert(true)}>
          Rattacher à un compte…
        </button>
      )}
    </div>
  );
}

/**
 * Un pied d'écran, pas un tableau de bord.
 *
 * Le détail de la gestion — qui a accès, les rôles, le fuseau, la suppression —
 * vit sur son propre écran. Ici on rappelle seulement où l'on est, et on y
 * mène : c'est un geste rare, il n'a pas à encombrer l'écran quotidien.
 */
function AccessSection(): ReactElement {
  const { user, household, role, households, switchHousehold, eaters } = useSession();
  const monAssiette = eaters.find((eater) => eater.isMe) ?? null;

  return (
    <section className="sec">
      <h2 className="eyebrow">Votre compte</h2>
      <p className="meta" style={{ lineHeight: 1.6 }}>
        {user?.name} · {user?.email}
        <br />
        Foyer : <b>{household?.name}</b> — vous y êtes{' '}
        {role === 'parent' ? 'parent' : 'adulte'}.
        <br />
        {monAssiette === null
          ? 'Vous n’avez pas de fiche à table.'
          : <>Votre fiche à table : <b>{monAssiette.firstName}</b>.</>}
      </p>

      {monAssiette === null ? (
        <button
          type="button" className="btn btn--ghost" style={{ marginTop: 12 }}
          onClick={() => navigate('/bienvenue')}
        >
          Créer ma fiche
        </button>
      ) : null}

      {households.length > 1 ? (
        <div style={{ marginTop: 14 }}>
          <p className="label">Changer de foyer</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {households.map((foyer) => (
              <Choix
                key={foyer.id}
                actif={foyer.id === household?.id}
                libellé={foyer.name}
                onClick={() => {
                  if (foyer.id !== household?.id) {
                    void switchHousehold(foyer.organizationId ?? '');
                  }
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button" className="btn btn--ghost" style={{ marginTop: 16 }}
        onClick={() => navigate('/foyer')}
      >
        Gérer le foyer et les accès
      </button>
    </section>
  );
}
