/**
 * Capture des échantillons figés pour les tests de non-régression (Tâche 0).
 *
 *   npm run jow:capture -- <recipeId | url> [recipeId | url…]
 *
 * Écrit un fichier par recette dans `server/jow/fixtures/`, contenant le nœud
 * `props.pageProps.recipe` tel que Jow le publie, plus la date de capture.
 * Les fixtures sont des **constats**, pas des données de référence : on ne les
 * édite jamais à la main, on les recapture.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractNextData } from '../server/jow/parse.ts';
import { fetchRecipeById, fetchRecipeByUrl } from '../server/jow/fetch.ts';

const FIXTURES = fileURLToPath(new URL('../server/jow/fixtures/', import.meta.url));

function recipeNode(html: string): Record<string, unknown> | null {
  const data = extractNextData(html) as
    | { props?: { pageProps?: { recipe?: Record<string, unknown> } } }
    | null;
  return data?.props?.pageProps?.recipe ?? null;
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('usage: npm run jow:capture -- <recipeId | url> [recipeId | url…]');
  process.exit(1);
}

await mkdir(FIXTURES, { recursive: true });

for (const id of ids) {
  try {
    const page = id.startsWith('http')
      ? await fetchRecipeByUrl(id)
      : await fetchRecipeById(id);
    const recipe = recipeNode(page.html);
    if (recipe === null) {
      console.error(`✗ ${id} : __NEXT_DATA__ / recipe introuvable`);
      continue;
    }
    const slug = typeof recipe['slug'] === 'string' ? recipe['slug'] : id;
    const file = `${slug}.json`;
    await writeFile(
      new URL(file, `file://${FIXTURES}`),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), url: page.url, recipe }, null, 1)}\n`,
      'utf8',
    );
    const similar = (recipe['similarRecipes'] as unknown) ?? null;
    console.log(`✓ ${id} → fixtures/${file}  « ${String(recipe['title'])} »${similar ? '' : ''}`);
  } catch (error) {
    console.error(`✗ ${id} : ${error instanceof Error ? error.message : String(error)}`);
  }
}
