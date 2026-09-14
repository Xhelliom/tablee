/**
 * Validation des corps de requête, à la main.
 *
 * Une bibliothèque de schémas serait plus courte, mais ces validateurs portent
 * des messages destinés à l'écran et des règles qui ne sont pas des types :
 * « au moins un convive », « un slot parmi les cinq ». Autant les écrire.
 */
import { ApiError } from './errors.ts';
import { SLOTS, SOURCES, type MealSource, type Slot } from '../repo/meals.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function body(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw ApiError.badRequest('corps de requête attendu');
  return value;
}

export function str(value: unknown, field: string, { max = 500 } = {}): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw ApiError.badRequest(`« ${field} » est attendu`);
  }
  if (value.length > max) throw ApiError.badRequest(`« ${field} » est trop long`);
  return value.trim();
}

export function optionalStr(value: unknown, field: string, opts?: { max?: number }): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, field, opts);
}

export function num(value: unknown, field: string, { min = -Infinity, max = Infinity } = {}): number {
  // Une chaîne vide n'est pas un zéro. `Number('')` vaut 0, et un champ laissé
  // vide se serait donc enregistré comme « 0 g » au lieu de « on ne sait pas »
  // — exactement ce que la règle « une valeur inconnue est NULL, jamais 0 »
  // interdit. Le client envoie `null` pour l'inconnu ; le reste est refusé.
  const blanc = typeof value === 'string' && value.trim().length === 0;
  const parsed = typeof value === 'string' ? (blanc ? NaN : Number(value)) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw ApiError.badRequest(`« ${field} » doit être un nombre`);
  }
  if (parsed < min || parsed > max) {
    throw ApiError.badRequest(`« ${field} » doit être compris entre ${min} et ${max}`);
  }
  return parsed;
}

export function int(value: unknown, field: string, opts?: { min?: number; max?: number }): number {
  const parsed = num(value, field, opts);
  if (!Number.isInteger(parsed)) throw ApiError.badRequest(`« ${field} » doit être un entier`);
  return parsed;
}

export function slot(value: unknown): Slot {
  if (typeof value !== 'string' || !SLOTS.includes(value as Slot)) {
    throw ApiError.badRequest(`créneau inconnu — attendu : ${SLOTS.join(', ')}`);
  }
  return value as Slot;
}

export function source(value: unknown): MealSource {
  if (typeof value !== 'string' || !SOURCES.includes(value as MealSource)) {
    throw ApiError.badRequest(`source inconnue — attendu : ${SOURCES.join(', ')}`);
  }
  return value as MealSource;
}

export function sex(value: unknown): 'F' | 'M' {
  if (value !== 'F' && value !== 'M') throw ApiError.badRequest('« sex » doit valoir F ou M');
  return value;
}

/** `YYYY-MM-DD`, et une date qui existe vraiment. */
export function isoDate(value: unknown, field: string): string {
  const text = str(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw ApiError.badRequest(`« ${field} » doit être une date AAAA-MM-JJ`);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(text)) {
    throw ApiError.badRequest(`« ${field} » n’est pas une date valide`);
  }
  return text;
}

/**
 * Une adresse e-mail, ramenée en minuscules.
 *
 * La validation est volontairement grossière — « une arobase, et un point
 * après ». Une expression rationnelle exhaustive refuse des adresses valides,
 * et de toute façon rien ici ne prouve qu'une adresse existe : la vérification
 * attend un serveur SMTP (dette n° 7). Ce qui compte, c'est la normalisation :
 * `Marie@Exemple.fr` et `marie@exemple.fr` doivent rattacher la même assiette.
 */
export function email(value: unknown, field: string): string {
  const text = str(value, field, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw ApiError.badRequest(`« ${text} » n’est pas une adresse e-mail`);
  }
  return text;
}

export function isoDateTime(value: unknown, field: string): string {
  const text = str(value, field, { max: 40 });
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`« ${field} » doit être une date et une heure`);
  }
  return date.toISOString();
}

/**
 * Un identifiant de fuseau IANA, et rien d'autre.
 *
 * Ce n'est pas un réglage d'affichage : `household.timezone` découpe les
 * journées et les mois de saisonnalité **dans le SQL** (`at time zone`).
 * Une valeur fantaisiste acceptée déplacerait la frontière entre hier et
 * aujourd'hui, et fausserait tous les bilans sans rien dire.
 *
 * `Intl.DateTimeFormat` lève sur une valeur inconnue : c'est la même base que
 * celle de Postgres pour les noms courants, et s'appuyer dessus évite de
 * maintenir une liste qui vieillirait mal — les fuseaux changent, les pays en
 * créent et en suppriment.
 */
export function timezone(value: unknown, field: string): string {
  const raw = optionalStr(value, field, { max: 64 });
  if (raw === null) {
    throw ApiError.badRequest(`${field} est requis`);
  }
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: raw });
  } catch {
    throw ApiError.badRequest(`« ${raw} » n’est pas un fuseau horaire connu`, 'fuseau_inconnu');
  }
  return raw;
}

export function uuid(value: unknown, field: string): string {
  const text = str(value, field, { max: 40 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw ApiError.badRequest(`« ${field} » n’est pas un identifiant valide`);
  }
  return text;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

export function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw ApiError.badRequest(`« ${field} » doit être une liste`);
  return value;
}

export function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((v, i) => str(v, `${field}[${i}]`, { max: 80 }));
}

/** Convives : le client envoie `present`, jamais `share` (§12). */
export function participants(value: unknown): { eaterId: string; present: boolean }[] {
  return array(value, 'participants').map((raw, i) => {
    const item = isRecord(raw) ? raw : {};
    if ('share' in item) {
      // R2 : les parts sont l'affaire du serveur. Les accepter du client
      // ouvrirait la porte à un historique incohérent, impossible à rattraper.
      throw ApiError.badRequest('les parts sont calculées par le serveur, pas envoyées par le client');
    }
    return {
      eaterId: uuid(item['eaterId'], `participants[${i}].eaterId`),
      present: item['present'] !== false,
    };
  });
}

export function mealItems(value: unknown): {
  foodId: string | null; label: string; quantity: number | null;
  unit: string | null; quantityG: number | null;
}[] {
  return array(value, 'items').map((raw, i) => {
    const item = isRecord(raw) ? raw : {};
    return {
      foodId: optionalUuid(item['foodId'], `items[${i}].foodId`),
      label: str(item['label'], `items[${i}].label`, { max: 200 }),
      quantity: item['quantity'] === undefined || item['quantity'] === null
        ? null
        : num(item['quantity'], `items[${i}].quantity`, { min: 0, max: 100_000 }),
      unit: optionalStr(item['unit'], `items[${i}].unit`, { max: 40 }),
      quantityG: item['quantityG'] === undefined || item['quantityG'] === null
        ? null
        : num(item['quantityG'], `items[${i}].quantityG`, { min: 0, max: 100_000 }),
    };
  });
}
