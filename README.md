# Tablée

PWA familiale de suivi alimentaire, auto-hébergée. On enregistre les repas —
surtout en les partageant depuis Jow — et l'app montre, **pour chaque
personne**, un bilan réparti selon son âge et son coefficient de portion.

La spec fait autorité : [`docs/plan-app-nutrition-famille.md`](docs/plan-app-nutrition-famille.md).
Les règles permanentes sont dans [`CLAUDE.md`](CLAUDE.md). Ce qui est su,
assumé et à reprendre est dans [`docs/dette-technique.md`](docs/dette-technique.md).

---

## Démarrer

```bash
npm install

# 1. La base
createdb tablee
export DATABASE_URL=postgres://tablee:…@localhost:5432/tablee
npm run migrate

# 2. Le référentiel d'aliments (§5) et les repères ANSES (§9)
#    Le seed télécharge l'export Ciqual lui-même, dans data/ciqual/, et refuse
#    de l'importer s'il ne correspond pas à l'empreinte de
#    db/seeds/ciqual-source.json. Rejouable : il ne refait rien s'il n'y a
#    rien à faire.
npm run seed          # = seed:food puis seed:refs

# 3. Le front, puis le serveur
npm run build:web
export TABLEE_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
npm start                      # http://localhost:3000
```

Il n'y a **pas** de commande pour créer le foyer : depuis la migration 007, le
premier compte se crée dans l'app, et le foyer avec. L'inscription est ouverte
— c'est ce qui permet à des amis de créer le leur (§16).

`npm run build:web` **avant** `npm start`, et à nouveau à chaque changement du
front : le serveur lit `web/dist/index.html` une seule fois, au démarrage. Le
rebâtir sans redémarrer sert une coquille qui pointe vers un bundle renommé.

En développement : `npm run dev` (serveur, rechargé à chaud) et
`npm run dev:web` (Vite sur le port 5173, qui proxie `/api`). Sur
`http://localhost`, poser `TABLEE_INSECURE_COOKIE=1` pour que le cookie de
session soit accepté sans HTTPS, et `TABLEE_BASE_URL=http://localhost:5173` :
une fois connecté, better-auth refuse toute requête dont l'en-tête `Origin`
n'est pas celui de `TABLEE_BASE_URL`, et le proxy de Vite le transmet tel quel.

Plutôt que des `export`, les variables peuvent vivre dans un `.env` à la racine
— gabarit dans `.env.example`, jamais commité. `dev`, `migrate` et `seed` le
lisent d'eux-mêmes ; une variable déjà exportée l'emporte sur le fichier.
`npm start` et `npm test` ne le lisent **pas** : en production les variables
viennent de l'environnement, et une suite qui trouverait `TEST_DATABASE_URL`
dans un fichier tronquerait une base sans qu'on l'ait demandé.

**En production, HTTPS est obligatoire** : le share target Android ne
fonctionne pas autrement (§4). Caddy devant le serveur suffit.

## Tests

```bash
npm run lint    # ESLint typé — des bugs, pas du style
npm run typecheck
npm test        # unitaires — aucune base requise

createdb tablee_test
TEST_DATABASE_URL=postgres://…/tablee_test npm test   # + tests d'intégration
```

Sans `TEST_DATABASE_URL`, les suites qui touchent à Postgres sont **sautées
avec un message**, jamais silencieusement vertes. Un `npm test` nu en passe 205
sur 292, et laisse de côté **tout** ce qui touche aux comptes, aux foyers, à
l'étanchéité entre eux et au contrat d'API — c'est-à-dire ce qui casse mal.

Le rôle Postgres de cette base **ne doit pas être superutilisateur** — il
contournerait la RLS en silence, et les tests d'isolation passeraient au vert
pour rien. Le serveur refuse d'ailleurs de démarrer dans cet état :

```bash
psql -c "create role tablee login password '…' nosuperuser"
psql -c "create database tablee_test owner tablee"
```

Corollaire à connaître avant de croire une base vide : un `psql` avec ce rôle ne
rend **aucune ligne** sur `eater`, `meal` ou `meal_template` tant que
`app.household_id` n'est pas posé. C'est la RLS, pas une base vide.

---

## Les tables de référence

Elles se chargent depuis `db/seeds/*.csv`, versionnés, avec **une colonne
`source` obligatoire sur chaque ligne** : le chargeur refuse un fichier qui en
manque une. C'est le seul garde-fou mécanique contre une valeur arrivée là on
ne sait comment (I1).

Rien n'est téléchargé au démarrage. Un fichier versionné se relit en diff et se
retrouve avec `git blame` le jour où une barre paraît fausse ; des chiffres qui
changent sous les pieds entre deux redémarrages, ce sont des conseils destinés
à des enfants qui changent avec.

| Table | État | Ce que fait l'app |
|---|---|---|
| `nutrient_reference` | **Remplie** pour les quatre macronutriments, de 4 à 17 ans et pour les adultes | Les barres se remplissent vers une cible et disent ce qui manque ou ce qui est dépassé. |
| `energy_reference` | **Remplie** (EFSA 2017 pour les enfants, ANSES 2016 pour les adultes) | Terme de calcul uniquement. Jamais affiché : I5. |
| `unit_default` | Vide — cinq pesées à faire | Une unité non convertible est signalée et la quantité est demandée. La nutrition d'un repas Jow reste exacte : elle vient du snapshot par portion. |
| `seasonal_produce` | Gabarit de 43 produits, mois à saisir depuis un calendrier au choix | La bande « De saison en … » ne s'affiche pas, et le badge des cartes non plus. |

```bash
npm run seed          # Ciqual + tables de référence
npm run seed:refs     # les tables de référence seules
npm run seed:refs -- --dry-run
```

### Comment les repères sont obtenus

Des quatre macronutriments de la V1, **seules les fibres ont une valeur absolue
publiée** : 30 g/j pour l'adulte, 14 / 16 / 19 / 21 g/j pour les 4-6, 7-10,
11-14 et 15-17 ans. Protéines, lipides et glucides sont publiés en
**pourcentage de l'apport énergétique total**, sous forme d'intervalle.

Or un pourcentage d'énergie est un **ratio**, pas un compteur : il converge au
fil de la journée au lieu de progresser, et ne répond donc pas à « qu'est-ce
qu'il me manque ? ». Les intervalles sont traduits en grammes au moment du
seed :

```
cible_g = intervalle (% AET) × besoin énergétique (kcal) / facteur (kcal/g)
```

Les trois termes sont sourcés — avis ANSES pour l'intervalle, EFSA 2017 / ANSES
2016 pour le besoin énergétique, Règlement (UE) n° 1169/2011 Annexe XIV pour
les facteurs, qui est la convention sous laquelle Ciqual publie son énergie.
Le produit, lui, n'est publié nulle part tel quel : ces lignes portent
`derived = true` et leur `source` contient la chaîne de calcul complète. C'est
un repère **de population**, pour une activité physique moyenne.

Le besoin énergétique ne sort jamais à l'écran : I5 interdit un objectif
chiffré de calories sur un profil mineur, et il ne sert ici qu'au calcul.

**Tranches prolongées** : l'avis ne retient un besoin énergétique que jusqu'à
69 ans chez l'homme et 59 ans chez la femme. Au-delà, la valeur de la dernière
tranche est reprise, pour qu'un repère existe quel que soit l'âge. Ces lignes
portent une `source` qui le dit, et ce texte remonte à l'écran — l'app ne fait
jamais dire à l'ANSES ce qu'elle ne dit pas. Le besoin énergétique baissant
avec l'âge, ces cibles sont probablement un peu hautes ; une valeur plus juste
existe sans doute dans le rapport annexe Anses 2017d, non consulté —
[dette n° 1](docs/dette-technique.md).

**Tranche non couverte** : 0 à 3 ans. Pas de prolongation vers le bas — les
besoins d'un nourrisson ne sont pas ceux d'un enfant de 4 ans en plus petit, et
c'est l'âge où une valeur plausible et fausse fait le plus de dégâts. Les
barres affichent « repère indisponible ».

### Ce qu'il y a à peser

Les cuillères et le litre ont un repli dans `unit_default` (« approximatif »), et
une quarantaine d'aliments courants leur conversion propre, sourcée, dans
`db/seeds/food-unit-weight.csv`. Les pièces, poignées, bouquets et tranches
courants — légumes, fruits, escalopes, saumon, knacks, pâtes à tarte, salades,
herbes, pain, jambon — y ont une valeur **retenue d'office** d'après des pages
web lues, poids brut compris. Un aliment qui n'y figure pas reste « non
converti » jusqu'à ce qu'on l'ajoute (dette n° 19). Une pesée maison remplace
volontiers une valeur retenue d'office. Un bol sur la
balance, tare, et on pèse, trois fois ; on garde la moyenne et on l'écrit par
aliment dans `food-unit-weight.csv`. « Pesée maison, 09/2026 » est une source
valable — c'est même la meilleure, parce que c'est votre poignée.

`Pièce` et `Litre` n'ont volontairement pas de valeur générique : une pièce de
poulet et une pièce de radis n'ont rien en commun, et 35 ml d'huile ne pèsent
pas 35 g. Ces deux-là passent par `food.unit_weights`, au cas par cas : une
ligne par aliment dans `db/seeds/food-unit-weight.csv` (code Ciqual, unité,
grammes, source), puis `npm run seed:refs`. Un œuf pesé chez vous y va aussi,
avec « Pesée maison, <date> » pour source.

## Où se trouve quoi

```
db/migrations/      SQL numéroté, jamais modifié après application
db/seeds/           CSV versionnés, colonne `source` obligatoire par ligne
scripts/            migrations, seed Ciqual, seed des repères, capture Jow
server/
  app.ts            assemblage Fastify : le hook qui authentifie et scope au
                    foyer, puis les routes. Le point d'entrée pour lire le reste.
  db.ts             pool, transactions, `withHousehold` (le foyer courant)
  auth/             better-auth : rôles et crochets, résolution du foyer actif
  http/             validation des corps, format d'erreur, fuseaux
  routes/           l'API du §12
  repo/             tout le SQL du domaine, scopé au foyer de la session
  nutrition/        les trois algorithmes du §11, en applicatif
  food/             lecture de l'export Ciqual + mapping des groupes
  jow/              parseur des pages publiques Jow (Tâche 0, verrouillée)
  test-support/     fabriques de comptes et de foyers pour les tests
web/
  App.tsx           le routeur et ses gardes
  session.tsx       compte, foyer actif, convives
  api.ts            client HTTP et types partagés (recopiés du serveur exprès)
  screens/          un fichier par écran
  components/       ce que plusieurs écrans partagent
  design/           tokens.css (couleurs, typo) et vocabulary.ts (les mots)
```

Le sens de circulation ne varie pas : **route → repo → base**, le calcul en
applicatif entre les deux.

## Deux ou trois choses à savoir avant de toucher au code

- **`meal_participant.share` est figé à l'écriture** (R2). Changer le
  `portion_coef` d'un enfant ne réécrit aucun repas passé — et la requête qui
  le ferait n'existe nulle part. `calculerShares` est la seule fonction
  autorisée à produire une part.
- **Une valeur inconnue est `NULL`, jamais `0`.** Un nutriment dont un seul
  aliment ignore la valeur ressort `null` pour tout le repas, avec un warning
  qui nomme l'aliment. Un total partiel serait sous-estimé sans le dire.
- **Les cinq couleurs de nutriments ne touchent que des données
  nutritionnelles.** Le terracotta porte tout le chrome.
- **`coversCount` de Jow n'est pas un facteur d'échelle** — lire
  `docs/jow-contract.md` avant de toucher à `server/jow/`.
- **Ne jamais logger ni persister `key` / `userId`** d'un lien de partage Jow.
  `redactShareText` est le seul point de passage.
- **Les journées se découpent dans le fuseau du foyer**, jamais en UTC — y
  compris le mois de saisonnalité, qui se lit via une jointure sur
  `household.timezone`. Voir `server/http/tz.ts`.
- **Aucune requête vers un tiers au chargement.** Les polices sont embarquées
  (`web/public/fonts/`). Seules les photos de plats viennent de Jow, et c'est
  le §8ter qui le demande.

---

## Licence

[AGPL-3.0-only](LICENSE). Copyleft de réseau : quiconque héberge une version
modifiée de Tablée — et c'est le mode d'emploi même du projet — doit en publier
les sources. C'est le choix cohérent avec un logiciel auto-hébergé qu'on veut
voir rester ouvert.

Copyright (C) 2026 Xhelliom et les contributeurs de Tablée.
