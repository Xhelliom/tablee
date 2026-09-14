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
laquelle rien ne part), `POST /api/meals/decoupage`, `POST /api/assistant`.

**Ce qui est fait.** Avant l'envoi, les prénoms des fiches du foyer — retirées
comprises — et les mots du nom du compte sont retirés du texte, mot entier et
sans égard à la casse ; un lien Jow collé perd son jeton. Chaque route IA est
limitée à dix appels par minute par compte — **par route** : le découpage et
l'assistant ont chacun leur compteur, vingt appels en tout.

**Ce qui passe quand même.** Tout ce qui n'est pas un prénom enregistré :
« mon fils », un surnom, le prénom d'un invité, un prénom tapé sans son accent
(« Lea » pour « Léa »). À l'inverse, un enfant prénommé Olive fait disparaître
« une olive » du texte : la ligne manque, et la personne la rajoute.

Et l'inscription est ouverte (§16) : n'importe qui peut créer un compte et un
foyer, puis faire vingt appels par minute sur la clé de l'hébergeur. Le plafond
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

## Levées

Gardées ici parce qu'une dette levée explique souvent pourquoi le code a la
forme qu'il a. Le détail est dans l'historique git.

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
