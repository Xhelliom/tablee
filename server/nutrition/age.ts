/**
 * L'âge se calcule, il ne se stocke pas (§10) : `eater.birth_date` est la
 * seule vérité, et un âge stocké serait faux dès le lendemain.
 */

/** Âge en années révolues à la date donnée. */
export function ageAt(birthDate: string, on: Date = new Date()): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) throw new Error(`date de naissance illisible : ${birthDate}`);

  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = on.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/**
 * L'âge à partir duquel un profil cesse d'être mineur.
 *
 * Nommé plutôt que recopié : I5 s'applique à plusieurs endroits — le poids
 * (009), le repère énergétique et la barre « Énergie » (017) — et un 18 en
 * dur dans chacun est un 18 qu'on oublie de changer dans l'un d'eux.
 */
export const MAJORITE = 18;

/** Un profil mineur : I5 y interdit tout objectif chiffré de calories ou de poids. */
export function isMinor(birthDate: string, on: Date = new Date()): boolean {
  return isMinorAge(ageAt(birthDate, on));
}

/** Le même test, quand l'âge est déjà calculé. */
export function isMinorAge(age: number): boolean {
  return age < MAJORITE;
}

/**
 * Tranche d'âge grossière, pour le contexte envoyé au LLM.
 *
 * I3 : le modèle reçoit « 1 enfant (6-9 ans) », jamais une date de naissance.
 * La fonction vit ici parce que la tranche se dérive de l'âge ; les assistants
 * s'en servent pour décrire le foyer (`server/llm/conseil.ts`).
 */
export function ageBracket(age: number): string {
  if (age < 1) return 'moins de 1 an';
  if (age <= 3) return '1-3 ans';
  if (age <= 5) return '4-5 ans';
  if (age <= 9) return '6-9 ans';
  if (age <= 12) return '10-12 ans';
  if (age <= 15) return '13-15 ans';
  if (age <= 17) return '16-17 ans';
  return 'adulte';
}
