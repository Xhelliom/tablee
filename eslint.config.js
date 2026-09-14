/**
 * ESLint — pour les bugs, pas pour le style.
 *
 * Le dépôt n'a pas de problème de style : il est homogène, écrit d'une seule
 * main, et un reformatage automatique noierait les vraies corrections dans un
 * diff de virgules. Aucune règle de mise en forme n'est activée ici, et il n'y
 * a pas de Prettier.
 *
 * Ce qui est activé est **typé** : ces règles lisent le programme compilé, pas
 * le texte. C'est ce qui leur permet de voir ce qu'une relecture rate —
 * une promesse jamais attendue, un `async` passé là où on attend un
 * gestionnaire synchrone, une comparaison entre deux types qui ne se croisent
 * jamais.
 *
 *   npm run lint
 *   npm run lint -- --fix
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `web/dist` est un artefact de build ; `node_modules` va de soi.
    ignores: ['web/dist/**', 'node_modules/**', 'web/public/sw.js'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Les deux programmes du dépôt : le serveur (`tsconfig.json`) et la
        // PWA (`web/tsconfig.json`). Sans les deux, les fichiers de l'un sont
        // « hors projet » et les règles typées s'éteignent en silence.
        project: ['./tsconfig.json', './web/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Les quatre qui justifient tout le reste ─────────────────────────
      //
      // Une promesse non attendue, c'est une écriture en base qui part après
      // la réponse HTTP, et une erreur qui devient un `unhandledRejection`
      // plutôt qu'un 500. Le hook `onResponse` du serveur rend le client
      // Postgres : une promesse qui traîne l'utiliserait après sa libération.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          // `describe` et `it` de `node:test` rendent une promesse que le
          // lanceur attend lui-même. Les marquer d'un `void` dans 52 suites
          // apprendrait à écrire `void` devant les promesses, ce qui est
          // exactement l'habitude que cette règle existe pour empêcher.
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['describe', 'it'] },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // ── Ce qui relève du style, et qu'on n'impose pas ───────────────────
      //
      // Les entrées HTTP sont des `unknown` validés à la main dans
      // `server/http/validate.ts` ; le reste du dépôt est typé. On garde donc
      // `no-explicit-any` (écrire `any` est une décision) mais on laisse les
      // `no-unsafe-*`, qui se déclenchent sur la valeur de retour de
      // bibliothèques tierces sans rien apprendre.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Un `_` en préfixe dit « je sais, et c'est voulu » — c'est la
      // convention déjà employée (`_ctx`, `_request`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    // Ce fichier-ci, et tout autre `.js` du dépôt, ne sont dans aucun des deux
    // programmes TypeScript : les règles typées n'ont rien à y lire.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    // Les tests lisent des corps de réponse JSON : `any` y est le type juste,
    // et l'assertion qui suit fait le travail d'un schéma.
    files: ['server/**/*.test.ts', 'server/test-support/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
