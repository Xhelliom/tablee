/**
 * Critère de sortie de la Tâche 0 : texte de partage Jow → JSON exploitable.
 *
 *   npm run jow:resolve -- "<texte partagé>"
 *   pbpaste | npm run jow:resolve
 *
 * ⚠️ Le texte passé en argument peut contenir `key` / `userId` : ce script ne
 * réaffiche jamais l'entrée brute (I6). Seule la sortie expurgée est imprimée.
 */
import { resolveShare } from '../server/jow/index.ts';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const text = process.argv.slice(2).join(' ').trim() || (await readStdin()).trim();
if (text.length === 0) {
  console.error('usage: npm run jow:resolve -- "<texte partagé depuis Jow>"');
  process.exit(1);
}

const recipe = await resolveShare(text);
console.log(JSON.stringify(recipe, null, 2));

// Une confiance basse n'est pas une erreur : c'est la bascule vers la saisie
// manuelle. On sort en 1 pour que les scripts appelants puissent la détecter.
process.exit(recipe.confidence === 'basse' ? 1 : 0);
