# Indicateurs possibles — inventaire du 17/09/2026

Ce fichier répond à une question du propriétaire : **l'énergie, et quoi d'autre ?**
Il inventorie ce qu'on pourrait afficher au-delà des cinq barres du §8, et pour
chaque candidat il dit trois choses, dans cet ordre :

1. **ce que les sources publient vraiment** — mesuré sur l'export épinglé, pas
   supposé ;
2. **s'il existe un repère par âge** chez l'ANSES, et où aller le chercher ;
3. **ce que la spec en disait déjà**, pour ne pas rouvrir par distraction ce
   qui a été tranché en connaissance de cause.

**Il ne décide rien et ne porte aucune valeur nutritionnelle.** Les valeurs
vivent dans `db/seeds/*.csv`, une ligne = une source (I1). Un candidat retenu
ici reste à sourcer là-bas avant d'exister.

Les chiffres de couverture du §2 viennent de l'export Ciqual **2025**, celui
que `db/seeds/ciqual-source.json` épingle depuis le 17/09/2026 — **3 484
aliments**, empreinte vérifiée. Le §1 raisonne, lui, sur la table **2020** :
c'est celle qu'on servait le matin même, et c'est en la comparant à la 2025
qu'on a pu mesurer ce que vaut une valeur dérivée. Les scripts de mesure ne
sont pas versionnés : ils tiennent en trente lignes et se refont, les
conclusions sont ici.

---

## 0. Ce qui commande tout le reste : par où la valeur arrive

Avant de comparer des nutriments, il faut regarder par où ils entrent. C'est ce
qui disqualifie la moitié de la liste, et ça ne se voit pas dans une table de
composition.

**Un repas Jow ne passe pas par Ciqual.** `calculerNutrition` prend le snapshot
publié par Jow et ignore la somme des ingrédients — délibérément, §3 de
`docs/jow-contract.md` : les quantités sont par convive dans des unités que
`unit_default` ne sait pas toutes convertir. Or Jow publie **cinq valeurs et
deux scores**, et rien d'autre :

| Ce que Jow publie | Ce qu'il ne publie pas |
|---|---|
| `ENERC` (kcal), `PRO`, `CHOAVL`, `FAT`, `FIBTG` par portion | sucres, sel, AG saturés, tout micronutriment |
| Nutri-Score et Green-Score, par recette | tout ce qui serait par personne |

**Conséquence, et c'est la conclusion principale de cet inventaire :** un
sixième nutriment serait **absent de tout repas Jow**, c'est-à-dire du chemin
principal du produit. Il s'afficherait « indisponible » sur le plat du soir et
chiffré sur un yaourt saisi à la main — l'inverse de ce qu'on veut montrer.

Trois façons d'en sortir, aucune gratuite :

- sommer les **ingrédients** Jow rattachés à Ciqual — c'est déjà fait pour la
  part végétale, et ça hérite de la dette n° 5 (rattachement manuel) et des
  trous de `unit_default` ;
- n'afficher le nouvel indicateur que **par repas**, jamais par personne et
  jamais en % d'un repère, là où l'information existe ;
- choisir un indicateur qui **ne dépend pas d'une teneur** — la diversité, la
  saisonnalité, les scores de Jow. Ceux-là traversent.

---

## 1. L'énergie — le sujet de la carte

> **Écrit, corrigé, puis fait le 17/09/2026.** Ce paragraphe recommandait
> d'abord de **dériver** l'énergie manquante par la formule du Règlement (UE)
> n° 1169/2011. Le test qui a renversé la conclusion est décrit plus bas — il
> est conservé, parce qu'il explique pourquoi la formule *paraît* bonne et ne
> l'est pas là où on voudrait s'en servir.
>
> **Ce que le propriétaire a tranché**, au vu de ces mesures :
>
> 1. **Monter à Ciqual 2025, et ne rien dériver.** Fait : `db/seeds/ciqual-source.json`
>    épingle la table 2025, l'énergie est publiée pour 3 339 aliments sur
>    3 484, et les 145 restants affichent « indisponible ».
> 2. **Une cinquième barre chiffrée dans le bilan, majeurs seulement.** Fait :
>    migration 017, `energyTargets`, `BILAN_NUTRIENTS`. Contre la
>    recommandation ci-dessous, qui proposait de ne la poser que sur un plat —
>    les deux objections lui ont été présentées, elles sont dans l'en-tête de
>    la 017 et dans les encarts datés du §8 et du §9 de la spec.

### Ce que la table épinglée publie, et ce qu'elle tait

L'export épinglé est **Ciqual 2020**. Sur ses 3 185 aliments, **2 298 (72 %)
portent l'énergie** (constituant 328, convention du Règlement (UE)
n° 1169/2011, celle des étiquettes) et **887 ne l'ont pas**. Le trou n'est pas
réparti au hasard :

| Groupe Ciqual | Sans énergie |
|---|---|
| fruits, légumes, légumineuses et oléagineux | 358 / 614 |
| produits sucrés | 182 / 306 |
| eaux et autres boissons | 106 / 295 |
| aides culinaires et ingrédients divers | 84 / 211 |
| produits laitiers | 64 / 301 |
| entrées et plats composés | 40 / 337 |
| viandes, œufs, poissons | 26 / 788 |
| produits céréaliers | 4 / 189 |

« Pomme, pulpe et peau, crue », « Lentille verte, sèche », « Betterave rouge,
crue », « Gâteau (aliment moyen) », « Biscuit sec au beurre » : le trou tombe
sur ce qu'une famille mange.

**Pourquoi l'ANSES se tait, et ce n'est pas parce qu'elle ignore l'aliment.**
Sa règle est de ne publier l'énergie que si **tous** les termes de la formule
sont mesurés. Des 887, **aucun** n'a les sept : il manque les polyols pour 735
d'entre eux, les acides organiques pour 620. Les macronutriments, eux, sont
là — 738 ont protéines + glucides + lipides, 695 ont en plus les fibres.
Autrement dit : l'aliment est décrit, c'est l'énergie qui est retenue.

### La piste écartée nº 1 — se servir d'un aliment voisin

L'idée est naturelle : la table connaît d'autres pommes, d'autres biscuits ;
on prend le plus bas du rayon et on dit « au moins ça ». Elle a été mesurée
avant d'être écartée. En prenant comme « familles » les sous-groupes Ciqual
(137 familles, 16 aliments en médiane), et en testant la méthode sur les
2 196 aliments **dont on connaît la vraie valeur** :

| Estimation par la famille | Trop haute (donc « au moins X » faux) | À ±10 % | Écart médian |
|---|---|---|---|
| le plus bas des frères | 5 % | 10 % | **−39 %** |
| la médiane des frères | **48 %** | 39 % | 0 % |

Les deux échouent, pour deux raisons opposées. Le minimum est un minorant
presque toujours vrai mais inutilisable : il dit « au moins 39 % de moins que
la réalité », et il place le sel à 0 kcal à côté d'un biscuit sablé. La
médiane, elle, se trompe **vers le haut une fois sur deux** : ce n'est plus un
plancher, c'est une invention. Un aliment voisin est un **autre aliment** — le
fromage blanc 0 % côtoie la faisselle à 6 % de matière grasse dans la même
famille.

### La piste écartée nº 2 — la formule du Règlement (UE)

Bien plus prometteuse, parce qu'elle utilise la composition **de l'aliment
lui-même** : protéines 4, glucides 4, lipides 9, fibres 2, alcool 7, polyols
2,4, acides organiques 3 (kcal/g), un terme non mesuré comptant pour 0.

**Un piège d'abord, et il est gros : chez Ciqual les polyols sont déjà dans les
glucides.** L'édulcorant à la stévia affiche 98 g de glucides *dont* 97,7 g de
polyols. Les additionner double le compte : 629 kcal calculées contre 238
publiées. En les retranchant des glucides avant de les compter à 2,4, la
formule colle remarquablement à la table :

| | écart médian | dans ±2 % | sur-estimations |
|---|---|---|---|
| polyols additionnés | 0,00 % | 1 976 / 2 201 (90 %) | 11,6 % |
| **polyols retranchés** | **0,00 %** | **2 018 / 2 201 (92 %)** | **7,5 %** |

Sur la table 2025, la même formule fait encore mieux : **94 % à ±2 %**.

**Et pourtant elle ne vaut rien là où on en a besoin.** Ces deux mesures sont
circulaires : elles testent la formule sur les aliments dont l'ANSES publie
l'énergie — c'est-à-dire ceux dont elle a mesuré *tous* les termes, et dont
elle a elle-même calculé l'énergie par cette formule. Le vrai test est ailleurs.

### Le test qui tranche

Ciqual 2025 publie l'énergie de **716 des 887 aliments** que Ciqual 2020
laissait vides. On dispose donc de la réponse pour exactement la population
visée. En appliquant la formule aux données 2020 et en comparant à ce que
l'ANSES a publié depuis :

| Population | à ±2 % | à ±5 % | trop haut | p5 | p95 |
|---|---|---|---|---|---|
| les 700 comparables | 57 % | 73 % | **35 %** | −12 % | +20 % |
| celles dont les 4 macros sont mesurées | 57 % | 74 % | 35 % | −11 % | +19 % |
| idem, hors boissons et édulcorants | 60 % | 77 % | 34 % | −10 % | +14 % |

92 % à ±2 % en apparence, **57 % en réalité**. Et les ratés ne sont pas des
arrondis : « Édulcorant à la saccharine » calculé à 360 kcal pour 5 publiées,
« Galette de maïs soufflé » à 44 pour 387, « Pomme de terre nouvelle bouillie »
à 12 pour 72. Filtrer sur les aliments complets n'y change rien.

La raison est double, et les deux moitiés sont instructives : la composition
elle-même a été révisée (**666 des 2 299 aliments communs ont vu leurs glucides
bouger de plus de 5 %** entre les deux tables), et un aliment dont l'ANSES
retient l'énergie est précisément un aliment qu'elle connaît mal. **La formule
est fidèle à Ciqual ; elle ne l'est pas à l'aliment.**

### Ce qu'il faut faire : prendre la table 2025

| | Ciqual 2020 (épinglé) | Ciqual 2025 |
|---|---|---|
| aliments | 3 185 | 3 484 (+481 nouveaux, 182 retirés) |
| constituants | 67 | 74 |
| **énergie publiée** | **2 298 (72 %)** | **3 339 (96 %)** |
| sans énergie | **887** | **145** |
| protéines / glucides / lipides / fibres | 97 / 87 / 94 / 92 % | 99 / 94 / 94 / 93 % |
| sucres / sel / AG saturés | 84 / 89 / 86 % | 86 / 90 / 89 % |

716 valeurs **mesurées et publiées par la source** au lieu de 887 estimations
dont un tiers seraient trop hautes. « Lentille verte, sèche » : la formule
rendait 327 kcal, l'ANSES publie 327. La différence, c'est qu'on n'a plus à le
parier.

Publication du 19/11/2025, licence Etalab 2.0, DOI `10.57745/RDMHWY` sur
`entrepot.recherche.data.gouv.fr` — la distribution a quitté `ciqual.anses.fr`,
où le ZIP 2025 n'existe pas. Les fichiers XML y sont servis **un par un**, avec
une empreinte MD5 publiée pour chacun.

**Ce que la montée a coûté, honnêtement :**

1. `db/seeds/ciqual-source.json` — nouvelle version, une URL et une empreinte
   **par fichier**, `etl` incrémenté. Le principe ne bouge pas : l'empreinte
   est versionnée, un fichier qui n'y correspond pas n'est pas importé.
2. `server/food/ciqual-source.ts` — deux fichiers à télécharger au lieu d'une
   archive à extraire, vérifiés tous les deux avant qu'aucun ne soit écrit.
   `server/food/zip.ts` et son test sont partis avec l'archive.
3. `server/food/ciqual.ts` — **l'export 2025 est en UTF-8**, l'ancien en
   windows-1252. `decodeCiqual` était figé sur le second ; `decoderFor` lit
   désormais le BOM puis la déclaration XML. Les seuils `< X` sont toujours là,
   échappés en `&lt;` — `parseRecords` les déséchappe déjà.
4. `server/food/groups.ts` — deux sous-groupes nouveaux : `0304` (farines,
   détachées du 0305) et `1010` (tartinables végétariens, détachés du 1001 —
   classés `plant: null`, deux des sept sont au fromage frais). Et un
   **reclassement** : le 1009, fourre-tout en 2020, ne contient plus en 2025
   que huit produits au soja et au blé — tofu, tempeh, seitan — qui retrouvent
   `substitut_vegetal` et `plant: true`, comme l'ancien 0411 qu'ils quittent.
5. `db/seeds/food-unit-weight.csv` — six lignes pointaient un code disparu.
   Deux recodées (tomate, pomme : même aliment, code changé), quatre retirées
   faute d'équivalent. L'en-tête du fichier dit lesquelles et pourquoi.
6. **Les 182 aliments retirés de la table restent en base** avec leurs valeurs
   de 2020 : le seed ne supprime rien (`on conflict do update`), et c'est
   voulu — un `meal_item` les référence peut-être.
7. Le pic mémoire du seed passe à **315 Mio** (mesuré, téléchargement compris)
   pour une limite de conteneur à 1 Gi. Rien à changer côté déploiement, hors
   un hôte de plus à joindre.

### Et les 145 qui resteront

Des condiments, des alcools forts, des épices et quelques crus : vinaigre de
cidre, câpres au vinaigre, gousse de vanille, estragon frais, bigorneau cru,
jarret de bœuf cru. **52 d'entre eux ont les quatre macros mesurées** ; les
dériver rapporterait 52 estimations avec le même taux d'erreur qu'au-dessus.

Ils restent **à `NULL`**, et l'app affiche « indisponible ». C'est le §9 tel
qu'il est écrit, et c'est le bon état.

### Le repère par âge, et l'affichage

Le repère énergétique **existe déjà en base** : `energy_reference`, par sexe et
par âge, sourcé (EFSA 2017 repris par l'ANSES). Il sert à dériver les cibles en
grammes des macros et **ne sort jamais à l'écran** (§9). Afficher une barre
« énergie en % du repère » reviendrait à l'en sortir : c'est exactement
l'objectif chiffré de calories qu'I5 interdit sur un profil mineur.

Ce que la spec et le code disaient déjà, et qui ne change pas :

- §9 : « `kcal` est stocké mais n'est jamais affiché comme objectif (I5). »
- `web/design/vocabulary.ts` : `BAR_NUTRIENTS` exclut `kcal`, le pourquoi est
  écrit à côté.
- `web/components/ReferenceSheet.tsx` : « Aucun chiffre de calories ici. »
- R7 : le vocabulaire parle qualité et variété.

Rien n'interdit d'**avoir** la valeur ; tout l'interdit comme **métrique mise en
avant** et comme **objectif sur une personne**. Un indicateur énergie se pose
donc sur un **plat** — « environ 540 kcal la part » sur la fiche d'un repas —
et pas sur un convive : pas de barre, pas de pourcentage, pas de total du jour.

---

## 1bis. Ciqual est-elle la seule source ?

Non, mais les autres ne remplacent pas celle-ci — elles la complètent, et
chacune se paie.

**Ciqual 2025, du même éditeur.** C'est la réponse au §1 : 3 484 aliments,
74 constituants, énergie publiée pour 96 %. Même publieur, même convention
d'énergie, mêmes codes aliments pour 3 003 fiches sur 3 185 — donc les
rattachements `jow_food_link` survivent. Publiée le 19/11/2025 sous Etalab 2.0,
DOI `10.57745/RDMHWY`. **C'est la seule piste qui n'ajoute aucune convention
nouvelle à la base.**

**CALNUT, de l'ANSES aussi.** C'est exactement l'idée de l'aliment voisin,
mais faite par la source : une table **sans valeurs manquantes**, construite à
partir de Ciqual en comblant les trous par des médianes de groupe ou des
valeurs d'aliments similaires. L'ANSES s'en sert pour calculer les apports de
la population française dans l'étude INCA 3. Deux réserves qui la classent en
complément et pas en base : elle ne couvre que **2 118 aliments** (ceux
consommés dans INCA 3, contre 3 185 dans Ciqual 2020), et ses valeurs sont des
**imputations assumées**, faites pour une moyenne de population, pas pour dire
ce que contient l'assiette de quelqu'un. Si on la prend un jour, c'est avec un
`confidence` plafonné à « Estimation » et une colonne qui dit d'où vient la
valeur — jamais mélangée en silence avec les mesures de Ciqual.

**Open Food Facts.** Déjà prévue : `food.source` accepte `'off'` depuis la 001.
Son intérêt est ailleurs que Ciqual — les **produits de marque**, là où Ciqual
n'a qu'un « aliment moyen ». Ses valeurs viennent des étiquettes, donc
l'énergie y est presque toujours présente. Son coût : une base contributive,
de qualité inégale, sans garantie de fraîcheur ni de méthode, et un second
référentiel à tenir. À réserver au jour où le code-barres entre dans la saisie.

**USDA FoodData Central.** Complète et bien tenue, mais américaine : aliments,
libellés et surtout **conventions différentes** — l'énergie y est calculée avec
les facteurs d'Atwater spécifiques, pas avec ceux du Règlement (UE). Mélanger
deux définitions dans la même colonne est précisément ce que `ciqual.ts` refuse
de faire pour les protéines. Non.

---

## 2. Les autres candidats

Couverture mesurée sur les mêmes 3 185 aliments. « seuil » = teneur publiée
sous la forme `< X`, que le code sait déjà exploiter comme majorant (migration
003) ; ce n'est pas un trou.

### Sucres — `32000`

- **Ciqual** : 2 996 valeurs (86 %), 60 seuils, 205 traces.
- **Jow** : non.
- **Repère ANSES** : oui pour l'adulte, dans un avis dédié aux sucres (le
  rapport de 2016 y renvoie explicitement : « le cas particulier des sucres
  fait l'objet d'un document spécifique (Anses 2017) »). L'avis 2019 sur les
  4-17 ans alerte sur l'excès de sucres chez l'enfant.
- **Le piège** : le repère de l'ANSES porte sur les sucres **hors lactose et
  galactose**. Ciqual publie des sucres **totaux**, et ne permet pas de les
  retrancher : lactose 788 valeurs (23 %) et galactose 306 (9 %). L'indicateur
  ne serait donc pas celui du repère, et l'écart tombe précisément sur les
  produits laitiers — les yaourts d'un goûter d'enfant.
- **Spec** : §6bis note que petit-déjeuner et goûter portent « une bonne partie
  des fibres et des sucres de la journée ». C'est la seule mention.
- **Verdict** : le nutriment le plus demandé, et un repère qu'on ne peut pas
  calculer. Affichable **par repas en grammes bruts**, jamais en % d'un repère,
  et jamais comme un plafond sur une personne — R7 et I5 y sont hostiles.

### Sel — `10004` (et sodium `10110`)

- **Ciqual** : 3 141 valeurs (90 %), 151 seuils. La meilleure couverture de
  toute la liste après les macros.
- **Jow** : non.
- **Repère ANSES** : oui, avis dédié au sodium, avec des valeurs par âge.
  À recopier de la source.
- **Spec** : jamais mentionné.
- **Verdict** : techniquement le plus solide. Mais c'est un **plafond**, et un
  plafond chiffré sur la fiche d'un enfant est la même mécanique qu'un objectif
  calorique : la barre se lit comme une faute quand elle se remplit. Si on le
  prend, ce doit être **au niveau du foyer**, comme l'assistant qui ne reçoit
  que des moyennes.

### Acides gras saturés — `40302`

- **Ciqual** : 3 093 valeurs (89 %), 135 seuils.
- **Jow** : non (Jow ne donne que les lipides totaux).
- **Repère ANSES** : oui, en **% de l'apport énergétique**, dans les mêmes avis
  que les macros déjà chargées (2016 pour l'adulte, 2019 pour les 4-17 ans). À
  recopier des tableaux de référence, non vérifié ligne à ligne ici.
- **Ce qui le rend facile** : le mécanisme existe entièrement. `basis =
  pct_aet`, `energy_reference`, `server/nutrition/derive.ts` — c'est exactement
  la chaîne des protéines, lipides et glucides. Un CSV sourcé, zéro code.
- **Verdict** : le meilleur rapport valeur / travail des nutriments, et le seul
  qui parle de **qualité** (quelle sorte de lipides) plutôt que de quantité.
  Réserve : il ne dit rien sur un repas Jow.

### Calcium — `10200` et fer — `10260`

- **Ciqual** : calcium 2 676 (77 %), fer 2 459 (71 %) + 188 seuils.
- **Jow** : non.
- **Repère ANSES** : oui, par âge **et par sexe**, en valeur absolue (mg/j) —
  le seul cas de la liste où la source publie directement dans le modèle que
  `nutrient_reference` attend, sans dérivation. Et l'avis 2019 désigne
  nommément le calcium et le fer comme les deux apports insuffisants chez
  l'enfant, ceux qui justifient des recommandations spécifiques.
- **Spec** : §17, « micronutriments → hors V1. Fer, calcium et consorts sont
  disponibles via Ciqual mais doublent le travail d'ETL pour un affichage que
  personne ne consulte au démarrage. **À rouvrir en V3.** »
- **Verdict** : on est en V3, et l'objection de la spec a vieilli à moitié. Le
  travail d'ETL est plus petit qu'annoncé — `food.micros` et
  `meal_nutrition.micros` sont des `jsonb` prévus pour ça depuis la 001, aucune
  migration — mais l'objection de fond tient : **absents de tout repas Jow**.
  Si un seul micronutriment doit passer, c'est le couple calcium/fer, et c'est
  celui que la source elle-même désigne.

### Les autres micronutriments

| Constituant | Valeurs | Seuils |
|---|---|---|
| Magnésium | 2 566 (74 %) | 19 |
| Zinc | 2 361 (68 %) | 210 |
| Vitamine B12 | 2 030 (58 %) | 118 |
| Vitamine C | 1 803 (52 %) | 568 |
| Vitamine D | 1 437 (41 %) | 604 |
| Vitamine B9 | 1 433 (41 %) | 90 |
| Iode | 1 291 (37 %) | 817 |

Tous ont un repère ANSES par âge. Aucun n'est publié par Jow. La vitamine D et
l'iode passent sous la moitié de la table en valeur exacte : un bilan y serait
`partiel` la plupart du temps. Même verdict que §17 : hors sujet tant que le
couple calcium/fer n'a pas fait la preuve qu'on regarde ce genre de barre.

### Oméga-3 — ALA `41833`, EPA `42053`, DHA `42263`

- **Ciqual** : 1 892 (54 %), 1 636 (47 %), 1 560 (45 %) — plus 210 à 955 seuils
  selon l'acide gras.
- **Repère ANSES** : oui (avis sur les acides gras). **Verdict** : couverture
  trop faible pour une barre, et trop technique pour le vocabulaire du produit.

### Eau — `400`

- **Ciqual** : 2 934 valeurs (84 %). Repère ANSES par âge : oui.
- **Verdict** : non. L'eau des aliments est connue, celle des verres ne l'est
  pas — personne ne saisit ses boissons. Un indicateur d'hydratation serait
  faux par construction, et faux vers le bas, ce qui est le pire sens.

### Diversité alimentaire

- **Source** : aucune. Se calcule sur `food.category` — **49 catégories** déjà
  classées dans `server/food/groups.ts`, et remplies pour 3 482 des 3 484
  aliments de la table (deux « aliments moyens » que Ciqual ne rattache à rien).
- **Jow** : oui, indirectement, par les ingrédients rattachés — et un rattachement
  manquant ne fausse pas le compte, il le sous-estime ; l'indicateur ne peut que
  monter, comme la part végétale.
- **Repère par âge** : aucun, et c'est une qualité. Comme la barre Végétal :
  une tendance, pas une cible (§8, R7).
- **Spec** : §8, écartée parce qu'elle « demande une fenêtre glissante ».
  **Cette objection est levée** : la fenêtre de 7 jours existe, la barre Végétal
  s'en sert pour la moyenne du foyer.
- **Verdict** : **le meilleur candidat de tout l'inventaire.** Aucune donnée à
  collecter, aucune source à trouver, aucun repère à ne pas inventer, aucun
  risque I5 — et c'est littéralement le vocabulaire du produit : « qualité et
  variété ». « 19 aliments différents cette semaine, 7 familles » se lit sans
  formation.

### Part d'ultra-transformé (NOVA)

- **Source** : toujours absente de Ciqual. Open Food Facts la publie, mais on
  n'ingère pas OFF, et la faire entrer veut dire un second référentiel avec sa
  propre fraîcheur et ses propres trous.
- **Spec** : §8, écartée pour cette raison exacte. **Rien n'a changé.**
- **Verdict** : non.

### Nutri-Score et Green-Score — déjà en base

- **Source** : Jow, par recette (`recipe.nutri_score`, `recipe.green_score`),
  calculés par Etiquettable. Déjà parsés, déjà stockés, jamais affichés.
- **Ciqual** : rien. Un repas hors-Jow n'en a pas.
- **Repère par âge** : sans objet, c'est une lettre.
- **Verdict** : le seul candidat qui ne demande **ni collecte, ni calcul, ni
  migration** — la valeur est en base et attend. Réserve symétrique de celle des
  nutriments : disponible **uniquement** sur les repas Jow, donc muet sur le
  texte libre et la photo. Et c'est un jugement porté sur un plat, pas une
  mesure : à placer sur la carte de la recette, jamais agrégé sur une personne.

---

## 3. Recommandation d'ensemble

Par ordre de ce que ça rapporte rapporté à ce que ça coûte :

1. **Monter à Ciqual 2025.** Ça ne s'appelle pas un indicateur, et c'est
   pourtant ce qui débloque l'énergie : 716 trous comblés par des valeurs
   mesurées, 481 aliments de plus, et les sucres, le sel et les AG saturés qui
   montent avec. Aucun arbitrage à rendre — la source a tranché pour nous.
2. **Diversité alimentaire** — rien à collecter, rien à sourcer, aucun risque
   I5, et c'est le vocabulaire du produit. L'objection de la spec est tombée.
3. **Énergie** sur la fiche d'un plat, jamais sur une personne ni en barre.
   Après la montée, elle est publiée pour 96 % de la table ; les 145 restants
   affichent « indisponible » et rien n'est dérivé. Détail et mesures au §1.
4. **Nutri-Score / Green-Score** sur la carte d'une recette Jow — la donnée est
   déjà là, c'est une ligne d'affichage.
5. **AG saturés** si un sixième nutriment doit exister : la chaîne de dérivation
   est déjà écrite, il ne manque qu'un CSV sourcé.
6. **Calcium et fer** ensuite, si les barres de nutriments se révèlent
   effectivement regardées. C'est la réouverture du §17, et elle demande de
   décider quoi faire des repas Jow, qui n'en portent aucun.

Et ce qu'on n'ouvre pas : NOVA (source absente), hydratation (données fausses
par construction), sucres en % d'un repère (le repère exclut un terme qu'on ne
sait pas retrancher), sel par personne (un plafond sur une fiche d'enfant).

**Aucune ligne de `nutrient_reference` ne se décide ici.** Chacun de ces
candidats, s'il est retenu, passe par la procédure du §9 : aller à la source,
recopier, citer, laisser absent ce qui n'est pas couvert.
