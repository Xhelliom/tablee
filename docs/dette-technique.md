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

## 7. Une adresse e-mail n'est pas vérifiée

**Où** — `server/auth/auth.ts`, `requireEmailVerification: false`.

L'inscription est ouverte — c'est le but (§16) — mais rien ne prouve que celui
qui s'inscrit possède l'adresse qu'il donne. Il n'y a pas de serveur SMTP sur
la machine, et la vérification suppose d'en envoyer un.

**Ce que ça coûte.** Quelqu'un peut créer un compte sur l'adresse d'un autre.
Le dégât reste borné : un compte ne donne accès à **aucun** foyer tant qu'une
invitation n'a pas été acceptée, et l'invitation est liée à l'adresse. Le vrai
coût est ailleurs — sans adresse vérifiée, une réinitialisation de mot de passe
par mail ne vaut rien, et c'était l'une des deux raisons d'avoir pris
better-auth.

**Ce qui le lèverait.** Un relais SMTP, puis `requireEmailVerification: true`
et `sendResetPassword`. Tant que ce n'est pas fait, un mot de passe oublié se
règle en base, ce qui n'est acceptable que pour l'hébergeur lui-même.

---

## 8. La RLS ne traverse pas les clés étrangères

**Où** — `db/migrations/008_rls.sql`, section finale.

Les policies portent sur les tables qui ont un `household_id` : `eater`,
`meal`, `meal_template`, `family_note`, `weekly_insight`, `recipe`. Leurs
tables filles — `meal_item`, `meal_participant`, `meal_nutrition`,
`eater_preference`, `eater_allergen`, `recipe_ingredient` — n'en ont pas, et
la RLS ne se propage pas à travers une clé étrangère.

**Ce que ça coûte.** `select … from meal_item where meal_id = $1` reste lisible
quel que soit le foyer, **si l'identifiant du repas est connu**. Ce sont des
UUID v4 qui ne sortent jamais d'une route scopée, donc le risque est théorique
tant que le code ne les expose pas. Ce n'est pas la garantie dure qu'on a sur
les tables parentes, et il vaut mieux le savoir que le découvrir.

**Ce qui le lèverait.** Une policy par table fille, avec un `exists` sur le
parent — soit un sous-select par ligne lue. À faire si l'une de ces tables
devient atteignable par un identifiant venu du client.

---

## 9. Le calcul des repas n'est pas concurrent-safe

**Où** — `server/repo/meals.ts`, `withHousehold` dans `server/db.ts`.

Le client Postgres d'une requête porte `app.household_id` en paramètre de
session, hors transaction — un `set_config(…, true)` serait annulé au premier
`commit`, et plusieurs fonctions ouvrent déjà la leur.

**Ce que ça coûte.** Rien aujourd'hui : chaque requête tient son client en
exclusivité du début à la fin. Mais si un jour une requête ouvrait deux
opérations en parallèle sur le même client, ou si un traitement de fond
réutilisait un client sans passer par `withHousehold`, le foyer courant
deviendrait ambigu. Le garde-fou du démarrage ne voit pas ce cas.

**Ce qui le lèverait.** Faire de `Db` un type qui ne s'obtient que par
`withHousehold`, pour qu'un `pool.query` sur une table du domaine ne compile
plus.

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
- **L'authentification était faite à la main, pour un seul foyer.** La dette
  n° 6 disait « ça le devient le jour où l'app en sort ». Elle est levée par
  better-auth 1.7.4 (plugin `organization`), dont le schéma est **figé** dans
  la migration 007 : son générateur ne doit jamais réécrire une migration
  appliquée. Ce qui manquait n'était pas le login, c'était l'invitation et la
  récupération de mot de passe — la seconde attend encore un SMTP (dette n° 7).
- **L'isolation entre foyers tenait par discipline.** La dette n° 4ter est
  levée par la RLS de la migration 008. Deux choses comptent autant que les
  policies : le rôle de connexion **ne doit pas être superutilisateur**, sans
  quoi elles sont contournées en silence — 178 tests sont passés au vert dans
  cet état avant qu'on s'en aperçoive —, et `assertIsolation()` empêche
  désormais de démarrer plutôt que d'écrire un avertissement que personne ne
  lit.
- **Les polices venaient de Google Fonts.** Fraunces et Inter sont embarquées
  dans `web/public/fonts/`, en sous-ensemble `latin` seul : vérification faite
  sur les 3 185 noms de Ciqual et sur tous les textes de l'interface, aucun
  caractère n'en sort. 84 Ko au total, et plus aucune requête vers un tiers au
  chargement — hors les photos de plats de Jow, qui sont le sujet même du
  §8ter.
