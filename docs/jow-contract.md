# Contrat de parsing Jow — Tâche 0

**Établi le 13 septembre 2026.** Document de constat : il décrit ce que Jow
publie réellement, vérifié sur 8 recettes. Il ne décide de rien.

Code correspondant : `server/jow/`. Échantillons figés :
`server/jow/fixtures/*.json`. Tests : `npm test`.

---

## Résumé

| Question du §3 de la spec | Réponse établie |
|---|---|
| Les pages sont-elles parsables ? | **Oui.** `__NEXT_DATA__` présent, complet, stable sur 8 recettes. |
| Où sont les données ? | `props.pageProps.recipe` (Pages Router, pas de RSC). |
| Le `recipeId` du partage est-il inutilisable ? | **Non — il est directement résolvable.** Voir ci-dessous. |
| `?coversCount=` change-t-il les quantités côté serveur ? | **Non.** Page statique, paramètre ignoré. |
| Les valeurs par portion sont-elles publiées ? | Oui, 5 nutriments, plus Nutri-Score et Green-score. |

**Critère de sortie atteint** : `npm run jow:resolve -- "<texte de partage>"`
produit `{ title, servings, ingredients[], nutrition{} }` sur 5 recettes
différentes, en confiance `haute`.

---

## 1. Le piège des identifiants n'existe pas

Le §3 de la spec prévoit une résolution par titre slugifié, le `recipeId` du
lien de partage (ObjectId Mongo) ne correspondant pas au suffixe de l'URL web.
Le constat est plus simple :

```
GET https://jow.fr/fr/recipes/650b16ade7cc8d0013ce4a6e
  → 302 https://jow.fr/recipes/galette-vege-puree-de-carotte-et-tzatziki-8vch9drbhyhc03wu0epa
  → 200
```

**L'ObjectId du lien de partage est accepté tel quel comme segment d'URL** et
redirige vers l'URL canonique. Le slug se lit ensuite dans
`props.pageProps.recipe.slug`, ou dans l'URL finale après redirection.

Conséquences :

- Pas de recherche par titre, pas de devinette de suffixe, pas d'appel
  supplémentaire. La stratégie « résolution par le titre » du §3 devient un
  repli mort — `slugify()` reste dans `server/jow/share.ts` parce que comparer
  deux titres sert ailleurs, mais elle n'est plus sur le chemin critique.
- `recipe.jow_slug` reste utile comme cache d'affichage (lien sortant), plus
  comme clé de résolution.
- La piste du deep link Branch (`app.jow.com/EC0U`) n'a pas eu à être testée.

⚠️ Ce comportement est une **redirection serveur non documentée**. Elle peut
disparaître. Le parseur ne s'y fie pas aveuglément : un échec de résolution
retombe sur `confidence='basse'` et la saisie manuelle, jamais sur une valeur
inventée.

---

## 2. Chemins exacts

Racine : `props.pageProps.recipe` dans
`<script id="__NEXT_DATA__" type="application/json">`.

### Recette

| Chemin | Type | Exemple | Destination |
|---|---|---|---|
| `.id` | string (24 hex) | `650b16ade7cc8d0013ce4a6e` | `recipe.jow_recipe_id` |
| `.title` | string | `Galette végé, purée de carotte & tzatziki` | `recipe.title` |
| `.slug` | string | `galette-vege-puree-de-carotte-et-tzatziki` | `recipe.jow_slug` |
| `.coversCount` | int | `1`, `4` | `recipe.base_servings` — **voir §3** |
| `.imageUrl` | string | `https://static.jow.fr/304x304/recipes/…png` | `recipe.image_url` |
| `.constituents[]` | array | — | `recipe_ingredient` |
| `.nutritionalFacts[]` | array | — | `recipe.*_serving` |
| `.nutritionalRatingScores[]` | array | — | `recipe.nutri_score`, `.green_score` |

### Ingrédients — `.constituents[]`

| Chemin | Type | Exemple | Destination |
|---|---|---|---|
| `.id` | string (24 hex) | `59ef3525a959090012a4f945` | `recipe_ingredient.jow_food_id` |
| `.name` | string | `Purée de carotte (surgelée)` | `recipe_ingredient.label` |
| `.quantityPerCover` | number | `0.1` | `recipe_ingredient.quantity` |
| `.unit.name` | string | `Kilogramme` | `recipe_ingredient.unit` |
| `.isOptional` | bool | `false` | `recipe_ingredient.optional` |

`.unit` est un objet complet (identifiant, abréviations, systèmes de mesure) ;
seul `.name` est retenu. Le parseur accepte aussi une chaîne nue, au cas où.

### Nutrition — `.nutritionalFacts[]`

Tableau de `{ id, label, unit, amount }`. Identifiants INFOODS :

| `id` | `unit` attendu | Colonne |
|---|---|---|
| `ENERC` | `kcal` | `kcal_serving` |
| `PRO` | `g` | `protein_serving` |
| `CHOAVL` | `g` | `carb_serving` |
| `FAT` | `g` | `fat_serving` |
| `FIBTG` | `g` | `fiber_serving` |

**L'unité est vérifiée, jamais convertie.** Si Jow publiait un jour `ENERC` en
kJ, la valeur est écartée (`null` + warning) plutôt que divisée par 4,184 :
une conversion silencieuse est exactement le genre de valeur plausible et
fausse qu'interdit I1. Test de non-régression dédié.

### Scores — `.nutritionalRatingScores[]`

`[{ id: 'nutriscore', score: 'B' }, { id: 'greenscore', score: 'A+' }]`.
Calculés par Etiquettable (`.nutritionalRatingProvider`), pas par Jow.

---

## 3. `coversCount` n'est pas un facteur d'échelle

Point le plus contre-intuitif du contrat, et la régression la plus facile à
introduire.

- `.quantityPerCover` est une quantité **par convive**.
- `.nutritionalFacts` sont des valeurs **par portion**.
- `.coversCount` est le nombre de parts **prévu par Jow** pour la recette —
  le « Recette prévue pour 4 » de la maquette. Il ne multiplie rien.

Vérification croisée sur `poulet-roti-et-duo-de-patates` (`coversCount: 4`) :
`0.25 × Poulet (entier)` par convive, soit un poulet pour quatre, et 868 kcal
qui ne peuvent être qu'une portion. Et sur la recette de référence
(`coversCount: 1`) : `0.1 kg` de purée et `0.05 kg` de tzatziki, identiques aux
100 g et 50 g relevés à la main au §3 de la spec.

La quantité totale d'un ingrédient vaut donc `quantity × servings`, et la
nutrition d'un repas `nutrition × meal.servings`. `servings` dans la sortie du
parseur porte `coversCount` et alimente `recipe.base_servings`.

### `?coversCount=` est ignoré

Le §3 demandait de tester `?coversCount=1` et `?coversCount=4`. Les deux
réponses sont **strictement identiques** : la page est générée statiquement
(`__N_SSG: true`) et le paramètre n'est lu que par le JavaScript client. La
mise à l'échelle est donc entièrement de notre côté — ce qui est plus sûr :
une seule source de vérité, pas de dépendance à un paramètre d'URL.

---

## 4. Unités — ce que le parseur refuse de faire

Le parseur ne convertit que les unités de **masse** (`Kilogramme`, `Gramme`,
`Milligramme`). Tout le reste ressort avec `quantityG: null` et un warning.

Unités relevées sur les 8 échantillons :

| Unité Jow | Occurrences | Exemple | Convertie ? |
|---|---|---|---|
| `Kilogramme` | 15 | `0.02 × Beurre` | ✅ `× 1000` |
| `Pièce` | 13 | `0.25 × Poulet (entier)` | ❌ |
| `Cuillère à soupe` | 6 | `0.25 × Moutarde` | ❌ |
| `Litre` | 4 | `0.035 × Huile de tournesol` | ❌ |
| `Poignée` | 2 | `1 × Salade (Mélange)` | ❌ |
| `Gousse` | 2 | `0.25 × Ail` | ❌ |
| `Bouquet` | 1 | `0.1 × Persil (frais)` | ❌ |
| `Tranche` | 1 | `1 × Pain de campagne (tranché)` | ❌ |

`Litre` est volontairement dans la colonne « non converti » : passer d'un
volume à une masse demande une densité, et 35 ml d'huile ne pèsent pas 35 g.

**Ces sept lignes sont exactement le contenu attendu de `unit_default` (§6).**
Chacune exige une `source` et relève du « ne pas décider seul » : elles ne
sont pas remplies ici.

Tant qu'elles manquent, la nutrition d'un repas Jow reste **exacte** : elle
vient du snapshot par portion publié par Jow, pas de la somme des ingrédients.
Les unités non résolues n'affectent que la part végétale (§8 de la spec), qui
sort à `null` plutôt qu'à un pourcentage calculé sur une base incomplète.

---

## 5. Pages ingrédients — piste, pas contrat

`https://jow.fr/ingredients/<ObjectId>` est publique et expose
`props.pageProps.ingredient.editorialData` :

```json
{
  "flags": { "fruit": false, "vegetable": false },
  "nutritionalFacts": [{ "id": "ENERC", "unit": "kcal", "amount": 245 }, "…"],
  "seasonality": [],
  "preservation": "fresh",
  "averageEstimatedValues": { "amount": 1, "unit": "piece" }
}
```

Deux choses intéressantes et une réserve :

- `flags.fruit` / `flags.vegetable` alimenteraient `food.plant_based` sans
  aucune saisie.
- `seasonality` pourrait recouper `seasonal_produce` (§8bis) — vide sur
  l'échantillon testé, à revérifier sur un légume franc.
- ⚠️ **La base des `nutritionalFacts` d'un ingrédient n'est indiquée nulle
  part dans le payload.** Le §5 de la spec suppose « valeurs /100 g » ; c'est
  vraisemblable, ce n'est pas établi. `averageEstimatedValues` suggère même
  qu'elles pourraient se rapporter à une pièce moyenne.

**Rien de tout cela n'est utilisé pour l'instant.** Écrire des valeurs
nutritionnelles sur une base supposée est précisément ce qu'interdit I1. À
trancher avant d'exploiter ces pages : soit une confirmation de la base, soit
on s'en tient à Ciqual et Open Food Facts, dont la base est documentée.

---

## 6. Tolérance et confiance

Le parseur **ne lève jamais**. Une page changée doit dégrader la saisie, pas
faire perdre le repas en cours.

| Situation | `confidence` |
|---|---|
| Titre, 5 nutriments, au moins un ingrédient | `haute` |
| Nutrition partielle, ou plus aucun ingrédient | `moyenne` |
| Pas de titre, ou aucune valeur nutritionnelle | `basse` |
| `__NEXT_DATA__` absent, JSON illisible, réseau en panne | `basse` |

`basse` déclenche la saisie manuelle avec le titre deviné depuis le texte de
partage. Aucune valeur n'est jamais inventée pour combler un trou : un champ
absent est `null`, jamais `0`.

Chaque anomalie produit un `warning` destiné à être **affiché**, pas seulement
loggué. Une donnée manquante doit se voir.

---

## 7. Secrets (I6)

Le texte partagé peut contenir `key=` et `userId=` — des tokens de compte.

- `redactShareText()` / `redactUrl()` les retirent (avec `token`,
  `access_token`) **avant** tout stockage, log ou message d'erreur.
- `parseShareText()` ne renvoie que des données déjà expurgées ; c'est le seul
  point d'entrée.
- `scripts/jow-resolve.ts` ne réimprime jamais son entrée.
- Trois tests vérifient qu'aucun secret ne ressort, y compris via un message
  d'exception.

Le texte brut ne doit jamais atteindre `meal.raw_input`.

---

## 8. Échantillons figés

`server/jow/fixtures/` — un fichier par recette, contenant le nœud
`props.pageProps.recipe` tel que publié, plus `capturedAt` et l'URL finale.

| Fichier | Parts | Intérêt |
|---|---|---|
| `galette-vege-puree-de-carotte-et-tzatziki` | 1 | Recette de référence du §3 |
| `knack-vege-et-puree-maison` | 1 | `Litre`, peu d'ingrédients |
| `poulet-roti-et-duo-de-patates` | 4 | `coversCount` ≠ 1 |
| `risotto-aux-poireaux` | 1 | `Cuillère à soupe`, `Pièce` |
| `salade-cesar` | 1 | 8 ingrédients, 6 unités non métriques |
| `saumon-mi-cuit-et-riz` | 1 | 2 ingrédients seulement |
| `tarte-spirale-de-legumes` | 4 | `coversCount` ≠ 1, aucun gramme résolu |
| `tofu-cacahuetes-riz-et-brocoli` | 1 | Cas courant |

Ces fichiers sont des **constats**. On ne les édite pas à la main : on les
recapture (`npm run jow:capture -- <recipeId | url>`) et on lit le diff. Un
diff inattendu signifie que Jow a bougé, donc que le contrat est à relire.

---

## 9. Ce qui reste ouvert

1. **Base des valeurs des pages ingrédients** (§5 ci-dessus) — à confirmer
   avant toute exploitation.
2. **Contenu de `unit_default`** (§4 ci-dessus) — sept unités identifiées,
   chacune à sourcer. Relève du « ne pas décider seul ».
3. **Durée de vie de la redirection par ObjectId** (§1) — non documentée par
   Jow, donc susceptible de changer sans préavis. Le repli existe.
4. **Recettes non publiques** — les 3 618 URLs du `sitemap.xml` couvrent le
   catalogue indexé. Une recette personnelle ou retirée du catalogue n'a pas
   été testée : elle retombera en `confidence='basse'`.
