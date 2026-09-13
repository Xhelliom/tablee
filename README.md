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

# 2. Le référentiel d'aliments (§5)
#    Télécharger l'export XML de la table Ciqual 2020 de l'ANSES et le
#    décompresser dans data/ciqual/ (dossier ignoré par git) :
#    https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip
npm run seed:food

# 3. Le compte du foyer (§7 — un seul compte, pas d'inscription dans l'app)
npm run household -- --login=maison --name="Chez nous"

# 4. Le front, puis le serveur
npm run build:web
npm start                      # http://localhost:3000
```

En développement : `npm run dev` (serveur, rechargé à chaud) et
`npm run dev:web` (Vite sur le port 5173, qui proxie `/api`). Sur
`http://localhost`, poser `TABLEE_INSECURE_COOKIE=1` pour que le cookie de
session soit accepté sans HTTPS.

**En production, HTTPS est obligatoire** : le share target Android ne
fonctionne pas autrement (§4). Caddy devant le serveur suffit.

## Tests

```bash
npm test        # unitaires — aucune base requise
npm run typecheck

createdb tablee_test
TEST_DATABASE_URL=postgres://…/tablee_test npm test   # + tests d'intégration
```

Sans `TEST_DATABASE_URL`, les suites qui touchent à Postgres sont **sautées
avec un message**, jamais silencieusement vertes.

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

### Ce qu'il y a à peser pour `unit_default`

Un bol sur la balance, tare, et on pèse : une poignée de salade, une gousse
d'ail épluchée, un bouquet de persil, une tranche de pain, une cuillère à
soupe rase d'huile. Trois fois chacune, on garde la moyenne. « Pesée maison,
09/2026 » est une source valable — c'est même la meilleure, parce que c'est
votre poignée.

`Pièce` et `Litre` n'ont volontairement pas de valeur générique : une pièce de
poulet et une pièce de radis n'ont rien en commun, et 35 ml d'huile ne pèsent
pas 35 g. Ces deux-là passent par `food.unit_weights`, au cas par cas.

## Où se trouve quoi

```
db/migrations/      SQL numéroté, jamais modifié après application
scripts/            seed Ciqual, création du foyer, icônes, migrations
server/
  jow/              parseur des pages publiques Jow (Tâche 0, verrouillée)
  food/             lecture de l'export Ciqual + mapping des groupes
  nutrition/        les trois algorithmes du §11, en applicatif
  repo/             accès aux données, scopé au foyer de la session
  routes/           l'API du §12
web/
  screens/          un fichier par écran
  design/           tokens.css (couleurs, typo) et vocabulary.ts (les mots)
```

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
