/**
 * L'arrivée dans un foyer vide.
 *
 * ── Ce que cet écran répare ─────────────────────────────────────────────────
 *
 * Jusqu'ici, créer un compte puis un foyer menait à une app vide : pas de
 * convive, donc pas de bilan, donc rien à regarder — et surtout, impossible
 * d'enregistrer un repas, puisqu'un repas sans convive n'a personne à qui
 * l'attribuer. La première chose que faisait l'app était de ne rien faire.
 *
 * Deux temps, et pas un de plus. La friction de saisie est le vrai risque du
 * projet : chaque question posée ici est une question de moins posée au
 * moment du premier partage Jow, mais une question de trop est quelqu'un qui
 * repose son téléphone.
 *
 *   1. **Votre assiette** — celle du compte qui vient d'arriver. Sautable :
 *      une nounou a un compte et ne mange pas ici.
 *   2. **Qui d'autre est à table** — les enfants, le conjoint. Et pour un
 *      adulte, l'invitation se prépare dans le même geste.
 *
 * ── I5, dès la première seconde ─────────────────────────────────────────────
 *
 * Aucun objectif, aucun chiffre de calories, aucun poids demandé sur un profil
 * mineur. Le vocabulaire parle de qui mange et de combien il mange par rapport
 * à un adulte — pas d'objectifs à atteindre.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { api, ApiError, type Eater } from '../api.ts';
import { navigate, useRoute } from '../router.tsx';
import { useSession } from '../session.tsx';
import { IconBowl, IconPlus } from '../icons.tsx';
import { AddEaterForm, LienÀTransmettre, type AddedEater } from '../components/AddEater.tsx';
import {
  draftToBody, emptyDraft, ProfileFields, type ProfileDraft,
} from '../components/EaterForm.tsx';
import { dietLabel } from '../design/vocabulary.ts';
import { ÉditionFiche } from './Eaters.tsx';

type Étape = 'moi' | 'famille';

export function OnboardingScreen(): ReactElement {
  const { user, household, eaters, refreshEaters } = useSession();
  const { path } = useRoute();
  const moi = eaters.find((eater) => eater.isMe) ?? null;
  const [étape, setÉtape] = useState<Étape>(moi === null ? 'moi' : 'famille');
  const [liens, setLiens] = useState<{ prénom: string; url: string }[]>([]);

  /**
   * L'accueil s'ancre sur son URL dès qu'il s'affiche.
   *
   * Sans ça, il disparaît **au milieu de lui-même** : on y arrive parce que le
   * foyer est vide, et la première fiche créée fait cesser cette condition —
   * l'écran s'effaçait donc entre l'étape 1 et l'étape 2, en laissant
   * l'utilisateur sur un accueil qu'il n'avait pas demandé. `replace` et non
   * `push` : le retour arrière doit ramener d'où l'on vient, pas rejouer
   * l'accueil.
   */
  useEffect(() => {
    if (path !== '/bienvenue') navigate('/bienvenue', { replace: true });
  }, [path]);

  const ajouté = async (result: AddedEater): Promise<void> => {
    await refreshEaters();
    if (result.invitationUrl !== null) {
      setLiens((liste) => [{ prénom: result.eater.firstName, url: result.invitationUrl as string }, ...liste]);
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

      {étape === 'moi' ? (
        <MonAssiette
          nomDuCompte={user?.name ?? ''}
          onDone={async () => { await refreshEaters(); setÉtape('famille'); }}
          onSkip={() => setÉtape('famille')}
        />
      ) : (
        <LaFamille
          foyer={household?.name ?? 'votre foyer'}
          moi={moi}
          autres={eaters.filter((eater) => !eater.isMe)}
          liens={liens}
          onAdded={ajouté}
          onChanged={refreshEaters}
          onRetourMoi={() => setÉtape('moi')}
        />
      )}

      <div className="fab-space" />
    </div>
  );
}

// ── 1. Votre assiette ───────────────────────────────────────────────────────

function MonAssiette({
  nomDuCompte, onDone, onSkip,
}: { nomDuCompte: string; onDone: () => Promise<void>; onSkip: () => void }): ReactElement {
  // Le prénom du compte est une proposition, pas une vérité : « Stéphane W. »
  // est un nom de compte, « Stéphane » est un prénom à table.
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft(nomDuCompte.split(' ')[0] ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ eater: Eater }>('/api/eaters', { ...draftToBody(draft), self: true });
      await onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'création impossible');
      setBusy(false);
    }
  };

  return (
    <div className="sec" style={{ paddingTop: 26 }}>
      <p className="eyebrow">1 sur 2</p>
      <p className="display" style={{ marginTop: 6 }}>Votre<br />assiette</p>
      <p className="meta" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Votre compte sert à entrer dans l’app ; votre assiette sert à savoir ce
        que vous avez mangé. Ce ne sont pas la même chose, et un plat se
        répartit entre les assiettes qui étaient là.
      </p>

      <form className="stack" style={{ marginTop: 22 }} onSubmit={(e) => { void submit(e); }}>
        <ProfileFields value={draft} onChange={setDraft} idPrefix="moi" />

        {error !== null ? (
          <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
        ) : null}

        <button className="btn" type="submit"
                disabled={busy || draft.firstName.trim() === '' || draft.birthDate === ''}>
          {busy ? 'Un instant…' : 'Continuer'}
        </button>
      </form>

      {/*
        Un compte n'implique pas une assiette (007). Une nounou entre ici, et
        l'obliger à s'inventer une fiche remplirait la table de convives qui ne
        mangent pas.
      */}
      <button type="button" className="btn btn--quiet" style={{ marginTop: 14 }} onClick={onSkip}>
        Je ne mange pas dans ce foyer
      </button>
    </div>
  );
}

// ── 2. Qui d'autre est à table ──────────────────────────────────────────────

function LaFamille({
  foyer, moi, autres, liens, onAdded, onChanged, onRetourMoi,
}: {
  foyer: string;
  moi: Eater | null;
  autres: Eater[];
  liens: { prénom: string; url: string }[];
  onAdded: (result: AddedEater) => Promise<void>;
  onChanged: () => Promise<void>;
  onRetourMoi: () => void;
}): ReactElement {
  const [ouvert, setOuvert] = useState(autres.length === 0);
  const total = (moi === null ? 0 : 1) + autres.length;

  return (
    <div className="sec" style={{ paddingTop: 26 }}>
      <p className="eyebrow">2 sur 2</p>
      <p className="display" style={{ marginTop: 6 }}>Qui d’autre<br />est à table ?</p>
      <p className="meta" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Les enfants, le conjoint, qui vous voulez. Chacun aura son bilan, réparti
        selon son âge et sa portion — c’est là que {foyer} sert à quelque chose.
      </p>

      <div className="stack" style={{ marginTop: 20 }}>
        {moi !== null ? <FicheBrève eater={moi} onChanged={onChanged} /> : null}
        {autres.map((eater) => <FicheBrève key={eater.id} eater={eater} onChanged={onChanged} />)}
      </div>

      {liens.map(({ prénom, url }) => (
        <LienÀTransmettre key={url} url={url} pour={prénom} />
      ))}

      <div style={{ marginTop: 16 }}>
        {ouvert ? (
          <AddEaterForm
            onAdded={async (result) => { await onAdded(result); setOuvert(false); }}
            {...(total === 0 ? {} : { onCancel: () => setOuvert(false) })}
          />
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setOuvert(true)}>
            <IconPlus size={17} />
            Ajouter quelqu’un
          </button>
        )}
      </div>

      <button
        className="btn" style={{ marginTop: 18 }} type="button"
        disabled={total === 0}
        onClick={() => navigate('/')}
      >
        {total === 0 ? 'Ajoutez au moins une personne' : 'C’est tout le monde'}
      </button>

      {moi === null ? (
        <button type="button" className="btn btn--quiet" style={{ marginTop: 12 }}
                onClick={onRetourMoi}>
          Finalement, je mange ici aussi
        </button>
      ) : null}

      <p className="meta" style={{ marginTop: 18, lineHeight: 1.6 }}>
        Rien n’est définitif : une fiche se corrige ici, ou plus tard depuis
        « La famille », et changer une portion ne réécrit aucun repas déjà
        enregistré.
      </p>
    </div>
  );
}

/**
 * Une personne déjà à table, et de quoi la corriger sans quitter l'accueil.
 *
 * C'est ici qu'on se trompe — une date de naissance, un prénom, quelqu'un
 * ajouté deux fois — et renvoyer vers « La famille » obligeait à sortir d'un
 * parcours pas fini. Le formulaire est celui de la famille, retrait compris, et
 * suit les mêmes droits : un parent corrige tout le monde, un adulte sa fiche.
 */
function FicheBrève({ eater, onChanged }: { eater: Eater; onChanged: () => Promise<void> }): ReactElement {
  const { role } = useSession();
  const [édition, setÉdition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modifiable = role === 'parent' || eater.isMe;

  return (
    <article className="card" style={{ padding: '12px 15px' }}>
      <div className="spread">
        <div>
          <p style={{ fontSize: 15 }}>
            {eater.firstName}
            {eater.isMe ? <span className="meta"> · vous</span> : null}
          </p>
          <p className="meta" style={{ marginTop: 2 }}>
            {eater.age} ans
            {eater.diets.length > 0 ? ` · ${eater.diets.map(dietLabel).join(', ')}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {eater.claimEmail !== null ? <span className="chip">Invitée</span> : null}
          {modifiable && !édition ? (
            <button type="button" className="chip" style={{ cursor: 'pointer' }}
                    onClick={() => { setError(null); setÉdition(true); }}>
              Modifier
            </button>
          ) : null}
        </div>
      </div>

      {édition ? (
        <ÉditionFiche
          eater={eater}
          onCancel={() => setÉdition(false)}
          onSaved={async () => { setÉdition(false); await onChanged(); }}
          onError={setError}
        />
      ) : null}
      {error !== null ? (
        <p style={{ fontSize: 13, color: 'var(--text-warning)', marginTop: 8 }}>{error}</p>
      ) : null}
    </article>
  );
}
