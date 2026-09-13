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

/** Un profil mineur : I5 y interdit tout objectif chiffré de calories ou de poids. */
export function isMinor(birthDate: string, on: Date = new Date()): boolean {
  return ageAt(birthDate, on) < 18;
}

/**
 * Tranche d'âge grossière, pour le contexte envoyé au LLM (V3).
 *
 * I3 : le modèle reçoit « 1 enfant (6-9 ans) », jamais une date de naissance.
 * La fonction vit ici parce que la tranche se dérive de l'âge, mais elle n'a
 * aucun usage en V1 — aucun appel LLM n'existe encore.
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
