# CLAUDE.md — Tablée

Instructions permanentes pour tout agent travaillant sur ce dépôt.
À lire intégralement avant la première action.

---

## Le projet en trois phrases

Tablée est une PWA familiale de suivi alimentaire, auto-hébergée, destinée à un
foyer avec enfants. On y enregistre les repas — principalement en les partageant
depuis l'application Jow — et l'app affiche pour **chaque personne** un bilan
nutritionnel réparti selon son âge et son coefficient de portion.

Le différenciateur est la répartition d'un même plat entre plusieurs convives aux
besoins différents. Aucune app du marché ne modélise ça.

---

## Documents de référence

| Fichier | Rôle |
|---|---|
| `docs/plan-app-nutrition-famille.md` | **La spec.** Fait autorité sur le modèle de données, l'API, la roadmap, les règles. |
| `docs/mockups-tablee.html` | Maquettes de référence. Fait autorité sur la mise en page et l'identité visuelle. À ouvrir dans un navigateur. |
| `docs/jow-contract.md` | Contrat de parsing des pages Jow (Tâche 0, faite). Fait autorité sur ce que Jow publie. |
| `docs/dette-technique.md` | Ce qui est su, assumé, et à reprendre. À lire avant de « corriger » une approximation : elle y est peut-être déjà expliquée. |
| `docs/mise-en-service.md` | **Séquence de vérification sur un vrai téléphone.** Le share target est le chemin critique du produit. |
| `docs/deploiement-kubernetes.md` | Passation pour la mise en service sur un cluster. À lire avant de toucher au `Dockerfile` ou à `deploy/k8s/`. |

En cas de contradiction entre ce fichier et la spec, **la spec gagne** — sauf sur
les interdits ci-dessous, qui ne se négocient pas.

---

## Carte du code

```
db/migrations/    SQL numéroté, jamais modifié après application
db/seeds/         CSV versionnés, colonne `source` obligatoire sur chaque ligne
scripts/          migrate, seed Ciqual, seed des repères, capture Jow, icônes
server/
  index.ts        démarrage : variables d'environnement, garde-fou RLS, écoute
  app.ts          assemblage Fastify — le hook qui authentifie et scope, puis
                  l'enregistrement des routes. Le meilleur point d'entrée.
  db.ts           pool, `transaction`, `withHousehold` / `acquireForHousehold`
  db/guard.ts     refuse de démarrer si la RLS n'est pas effective
  auth/           better-auth : rôles, permissions, crochets d'organisation
                  (auth.ts) ; qui parle et pour quel foyer (identity.ts)
  http/           validation des corps, format d'erreur, fuseaux
  routes/         l'API du §12 — un fichier par ressource
  repo/           tout le SQL du domaine, scopé au foyer. Une route n'écrit
                  jamais de SQL elle-même.
  nutrition/      les trois algorithmes du §11, en applicatif
  food/           lecture de l'export Ciqual, mapping des groupes
  jow/            parseur des pages publiques Jow (Tâche 0, verrouillée)
  test-support/   fabriques de comptes/foyers, base de test, migrations
  *.test.ts       les suites d'intégration vivent à la racine de server/
web/
  App.tsx         le routeur et ses gardes (anonyme / sans foyer / accueil)
  router.tsx      routage sur l'API History — pas de hash, `/share` en dépend
  session.tsx     état partagé : compte, foyer actif, convives
  api.ts          client HTTP **et** types partagés, recopiés du serveur exprès
  screens/        un fichier par écran
  components/     ce que plusieurs écrans partagent
  design/         tokens.css (couleurs, typo), vocabulary.ts (les mots)
deploy/k8s/       manifestes ; Dockerfile à la racine
```

Où chercher, selon la question :

| Je cherche… | Fichier |
|---|---|
| comment une requête est authentifiée et rattachée à un foyer | `server/app.ts` (hook `onRequest`), puis `server/auth/identity.ts` |
| la liste des routes, ou où en brancher une | bas de `buildApp` dans `server/app.ts` |
| le SQL d'une table du domaine | `server/repo/<table>.ts` — **jamais** dans une route |
| les trois algorithmes du §11 | `server/nutrition/{compute,shares,daily}.ts` |
| comment un repère par âge est choisi | `server/nutrition/references.ts`, données dans `db/seeds/` |
| les rôles, et ce qu'ils autorisent | `server/auth/auth.ts` (`ROLES`) |
| valider un champ entrant | `server/http/validate.ts` |
| ce que la RLS protège, et ce qu'elle **ne** protège pas | en-tête de `db/migrations/008_rls.sql` |
| poser le foyer courant hors d'une requête (crochet, script) | `withHousehold` dans `server/db.ts` |
| quel écran s'affiche quand | `web/App.tsx` |
| fabriquer un compte, un foyer, une invitation dans un test | `server/test-support/auth.ts` |

Le sens de circulation ne varie pas : **route → repo → base**. Une route valide,
autorise et présente ; un repo écrit le SQL ; le calcul se fait en applicatif,
entre les deux. Ce qui traverse cette pile sans passer par `request.db` n'est
pas filtré par la RLS.

---

## Règles absolues

### Ne jamais faire

- **Ne jamais inventer une valeur nutritionnelle ou un repère.** Si la source
  manque, laisser `NULL` et le signaler. Les repères par âge servent de base à
  des conseils destinés à des enfants ; une valeur plausible et fausse est pire
  qu'une valeur absente.
- **Ne jamais stocker de jugement sur une personne.** `family_note` accepte
  « Léa a goûté les épinards et a aimé », jamais « Léa mange mal ». Un jugement
  stocké se réinjecte à chaque prompt et devient une étiquette durable.
- **Ne jamais afficher d'objectif chiffré de calories ou de poids sur un profil
  mineur.** Les kcal existent en base ; elles ne sont jamais la métrique mise en
  avant. Ni séries, ni scores par personne, nulle part. Depuis la 009, le poids
  existe aussi — **majeurs seulement**, comme une mesure datée et jamais comme
  une cible. Sur un profil mineur le champ n'est pas grisé, il est absent :
  l'API refuse (422), la lecture masque, et une date corrigée qui rend le profil
  mineur efface la valeur. Ne pas « harmoniser » ces trois filets en un seul.
- **Ne jamais envoyer au LLM** : prénoms, dates de naissance, allergènes, poids,
  photos de personnes. Uniquement des libellés d'aliments, des agrégats et des
  tranches d'âge.
- **Ne jamais générer de commentaire automatique par repas.** La synthèse est
  hebdomadaire.
- **Ne jamais logger ni persister** le paramètre `key` ou `userId` d'un lien de
  partage Jow : c'est un token de compte.
- **Ne pas utiliser l'API interne non documentée de Jow.** Pages publiques
  uniquement.

Sur les trois premiers points : en cas de doute, s'arrêter et demander. Ce ne
sont pas des préférences de style.

### Toujours faire

- Les valeurs nutritionnelles viennent d'une source référencée : Jow, Ciqual,
  Open Food Facts. Jamais du modèle.
- `meal_participant.share` est calculé **à l'écriture** puis figé. Modifier un
  `portion_coef` ne doit jamais réécrire l'historique.
- Les barres s'affichent en **% du repère du jour**, jamais en grammes bruts.
- Tout appel LLM part du serveur. La clé API n'apparaît jamais dans le bundle.
- Toute estimation porte un `confidence` visible dans l'UI.
- Le vocabulaire produit parle **qualité et variété**, pas calories et objectifs.
  « Qui était à table ? », pas « participants ».

---

## Ne pas décider seul

Sur ces points, demander plutôt que choisir :

1. ~~**Contenu de `nutrient_reference`**~~ — fait le 13/09/2026, en partie. Les
   fibres viennent de l'ANSES ; protéines, lipides et glucides sont **dérivés**
   d'intervalles en % de l'apport énergétique, faute d'être publiés en grammes.
   Lire l'encart du §9 de la spec avant d'y toucher. Restent découverts : les
   0-3 ans, et les tranches prolongées au-delà de 69/59 ans.
2. **Contenu de `unit_default`** — chaque ligne exige une `source`. Toujours
   vide. Gabarit commenté dans `db/seeds/unit-default.csv`.
3. **Contenu de `seasonal_produce`** — saisie manuelle, ~40 produits. Toujours
   vide. Gabarit dans `db/seeds/seasonal-produce.csv`.
4. ~~**Stocker le poids**~~ — tranché le 14/09/2026 : oui, pour les **majeurs
   seulement**, optionnel, jamais une cible. Lire l'encart du §9 avant d'y
   toucher. Reste ouvert, et c'est le point 1 déguisé : **la ligne
   `nutrient_reference` qui s'en servirait** — la RNP protéines de l'ANSES à
   0,83 g/kg/j — n'est pas écrite. Tant qu'elle ne l'est pas, le poids est une
   donnée de santé qui ne rend rien (dette n° 10).
5. Toute modification des règles ci-dessus.

Les valeurs se chargent depuis `db/seeds/*.csv`, versionnés, avec une colonne
`source` **obligatoire sur chaque ligne** — le chargeur refuse un fichier qui
en manque une. Rien n'est téléchargé au démarrage : un fichier versionné se
relit en diff, un fetch au boot ne se relit pas.

Le reste est tranché dans la spec. Les décisions y sont motivées pour pouvoir
être contestées en connaissance de cause, pas pour être réouvertes par défaut.

---

## Ordre de travail

### Tâche 0 — Contrat Jow — ✅ faite le 13/09/2026

Résultat dans `docs/jow-contract.md`, code dans `server/jow/`. Trois points à
ne pas réintroduire par habitude :

- **La résolution par titre slugifié est inutile.** `jow.fr/fr/recipes/<ObjectId>`
  redirige vers l'URL canonique : le `recipeId` du lien de partage suffit.
- **`coversCount` n'est pas un facteur d'échelle.** Les quantités sont par
  convive, les valeurs nutritionnelles par portion, quel que soit son contenu.
  C'est `recipe.base_servings`, rien de plus.
- **Le parseur ne convertit que les unités de masse.** `Poignée`, `Pièce`,
  `Cuillère à soupe`, `Litre` ressortent à `null` : ces conversions sont dans
  `unit_default`, qui exige une source.

Avant de toucher à `server/jow/`, lire le contrat. Les échantillons figés se
recapturent (`npm run jow:capture`), ne se modifient pas à la main.

### V1 et V2 — ✅ écrites le 13/09/2026

Toutes les cases du §15 passent, sauf la saisie de `seasonal_produce`. 176
tests, typecheck vert. Le détail de ce qui a été décidé en chemin est dans les
encarts datés des §6, §9, §10, §11 et §12 de la spec — le texte d'origine y est
conservé, comme au §3.

**Avant d'aller plus loin, deux choses ne se remplacent pas par du code :**

1. Installer la PWA sur un téléphone et partager une vraie recette depuis Jow.
   Le share target est le chemin critique du produit et n'a jamais tourné
   ailleurs que dans un Chromium de test. La séquence est dans
   `docs/mise-en-service.md` ; les pièges vérifiables à froid le sont déjà.
2. Savoir si la famille logue encore trois semaines plus tard. C'est l'objectif
   du jalon V1, et aucune ligne de code n'y répond.

### Auth multi-comptes et multi-foyers — ✅ écrite le 13/09/2026

Le §7 (« un compte par foyer ») est **renversé** et le §16 (« si l'app sort du
foyer ») est **tranché** : plusieurs adultes avec leur propre compte, plusieurs
foyers étanches sur une instance. Lire les deux encarts datés avant d'y toucher.

better-auth 1.7.4 (plugin `organization`), migrations 007 et 008. Quatre choses
à ne pas défaire par habitude :

- **`eater` est une assiette, `"user"` est un compte, et les deux ensembles ne
  coïncident pas.** Les enfants sont des convives sans compte ; une nounou est
  un compte sans convive. Tout ce qui désigne « qui a agi » — `meal.created_by`,
  `jow_food_link.confirmed_by` — pointe vers un compte. Ne jamais les
  refusionner « pour simplifier » : c'est l'erreur que la 007 répare.
- **Le schéma de better-auth est figé dans la 007**, recopié de son générateur.
  Ne jamais lancer son CLI en écriture sur cette base : une migration appliquée
  ne se modifie plus, et le lanceur le vérifie par empreinte. Une montée de
  version = une migration de plus.
- **Le rôle Postgres ne doit pas être superutilisateur**, sinon la RLS est
  contournée *en silence*. Le serveur refuse de démarrer dans cet état, et un
  test vérifie que la RLS est effective et pas seulement déclarée. Ne pas
  désarmer l'un ni l'autre : 178 tests sont passés au vert avec une isolation
  entièrement décorative avant qu'on s'en aperçoive.
- **La version chiffrée par foyer a été écartée en connaissance de cause.**
  L'hébergeur a le root ; l'app ne montre rien, la machine reste la sienne, et
  ça se dit tel quel aux familles invitées. Ne pas rouvrir sans relire le §16.

Deux rôles : `parent` (gère les accès) et `adulte` (saisit et lit). `jeune`
est une valeur réservée **sans écran** — un enfant qui a un compte est un autre
produit, soumis à I5, et ça se décidera le jour venu.

### Le lien convive ↔ compte — ✅ écrit le 14/09/2026

Migration 009, après la première mise en service. La 007 avait raison de
séparer `eater` et `"user"` ; il manquait le cas où **une même personne est les
deux**. `eater.user_id` dit laquelle de ces assiettes est la vôtre,
`eater.claim_email` la réserve à quelqu'un qui n'est pas encore inscrit.

- **C'est un lien, pas une fusion.** Cardinalité 0..1 des deux côtés. Les
  enfants restent des convives sans compte, une nounou un compte sans convive,
  et `meal.created_by` désigne toujours un `"user"`. Ne pas en profiter pour
  refusionner les deux tables : c'est l'erreur que la 007 répare.
- **Le rattachement se fait tout seul** à l'entrée dans le foyer
  (`afterAcceptInvitation`, `afterAddMember`), et immédiatement si l'adresse est
  déjà membre. Il **échoue en silence** exprès : une exception dans le crochet
  ferait échouer l'acceptation de l'invitation, et une fiche non rattachée se
  rattache d'un tap alors qu'une personne bloquée dehors est bloquée dehors.
- **Les rôles s'appliquent enfin aux convives.** `/api/eaters` n'en vérifiait
  aucun. Un `parent` compose le foyer et décide à qui appartient une fiche ; un
  `adulte` ne modifie que la sienne, et ne voit pas le poids des autres. Ne pas
  desserrer « pour simplifier » : sans la garde sur le rattachement, un compte
  `adulte` s'attribue la fiche d'un enfant et gagne le droit de la modifier.
- **Un foyer vide ouvre sur `/bienvenue`**, pas sur un accueil vide. `/share`
  en est exclu : détourner cette navigation perdrait la recette partagée.

### Ensuite

V3 → V4, dans l'ordre, avec les critères d'acceptation du §15. Ne pas anticiper
l'IA : un assistant diététicien branché sur trois repas mal saisis ne produit
que des banalités. La V3 demande une relecture humaine de 4 synthèses sur des
données réelles, la V4 un an d'historique — les écrire avant, c'est produire de
l'invérifiable.

---

## Faire tourner, et vérifier

L'installation de zéro est dans le `README.md` — base, migrations, seed Ciqual,
front, serveur. Ce qui suit est ce qu'on refait à chaque tour, et les pièges qui
coûtent du temps parce qu'ils ne se voient pas.

```bash
npm run typecheck                       # DEUX projets : serveur, puis web/
npm test                                # unitaires seuls
TEST_DATABASE_URL=postgres://…/tablee_test npm test    # + intégration
npm run build:web && npm start          # dans cet ordre, voir ci-dessous
```

- **Sans `TEST_DATABASE_URL`, les suites Postgres sont sautées.** Avec un
  message, jamais silencieusement vertes — mais un « tout passe » qui ne prouve
  rien reste un « tout passe ». Un `npm test` nu en passe 149 sur 216, et
  laisse de côté tout ce qui touche aux comptes, aux foyers, à l'étanchéité et
  au contrat d'API : exactement ce qui casse mal.
- **Le rôle Postgres ne doit pas être superutilisateur.** Il contournerait la
  RLS *en silence* : le serveur refuse alors de démarrer (`server/db/guard.ts`),
  et les tests d'isolation passeraient au vert pour rien. `create role tablee
  login nosuperuser` — c'est déjà arrivé, voir l'en-tête de la 008.
- **`psql` ne montre rien.** Une table sous RLS interrogée avec le rôle
  applicatif rend zéro ligne tant que `app.household_id` n'est pas posé. Ce
  n'est pas une base vide, c'est la RLS qui fait son travail : passer par le
  rôle propriétaire, ou poser `set_config('app.household_id', …, false)`.
- **Le serveur lit `web/dist/index.html` une seule fois, au démarrage.** Après
  un `npm run build:web`, il sert une coquille qui pointe vers un bundle
  renommé, et la page reste blanche sur une erreur de type MIME. Redémarrer.
  (`npm run dev:web` n'a pas ce problème : Vite sert la coquille lui-même.)
- **`exactOptionalPropertyTypes` est actif** dans les deux projets. Une prop
  facultative se passe par spread conditionnel — `{...(x ? { onCancel } : {})}` —
  et non en lui donnant `undefined`.
- **Il n'y a pas de linter**, et il n'y a **aucun test de bout en bout**. Le
  typecheck et les tests d'intégration sont tout le filet automatique ; un
  parcours d'écrans se vérifie en pilotant un navigateur, et la séquence de
  référence sur un vrai téléphone est dans `docs/mise-en-service.md`.

---

## Stack et conventions

| Couche | Choix |
|---|---|
| Front | Vite + React + TypeScript, PWA |
| Back | Node — Fastify ou Hono |
| Base | PostgreSQL 16+ |
| Migrations | Fichiers SQL numérotés dans `db/migrations/`, jamais modifiés après application |
| Proxy | Caddy (HTTPS obligatoire pour le share target) |
| Hébergement | Proxmox local |

L'arborescence est dans « Carte du code », plus haut. Le CI publie l'image sur
ghcr.io depuis `.github/workflows/`, tests d'abord.

Conventions de code :
- Le calcul nutritionnel se fait **en applicatif**, pas en SQL. Voir §11 de la
  spec pour les trois algorithmes (`calculerNutrition`, `calculerShares`,
  `bilanJournalier`).
- Les scripts de seed sont **idempotents** (`on conflict do update`).
- Une valeur inconnue est `NULL`, jamais `0`.
- Une route du domaine lit et écrit par **`request.db`**, le client marqué au
  foyer courant — jamais `ctx.pool`, qui n'en porte aucun et que la RLS ne
  filtre donc pas.
- L'image ne contient **ni secret, ni export Ciqual** : les premiers viennent
  de l'environnement, le second d'un seed joué une fois. Et `tsx` est une
  dépendance de service, pas de développement — le serveur exécute du
  TypeScript directement.

Conventions d'écriture — elles se voient dans tous les fichiers, autant les
dire :

- **Les commentaires et tout ce qui atteint l'écran sont en français.** Sans
  exception, guillemets « » compris.
- **Les identifiants sont en anglais par défaut** — `createEater`,
  `findReference`, `withHousehold`. Le français apparaît à deux endroits, et
  c'est cohérent : quand la spec nomme le concept (`calculerNutrition`,
  `calculerShares`, `bilanJournalier`) et sur les aides locales et les
  composants d'écran (`traduire`, `lisible`, `FicheConvive`). Dans le doute,
  suivre le fichier dans lequel on écrit plutôt qu'imposer une langue.
- **Un en-tête de fichier dit pourquoi le fichier existe et ce qu'il refuse de
  faire**, pas ce qu'il fait — le code le dit déjà. Un commentaire qui paraphrase
  la ligne d'en dessous n'a pas sa place ; un commentaire qui explique pourquoi
  la ligne d'en dessous n'est pas ce qu'on attendait, si.
- **Une décision renversée se conserve et se date**, elle ne se supprime pas.
  Les encarts `⚠️ Renversé le …` de la spec, l'en-tête des migrations, les
  « Levées » de `docs/dette-technique.md` : le raisonnement d'origine explique
  la forme du code, et l'effacer condamne à refaire l'erreur.
- **Ce qui est approximatif se dit** dans `docs/dette-technique.md`, avec ce que
  ça coûte et ce qui le lèverait. Une approximation consignée est une décision ;
  une approximation tue est un piège.

---

## Identité visuelle

- Couleur de marque : terracotta `#D85A30`, en aplat plein sur le chrome.
- Palette nutriments : protéines `#7F77DD`, glucides `#EF9F27`, lipides
  `#378ADD`, fibres `#1D9E75`, végétal `#639922`.
- **Ces cinq couleurs n'apparaissent que sur des données nutritionnelles.**
  Jamais sur un bouton, un onglet, un badge ou un fond.
- Fond crème, pas de blanc pur. Contraste typographique fort : serif 28-34 px
  pour l'affichage, sans-serif 11-17 px pour le reste.
- Les aplats colorés des maquettes sont des placeholders pour les photos Jow
  (`recipe.image_url`).

---

## Définition de « terminé »

Une tâche est terminée quand :

1. Les critères d'acceptation du jalon concerné (§15) passent.
2. Les trois tests structurants passent :
   - Σ des `share` d'un repas sans invité = 1
   - modifier un `portion_coef` ne change aucun repas passé
   - une tranche d'âge sans repère affiche « indisponible », pas 0
3. Aucune valeur nutritionnelle n'a été écrite sans source.

Signaler explicitement tout endroit où une donnée manquait et a été laissée
vide : c'est le comportement attendu, pas un échec.

---

## Ce qui ne rentre jamais dans le dépôt

Le code et les documents sont génériques. Les données du foyer vivent en base
sur le serveur, jamais ici : prénoms, dates de naissance, allergènes, photos de
repas, textes de partage bruts (ils portent le token `key`), dumps Postgres.

Un seed qui crée un foyer de démonstration utilise des prénoms fictifs. Le
`.gitignore` couvre les cas connus ; y ajouter un chemin coûte moins cher que
de réécrire l'historique.
