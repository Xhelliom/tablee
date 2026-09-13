# Dette technique

Ce qui est **su, assumé, et à reprendre**. Une dette écrite ici a été choisie
en connaissance de cause ; ce qui n'y figure pas et qui coince est un bug, pas
une dette.

À distinguer de ce qui est simplement **en attente de données** — les tables
livrées vides du §17 de la spec ne sont pas de la dette, leur remplissage est
une collecte prévue. Elles ne figurent ici que là où le code a dû composer avec
leur absence d'une manière discutable.

Ordre : ce qui pèse le plus en premier.

---

## 1. Les repères des adultes sont prolongés au-delà des tranches de l'avis

**Où** — `db/seeds/energy-reference.csv`, lignes `M,70,120` et `F,60,120`.

L'avis ANSES 2012-SA-0103 ne retient un besoin énergétique que jusqu'à **69 ans
chez l'homme et 59 ans chez la femme**. Au-delà, la valeur de la dernière
tranche est reprise telle quelle, pour qu'un repère existe quel que soit l'âge.

**Ce que ça coûte.** Le besoin énergétique **baisse** avec l'âge : masse maigre
et métabolisme de base diminuent. Reprendre la valeur des 18-69 ans à 75 ans la
surestime, et surestime avec elle les cibles en grammes de protéines, glucides
et lipides qui en dérivent. Une personne âgée se verra réclamer un peu plus que
nécessaire — « il manque 30 g de protéines » alors qu'elle est peut-être déjà
au niveau. L'erreur va dans le sens de la sur-sollicitation, pas de la
sous-alimentation, ce qui est le moins mauvais des deux sens, mais ce n'est pas
une raison de s'en satisfaire.

**Ce qui le lèverait.** L'avis 2016 mentionne des estimations de besoin
énergétique calculées « selon leur âge **entre 18 et 79 ans** », détaillées
dans un rapport annexe (`Anses 2017d`) qui n'a pas été consulté. Il contient
très probablement des valeurs par tranche d'âge jusqu'à 79 ans, voire au-delà.
Les récupérer remplacerait la prolongation par des valeurs sourcées, sans
toucher au code : ce sont deux lignes de CSV.

**Ce qui protège en attendant.** La prolongation est une ligne à part, avec sa
propre `source`, pas un élargissement de la tranche sourcée. Le texte
« valeur des 18-59 ans, prolongée au-delà de 59 ans : hors du périmètre de
l'avis » remonte tel quel dans l'écran « d'où viennent ces barres ». Un test
vérifie que les deux tranches ne fusionnent pas. L'app ne fait donc jamais dire
à l'ANSES ce qu'elle ne dit pas.

---

## 2. Les 0-3 ans n'ont aucun repère

**Où** — absence de lignes dans `db/seeds/nutrient-reference.csv` et
`energy-reference.csv`.

Aucune des deux sources consultées ne couvre les moins de 4 ans. Les quatre
barres affichent « repère indisponible ».

**Choix assumé, et à ne pas « corriger » par une prolongation.** Les besoins
d'un nourrisson ne sont pas ceux d'un enfant de 4 ans en plus petit : diversité
alimentaire, lait, densité nutritionnelle, tout diffère. C'est l'âge où une
valeur plausible et fausse fait le plus de dégâts (I1).

**Ce qui le lèverait.** L'avis ANSES 2017-SA-0145 porte sur les repères du PNNS
pour les enfants de 0 à 3 ans. À lire avant toute saisie.

---

## 3. Ciqual publie des « traces » sans seuil chiffré

**Où** — `server/food/ciqual.ts`, `parseTeneur`.

La documentation de la table dit qu'une teneur à l'état de `traces` est
« détectée [...] sans pouvoir être précisément quantifiée [...] très faible,
mais ne peut être considérée nulle ». Aucun seuil n'est donné. Ces teneurs
sortent donc **entièrement inconnues** : ni borne basse, ni borne haute.

**Ce que ça coûte.** 328 teneurs de glucides, 72 de fibres, 13 de lipides et 5
de protéines restent sans encadrement. Un repas qui en contient un ressort avec
une borne haute absente — « au moins X g » — là où un majorant, même large,
donnerait un intervalle.

**Ce qui le lèverait.** Établir si l'ANSES documente quelque part les seuils de
quantification par constituant. Si oui, `traces` devient `[0 ; seuil]` comme
`< X`, et la ligne du tableau de `parseTeneur` change seule. Si non, ça reste
en l'état — et c'est le bon état.

---

## 4. La PWA n'a jamais tourné sur un vrai Android

**Où** — `web/public/manifest.webmanifest`, `web/public/sw.js`.

Le share target, l'installabilité et le service worker sont écrits selon la
spécification et vérifiés dans Chromium en local. Rien n'a été installé sur un
téléphone.

**Ce que ça coûte.** C'est le **chemin critique du produit** : sans PWA
installée, Tablée n'apparaît pas dans le menu de partage d'Android, donc pas
d'ingestion Jow, donc pas d'app. Une erreur de manifeste ne se verrait pas
avant le premier essai réel.

**Ce qui a été réduit à froid le 13/09/2026.** Les pièges Android statiquement
vérifiables l'ont été, et sont verts : types MIME (le manifeste sort bien en
`application/manifest+json` — servi en `text/plain`, Chrome l'ignore et l'app
n'est pas installable, en silence), présence des icônes 192 / 512 / maskable
après build, `scope` couvrant l'action de partage, et `GET /share?…` qui rend
la coquille en 200. Reste ce qu'aucune machine ne peut dire : Chrome
accepte-t-il d'installer, Tablée apparaît-elle dans la feuille de partage de
Jow, et Jow met-il dans `text` ce que le contrat prévoit.

**Ce qui le lèverait.** `docs/mise-en-service.md` — la séquence ordonnée, avec
ce qui échoue à chaque étape et comment le diagnostiquer.

---

## 4bis. Le service worker survit mal à un redéploiement du front

**Où** — `web/public/sw.js`, constante `CACHE`.

La coquille est mise en cache à l'installation du worker. Si le front est
redéployé **sans** que `sw.js` change d'un octet, le navigateur ne voit pas de
nouveau worker, ne réinstalle pas, et garde une coquille qui référence des
bundles hachés désormais absents du serveur.

**Ce que ça coûte.** Rien en ligne — la navigation est réseau d'abord. Hors
ligne, l'app s'ouvre sur une page blanche jusqu'au prochain passage en ligne.

**Ce qui le lèverait.** Faire dépendre le nom du cache de la version du build
plutôt que d'une constante écrite à la main. À faire quand ça gênera vraiment :
aujourd'hui l'usage hors ligne est un confort, pas le chemin critique.

---

## 4ter. L'isolation entre foyers tient par discipline, pas par construction

**Où** — `server/repo/*.ts`.

Les entrées publiques scopent correctement — `getMeal(db, householdId, id)`,
`deleteMeal(db, householdId, mealId)`. Les helpers internes, non :

```ts
// server/repo/meals.ts
await client.query('delete from meal_item where meal_id = $1', [mealId]);
```

C'est **correct aujourd'hui**, parce que l'appelant a vérifié avant.

**Ce que ça coûtera.** Rien tant qu'un seul foyer vit sur l'instance. À partir
du moment où des amis y créent le leur (§16, décidé le 13/09/2026), un oubli
cesse d'être un bug et devient une fuite de données alimentaires d'enfants qui
ne sont pas les siens.

**Ce qui le lèverait.** Row-Level Security Postgres : `app.household_id` posé
dans la session, une policy par table scopée. La base refuse alors d'elle-même
une ligne d'un autre foyer, même si la requête a oublié son `where`. À faire
**dans le même lot que l'auth multi-foyer**, jamais après.

---

## 5. Les ingrédients Jow doivent être rattachés à la main

**Où** — `jow_food_link`, écran de détail d'un repas.

Jow publie des libellés, pas des codes Ciqual. Le rattachement est humain, une
fois par ingrédient, puis propagé à toutes les recettes.

**Ce n'est pas un défaut de conception** — les deux pistes automatiques ont été
explorées et écartées, et le contrat Jow dit pourquoi (§5) : `flags.vegetable`
désigne une catégorie PNNS et non l'origine végétale (l'ail et le riz y sont
`false`), et les valeurs des pages ingrédients sont arrondies et mutuellement
incohérentes. Un rapprochement par ressemblance de chaîne produirait des parts
végétales fausses affichées sans avertissement.

**Ce que ça coûte.** Un effort de départ, qui décroît vite : 8 recettes
donnaient déjà 38 ingrédients distincts pour 44 lignes. À surveiller quand
même : si le rattachement traîne, la barre « Végétal » reste vide sur les
repas Jow, qui sont la majorité.

**Ce qui l'allégerait.** Un écran listant les ingrédients non rattachés les
plus fréquents, pour les traiter en série plutôt qu'au fil des repas.

---

## 6. L'authentification est faite à la main, et pour un seul foyer — **échue**

**Où** — `server/auth/`.

Argon2id, jeton opaque en base, cookie `httpOnly`. Une centaine de lignes, sans
bibliothèque, parce que le §7 a tranché pour un compte unique par foyer.

Cette entrée disait : *« ce n'est pas de la dette tant que l'app reste à la
maison ; ça le devient le jour où elle en sort »*. **Ce jour est arrivé le
13/09/2026** — le §16 est amendé, plusieurs foyers cohabiteront sur l'instance.
C'est donc de la dette, échue.

**Ce que ces cent lignes ne font pas, et qu'il faut maintenant :**

- **L'invitation.** Entropie du jeton, expiration, usage unique, et le cas
  tordu : accepter une invitation en étant déjà connecté sous un autre compte.
  Court à écrire, facile à écrire mal.
- **La récupération de mot de passe.** Elle n'existe pas : aujourd'hui c'est
  `npm run household` en SSH. Acceptable pour un mot de passe partagé entre
  deux adultes qui ont la main sur la machine ; pas pour la femme d'un ami.
- **Séparer compte et convive.** `member` est une assiette (`portion_coef`,
  âge, allergènes) et `meal.created_by` pointe dessus : « qui a saisi » et
  « qui a mangé » sont le même objet. Les enfants sont des assiettes sans
  compte, une nounou serait un compte sans assiette. Voir l'encart du §7.

**Ce qui le lèverait.** better-auth, plugin `organization` (une organisation =
un foyer), schéma figé dans une migration numérotée comme les autres — son CLI
ne doit jamais réécrire une migration appliquée. Deux rôles, `parent` et
`adulte`. Et la RLS de la dette n° 4ter **dans le même lot**.

---

## Levées

Gardées ici parce qu'une dette levée explique souvent pourquoi le code a la
forme qu'il a. Le détail est dans l'historique git.

- **Le mois de saisonnalité était calculé en UTC.** Cinq requêtes lisaient
  `extract(month from eaten_at)` sans fuseau, alors que tout le reste du
  découpage des journées passe par `household.timezone`. Le fuseau est
  désormais joint depuis `household` **dans la requête** plutôt que passé en
  paramètre : le sortir du SQL reviendrait à confier ce soin à chaque appelant,
  et l'un d'eux finirait par l'oublier. Au passage, la bande d'accueil cochait
  ce qui avait été mangé le mois **courant** au lieu du mois **affiché**.
- **Les polices venaient de Google Fonts.** Fraunces et Inter sont embarquées
  dans `web/public/fonts/`, en sous-ensemble `latin` seul : vérification faite
  sur les 3 185 noms de Ciqual et sur tous les textes de l'interface, aucun
  caractère n'en sort. 84 Ko au total, et plus aucune requête vers un tiers au
  chargement — hors les photos de plats de Jow, qui sont le sujet même du
  §8ter.
