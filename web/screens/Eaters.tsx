/**
 * La famille : fiches, coefficients de portion, régimes.
 *
 * **I5 — aucun objectif chiffré de calories ni de poids sur un profil
 * mineur.** Nulle part sur cet écran. Pas de poids du tout, d'ailleurs : la
 * table n'en a pas, et c'est délibéré.
 *
 * **I2 — aucun jugement stocké.** Les préférences se disent en faits :
 * « aime », « n'aime pas », « évite ». Jamais « mange mal ».
 *
 * Le `portion_coef` est modifiable ici. Le changer ne touche **aucun repas
 * passé** (R2) : l'écran le dit, parce que c'est contre-intuitif et que la
 * question se posera.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type DailyBalance, type DashboardResponse, type Eater } from '../api.ts';
import { useSession } from '../session.tsx';
import { NutrientBars } from '../components/NutrientBars.tsx';
import { IconPlus } from '../icons.tsx';
import { NUTRIENT_COLOR } from '../design/vocabulary.ts';
import { InviteMembers } from './Invitation.tsx';

/** Repères grossiers du §10 : « démarrer grossier, affiner à l'usage ». */
const COEF_CHOICES = [0.5, 0.75, 1];

export function EatersScreen(): React.ReactElement {
  const { eaters, refreshEaters } = useSession();
  const [balances, setBalances] = useState<Map<string, DailyBalance>>(new Map());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<DashboardResponse>('/api/dashboard');
    setBalances(new Map(data.dashboard.map((entry) => [entry.eater.id, entry.balance])));
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load, eaters]);

  const setCoef = async (eater: Eater, portionCoef: number): Promise<void> => {
    try {
      await api.patch(`/api/eaters/${eater.id}`, { portionCoef });
      await refreshEaters();
    } catch {
      setError('la modification n’a pas pu être enregistrée');
    }
  };

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">La famille</p>
        <p className="display" style={{ marginTop: 6 }}>Qui mange<br />à la maison</p>
      </div>

      {error !== null ? <p className="sec meta" style={{ paddingTop: 10 }}>{error}</p> : null}

      <div className="sec stack" style={{ paddingTop: 18 }}>
        {eaters.map((eater) => (
          <article key={eater.id} className="card" style={{ padding: '14px 15px' }}>
            <div className="spread">
              <div>
                <p style={{ fontSize: 16 }}>{eater.firstName}</p>
                <p className="meta" style={{ marginTop: 2 }}>
                  {eater.age} ans
                  {eater.diets.length > 0 ? ` · ${eater.diets.join(', ')}` : ''}
                </p>
              </div>
              {balances.get(eater.id) !== undefined ? (
                <NutrientBars balance={balances.get(eater.id) as DailyBalance}
                              firstName={eater.firstName} />
              ) : null}
            </div>

            <div style={{ marginTop: 14 }}>
              <p className="label">Combien cette personne mange, par rapport à un adulte</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {COEF_CHOICES.map((coef) => (
                  <button
                    key={coef}
                    type="button"
                    onClick={() => { void setCoef(eater, coef); }}
                    className="chip"
                    style={{
                      cursor: 'pointer',
                      background: eater.portionCoef === coef ? 'var(--coral)' : 'var(--surface-1)',
                      color: eater.portionCoef === coef ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {coef === 1 ? 'Comme un adulte' : `${coef * 100} %`}
                  </button>
                ))}
              </div>
              <p className="meta" style={{ marginTop: 7, lineHeight: 1.45 }}>
                Change les repas à venir. Les repas déjà enregistrés gardent la
                part qui leur a été donnée le jour même.
              </p>
            </div>
          </article>
        ))}

        {eaters.length === 0 && !adding ? (
          <p className="empty" style={{ padding: '10px 0' }}>
            Personne n’est encore enregistré. Sans convive, impossible de dire
            qui était à table.
          </p>
        ) : null}

        {adding ? (
          <NewMember
            onDone={async () => { setAdding(false); await refreshEaters(); }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>
            <IconPlus size={17} />
            Ajouter quelqu’un
          </button>
        )}
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

function NewMember({
  onDone, onCancel,
}: { onDone: () => Promise<void>; onCancel: () => void }): React.ReactElement {
  const [firstName, setFirstName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [sex, setSex] = useState<'F' | 'M'>('F');
  const [portionCoef, setPortionCoef] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/eaters', { firstName, birthDate, sex, portionCoef });
      await onDone();
    } catch {
      setError('création impossible — vérifie la date de naissance');
      setBusy(false);
    }
  };

  return (
    <form className="card stack" style={{ padding: '14px 15px' }}
          onSubmit={(e) => { void submit(e); }}>
      <div>
        <label className="label" htmlFor="firstName">Prénom</label>
        <input id="firstName" className="field" value={firstName} required
               onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="birthDate">Date de naissance</label>
        <input id="birthDate" className="field" type="date" value={birthDate} required
               onChange={(e) => setBirthDate(e.target.value)} />
        {/* L'âge se calcule, il ne se stocke pas : il sert à choisir le repère
            de la bonne tranche (§9). */}
        <p className="meta" style={{ marginTop: 5 }}>
          Sert à choisir le repère nutritionnel de la bonne tranche d’âge.
        </p>
      </div>
      <div>
        <span className="label">Sexe</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['F', 'M'] as const).map((option) => (
            <button key={option} type="button" className="chip"
                    style={{
                      cursor: 'pointer',
                      background: sex === option ? 'var(--coral)' : 'var(--surface-1)',
                      color: sex === option ? '#fff' : 'var(--text-secondary)',
                    }}
                    onClick={() => setSex(option)}>
              {option === 'F' ? 'Féminin' : 'Masculin'}
            </button>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 5 }}>
          Les repères de l’ANSES sont sexués à partir de l’adolescence.
        </p>
      </div>
      <div>
        <span className="label">Portion, par rapport à un adulte</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {COEF_CHOICES.map((coef) => (
            <button key={coef} type="button" className="chip"
                    style={{
                      cursor: 'pointer',
                      background: portionCoef === coef ? 'var(--coral)' : 'var(--surface-1)',
                      color: portionCoef === coef ? '#fff' : 'var(--text-secondary)',
                    }}
                    onClick={() => setPortionCoef(coef)}>
              {coef === 1 ? 'Comme un adulte' : `${coef * 100} %`}
            </button>
          ))}
        </div>
      </div>
      {error !== null ? (
        <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn" disabled={busy}>Ajouter</button>
      </div>
    </form>
  );
}


/**
 * Le compte, le foyer actif, et les invitations.
 *
 * Volontairement au bas de l'écran « La famille » plutôt que dans un écran de
 * réglages à part : gérer les accès est un geste rare, et lui donner un onglet
 * le mettrait au même niveau que la saisie, qui est quotidienne.
 */
function AccessSection(): React.ReactElement {
  const { user, household, role, households, switchHousehold, signOut } = useSession();

  return (
    <>
      <InviteMembers />

      <section className="sec">
        <h2 className="eyebrow">Votre compte</h2>
        <p className="meta" style={{ lineHeight: 1.6 }}>
          {user?.name} · {user?.email}
          <br />
          Foyer : <b>{household?.name}</b> — vous y êtes{' '}
          {role === 'parent' ? 'parent' : 'adulte'}.
        </p>

        {households.length > 1 ? (
          <div style={{ marginTop: 14 }}>
            <p className="label">Changer de foyer</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {households.map((foyer) => (
                <button
                  key={foyer.id}
                  type="button"
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    background: foyer.id === household?.id ? 'var(--coral)' : 'var(--surface-1)',
                    color: foyer.id === household?.id ? '#fff' : 'var(--text-secondary)',
                  }}
                  onClick={() => {
                    if (foyer.id !== household?.id) {
                      void switchHousehold(foyer.organizationId ?? '');
                    }
                  }}
                >
                  {foyer.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button" className="btn btn--ghost" style={{ marginTop: 16 }}
          onClick={() => { void signOut(); }}
        >
          Se déconnecter
        </button>
      </section>
    </>
  );
}
