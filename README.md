# Tablée

PWA familiale de suivi alimentaire, auto-hébergée. On enregistre les repas —
surtout en les partageant depuis Jow — et l'app montre, **pour chaque
personne**, un bilan réparti selon son âge et son coefficient de portion.

La spec fait autorité : [`docs/plan-app-nutrition-famille.md`](docs/plan-app-nutrition-famille.md).
Les règles permanentes sont dans [`CLAUDE.md`](CLAUDE.md).

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

## Les trois tables livrées vides

Ce n'est pas un oubli. Chacune demande une collecte, et une valeur inventée y
serait pire que son absence (I1). Le code est écrit pour fonctionner sans
elles, et chaque état « la donnée manque » est testé comme un cas nominal.

| Table | Ce qu'il faut | Ce que fait l'app en attendant |
|---|---|---|
| `nutrient_reference` | Les repères ANSES / PNNS par âge et sexe, avec leur `source` | Les barres affichent « repère indisponible » — pas une barre à 0. L'accueil le dit en toutes lettres. |
| `unit_default` | Les 7 unités Jow du §4 de `docs/jow-contract.md`, chacune sourcée | Une unité non convertible est signalée et la quantité est demandée. La nutrition d'un repas Jow reste exacte : elle vient du snapshot par portion. |
| `seasonal_produce` | ~40 fruits et légumes × leurs mois, saisie manuelle | La bande « De saison en … » ne s'affiche pas, et le badge des cartes de repas non plus. |

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
