/**
 * Découpage des journées dans le fuseau du foyer (`household.timezone`).
 *
 * Un dîner du 13 septembre à 22 h 30 heure de Paris appartient à la journée du
 * 13, pas à celle du 14 UTC. Sans ce soin, un repas sur deux glisse d'un jour
 * en hiver et le bilan du jour devient faux sans prévenir.
 */

/** La date du jour telle que le foyer la lit — ou celle d'un instant donné. */
export function todayIn(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: timezone }).format(at);
}

/** Une date AAAA-MM-JJ décalée de `delta` jours. Une date n'a pas de fuseau. */
export function shiftDay(date: string, delta: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + delta);
  return day.toISOString().slice(0, 10);
}

export function nextDay(date: string): string {
  return shiftDay(date, 1);
}

/** Semaine ISO : elle commence le lundi. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const shift = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - shift);
  return day.toISOString().slice(0, 10);
}

/** Décalage du fuseau à cette date — l'heure d'été change deux fois par an. */
export function offsetOf(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  return name.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '+00:00';
}

/** Début d'une journée locale, sous forme d'instant absolu. */
export function startOfDay(date: string, timezone: string): string {
  return `${date}T00:00:00${offsetOf(new Date(`${date}T12:00:00Z`), timezone)}`;
}
