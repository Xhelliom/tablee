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

## 4. Le mois de saisonnalité est calculé en UTC, pas dans le fuseau du foyer

**Où** — `server/repo/refs.ts:82`, `server/repo/meals.ts:513`,
`server/routes/recipes.ts` (trois appels à `seasonalCount`).

Tout le découpage des journées passe soigneusement par `household.timezone`
(voir `server/http/tz.ts`). Ces cinq endroits-là ne le font pas : ils utilisent
`extract(month from eaten_at)` en UTC, ou `new Date().getMonth()` en heure du
serveur.

**Ce que ça coûte.** Un repas pris le 31 août à 23 h heure de Paris compte pour
septembre dans le badge « N produits de saison » et dans le marquage « déjà
mangé ce mois-ci » de la bande d'accueil. Deux heures par mois, sur un badge
décoratif — donc peu, mais c'est une incohérence avec le reste du code, et
c'est le genre d'incohérence qui se propage si on la laisse.

**Ce qui le lèverait.** Passer le fuseau du foyer à ces requêtes, comme le font
déjà `mealsForDay` et `weekGrid`.

---

## 5. La PWA n'a jamais tourné sur un vrai Android

**Où** — `web/public/manifest.webmanifest`, `web/public/sw.js`.

Le share target, l'installabilité et le service worker sont écrits selon la
spécification et vérifiés dans Chromium en local. Rien n'a été installé sur un
téléphone.

**Ce que ça coûte.** C'est le **chemin critique du produit** : sans PWA
installée, Tablée n'apparaît pas dans le menu de partage d'Android, donc pas
d'ingestion Jow, donc pas d'app. Une erreur de manifeste ne se verrait pas
avant le premier essai réel.

**Ce qui le lèverait.** Installer sur un téléphone derrière HTTPS, partager une
recette depuis Jow, vérifier que Tablée apparaît dans la feuille de partage,
puis couper le Wi-Fi et rouvrir l'app.

---

## 6. Les polices viennent d'un CDN

**Où** — `web/index.html`, lien vers `fonts.googleapis.com`.

Fraunces et Inter sont chargées depuis Google Fonts. Les piles de repli sont
réelles (Georgia, system-ui) et l'app reste lisible sans elles, mais une app
auto-hébergée sur le réseau de la maison ne devrait pas dépendre d'un CDN pour
sa typographie — et l'écart serif/sans-serif est la moitié de l'identité
visuelle (§8ter).

**Ce qui le lèverait.** Vendoriser les deux familles en woff2 dans
`web/public/fonts/` et servir un `@font-face` local. Quelques centaines de Ko
dans le dépôt, et plus aucune requête sortante au chargement.

---

## 7. Les ingrédients Jow doivent être rattachés à la main

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

## 8. L'authentification est faite à la main, et pour un seul foyer

**Où** — `server/auth/`.

Argon2id, jeton opaque en base, cookie `httpOnly`. Une centaine de lignes, sans
bibliothèque, parce que le §7 a tranché pour un compte unique par foyer.

**Ce n'est pas de la dette tant que l'app reste à la maison.** Ça le devient le
jour où elle en sort — et le §16 rappelle que ce n'est pas un changement
d'échelle mais de nature : données de santé de mineurs, comptes individuels,
consentement parental, multi-tenant. C'est à ce moment-là qu'une bibliothèque
d'authentification vaut mieux que cent lignes maison, et cette décision se
prend **avant**, jamais après.
