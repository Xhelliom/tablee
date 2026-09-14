/**
 * Les champs d'une fiche de convive, en un seul endroit.
 *
 * Le même formulaire sert à trois moments — l'arrivée dans l'app, l'ajout d'un
 * proche, la modification d'une fiche — et les trois doivent poser exactement
 * les mêmes questions. Les dupliquer, c'est se retrouver avec un poids
 * demandé ici et pas là, ou une règle I5 appliquée à un endroit sur deux.
 *
 * ── Ce que ce formulaire refuse de faire ────────────────────────────────────
 *
 * **Aucun champ de poids sur un profil mineur.** Pas grisé, pas « à remplir
 * plus tard » : absent. I5 interdit tout objectif chiffré de poids sur la fiche
 * d'un enfant, et un champ vide est une invitation à le remplir. Le serveur
 * refuse aussi, mais l'interface ne doit pas poser la question.
 *
 * **Aucune préférence formulée en jugement.** Les régimes sont des faits
 * déclarés — « végétarien », « sans porc ». « Mange mal » n'est pas un régime
 * (I2).
 */
import type { ReactElement } from 'react';
import { DIET_CHOICES } from '../design/vocabulary.ts';

/** Repères grossiers du §10 : « démarrer grossier, affiner à l'usage ». */
export const COEF_CHOICES = [0.5, 0.75, 1];

export const coefLabel = (coef: number): string =>
  coef === 1 ? 'Comme un adulte' : `${Math.round(coef * 100)} %`;

/** Âge en années révolues, pour un formulaire en cours de saisie. */
export function ageFromBirthDate(birthDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const mois = now.getUTCMonth() - birth.getUTCMonth();
  if (mois < 0 || (mois === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age < 0 || age > 130 ? null : age;
}

export const isMinorBirthDate = (birthDate: string): boolean => {
  const age = ageFromBirthDate(birthDate);
  return age !== null && age < 18;
};

/**
 * Une portion **proposée** d'après l'âge, jamais posée en silence.
 *
 * Ce n'est pas une valeur nutritionnelle — I1 ne s'applique pas — mais un
 * réglage de foyer que la spec elle-même dit de démarrer grossier et d'affiner
 * à l'usage. Le formulaire le pré-sélectionne et le dit ; il reste à un tap de
 * la personne qui saisit, qui connaît son enfant mieux qu'une table.
 */
export function suggestedCoef(birthDate: string): number {
  const age = ageFromBirthDate(birthDate);
  if (age === null || age >= 13) return 1;
  if (age >= 8) return 0.75;
  return 0.5;
}

export interface ProfileDraft {
  firstName: string;
  birthDate: string;
  sex: 'F' | 'M';
  portionCoef: number;
  /** `true` tant que personne n'a touché aux portions : la proposition suit l'âge. */
  coefAuto: boolean;
  diets: string[];
  /** Saisis en texte : un champ vide vaut « inconnu », jamais zéro. */
  weightKg: string;
  heightCm: string;
}

export const emptyDraft = (firstName = ''): ProfileDraft => ({
  firstName,
  birthDate: '',
  sex: 'F',
  portionCoef: 1,
  coefAuto: true,
  diets: [],
  weightKg: '',
  heightCm: '',
});

/**
 * Le corps de requête correspondant. Un champ laissé vide part à `null` — une
 * valeur inconnue est `null`, jamais `0`.
 */
export function draftToBody(draft: ProfileDraft): Record<string, unknown> {
  const mineur = isMinorBirthDate(draft.birthDate);
  const nombre = (texte: string): number | null => {
    const valeur = Number(texte.replace(',', '.'));
    return texte.trim() === '' || !Number.isFinite(valeur) ? null : valeur;
  };

  return {
    firstName: draft.firstName.trim(),
    birthDate: draft.birthDate,
    sex: draft.sex,
    portionCoef: draft.portionCoef,
    diets: draft.diets,
    // Rien n'est envoyé pour un mineur — pas même `null` : le serveur refuse
    // le champ, et l'envoyer vide ferait échouer une fiche parfaitement valide.
    ...(mineur ? {} : { weightKg: nombre(draft.weightKg), heightCm: nombre(draft.heightCm) }),
  };
}

interface Props {
  value: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  /** Préfixe des `id`, pour que deux formulaires puissent cohabiter. */
  idPrefix: string;
  /** Le poids ne se propose qu'à qui remplit sa propre fiche ou celle d'un adulte. */
  showBody?: boolean;
}

export function ProfileFields({ value, onChange, idPrefix, showBody = true }: Props): ReactElement {
  const set = (patch: Partial<ProfileDraft>): void => onChange({ ...value, ...patch });
  const age = ageFromBirthDate(value.birthDate);
  const mineur = isMinorBirthDate(value.birthDate);

  // La proposition suit l'âge tant que personne n'a tranché. Dès qu'un choix
  // est fait, il tient : corriger une date de naissance ne doit pas réécrire
  // un coefficient choisi exprès.
  const setBirthDate = (birthDate: string): void =>
    set({
      birthDate,
      ...(value.coefAuto ? { portionCoef: suggestedCoef(birthDate) } : {}),
    });

  return (
    <>
      <div>
        <label className="label" htmlFor={`${idPrefix}-firstName`}>Prénom</label>
        <input
          id={`${idPrefix}-firstName`} className="field" value={value.firstName} required
          autoComplete="off" maxLength={80}
          onChange={(e) => set({ firstName: e.target.value })}
        />
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-birthDate`}>Date de naissance</label>
        <input
          id={`${idPrefix}-birthDate`} className="field" type="date" value={value.birthDate}
          required max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirthDate(e.target.value)}
        />
        {/* L'âge se calcule, il ne se stocke pas : il sert à choisir le repère
            de la bonne tranche (§9). */}
        <p className="meta" style={{ marginTop: 5 }}>
          {age === null
            ? 'Sert à choisir le repère nutritionnel de la bonne tranche d’âge.'
            : `${age} ans — le repère de cette tranche d’âge sera utilisé.`}
        </p>
      </div>

      <div>
        <span className="label">Sexe</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['F', 'M'] as const).map((option) => (
            <Choix
              key={option}
              actif={value.sex === option}
              onClick={() => set({ sex: option })}
              libellé={option === 'F' ? 'Féminin' : 'Masculin'}
            />
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
            <Choix
              key={coef}
              actif={value.portionCoef === coef}
              onClick={() => set({ portionCoef: coef, coefAuto: false })}
              libellé={coefLabel(coef)}
            />
          ))}
        </div>
        <p className="meta" style={{ marginTop: 6, lineHeight: 1.45 }}>
          {value.coefAuto && age !== null
            ? 'Proposé d’après l’âge — à ajuster, vous connaissez l’appétit mieux qu’une table.'
            : 'Ne change que les repas à venir : ceux déjà enregistrés gardent leur part.'}
        </p>
      </div>

      <div>
        <span className="label">Régimes</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DIET_CHOICES.map(({ value: régime, label }) => (
            <Choix
              key={régime}
              actif={value.diets.includes(régime)}
              onClick={() =>
                set({
                  diets: value.diets.includes(régime)
                    ? value.diets.filter((d) => d !== régime)
                    : [...value.diets, régime],
                })
              }
              libellé={label}
            />
          ))}
        </div>
      </div>

      {/*
        I5 — le champ n'existe pas sur un profil mineur. Pas grisé : absent.
        Tant que la date de naissance n'est pas saisie, on ne sait pas, et on
        ne demande donc rien.
      */}
      {showBody && age !== null && !mineur ? (
        <div>
          <span className="label">Poids et taille — facultatif</span>
          <div className="grid2">
            <input
              className="field" inputMode="decimal" placeholder="kg"
              aria-label="Poids en kilogrammes" value={value.weightKg}
              onChange={(e) => set({ weightKg: e.target.value })}
            />
            <input
              className="field" inputMode="numeric" placeholder="cm"
              aria-label="Taille en centimètres" value={value.heightCm}
              onChange={(e) => set({ heightCm: e.target.value })}
            />
          </div>
          <p className="meta" style={{ marginTop: 6, lineHeight: 1.45 }}>
            Une mesure, pas un objectif : aucun poids cible, aucune courbe,
            aucun écart affiché. Demandé aux adultes seulement.
          </p>
        </div>
      ) : null}
    </>
  );
}

/**
 * Une puce sélectionnable.
 *
 * Le terracotta de marque, jamais une couleur de nutriment : les cinq
 * couleurs de la palette n'apparaissent que sur des données nutritionnelles
 * (§8ter).
 */
export function Choix({
  actif, onClick, libellé,
}: { actif: boolean; onClick: () => void; libellé: string }): ReactElement {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={actif}
      style={{
        cursor: 'pointer',
        background: actif ? 'var(--coral)' : 'var(--surface-1)',
        color: actif ? '#fff' : 'var(--text-secondary)',
      }}
      onClick={onClick}
    >
      {libellé}
    </button>
  );
}
