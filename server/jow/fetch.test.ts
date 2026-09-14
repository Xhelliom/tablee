/**
 * L'accès réseau à Jow — et surtout où il refuse d'aller.
 *
 * Le serveur tourne **sur le réseau de la maison**. Une requête sortante qu'un
 * tiers peut réorienter est une requête entrante sur le réseau local : c'est la
 * définition du SSRF, et une redirection suffit à l'obtenir. Le contrôle
 * d'hôte fait une seule fois, à l'entrée, ne protège de rien ici.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchRecipeById, fetchRecipeByUrl } from './fetch.ts';

const ID = '650b16ade7cc8d0013ce4a6e';

/** Un `fetch` de mensonge, qui note ce qu'on lui a demandé. */
function faux(
  routes: Record<string, { status: number; location?: string; body?: string }>,
): { impl: typeof fetch; vues: string[] } {
  const vues: string[] = [];
  const impl = ((url: string | URL) => {
    const key = String(url);
    vues.push(key);
    const route = routes[key] ?? { status: 404 };
    const headers = new Headers();
    if (route.location !== undefined) headers.set('location', route.location);
    return Promise.resolve(
      new Response(route.status >= 300 && route.status < 400 ? null : (route.body ?? ''), {
        status: route.status,
        headers,
      }),
    );
  }) as unknown as typeof fetch;
  return { impl, vues };
}

const PAGE = '<html><body>recette</body></html>';

describe('fetch Jow — ce qui est suivi', () => {
  it('suit la redirection vers l’URL canonique, qui reste chez Jow', async () => {
    const { impl, vues } = faux({
      [`https://jow.fr/fr/recipes/${ID}`]: { status: 302, location: `/fr/recipes/${ID}-galette-vege` },
      [`https://jow.fr/fr/recipes/${ID}-galette-vege`]: { status: 200, body: PAGE },
    });

    const page = await fetchRecipeById(ID, { fetchImpl: impl });
    assert.equal(page.html, PAGE);
    assert.equal(vues.length, 2, 'un saut, celui du contrat Jow');
  });

  it('refuse un identifiant qui n’est pas un ObjectId', async () => {
    const { impl, vues } = faux({});
    for (const mauvais of ['../../etc/passwd', 'abc', `${ID}x`, '']) {
      await assert.rejects(fetchRecipeById(mauvais, { fetchImpl: impl }), /identifiant/);
    }
    assert.deepEqual(vues, [], 'rien ne part sur le réseau');
  });
});

describe('fetch Jow — ce qui est refusé (SSRF)', () => {
  /**
   * Le cas qui motive tout le module : jow.fr renvoie vers le réseau local.
   * Avec `redirect: 'follow'`, la requête serait partie vers la box.
   */
  it('ne suit pas une redirection vers une adresse privée', async () => {
    const { impl, vues } = faux({
      [`https://jow.fr/fr/recipes/${ID}`]: { status: 302, location: 'http://192.168.1.1/admin' },
    });

    await assert.rejects(fetchRecipeById(ID, { fetchImpl: impl }), /HTTPS|domaine Jow/);
    assert.deepEqual(vues, [`https://jow.fr/fr/recipes/${ID}`], 'le second saut n’a pas eu lieu');
  });

  it('ne suit pas une redirection vers un autre domaine, même en HTTPS', async () => {
    const { impl, vues } = faux({
      [`https://jow.fr/fr/recipes/${ID}`]: { status: 301, location: 'https://exemple.test/piege' },
    });

    await assert.rejects(fetchRecipeById(ID, { fetchImpl: impl }), /domaine Jow/);
    assert.equal(vues.length, 1);
  });

  it('ne suit pas une redirection vers le service de métadonnées', async () => {
    const { impl } = faux({
      [`https://jow.fr/fr/recipes/${ID}`]: {
        status: 302,
        location: 'http://169.254.169.254/latest/meta-data/',
      },
    });
    await assert.rejects(fetchRecipeById(ID, { fetchImpl: impl }), /HTTPS|domaine Jow/);
  });

  it('s’arrête sur une boucle de redirections', async () => {
    const { impl, vues } = faux({
      'https://jow.fr/a': { status: 302, location: '/b' },
      'https://jow.fr/b': { status: 302, location: '/a' },
    });

    await assert.rejects(
      fetchRecipeByUrl('https://jow.fr/a', { fetchImpl: impl }),
      /trop de redirections/,
    );
    assert.ok(vues.length <= 6, `bornée à 6 requêtes, vu ${vues.length}`);
  });

  it('refuse une URL qui n’est chez Jow qu’en apparence', async () => {
    const { impl, vues } = faux({});
    for (const piège of [
      'https://jow.fr@exemple.test/recette',
      'https://jow.fr.exemple.test/recette',
      'https://notjow.fr/recette',
      'http://jow.fr/recette',
      'file:///etc/passwd',
      'not-a-url',
    ]) {
      await assert.rejects(fetchRecipeByUrl(piège, { fetchImpl: impl }));
    }
    assert.deepEqual(vues, [], 'aucune de ces URL ne doit atteindre le réseau');
  });

  it('accepte un sous-domaine de Jow, qui en est un vrai', async () => {
    const { impl } = faux({ 'https://www.jow.fr/recette': { status: 200, body: PAGE } });
    const page = await fetchRecipeByUrl('https://www.jow.fr/recette', { fetchImpl: impl });
    assert.equal(page.html, PAGE);
  });
});
