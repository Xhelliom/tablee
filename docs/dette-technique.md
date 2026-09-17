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

> **⚠️ Levée par configuration le 14/09/2026.** `TABLEE_MAIL=resend` ou
> `smtp` (`server/auth/mail.ts`) allume les trois d'un coup : confirmation
> d'adresse obligatoire, mot de passe oublié, invitation envoyée par mail. Sans
> la variable, rien ne change et cette dette reste entière — c'est donc une
> décision d'hébergeur, pas un état du code. Ce qu'il en coûte de l'allumer
> sur une instance existante : **tous** les comptes déjà créés ont
> `emailVerified = false`, et devront confirmer leur adresse à leur prochaine
> connexion. Un lien leur part tout seul ; les sessions ouvertes, elles, ne
> sont pas coupées. Aucune migration ne les marque « vérifiés » d'office :
> ce serait affirmer une preuve qu'on n'a pas.

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

## 9bis. Les manifestes Kubernetes n'ont jamais tourné dans un cluster

**Où** — `deploy/k8s/`, `.github/workflows/image.yml`.

L'image est construite, lancée et vérifiée pour de vrai — elle sert, elle
migre, elle s'arrête proprement, et son garde-fou d'étanchéité fonctionne. Le
script d'initialisation de Postgres est testé contre un Postgres réel, avec un
mot de passe piégeux.

Les **manifestes**, eux, sont écrits selon les spécifications et validés
syntaxiquement, jamais appliqués : il n'y a pas de cluster ici. Le workflow
GitHub Actions n'a pas non plus tourné une seule fois.

**Ce que ça coûte.** Les erreurs qui restent sont celles qu'une validation YAML
ne voit pas : une classe d'Ingress qui n'existe pas, un `ClusterIssuer` mal
nommé, un `storageClassName` absent, un paquet GHCR privé que le cluster ne
peut pas tirer. Toutes se voient au premier `apply`, aucune n'est silencieuse.

**Ce qui le lèverait.** Un premier déploiement, et la correction des valeurs
propres au cluster. La passation les liste comme étant à remplacer.

---

## 10. Le poids est stocké et lu par personne

**Où** — `eater.weight_kg`, `.height_cm` (migration 009), saisis dans
`web/components/EaterForm.tsx`.

Ces colonnes existent parce que la RNP des protéines de l'ANSES s'exprime **par
kilogramme de poids corporel** — 0,83 g/kg/j chez l'adulte —, ce qui est
exactement le terme qui manque pour dériver une cible en grammes plutôt qu'un
intervalle en % de l'AET (§9). Sauf que ce calcul n'est pas fait : il demande
une ligne `nutrient_reference` de plus, avec sa chaîne de sources complète, et
le contenu de cette table ne se décide pas seul.

**Ce que ça coûte.** Une donnée de santé demandée à l'utilisateur, qui ne lui
rend rien pour l'instant. C'est le mauvais côté du marché, et ça ne doit pas
durer : soit la ligne dérivée s'écrit, soit les colonnes se retirent.

**Ce qui le lèverait.** Une ligne `protein_g` / `RNP` / `absolu` dérivée de
`0,83 g/kg × poids`, avec `derived = true` et sa source, et la barre protéines
qui la préfère à l'intervalle quand le poids est connu. À décider avec le
propriétaire du dépôt, comme le reste de `nutrient_reference`.

---

## 11. « Poids réservé aux majeurs » n'est pas dans la base

**Où** — `server/routes/eaters.ts`, fonctions `corps()` et `present()`.

L'âge se dérive de `birth_date` et de la date du jour. Un `check` Postgres qui
l'utiliserait serait non-immutable — donc refusé — et de toute façon faux le
lendemain de l'anniversaire. La règle vit donc en applicatif, à trois endroits :
l'écriture refuse (422), la lecture masque, et une date de naissance corrigée
qui rend le profil mineur **efface** le poids.

**Ce que ça coûte.** Un script qui écrirait directement en base — un seed, une
reprise de données, un `psql` un soir — poserait un poids sur un profil mineur
sans que rien ne bronche. L'interface ne le montrerait pas ; la colonne, elle,
le porterait.

**Ce qui le lèverait.** Rien de propre côté Postgres tant que l'âge est dérivé.
Le contournement serait une colonne `is_minor` maintenue par déclencheur, qui
échangerait un problème contre un pire. Consigné pour être su, pas pour être
corrigé.

---

## 12. Le thème sombre exige un navigateur de 2024

**Où** — `web/design/tokens.css`, tous les tokens en `light-dark()`.

Les deux valeurs de chaque couleur sont déclarées sur la même ligne. C'est ce
qui rend impossible d'en mettre à jour une et d'oublier l'autre — le défaut
classique d'un second bloc `@media (prefers-color-scheme: dark)`, qui se
désynchronise sans que rien ne le signale.

**Ce que ça coûte.** `light-dark()` date de Chrome 123 / Safari 17.5 /
Firefox 120, début 2024. En deçà, ce n'est pas « pas de mode sombre » : les
propriétés personnalisées se parsent (elles acceptent presque n'importe quels
jetons) mais ne résolvent pas, donc `background: var(--surface-2)` devient
invalide et l'interface perd ses couleurs. Sur Android à jour — la cible, et la
seule qui permette le share target — c'est acquis depuis deux ans. Sur la
vieille tablette d'un grand-parent, non. Et le grand-parent est un utilisateur
prévu par la spec (rôle `adulte`).

⚠️ Le repli par déclaration adjacente (`--x: #FFF; --x: light-dark(…);`) **ne
marche pas ici** : les deux déclarations se parsent dans un navigateur sans
support, la seconde gagne, et le résultat est le même. Seul `@supports` ferait
l'affaire.

**Ce qui le lèverait.** Un bloc `@supports (color: light-dark(#000, #fff))`
portant les tokens sombres, le `:root` de base ne gardant que les valeurs
claires. Ça rétablit la duplication, et il faudrait alors un test qui compare
les deux jeux plutôt qu'une bonne intention.

---

## 13. L'orange des glucides est faiblement contrasté en mode clair

**Où** — `--n-gluc: #EF9F27` sur une carte blanche.

Mesuré en vérifiant le mode sombre, pas en le cherchant. Les cinq couleurs de
nutriments sur fond de carte :

| | sur la carte sombre | sur la carte blanche |
|---|---|---|
| protéines | 4,41 | 3,76 |
| glucides | 7,62 | **2,17** |
| lipides | 4,61 | 3,59 |
| fibres | 4,89 | 3,39 |
| végétal | 4,82 | 3,44 |

Le seuil WCAG pour un élément graphique porteur de sens est 3 pour 1. L'orange
des glucides passe à 2,17 en clair — c'est la seule des dix mesures en dessous,
et le mode sombre le corrige par accident.

**Ce que ça coûte.** Une barre de glucides peu lisible en plein soleil, sur
l'écran où l'app sert le plus. Pas faux, juste pâle.

**Ce qui le lèverait.** Assombrir `--n-gluc` d'un ou deux crans en mode clair
uniquement. **Ce n'est pas une décision à prendre seul** : les cinq valeurs sont
celles du §8ter et des maquettes, et les changer désaccorde l'app de sa
référence visuelle. Rien n'a donc été touché.

## 14. La source d'une ligne de saisonnalité est exigée, puis jetée

**Où** — `scripts/seed-refs.ts`, `loadSeasonal` ; table `seasonal_produce`
(migration 001).

Le chargeur appelle `requireSource()` sur chaque ligne du CSV et refuse un
fichier qui en manque une — comme pour les deux autres tables de référence.
Mais `seasonal_produce` n'a pas de colonne `source`, contrairement à
`nutrient_reference` et `unit_default` : la provenance est **vérifiée à
l'entrée, puis perdue**.

**Ce que ça coûte.** Rien de faux ne s'écrit — la vérification, elle, a bien
lieu. Ce qui manque, c'est la traçabilité : l'app peut dire d'où vient un
repère nutritionnel, pas d'où vient « la courgette est de saison en juillet ».
Sur un jeu, c'est moins grave que sur un repère ; ça reste une règle du projet
à moitié tenue.

**Ce qui le lèverait.** Une migration ajoutant `source text not null`, et
trois caractères dans l'`insert`. À faire quand la table se remplira — elle
est vide aujourd'hui, et sa saisie manuelle est justement l'un des points du
« ne pas décider seul ».

**Même compromis, depuis le 14/09/2026, pour les conversions par aliment**
(`db/seeds/food-unit-weight.csv`, `loadFoodUnitWeights`). La source est exigée
sur chaque ligne, puis ne suit pas : `food.unit_weights` est un jsonb de
grammes. L'app dit « Estimation », pas « 1 tbsp = 5 g selon l'USDA ». Le
lever demanderait de passer le jsonb à `{"grams", "source"}` — ou une table à
part — et de relire les deux formes dans `loadFoodValues`.


---

## 15. Ce que la passe de sécurité du 14/09/2026 laisse ouvert

Trois angles morts connus, tous assumés, aucun bloquant.

**La CSP autorise les styles en ligne.** `style-src 'self' 'unsafe-inline'`,
parce que le front pose ses styles en attribut `style=…` sur presque chaque
élément. Une injection HTML pourrait donc encore repeindre la page — mais pas
exécuter de script (`script-src 'self'`), ni appeler un tiers
(`connect-src 'self'`). Le lever demande de sortir les styles des composants
vers des feuilles, ce qui est une passe à soi seule.

**Les requêtes anonymes partagent un compteur de débit.** `trustProxy` n'est
pas activé — un `x-forwarded-for` cru sur parole se falsifie, et le plafond se
contournerait d'une ligne — donc `request.ip` est celle de Caddy. Conséquence :
un scanner qui martèle `/api/auth` peut faire attendre une minute devant
l'écran de connexion. Les requêtes authentifiées sont comptées par compte et ne
sont pas concernées. Le lever suppose de décider quel proxy est de confiance,
ce qui dépend de l'installation.

**HSTS n'est pas posé par l'app.** L'app ne sert qu'en HTTP derrière Caddy, qui
porte le TLS : `Strict-Transport-Security` se pose là, une ligne de Caddyfile
(`docs/mise-en-service.md`). Tant qu'elle n'y est pas, une toute première
visite en `http://` reste interceptable.

---

## 16. Réimporter Ciqual après un changement de mapping se demande à la main

**Où** — `db/seeds/ciqual-source.json`, champ `etl` ; `server/food/groups.ts`.

Depuis le 14/09/2026, le seed Ciqual tourne à chaque déploiement et sait ne
rien faire quand il n'y a rien à faire : il compare ce qui est en base
(`referential_import`) à l'archive épinglée. Une nouvelle table de l'ANSES est
donc importée toute seule.

**Ce qui ne l'est pas** : un changement de **notre** lecture de cette archive.
Corriger le classement d'un sous-groupe dans `server/food/groups.ts` laisse en
base 3 185 lignes calculées par l'ancien code, et rien ne s'en aperçoit — même
archive, même empreinte. Le champ `etl` du manifeste existe exactement pour
ça : l'incrémenter dans le même commit force la réimportation au déploiement
suivant. C'est un geste humain, et donc oubliable.

**Ce que ça coûte** — un classement corrigé qui ne prend pas effet, sans
signal. La part végétale d'un aliment reste fausse jusqu'au prochain import
forcé. Aucune valeur nutritionnelle n'est touchée : `plant_based` et `category`
sont les seules colonnes dérivées de notre code, les teneurs viennent
directement de la source.

**Ce qui le lèverait** — dériver `etl` du contenu de `groups.ts` (une empreinte
du fichier, plutôt qu'un entier saisi). Ça a été écarté pour l'instant : un
reformatage ou un commentaire déclencherait alors une réimportation complète,
et une version qu'on choisit dit quelque chose qu'une empreinte automatique ne
dit pas — « cette modification-là change les lignes déjà en base ».

---

## 17. Le découpage par IA : un filet pour les prénoms, et une clé ouverte à l'inscription

**Où** — `server/llm/index.ts` (`anonymize`, et la marque `Anonymized` sans
laquelle rien ne part), `POST /api/meals/decoupage`, `POST /api/assistant`,
`POST /api/assistant/recipes`.

**Ce qui est fait.** Avant l'envoi, les prénoms des fiches du foyer — retirées
comprises — et les mots du nom du compte sont retirés du texte, mot entier et
sans égard à la casse ; un lien Jow collé perd son jeton. Chaque route IA est
limitée à dix appels par minute par compte — **par route** : le découpage,
l'assistant et les recettes de l'accueil ont chacun leur compteur, trente
appels en tout. Depuis le 14/09/2026, un découpage en fait deux au modèle — le
découpage, puis le choix dans Ciqual : quarante appels au modèle par minute, au
plus.

**Ce qui passe quand même.** Tout ce qui n'est pas un prénom enregistré :
« mon fils », un surnom, le prénom d'un invité, un prénom tapé sans son accent
(« Lea » pour « Léa »). À l'inverse, un enfant prénommé Olive fait disparaître
« une olive » du texte : la ligne manque, et la personne la rajoute.

Et l'inscription est ouverte (§16) : n'importe qui peut créer un compte et un
foyer, puis faire quarante appels au modèle par minute sur la clé de l'hébergeur. Le plafond
borne la vitesse, pas le total.

**Ce que ça coûte** — un prénom d'enfant qui part chez Anthropic quand
quelqu'un l'écrit autrement que sur sa fiche. Et une facture qui peut monter
sans que l'hébergeur le voie, s'il ne pose pas de limite de dépense sur la clé.

**Ce qui le lèverait** — pour les prénoms, rien d'automatique n'est complet :
l'écran invite déjà à décrire l'assiette plutôt que qui l'a mangée, et c'est la
seule vraie défense. Pour la clé, en attendant mieux, une limite de dépense
côté console Anthropic ; ensuite, un quota quotidien par foyer en base, ou
l'IA réservée aux foyers que l'hébergeur désigne. Écarté tant que l'instance ne
sert que des familles connues.

**L'assistant ajoute un angle mort.** Le même filet retire les prénoms de la
question, de la conversation renvoyée par l'écran et des libellés de plats ;
mêmes trous. Mais surtout, **ce qu'il répond n'est relu par rien** avant
l'écran. Sa consigne lui interdit tout chiffre absent des faits — repères
compris —, tout objectif de calories ou de poids, tout jugement sur une
personne. Une consigne se suit presque toujours, pas toujours : un « deux
portions de poisson par semaine » tiré de sa mémoire, c'est un repère sans
source (I1) affiché tel quel. Le lever demanderait une relecture automatique
de la réponse — un second appel, ou une liste de motifs refusés — et ni l'un
ni l'autre n'est complet. C'est pour ça que l'écran dit « vérifiez ce qu'il
propose » et que rien n'est gardé : une réponse fausse ne survit pas à la
conversation.

---

## 18. Le repli d'une cuillère est une médiane, pas une mesure

**Où** — `db/seeds/unit-default.csv`, `resolveUnit` et `formOf`
(`server/nutrition/units.ts`), migration 013.

Quand un aliment n'a pas sa conversion propre, une cuillère à soupe vaut 15 g
(médiane de 14 mesures USDA de liquides, pâtes et grains, de 13,5 à 21 g),
6,5 g pour une épice, et un litre 1 kg. L'app l'affiche « approximatif ».

**Commun à tous les foyers.** Ces conversions, comme celles de
`food-unit-weight.csv` et la valeur retenue d'office pour l'œuf (50 g) et la
gousse d'ail (5 g), sont du référentiel : l'hébergeur les change par le CSV et
le seed, aucun utilisateur ne les corrige depuis l'écran. D'où « approximatif »
et non « à vérifier » sur une ligne d'ingrédient. Une correction par foyer
demanderait une table sous RLS et un geste « corriger le poids » — pas faite,
et à ne jamais écrire dans `food.unit_weights`, où la cuillère d'une famille
changerait celle des autres.

**Des poids bruts.** Les pièces, poignées, bouquets et tranches retenus d'office
le 14/09/2026 viennent de fiches Aprifel et d'étiquettes produit : épluchure,
os, noyau compris. Ciqual, lui, compte la partie comestible. Un avocat, une
banane, un citron — et surtout un poulet entier, 1,5 kg prêt à cuire — pèsent
donc plus que ce qu'on en mange, et la part végétale d'un repas en est faussée.
Aucune page lisible ne donnait la part comestible de chaque produit ; un
rendement par famille (peau fine, noyau, os) le lèverait, s'il se trouve sourcé.

**Ce que ça coûte.** La forme ne se lit que sur la catégorie `epice`. Une
poudre légère rangée ailleurs et sans ligne propre prend le repli commun, à 15 g
la cuillère : la fécule de maïs, avant d'avoir sa ligne, en pèse 8 (USDA), le
cacao 5,4. Toutes les poudres ne sont pas légères — la levure chimique fait
13,8 g, le sel 18. Le miel, à 21 g, est sous-estimé d'un quart. Un litre d'huile
sans ligne propre est surestimé d'environ 10 %. Rien de cela ne touche les valeurs nutritionnelles d'un
repas Jow, qui viennent de sa fiche : seulement la part végétale, et un repas
saisi en cuillères.

**Ce qui le lèverait.** Une ligne par aliment dans `food-unit-weight.csv` pour
les poudres qu'on emploie vraiment — c'est ce qui a été fait pour la farine et
le sucre —, ou une forme déclarée par sous-groupe Ciqual plutôt que par
catégorie.

---

## 19. Un trou de conversion se voit en déploiement, et se comble dans le dépôt

**Où** — `db/seeds/food-unit-weight.csv` et `db/seeds/unit-default.csv` d'un
côté ; `recipe_ingredient`, `jow_food_link` et `food` de l'autre, dans la base
de chaque instance.

Les conversions d'unités sont du référentiel versionné : une ligne s'ajoute par
un commit, et `seed:refs` la charge au déploiement suivant. Les recettes Jow,
elles, arrivent dans la base d'une instance. C'est là qu'un nouvel ingrédient à
la pièce — une côte de bœuf — apparaît et reste « non converti », que quelqu'un
l'ait rattaché à Ciqual ou non. **Rien ne remonte de la base vers le dépôt.**

**Ce que ça coûte.** Un trou dure jusqu'à ce que quelqu'un le remarque à
l'écran, retrouve le code Ciqual, écrive la ligne et fasse redéployer. Sur une
instance qui sert plusieurs familles, l'hébergeur ne voit pas leurs recettes :
le trou peut durer indéfiniment. La part végétale des repas concernés reste
incomplète — elle le dit, mais personne n'agit dessus.

**Ce qui le lèverait.** La liste des couples (aliment Ciqual, unité) employés
sans conversion, triés par nombre de recettes. Elle se calcule sur les recettes
**Jow** seulement — globales, sans rien d'une famille — et jamais sur les
recettes manuelles ni sur `meal_item`, qui sont au foyer. Reste à choisir où
elle sort, et chaque option a son prix :

- une commande à lancer sur le déploiement : il faut penser à aller la lire ;
- une ligne dans le journal du seed à chaque démarrage : même chose, en moins
  oubliable ;
- une issue ouverte sur le dépôt : le trou arrive là où il se comble, mais des
  libellés d'ingrédients sortent de l'instance vers un tiers, et l'instance
  doit détenir un jeton d'écriture sur le dépôt.

Décidé le 14/09/2026 de consigner plutôt que de construire : la commande a été
proposée, puis écartée faute de résoudre le vrai problème — le trajet de la
base au dépôt.

---

## 20. L'assistant de recettes vise des moyennes saisies, et ses idées n'ont pas de source

**Où** — `server/llm/recettes.ts`, `POST /api/assistant/recipes`, le bouton
« Demander à l'assistant des recettes » de l'accueil.

**Des moyennes de ce qui a été saisi.** Le modèle vise le repère le moins
atteint sur les sept jours précédents. Une journée dont seul le dîner a été
saisi y compte comme une journée entière : le pourcentage est un minorant, et
le modèle peut viser un manque qui n'existe pas. La route refuse une semaine
vide, pas une semaine lacunaire ; le résumé dit que la saisie peut être
incomplète, il ne sait pas laquelle.

**Des idées sans source.** Au-delà des recettes Jow du foyer, qu'il désigne
par numéro et dont les valeurs viennent de Jow, le modèle avance une ou deux
idées de plats — élargi le 14/09/2026, à la demande du propriétaire. Une idée
n'a ni valeur ni photo, et un chiffre l'écarte entière ; mais son « pourquoi »
(« les légumineuses apportent des fibres ») vient de ce que le modèle sait des
aliments, pas d'une source. R1 est tenu dans sa lettre — aucune valeur ne vient
du modèle —, pas tout à fait dans son esprit. Le badge « à vérifier » le dit,
et rien n'est gardé.

**Ni allergènes ni régimes contrôlés.** Les allergies ne sont saisies nulle
part et ne partiraient pas (I3). Les régimes partent, et la consigne demande de
les respecter, sans que rien ne le vérifie. Les recettes proposées sont celles
que le foyer a lui-même partagées ; une idée n'est qu'un nom de plat, que
personne ne cuisine sans en lire la recette.

**Ce que ça coûte.** Une proposition qui vise le mauvais repère, ou une idée
qui ne convient pas au foyer : une suggestion de trop, jamais une valeur fausse
affichée.

**Ce qui le lèverait.** Écarter les journées manifestement incomplètes demande
un seuil qu'aucune source ne donne : il se décide avec le foyer. Rapprocher une
idée d'une vraie recette demanderait de chercher dans Jow, ce que l'app ne fait
pas (I7 : pages publiques seulement).

---

## 21. L'image d'un plat décrit avec l'IA : reprise sur les seuls ingrédients, et un second tiers

**Où** — `server/llm/image.ts`, `POST /api/meals/:id/image`, migration 015.

**Reprise à ingrédients égaux, description ignorée.** L'étiquette d'une image
est l'ensemble exact de ses ingrédients (aliment Ciqual, sinon libellé). Des
pâtes, des tomates et des lardons dessinés en gratin reprennent le gratin le
jour où on les décrit en salade. À l'inverse, un ingrédient de plus redessine
tout, même pour un plat identique à l'œil.

**Un second tiers voit la description.** Gemini reçoit ce qu'Anthropic reçoit
déjà pour le découpage : les aliments et le texte tapé, passés au même filtre
de prénoms, avec les mêmes trous (dette n° 17). La route est plafonnée comme
les autres routes IA, mais l'inscription reste ouverte : la clé Google mérite
sa limite de dépense.

**L'image arrive après l'accueil.** L'écran de saisie la demande sans
l'attendre et revient à l'accueil. Celui-ci s'affiche avant qu'elle soit
dessinée : le bol reste jusqu'au prochain chargement. Une demande perdue (app
fermée aussitôt, modèle en panne) laisse le bol pour de bon : rien ne la
rejoue.

**Ni réduite ni vérifiée.** L'image est gardée telle que le modèle la rend,
en 1K, pour des vignettes de 42 à 118 px. Et le format de réponse de
`generateContent` est lu d'après la documentation de Google : aucun appel réel
n'a été fait à l'écriture, faute de clé.

**Ce que ça coûte.** Une image qui ne ressemble pas au plat, ou pas d'image :
jamais une valeur fausse. Quelques centaines de Ko par plat distinct en base.

**Ce qui le lèverait.** Rapprocher des ensembles voisins plutôt qu'égaux ;
rafraîchir l'accueil quand l'image arrive ; réduire l'image avant de la garder
(une dépendance de plus, `sharp`, pour quelques Ko).

## 22. Le titre d'un repas décrit avec l'IA n'est ni relu ni modifiable

**Où** — `server/llm/decoupage.ts` (`title`), `POST /api/meals` (`title`),
migration 016, `web/screens/FreeTextEntry.tsx`.

**Le foyer ne le voit qu'après.** Le modèle reformule la description en titre
au moment du découpage, et l'écran de saisie l'enregistre tel quel avec le
repas : il n'est ni affiché ni éditable avant « Enregistrer », et rien ne le
modifie ensuite. Un titre à côté de la plaque reste sur la carte. Les lignes,
elles, se relisent et se corrigent ; le titre est la seule sortie du modèle
qui n'a pas ce filet.

**Le premier découpage l'emporte.** Un plat décrit en deux fois (« des pâtes »
puis « et une salade ») garde le titre du premier texte.

**Ce que ça coûte.** Un libellé maladroit sur une carte, jamais une valeur.
Le modèle ne reçoit que la description passée par `anonymize` (dette n° 17) :
un prénom qui traverse le filtre peut donc finir dans le titre.

**Ce qui le lèverait.** Un champ « Titre » sous la description, prérempli par
le découpage et corrigeable, et `PATCH /api/meals/:id` qui l'accepte.

---

## 23. La photo d'un plat part sans filtre, et ne laisse rien

**Où** — `server/llm/index.ts` (`DishPhoto`), `POST /api/meals/decoupage`
(`photo`), `web/screens/FreeTextEntry.tsx` (`réduire`).

**Aucun filtre ne relit une image.** `anonymize` retire les prénoms et les
jetons Jow d'un texte ; une photo n'a ni l'un ni l'autre, mais peut cadrer une
personne — et I3 interdit d'envoyer des photos de personnes au modèle. Le seul
filet est la phrase sous le bouton (« Ne cadrez que l'assiette, sans
personne ») et la consigne au modèle de ne décrire aucune personne. C'est un
usage demandé, pas une garantie.

**La photo n'est pas conservée.** Ni en base, ni sur disque : elle sert au
découpage et disparaît. La carte du repas n'a donc pas d'image, et
`POST /api/meals/:id/image` ne dessine que les repas de source `ia`. Garder
la vraie photo serait mieux qu'une image générée — mais c'est stocker une
photo prise dans une cuisine, avec ce qu'elle cadre.

**Ce que ça coûte.** Une image de personne peut partir chez Anthropic si
l'écran est ignoré. Une confiance « basse » sur tout repas photographié, même
corrigé ligne à ligne : c'est la règle du §11, elle ne distingue pas.

**Ce qui le lèverait.** Une passe de détection de visages **côté téléphone**
avant l'envoi (`FaceDetector` n'est pas disponible partout) ; et pour la
conservation, décider si une photo de repas est une donnée du foyer comme une
autre, puis la stocker dans `dish_image` avec le même consentement.

---

## Levées

Gardées ici parce qu'une dette levée explique souvent pourquoi le code a la
forme qu'il a. Le détail est dans l'historique git.

- **Un partage Jow reçu sans session ne survivait pas à la connexion Google**
  (ouverte et levée le 14/09/2026, sans numéro : le n° 17 est le découpage par
  IA, ouvert en parallèle). Le retour de Google ne
  ramenait que le chemin : la query porte les jetons `key` et `userId` (I6), et
  better-auth la garde en base le temps de l'aller-retour. L'écran de connexion
  la lui confie désormais passée par `redactRequestUrl` — la même expurgation
  que celle du journal de requêtes, importée du serveur plutôt que recopiée,
  pour qu'il n'y en ait qu'une. L'identifiant de recette, seul utile au
  serveur, reste. Écarté en chemin : garder le texte dans `sessionStorage`,
  qui aurait conservé côté navigateur ce qu'I6 demande de ne pas garder.

- **Le type `Db` laissait écrire un `pool.query` sur une table du domaine.**
  La dette n° 9 disait que le foyer courant deviendrait ambigu le jour où un
  traitement réutiliserait un client sans passer par `withHousehold`, et que
  le garde-fou du démarrage ne voit pas ce cas. `Db = pg.Pool | pg.PoolClient`
  est remplacé par deux types : `HouseholdDb`, un client **marqué** que seul
  `acquireForHousehold` produit et que toutes les fonctions du domaine
  exigent, et `UnscopedDb`, nommé pour se voir en revue, réservé à ce qui
  précède le foyer — la résolution de session, la création du foyer d'une
  organisation, la liste des foyers d'un compte — et au référentiel public
  hors RLS. Une erreur qui se compilait ne se compile plus ; `server/db.test.ts`
  le vérifie par `@ts-expect-error`, de sorte qu'un relâchement du type casse
  le typecheck au lieu de passer inaperçu. Au passage, `transaction()` ne prend
  plus de pool du tout : le client est toujours celui de l'appelant.
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
- **Rien ne reliait une fiche de convive à un compte.** Créer son compte menait
  à une app vide, un conjoint saisi à la main restait orphelin de son compte, et
  `/api/eaters` n'appliquait **aucun** contrôle de rôle alors que `ROLES.adulte`
  n'en porte aucun sur les convives. La migration 009 pose le lien facultatif
  (`eater.user_id`, `eater.claim_email`), et les rôles s'appliquent enfin :
  un `parent` compose le foyer, un `adulte` ne modifie que sa propre fiche.
- **Les polices venaient de Google Fonts.** Fraunces et Inter sont embarquées
  dans `web/public/fonts/`, en sous-ensemble `latin` seul : vérification faite
  sur les 3 185 noms de Ciqual et sur tous les textes de l'interface, aucun
  caractère n'en sort. 84 Ko au total, et plus aucune requête vers un tiers au
  chargement — hors les photos de plats de Jow, qui sont le sujet même du
  §8ter.
