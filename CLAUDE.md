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
| `docs/mise-en-service.md` | Déploiement et **séquence de vérification sur un vrai téléphone**. Le share target est le chemin critique du produit. |

En cas de contradiction entre ce fichier et la spec, **la spec gagne** — sauf sur
les interdits ci-dessous, qui ne se négocient pas.

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
  avant. Ni séries, ni scores par personne, nulle part.
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
4. Toute modification des règles ci-dessus.

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

### Ensuite

V3 → V4, dans l'ordre, avec les critères d'acceptation du §15. Ne pas anticiper
l'IA : un assistant diététicien branché sur trois repas mal saisis ne produit
que des banalités. La V3 demande une relecture humaine de 4 synthèses sur des
données réelles, la V4 un an d'historique — les écrire avant, c'est produire de
l'invérifiable.

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

```
/
├── CLAUDE.md
├── docs/
│   ├── plan-app-nutrition-famille.md
│   ├── mockups-tablee.html
│   └── jow-contract.md
├── db/migrations/
├── scripts/          seed-food.ts, seed-seasonal.ts
├── server/
│   ├── routes/
│   ├── auth/         better-auth, rôles, résolution du foyer actif
│   ├── jow/          parseur + contrat
│   └── nutrition/    calcul, shares, repères
└── web/
    ├── screens/
    └── design/       tokens couleur et typo
```

Conventions :
- Le calcul nutritionnel se fait **en applicatif**, pas en SQL. Voir §11 de la
  spec pour les trois algorithmes (`calculerNutrition`, `calculerShares`,
  `bilanJournalier`).
- Les scripts de seed sont **idempotents** (`on conflict do update`).
- Une valeur inconnue est `NULL`, jamais `0`.
- Une route du domaine lit et écrit par **`request.db`**, le client marqué au
  foyer courant — jamais `ctx.pool`, qui n'en porte aucun et que la RLS ne
  filtre donc pas.

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
