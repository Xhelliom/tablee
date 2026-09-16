/**
 * Ce que Chrome exige avant d'émettre `beforeinstallprompt` — et donc avant
 * que le bandeau d'installation (`web/components/InstallBanner.tsx`) et le
 * share target Android existent. Lu depuis `web/public/`, sans base ni
 * serveur : ce test tourne dans un `npm test` nu.
 *
 * Le HTTPS et le type MIME du manifeste ne se vérifient qu'en service
 * (`docs/mise-en-service.md`) ; `@fastify/static` sert `.webmanifest` en
 * `application/manifest+json` de lui-même.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const pub = new URL('../web/public/', import.meta.url);
const lire = (f: string): string => readFileSync(new URL(f, pub), 'utf8');

describe('installabilité de la PWA', () => {
  it('la page référence le manifeste, et main.tsx enregistre le service worker', () => {
    assert.match(lire('../index.html'), /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(lire('../main.tsx'), /serviceWorker\.register\('\/sw\.js'\)/);
    assert.ok(lire('sw.js').includes("addEventListener('fetch'"), 'un SW sans fetch ne rend pas installable');
  });

  it('le manifeste a name, start_url, display standalone et des PNG 192 et 512', () => {
    const m = JSON.parse(lire('manifest.webmanifest')) as {
      name?: string; start_url?: string; display?: string;
      icons?: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    assert.equal(m.name, 'Tablée');
    assert.equal(m.start_url, '/');
    assert.equal(m.display, 'standalone');
    const png = (m.icons ?? []).filter((i) => i.type === 'image/png' && i.purpose === undefined);
    for (const taille of ['192x192', '512x512']) {
      const icône = png.find((i) => i.sizes === taille);
      assert.ok(icône, `icône PNG ${taille} manquante`);
      const octets = readFileSync(new URL(icône.src.slice(1), pub));
      assert.equal(octets.subarray(1, 4).toString(), 'PNG', `${icône.src} n'est pas un PNG`);
    }
  });
});
