# Assistant diététicien familial — Spécification

**Version 3 — document autoportant.**
Destiné à être exécuté par quelqu'un (ou un agent) qui ne connaît pas le projet.

**Fichier associé :** `mockups-tablee.html` — maquettes de référence de tous les
écrans, à ouvrir dans un navigateur. Voir §8ter.

---

## 0. Comment lire ce document

- Les sections **RÈGLES** et **INTERDITS** (§2) priment sur tout le reste.
- Le §3 (Tâche 0) est **bloquant** : rien d'autre ne démarre avant.
- Chaque jalon a des **critères d'acceptation** (§15). Tant qu'ils ne passent
  pas, le jalon n'est pas terminé.
- Le §17 liste ce qui reste **non tranché**. Sur ces points précis : demander,
  ne pas décider seul.
- Partout ailleurs, les décisions sont prises. Elles sont motivées pour pouvoir
  être contestées en connaissance de cause — pas pour être réouvertes par défaut.

---

## 1. Le produit

Une PWA familiale. Chaque membre a un profil (âge, sexe, régime, coefficient de
portion). On enregistre les repas — principalement en les partageant depuis
l'application Jow — et l'app affiche **pour chaque personne** un bilan
nutritionnel lisible, complété par une synthèse hebdomadaire générée par un LLM
disposant d'une mémoire de la famille.

**Le différenciateur :** la répartition d'un même repas entre plusieurs personnes
aux besoins différents. Les apps du marché empilent des comptes individuels ;
aucune ne modélise « un plat, quatre assiettes, quatre âges ».

**Utilisateurs :** un foyer, dont des enfants. Usage privé, auto-hébergé.

---

## 2. Règles absolues

### RÈGLES (MUST)

| # | Règle |
|---|---|
| R1 | Les valeurs nutritionnelles proviennent **toujours** d'une source référencée (Jow, Ciqual, Open Food Facts). Jamais du LLM. |
| R2 | `meal_participant.share` est calculé **à l'écriture** puis figé. |
| R3 | Les barres s'affichent en **% du repère du jour**, jamais en grammes bruts. |
| R4 | Tout appel LLM part **du serveur**. La clé API n'apparaît jamais dans le bundle client. |
| R5 | Ce qui est envoyé au LLM : libellés d'aliments, agrégats, tranches d'âge. Rien d'autre. |
| R6 | Toute estimation porte un `confidence` affiché dans l'UI. |
| R7 | Le vocabulaire produit est **qualité / variété**. Les kcal existent en base, elles ne sont jamais la métrique mise en avant. |

### INTERDITS (MUST NOT)

| # | Interdit |
|---|---|
| I1 | **Ne jamais inventer une valeur nutritionnelle ou un repère.** Si la source manque, laisser `NULL` et le signaler. Vaut en particulier pour les repères des enfants (§9). |
| I2 | Ne jamais stocker de **jugement** sur une personne. `family_note` accepte « Léa a goûté les épinards et a aimé », pas « Léa mange mal ». |
| I3 | Ne jamais envoyer au LLM : prénoms, dates de naissance, allergènes, poids, photos de personnes. |
| I4 | Ne jamais générer de commentaire automatique **par repas**. La synthèse est hebdomadaire. |
| I5 | Ne jamais afficher d'objectif chiffré de calories ni de poids pour un profil mineur. |
| I6 | Ne jamais logger ni persister le paramètre `key` des liens de partage Jow (token de compte). |
| I7 | Ne pas utiliser l'API interne non documentée de l'app Jow. Uniquement les pages publiques. |

> **Sur I1, I2 et I5 :** ce ne sont pas des préférences de style. L'app est
> utilisée par des enfants. Un repère inventé produit un conseil faux ; un
> jugement stocké se réinjecte à chaque prompt et devient une étiquette durable ;
> un objectif chiffré installe un rapport comptable à la nourriture. En cas de
> doute sur ces trois points : s'arrêter et demander.

---

## 3. Tâche 0 — Vérifier le contrat Jow (BLOQUANT)

> ✅ **Faite le 13/09/2026. Résultat : `docs/jow-contract.md`**, qui fait
> autorité sur tout ce qui suit dans cette section. Deux constats contredisent
> ce qui était supposé ici :
> 1. **Le piège des identifiants n'existe pas.** `jow.fr/fr/recipes/<ObjectId>`
>    redirige vers l'URL canonique : la résolution par titre slugifié décrite
>    plus bas est inutile et n'est plus le chemin principal.
> 2. **`?coversCount=` ne change rien** — la page est statique. En revanche
>    `coversCount` est le nombre de parts prévu par la recette, pas un facteur
>    d'échelle : les quantités sont par convive et les valeurs par portion.
>
> Le reste de la section est conservé tel quel : c'est l'état des hypothèses
> avant vérification, utile pour comprendre pourquoi le code est écrit ainsi.

Tout le projet repose sur l'hypothèse que les pages publiques Jow sont
parsables. **Cette hypothèse doit être vérifiée avant d'écrire le reste.**

### Ce qui est déjà vérifié

Sur `https://jow.fr/fr/recipes/galette-vege-puree-de-carotte-et-tzatziki-8vch9drbhyhc03wu0epa` :

- Page publique, indexée, accessible sans authentification
- Ingrédients avec quantités : steak végétal ×1, purée de carotte 100 g,
  tzatziki 50 g, salade 1 poignée, persil 1/10 botte
- Chaque ingrédient lié vers `jow.fr/ingredients/<ObjectId>` (valeurs / 100 g)
- **Valeurs par portion déjà calculées** : 320 kcal, 20 g MG, 16 g glucides,
  18 g protéines, 12 g fibres
- Nutri-Score B, Green-score A+ (calculés par Etiquettable)
- Site en **Next.js** (assets `/_next/image`) → présence attendue d'un blob
  `__NEXT_DATA__` ou de payloads RSC dans le HTML

### Ce qui reste à établir

1. Récupérer le **HTML brut** de cette URL (`curl`, pas un extracteur de texte).
2. Localiser le JSON : `<script id="__NEXT_DATA__">`, ou les `self.__next_f.push`
   si l'App Router est utilisé.
3. **Documenter le chemin exact** vers : liste d'ingrédients, quantité, unité,
   id d'ingrédient, nombre de parts, valeurs nutritionnelles.
4. Consigner ce chemin dans `docs/jow-contract.md` avec un échantillon figé.
5. Écrire un parseur **tolérant** : structure inattendue → on ne plante pas, on
   renvoie `confidence='basse'` et on bascule en saisie manuelle.
6. Tester `?coversCount=1` et `?coversCount=4` : vérifier que les quantités
   changent bien côté serveur.
7. Écrire un test de non-régression sur l'échantillon figé.

### Le piège des identifiants

```
Lien de partage : recipeId=650b16ade7cc8d0013ce4a6e   (ObjectId Mongo)
URL web         : ...-8vch9drbhyhc03wu0epa            (autre format)
```

**Les deux ne correspondent pas.** On ne peut pas construire l'URL web depuis le
lien partagé.

Stratégie retenue — **résolution par le titre** :

1. Le texte partagé contient le titre (`Galette végé, purée de carotte & tzatziki`).
2. Slugifier : minuscules, accents retirés, `&`→`et`, ponctuation retirée,
   espaces→`-` → `galette-vege-puree-de-carotte-et-tzatziki`.
3. Le suffixe (`8vch9drbhyhc03wu0epa`) est inconnu. Le retrouver une fois par
   recherche, puis le mettre en cache dans `recipe.jow_slug`.
4. Stocker aussi `jow_recipe_id` pour reconnaître un re-partage sans refetch.
5. Échec de résolution → créer la recette avec le titre seul, `confidence='basse'`,
   et proposer la saisie manuelle. **Ne pas deviner les valeurs.**

Piste alternative à tester : suivre les redirections du deep link Branch
(`app.jow.com/EC0U`). Il renvoie 400 hors navigateur — résolution probablement
en JavaScript, donc peu fiable. Ne pas en faire la voie principale.

### Critère de sortie

Un script prend en entrée le texte de partage Jow et ressort un JSON
`{ title, servings, ingredients[], nutrition{} }` pour au moins **5 recettes
différentes**. Tant que ce n'est pas le cas, ne pas continuer.

---

## 4. Ingestion — Share target Android

`manifest.webmanifest` :

```json
{
  "name": "Tablée",
  "short_name": "Tablée",
  "start_url": "/",
  "display": "standalone",
  "share_target": {
    "action": "/share",
    "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" }
  }
}
```

La PWA apparaît dans le menu de partage Android une fois installée. HTTPS
obligatoire. Jow partage un texte contenant titre + URL : tout arrive dans `text`,
il faut donc parser `text` et pas seulement `url`.

**Traitement de `/share` :**

1. Extraire `recipeId=([a-f0-9]{24})` du texte → `jow_recipe_id`.
2. Si la recette existe déjà en base → réutiliser, pas de fetch.
3. Sinon : extraire le titre, résoudre le slug, fetcher, parser, persister.
4. Afficher un écran de confirmation : recette, nombre de parts, **qui a mangé**.
5. Enregistrer.

> **I6 :** si le texte partagé contient `key=` ou `userId=` (cas du partage de
> menu hebdomadaire), les retirer avant toute journalisation ou persistance.

---

## 5. Hors-Jow

Trois voies, par priorité d'usage :

1. **Templates** — la plus utilisée en pratique. Le petit-déjeuner est identique
   tous les matins. Un bouton = un repas loggué. C'est le levier principal contre
   la friction, et la friction est ce qui tue les apps de suivi.
2. **Texte libre** — « big mac + frites moyennes », « 2 œufs, 1 muffin anglais ».
   En V1 : recherche plein texte sur `food`. En V3 : le LLM éclate en items +
   quantités, l'utilisateur valide.

   > **Écrit le 14/09/2026.** Le LLM rend des libellés, des mots de recherche
   > et des grammes — jamais une teneur (R1) : le rapprochement avec `food` est
   > la recherche plein texte du dépôt, et chaque ligne se corrige avant
   > l'enregistrement. Les prénoms du foyer et les jetons Jow sont retirés du
   > texte avant l'envoi (I3, I6), sans garantie complète (dette n° 17). Le
   > repas porte la source `ia` (migration 012), dont la confiance est
   > plafonnée à « moyenne » (R6). Facultatif : sans `ANTHROPIC_API_KEY`, la
   > saisie reste celle de la V1.
   >
   > ⚠️ **Précisé le même jour — le modèle choisit aussi l'aliment.** La
   > recherche seule présélectionnait « Pâte à pizza cuite » pour des pâtes et
   > « Pomme, sèche » pour une pomme. Un second appel reçoit les quinze premiers
   > candidats de chaque ligne — des noms, sans valeurs — et désigne le bon par
   > son numéro ; hors liste, il est ignoré, et « aucun » ne présélectionne rien. En-tête de `server/llm/decoupage.ts`.
3. **Photo** — fallback uniquement (cantine, plat de famille). `confidence='basse'`.

### Référentiels et ETL

| Source | Contenu | Accès |
|---|---|---|
| **Ciqual (ANSES)** | Aliments bruts, composition complète | Table de composition nutritionnelle, téléchargeable (XML/XLSX) sur le site Ciqual de l'ANSES |
| **Open Food Facts** | Produits transformés, marques, codes-barres | Export ou API publique |
| **Jow ingredients** | `jow.fr/ingredients/<id>`, valeurs /100 g | Récupérés au passage des recettes |

**Procédure ETL (à écrire dans `scripts/seed-food.ts`) :**

1. Télécharger l'export Ciqual → insérer dans `food` avec `source='ciqual'`,
   `external_id` = code aliment Ciqual.
2. Mapper les colonnes vers `kcal_100g`, `protein_100g`, `carb_100g`,
   `fat_100g`, `fiber_100g` ; le reste dans `micros` (jsonb).
3. Valeurs manquantes ou traces → `NULL`, **jamais 0** (voir I1). La différence
   entre « pas de fibres » et « on ne sait pas » compte.
4. Renseigner `plant_based` et `category` par mapping de groupe Ciqual.
5. Open Food Facts en second passage, `source='off'`, `external_id` = code-barres.
6. Script **idempotent** : `on conflict (source, external_id) do update`.

---

## 6. Unités et conversions

> ⚠️ **Écart assumé, 13/09/2026.** Le point 1 ci-dessous range `ml` parmi les
> unités directement utilisables. Le code ne le fait pas : passer d'un volume à
> une masse demande une densité, et 35 ml d'huile ne pèsent pas 35 g. Les
> volumes passent donc par `food.unit_weights` ou `unit_default`, et à défaut
> déclenchent la question à l'utilisateur — même règle que `Litre` au §4 de
> `docs/jow-contract.md`. Elle découle de I1, qui ne se négocie pas.
>
> `unit_default` est toujours vide. Son gabarit commenté est dans
> `db/seeds/unit-default.csv`, avec le détail de ce qu'il y a à peser. `Pièce`
> et `Litre` en sont volontairement absents : une pièce de poulet et une pièce
> de radis n'ont rien en commun, et ces deux-là relèvent de `food.unit_weights`,
> au cas par cas.
>
> **Précisé le 14/09/2026 — `food.unit_weights` a son seed.** Une recherche de
> sources publiées n'a trouvé **aucune** équivalence générique défendable : la
> cuillère à soupe va de 5 g (parmesan râpé) à 16 g (beurre de cacahuète), la
> gousse d'ail de 3 g (USDA) à 5-8 g (Aprifel). Les conversions sourcées sont
> toutes propres à un aliment ; elles vivent dans `db/seeds/food-unit-weight.csv`
> (code Ciqual, unité, grammes, source), chargé par `seed:refs`, qui remplace
> `food.unit_weights` en entier. Deux changements suivent : une conversion par
> aliment sort en `confidence='moyenne'`, plus en `haute` — une pièce ou une
> cuillère n'est pas une pesée, et une valeur USDA décrit un produit américain
> (R6) ; et le déploiement charge Ciqual **avant** les repères, puisque ce fichier
> s'y rattache par code. Les pesées maison y ont leur place, source datée.
>
> **Complété le même jour — un repli dégradé, par forme.** Quand l'aliment n'a
> pas sa conversion, `unit_default` (migration 013) donne une valeur par unité
> **et par forme** : une cuillère à soupe vaut 15 g (médiane de 14 mesures USDA
> de liquides, pâtes et grains), 6,5 g pour une épice ; une cuillère à café 5 g
> ou 2,2 g ; un litre 1 kg. La forme vient de `food.category`, jamais du nom.
> Le point 3 ci-dessous change donc : ce repli sort en `confidence='basse'` —
> « approximatif » sur une recette — et non plus `moyenne`. Une cuillère n'est pas une mesure, et
> ce que ce repli approxime est consigné (dette n° 18). Pièce, poignée, gousse,
> bouquet et tranche n'en ont pas : aucun volume sur quoi s'appuyer.
>
> Deux défauts de branchement corrigés au passage : les ingrédients d'une
> recette Jow ne passaient jamais par la résolution d'unité — une cuillère de
> sauce ne comptait pas dans la part végétale —, et l'écran de la recette
> montrait les grammes figés à l'import. Il les résout maintenant à la lecture,
> avec leur confiance.

Les recettes Jow utilisent des unités non métriques (`1 poignée`, `1/10 botte`,
`×1 steak`). Le calcul nutritionnel exige des grammes.

**Règle de résolution, dans cet ordre :**

1. Unité déjà métrique (`g`, `ml`) → utiliser directement.
2. `food.unit_weights` contient l'unité → convertir.
3. Table `unit_default` (valeurs génériques de repli) → convertir,
   `confidence='moyenne'`.
4. **Sinon : demander à l'utilisateur.** Ne pas deviner (I1).

Les fractions (`1/10 botte`) se parsent en décimal avant conversion.

```sql
create table unit_default (
  unit    text primary key,
  grams   numeric(8,2) not null,
  source  text not null
);
-- À remplir au seed, avec la source documentée pour chaque ligne.
-- Ne pas inventer : utiliser les équivalences d'une table de référence,
-- ou laisser la ligne absente (déclenche alors la demande utilisateur).
```

---

## 6bis. Restes, invités, périmètre des repas — **décidé**

### Les restes — un 2ᵉ repas, pas un repas fractionné

Un plat cuisiné pour 4 et mangé sur deux jours donne **deux lignes `meal`**
pointant la même `recipe_id`, avec des `servings` différents et des participants
différents.

```
J1 dîner    recipe=X  servings=2.5  participants=[papa, maman, enfant]
J2 déjeuner recipe=X  servings=1.5  participants=[papa]   leftover_of=<meal J1>
```

Un `servings` fractionnaire sur un seul repas ne peut pas marcher : un `meal`
porte une seule `eaten_at` et un seul jeu de participants, or les restes se
mangent un autre jour et souvent par un sous-ensemble différent du foyer.

**La somme des `servings` n'est pas contrainte** à `base_servings`. Personne ne
sait doser au quart de part, et une contrainte ici ne produirait que de la
friction et des chiffres bidouillés.

`leftover_of` est facultatif et sert à la traçabilité (afficher « 2ᵉ service du
plat du 12/09 »). Il n'entre dans aucun calcul.

> **Corrigé le 14/09/2026 — les écrans disaient l'inverse de ce calcul.**
>
> `servings` est le nombre de parts **mangées à ce repas** : la nutrition vaut
> `parts × valeurs par portion`, puis se répartit entre les convives présents
> (§11). L'exemple ci-dessus le dit déjà — 2,5 puis 1,5 pour un plat prévu
> pour 4.
>
> Les écrans, eux, affichaient « parts préparées », repris des maquettes
> (`docs/mockups-tablee.html`, la carte « Pour combien ? » et la liste
> « Restes de… »). Cuisiner pour 4 et en laisser la moitié invitait donc à
> saisir 4, et le foyer se voyait attribuer deux portions que personne n'avait
> mangées. Les écrans disent maintenant « parts mangées à ce repas », et
> proposent « Restes de… » dès que le nombre saisi passe sous `base_servings`.
> Les maquettes gardent l'ancien mot : elles font autorité sur la mise en page,
> pas sur la sémantique du calcul.

**Le point critique est dans l'UI, pas dans le modèle.** L'écran d'ajout doit
proposer un bouton **« Restes de… »** listant les repas des 3 derniers jours
ayant une `recipe_id` : un tap, on choisit qui mange, c'est enregistré. Sans
cette affordance, les restes ne seront jamais saisis et les déjeuners
resteront vides.

> **Renversé en partie le 15/09/2026 — ce qui reste se déclare.**
>
> À l'usage, « parts mangées » ne se sait pas ; « il en reste un quart », si.
> Et rien ne gardait ce qui restait : « Restes de… » proposait tous les plats
> à recette des trois derniers jours, finis ou non, et un tap enregistrait
> d'office une part pour tout le foyer — l'étape « on choisit qui mange »
> avait sauté.
>
> - L'écran demande **« Cuisiné pour »** (`base_servings` par défaut) et
>   **« Il en reste ? »** : rien, un fond (10 %), ¼, ½, ¾. `servings` s'en
>   déduit et garde son sens — parts mangées — : le §11 ne change pas, les
>   parts figées non plus.
> - `meal.remaining_servings` (014) garde les parts laissées dans le plat.
>   `NULL` : rien n'a été dit, ce qui n'est pas « rien ».
> - **Sans recette, ce qu'on saisit est ce qui a été servi** — la pizza
>   entière — et seul « Il en reste ? » est demandé : le nombre de parts n'y
>   sert à rien. Le §11 ne compte que la part mangée, grammes compris (encart
>   du 15/09/2026). Resservir recopie la composition réduite à ce qui restait,
>   et un habituel rejoue ce qui a été mangé, pas le plat entier.
> - « Restes de… » et **« Dans le frigo »** (l'accueil) listent les repas des
>   3 derniers jours, recette ou pas, dont il reste quelque chose et qu'aucun
>   service n'a suivi. `leftover_of` pointe désormais le **service
>   précédent** : un reste qu'on ne finit pas devient la source du suivant. Il
>   n'entre toujours dans aucun calcul nutritionnel ; il sert à la liste.
> - Resservir ouvre une feuille : ce qui restait, qui mange — sa propre fiche
>   par défaut —, s'il en reste encore.
> - **La somme n'est toujours pas contrainte.** Le reste est déclaré, jamais
>   vérifié contre `base_servings` : le paragraphe plus haut tient.
> - Des paliers et pas un pourcentage : un « 25 % » posé à côté de barres en
>   « % du repère du jour » se lirait comme de la nutrition.

> **Renversé le 15/09/2026, le même jour — « Cuisiné pour » sur tous les repas.**
>
> Deux défauts trouvés sur des repas réels, et un seul geste pour les deux :
>
> - **Jow publie la plupart de ses recettes « pour 1 »** (6 sur 8 dans
>   `server/jow/fixtures/`), et le lien de partage ne dit pas pour combien on a
>   cuisiné dans l'app (§3 de `docs/jow-contract.md`). Avec `base_servings` par
>   défaut, un dîner à quatre comptait une assiette partagée entre quatre. Le
>   défaut est maintenant **le nombre de personnes à table**, invités compris,
>   tant qu'on ne touche pas au compteur.
> - **Sans recette, les grammes estimés par l'IA valaient une assiette**, elle
>   aussi partagée entre toute la table. « Cuisiné pour » y est donc demandé
>   aussi : l'IA le reçoit — un nombre, rien de plus (R5) —, et le changer,
>   avant ou après l'enregistrement, remet chaque quantité à l'échelle.
>   `servings + remaining_servings` le porte ; « Il en reste ? » reste un
>   rapport, et le §11 ne change pas. Seul un reste sans recette s'en passe :
>   sa composition est déjà ce qui restait.
> - Les enfants n'ont rien de spécial : on dit pour combien on a cuisiné, les
>   coefficients ne font que répartir.
> - Les repas sans recette enregistrés avant valent « Cuisiné pour 1 » : les
>   passer à 4 multiplierait leurs grammes par 4. Pas de migration, décidé avec
>   le propriétaire — il y en avait quatre.

### Les invités — `guest_count`, pas de membre fictif

Un champ entier sur `meal`. Les invités entrent au dénominateur du calcul des
shares (§11) : leur part est consommée mais attribuée à personne.

Gère 1 comme 5 invités, sans polluer la liste des membres du foyer.

### Périmètre des repas en V1 — **tous les créneaux**

Les cinq créneaux (`petit_dej`, `dejeuner`, `gouter`, `diner`, `collation`) sont
proposés dès la V1. Un bilan nutritionnel amputé du petit-déjeuner et du goûter
n'a pas de sens : ce sont deux repas où se joue une bonne partie des fibres et
des sucres de la journée.

**Conséquence directe, non négociable :** les **templates passent en V1** (ils
étaient prévus en V2). Le petit-déjeuner et le goûter sont les repas les plus
répétitifs de la semaine — ce sont eux qui font vivre ou mourir l'app. Sans un
bouton « Mon petit-déj » à un tap, quatre saisies par jour deviennent une
corvée et l'usage s'arrête en deux semaines.

Autrement dit : ouvrir tous les créneaux sans livrer les templates en même temps
est la principale façon de faire échouer la V1.

---

## 7. Authentification — ~~**décidé**~~ **renversé (13/09/2026)**

> ⚠️ **Renversé le 13/09/2026. Cette section est caduque, et la raison qu'elle
> donne était fausse.** Elle est conservée parce qu'elle explique la forme du
> code écrit jusqu'ici, et parce que l'erreur mérite d'être lisible.
>
> Ce que le §7 disait : *« des comptes individuels ajouteraient de l'auth, des
> rôles et des policies pour un gain nul »*. Le gain n'était pas nul — il était
> juste invisible tant qu'on regardait un seul foyer. Deux décisions du
> 13/09/2026 le rendent visible :
>
> 1. **Plusieurs adultes saisissent, avec leur propre compte.** Le sélecteur
>    « c'est moi » ne dit pas qui saisit, il dit qui *prétend* saisir.
> 2. **Plusieurs foyers cohabitent sur une instance.** Des amis créent leur
>    foyer, et l'hébergeur ne doit pas voir leurs données.
>
> **L'erreur de fond n'était pas dans l'auth, elle était dans le mot
> « membre ».** Le §10 n'a qu'une table de personnes : `member`, qui porte un
> `portion_coef`, un âge, des allergènes — c'est **une assiette**. Et
> `meal.created_by` pointe dessus, c'est-à-dire que « qui a saisi » et « qui a
> mangé » sont le même objet. Or les deux ensembles ne coïncident pas :
>
> | | compte | assiette |
> |---|---|---|
> | Les parents | oui | oui |
> | Les enfants | non (trop jeunes) | oui |
> | Une nounou, un grand-parent | possible | non |
>
> **Ce qui remplace cette section :**
>
> - `member` devient `eater` — le convive, inchangé par ailleurs.
> - Un compte est un `user`, membre d'un ou plusieurs foyers. `meal.created_by`
>   pointe vers un `user`.
> - Identité, invitations et rôles délégués à **better-auth** (plugin
>   `organization` : une organisation = un foyer). L'invitation et la
>   récupération de mot de passe sont les deux endroits où l'auth maison se
>   trompe, et la seconde n'existe pas aujourd'hui.
> - Deux rôles par foyer : `parent` (tout, y compris les accès) et `adulte`
>   (saisir et lire, pas gérer les accès). `jeune` est une valeur réservée,
>   **sans écran** : un enfant qui a un compte est un autre produit, soumis à
>   I5, et ça se décidera le jour venu.
> - Inscription **ouverte** — c'est le but — donc limitation de débit sur la
>   création de compte. La vérification d'adresse attend un SMTP (dette n° 7).
>
> **Écrit le 13/09/2026** (better-auth 1.7.4, migrations 007 et 008). Trois
> points que l'encart ci-dessus ne pouvait pas prévoir :
>
> - **La session reste à 30 jours**, contre 7 par défaut chez better-auth.
>   C'est la seule décision du §7 d'origine qui survit, et sa raison n'a pas
>   bougé : une PWA familiale qui redemande le mot de passe toutes les semaines
>   met de la friction sur le chemin critique.
> - **Trois états d'authentification, pas deux.** `anonyme`, `sans_foyer`
>   (connecté, mais pas encore dans un foyer) et `actif`. Renvoyer un compte
>   tout neuf vers l'écran de connexion serait lui redemander un mot de passe
>   qu'il vient de saisir — d'où `GET /api/me`, qui les distingue.
> - **Un compte qui n'appartient qu'à un seul foyer n'a rien à choisir.** Le
>   serveur résout ce foyer implicitement ; exiger un « choisissez » ajouterait
>   un tap au chemin du partage, pour rien.

> **Complété le 14/09/2026** (migration 009), après la première mise en service
> sur un vrai téléphone. La scission compte / assiette était juste, mais elle
> ne disait rien du cas le plus courant du foyer : **les deux à la fois**.
>
> Ce qui manquait se voyait à trois endroits :
>
> - créer son compte menait à une app vide. Il fallait ensuite penser à se
>   créer une assiette, ce que personne ne fait ;
> - un conjoint saisi à la main, qui s'inscrit trois semaines plus tard, se
>   retrouvait avec une fiche d'un côté et un compte de l'autre, sans que rien
>   ne les rejoigne. La seule issue était de ressaisir ;
> - un `adulte` ne pouvait pas modifier « sa » fiche, faute de savoir laquelle.
>
> D'où **un lien facultatif, et rien de plus** : `eater.user_id` (le compte de
> ce convive, quand il en a un) et `eater.claim_email` (l'adresse à qui la
> fiche est réservée, en attendant). Cardinalité 0..1 des deux côtés, dans les
> deux sens. Les enfants restent des convives sans compte, une nounou un compte
> sans convive, et `meal.created_by` continue de désigner un `"user"` : **ce
> n'est pas la refusion que la 007 répare**, c'est une information de plus.
>
> Le rattachement se fait tout seul à l'entrée dans le foyer — crochets
> `afterAcceptInvitation` et `afterAddMember` — et immédiatement si l'adresse
> est déjà membre. Il échoue en silence plutôt que de faire échouer une
> acceptation d'invitation : une fiche non rattachée se rattache d'un tap, une
> personne qui ne peut pas entrer est bloquée.
>
> **Trois gardes ajoutées au passage**, parce que la question « laquelle est la
> vôtre ? » n'avait pas de réponse avant :
>
> - les rôles s'appliquent enfin aux convives. `ROLES.adulte` ne portait aucune
>   permission `eater`, et pourtant `/api/eaters` n'en vérifiait aucune :
>   n'importe quel membre modifiait n'importe quelle fiche. Un `parent` compose
>   le foyer, un `adulte` ne modifie que la sienne ;
> - décider à qui appartient une fiche est réservé au `parent`. Sans ça, un
>   compte `adulte` pourrait s'attribuer la fiche d'un enfant et gagner le
>   droit de la modifier ;
> - un `adulte` ne voit pas le poids des autres (voir l'encart du §9).

> **Complété le 14/09/2026 — le mail, au choix de l'hébergeur.** « La
> vérification d'adresse attend un SMTP » reste vrai pour une instance sans
> `TABLEE_MAIL`. Avec `TABLEE_MAIL=resend` ou `smtp` (`server/auth/mail.ts`),
> trois choses s'allument **ensemble**, parce qu'aucune ne tient seule : la
> confirmation d'adresse devient obligatoire, le mot de passe oublié existe
> (écran `/reinitialiser`), et l'invitation part par mail — le lien reste
> rendu au parent dans tous les cas, un mail pouvant finir en indésirables.
>
> L'allumer sur une instance existante demande aux comptes déjà créés de
> confirmer leur adresse à leur prochaine connexion ; un lien part tout seul.
> Aucune migration ne les marque vérifiés d'office : ce serait affirmer une
> preuve qu'on n'a pas. Détail dans la dette n° 7.

> **Complété le 14/09/2026 — la connexion Google, au choix de l'hébergeur.**
> Avec `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`, l'écran de connexion
> propose « Continuer avec Google » : un tap au lieu d'une adresse et de douze
> caractères. C'est toujours better-auth (`socialProviders.google`), et aucune
> migration : la table `account` de la 007 porte déjà les comptes tiers.
>
> - **Un compte ouvert par Google est un compte comme un autre** : même état
>   `sans_foyer`, mêmes invitations, même rattachement d'assiette par adresse.
>   `user.name` n'en garde que le prénom, comme l'inscription le demande.
> - **Une adresse déjà inscrite par mot de passe n'est reliée à Google que si
>   elle est confirmée** — le défaut de better-auth, laissé tel quel. Sinon,
>   inscrire l'adresse de quelqu'un avant lui suffirait à garder un mot de
>   passe sur le compte qu'il ouvrira ensuite par Google. Sans `TABLEE_MAIL`,
>   aucune adresse n'est confirmée : la personne entre avec son mot de passe,
>   et l'écran le lui dit.
> - **Le retour de Google garde l'URL, jetons Jow retirés.** Une invitation
>   survit, un partage Jow reçu sans session aussi : sa query passe par
>   `redactRequestUrl` avant d'être confiée à better-auth, qui la garde en base
>   le temps de l'aller-retour (I6).
> - **Un compte ouvert par mot de passe lie Google depuis les réglages du
>   foyer**, en étant connecté. La session prouve le compte, Google prouve le
>   sien : les deux adresses peuvent différer (`allowDifferentEmails`), à la
>   différence de la liaison implicite à la connexion. C'est la porte des
>   comptes jamais confirmés.
>   ⚠️ Déplacé le 14/09/2026 : la liaison vit sur « Votre profil » (`/profil`),
>   plus dans les réglages du foyer — c'est le compte qu'on lie, pas le foyer.
>   La page dit aussi si un compte Google est déjà lié.


**Un compte par foyer. Pas de compte individuel.**

- Un identifiant/mot de passe unique pour le foyer, session longue (30 jours).
- Un sélecteur « c'est moi » en haut de l'app pour savoir qui saisit.
- Pas de PIN par membre en V1.

**Pourquoi :** app auto-hébergée, usage familial, sur le réseau de la maison.
Des comptes individuels ajouteraient de l'auth, des rôles et des policies pour
un gain nul — et multiplieraient la friction de saisie, qui est le vrai risque
du projet. Le jour où l'app sort du foyer, ce choix est à revoir en entier (§16).

**Implémentation :** cookie de session `httpOnly` + `Secure` + `SameSite=Lax`.
Mot de passe hashé en argon2id. Pas de JWT — inutile ici, et plus dur à révoquer.

---

## 8. Les 5 barres — **décidé**

> ⚠️ **Une sixième s'ajoute le 17/09/2026 : l'énergie, majeurs seulement.**
> Décidée par le propriétaire, contre les deux objections qui lui ont été
> présentées — le §9 s'interdisait de faire sortir `energy_reference` de la
> base, et R7 dit que le vocabulaire parle qualité et variété. Le texte
> d'origine est conservé tel quel ci-dessous : les **cinq** barres restent
> celles de l'anneau, des compteurs du foyer et de la fiche d'un repas, et ce
> sont elles qui portent les cinq couleurs du §8ter.
>
> L'énergie n'est chiffrée que dans le **bilan détaillé** d'une personne, en
> dernière position, en gris, et **jamais sur un profil mineur** (I5, trois
> filets — voir l'en-tête de la migration 017). Ce qui l'a rendue possible est
> une autre décision du même jour : la montée à la table Ciqual 2025, qui
> publie l'énergie de 3 339 aliments sur 3 484 là où la 2020 en couvrait 2 298
> sur 3 185. La mesure complète, y compris les deux façons de combler ce trou
> qui ont été essayées et écartées, est dans `docs/indicateurs-possibles.md`.

**Protéines · Glucides · Lipides · Fibres · Végétal**

Affichage : **% du repère du jour**, par personne (R3).

La 5ᵉ barre est **Végétal** = part des grammes du repas issus d'aliments
d'origine végétale.

```
végétal_% = Σ(quantity_g des items où food.plant_based) / Σ(quantity_g) × 100
```

**Pourquoi celle-là :** elle est calculable exactement avec les données déjà en
base (un booléen sur `food`), elle est alignée sur les recommandations
publiques, et elle ne demande aucune estimation. Les alternatives envisagées —
diversité alimentaire, part d'ultra-transformé — demandent respectivement une
fenêtre glissante et une classification NOVA absente de Ciqual. Elles restent
possibles en V3.

Repère `végétal` : **pas de cible chiffrée affichée**. La barre montre la valeur
du jour et la moyenne des 7 derniers jours du foyer. C'est une tendance, pas un
objectif (R7, I5).

---

## 8bis. Saisonnalité — **en V1**

Contrairement aux autres modules « plaisir » (§14bis), la saisonnalité ne demande
**aucun historique** : elle est utile le premier jour. Elle part donc en V1.

**Donnée :** table `seasonal_produce`, environ 40 fruits et légumes × les mois où
ils sont de saison. Une demi-journée de saisie, acquise définitivement. Ni
Ciqual ni Open Food Facts ne la contiennent.

**Deux emplacements, pas un :**

1. **Bande en haut de l'accueil** — « De saison en septembre ». Information
   passive : on doit la voir sans aller la chercher. Les produits déjà mangés
   dans le mois sont marqués, les autres en pointillé. Une ligne d'urgence en
   dessous (« le raisin part fin octobre ») transforme un catalogue en fenêtre
   qui se ferme.
2. **Badge sur la carte de repas** — croisement `recipe_ingredient` ×
   `seasonal_produce`. Jow fournit les ingrédients, donc le nombre de produits
   de saison d'une recette est calculable sans aucune saisie.

Le « bingo des légumes » envisagé en maquette disparaît comme écran séparé : la
bande d'accueil est à la fois l'information et le jeu.

---

## 8ter. Identité visuelle

> Les maquettes de référence sont dans `mockups-tablee.html`, à ouvrir dans un
> navigateur. Elles font foi sur la mise en page ; cette section fixe les règles.

### Couleur de marque

**Terracotta `#D85A30`.** Chaud, cuisine, et hors des deux ornières du domaine :
le vert « santé » et le bleu « médical ».

Employé en **aplat plein** sur le chrome — barre de titre, navigation active,
boutons, accents. Une couleur en petites touches sur fond blanc reste un tableau
de bord avec un liseré.

### Palette de nutriments

| Nutriment | Couleur |
|---|---|
| Protéines | `#7F77DD` |
| Glucides | `#EF9F27` |
| Lipides | `#378ADD` |
| Fibres | `#1D9E75` |
| Végétal | `#639922` |

**Règle stricte : ces cinq couleurs n'apparaissent que sur des données
nutritionnelles** — anneaux, barres, graphes de la vue semaine. Jamais sur un
bouton, un onglet, un badge ou un fond. Six couleurs dans une interface sans
discipline d'usage, c'est un sapin de Noël.

Ce sont cinq catégories distinctes, pas une échelle : elles ne doivent pas coder
un état (bon/mauvais). Un anneau où le segment vert manque se lit d'un coup —
c'est tout l'intérêt.

> **Mode sombre — ajouté le 14/09/2026.** Le §8ter ne décrivait qu'un fond
> crème. L'app se consulte à table, le soir, sur un téléphone : le sombre suit
> désormais le réglage du système, avec un choix manuel *par appareil* —
> localStorage, pas la base. Deux personnes partagent un foyer et pas leurs yeux.
>
> Ce qui ne change pas, et qui est le point : **le terracotta et les cinq
> couleurs de nutriments sont identiques dans les deux modes**. Elles portent
> l'identité, elles ne se « corrigent » pas pour un fond — et la mesure leur
> donne raison, entre 4,4 et 7,6 pour 1 sur le fond sombre contre 2,2 à 3,8 sur
> le crème. Ce qui bascule, ce sont les surfaces, les textes, les bordures et
> les rampes, qui s'inversent.
>
> Le fond sombre suit la même règle que le crème : **pas de noir pur**, un brun
> très sombre, et le même ordre de hauteur — la carte reste au-dessus du fond.
>
> Détail technique dans l'en-tête de `web/design/tokens.css` ; la contrainte de
> navigateur qu'il impose est en dette n° 12.

### Fond

Pas de blanc pur. Un crème très légèrement teinté de la couleur de marque
(`rgba(216,90,48,.06)` sur la surface) change la perception avant qu'on ait lu
quoi que ce soit. Le blanc est réservé aux cartes, qui ressortent alors du fond.

### Typographie

Un serif (Fraunces ou équivalent) pour les moments d'affichage, à **28-34 px**.
Un sans-serif pour tout le reste, entre 11 et 17 px. C'est l'écart qui crée le
rythme — une interface entièrement comprise entre 11 et 15 px paraît plate quelle
que soit sa palette.

### Hiérarchie

Ne pas tout traiter au même poids. Une carte héros pour le plat principal du
jour, des vignettes plus petites pour le reste. Une grille uniforme ne dit pas
ce qui compte.

### Photos

Chaque aplat coloré des maquettes est un placeholder pour une photo Jow
(`recipe.image_url`). Elles porteront l'essentiel de la chaleur visuelle. Une
fois en place, **le terracotta doit reculer des zones d'image** et rester sur le
chrome, sinon l'écran devient orange sur orange.

### Vocabulaire

« Qui était à table ? » plutôt que « participants ». « Pour combien ? » plutôt
que « parts préparées ». « Ce soir » plutôt que « créneau dîner ». Le
vocabulaire système est la moitié de l'effet tableau de bord.

---

## 9. Repères nutritionnels — **à sourcer, pas à inventer**

> ⚠️ **Constat du 13/09/2026 : cette section suppose un modèle que les sources
> ne suivent pas.** Elle demande de remplir `nutrient_reference` avec, pour
> chaque tranche d'âge et de sexe, une valeur en grammes. Des quatre
> macronutriments de la V1, **seules les fibres sont publiées ainsi**.
>
> | Nutriment | Ce que l'ANSES publie réellement |
> |---|---|
> | Fibres | 30 g/j pour l'adulte, 14 / 16 / 19 / 21 g/j pour les 4-6, 7-10, 11-14 et 15-17 ans. Absolu, non sexué. |
> | Protéines | un **intervalle de référence en % de l'apport énergétique total** (10-20 % chez l'adulte), qui varie avec l'âge |
> | Lipides | intervalle de 35-40 % de l'AET |
> | Glucides | intervalle de 40-55 % de l'AET, hors fibres |
>
> La RNP des protéines s'exprime en outre **par kilogramme de poids corporel**,
> donnée que le §10 ne stocke volontairement pas.
>
> Or un pourcentage d'énergie est un ratio : il converge au fil de la journée
> au lieu de progresser, et ne répond donc jamais à « qu'est-ce qu'il me
> manque ». `nutrient_reference` porte donc désormais un `kind` (AS, RNP, RN,
> IR_MIN, IR_MAX) et une `basis` (`absolu` ou `pct_aet`), et les cibles en
> grammes des trois autres macros sont **dérivées** au moment du seed :
>
> ```
> cible_g = intervalle (% AET) × besoin énergétique (kcal) / facteur (kcal/g)
> ```
>
> **Le poids, 14/09/2026 — décision revue, portée réduite.** Cette section et
> le §10 refusaient de stocker le poids ; la 005 le redit. La demande est venue
> de la mise en service, et elle est légitime : la RNP des protéines de l'ANSES
> s'exprime **par kilogramme de poids corporel** (0,83 g/kg/j chez l'adulte), et
> c'est exactement le terme qui manquait pour en dériver une cible en grammes
> au lieu d'un intervalle en % de l'AET.
>
> `eater.weight_kg`, `eater.weight_recorded_at` et `eater.height_cm` existent
> donc depuis la 009, à trois conditions qui ne sont pas négociables :
>
> 1. **Majeurs seulement.** I5 interdit tout objectif chiffré de poids sur la
>    fiche d'un enfant, et une valeur qu'on stocke finit par s'afficher. Le
>    champ n'est pas grisé sur un profil mineur : il est **absent**, l'API le
>    refuse, et la lecture le masque si une date corrigée rend le profil mineur.
> 2. **Une mesure, jamais une cible.** Aucune barre, aucune série, aucune
>    courbe, aucun écart à un poids « idéal ». `weight_recorded_at` est posé par
>    le serveur et l'interface affiche « pesé le … » : un poids sans date dérive
>    en silence.
> 3. **Visible de soi et des parents.** Une nounou a besoin des allergènes, pas
>    du poids des parents.
>
> ⚠️ **Aucun calcul ne le lit encore, et c'est volontaire.** Dériver la RNP des
> protéines demanderait une ligne `nutrient_reference` de plus, avec sa chaîne
> de sources — et le contenu de cette table ne se décide pas seul (CLAUDE.md).
> La donnée est là ; la ligne dérivée reste à écrire.
>
> Les trois termes sont sourcés — avis ANSES, besoins énergétiques EFSA 2017
> repris par l'ANSES, facteurs du Règlement (UE) n° 1169/2011 Annexe XIV, qui
> est la convention sous laquelle Ciqual publie son énergie. Le produit, lui,
> n'est publié nulle part : ces lignes portent `derived = true` et leur chaîne
> de calcul complète en `source`. Voir `db/seeds/` et
> `server/nutrition/derive.ts`.
>
> Le besoin énergétique vit dans sa propre table (`energy_reference`) et ~~**ne
> sort jamais à l'écran**~~ : I5 interdit un objectif chiffré de calories sur un
> profil mineur, et il ne sert ici qu'au calcul.
>
> ⚠️ **Renversé le 17/09/2026, par le propriétaire.** Il sort à l'écran, pour
> les **majeurs seulement**, comme repère de la barre « Énergie » (§8). Le seed
> le recopie alors dans `nutrient_reference` sous la nature `BNM` — un besoin
> **moyen**, et pas une RNP : une RNP couvrirait 97,5 % de la population, ce
> qui pour l'énergie ferait manger la moitié des gens au-delà de leur besoin.
>
> Ce que le renversement n'emporte pas, et qui tient toujours : **aucune ligne
> n'est écrite avant 18 ans**, `bilanJournalier` ne construit pas la barre sous
> 18 ans, et la **chaîne de dérivation** des cibles en grammes ne s'affiche
> toujours pas — elle contient un nombre de calories (« × 2263 kcal ») qui
> serait, lui, celui d'un enfant. Lire l'en-tête de la migration 017.
>
> Le point 4 ci-dessous tient intégralement : une tranche non couverte reste
> absente et l'UI affiche « repère indisponible ». C'est le cas des 0-3 ans.
> Les tranches au-delà de 69 ans (hommes) et 59 ans (femmes) sont prolongées,
> ce qui est consigné comme dette n° 1 dans `docs/dette-technique.md`.

La table `nutrient_reference` est **livrée vide**.

> ⚠️ **I1 s'applique ici en priorité.** Les repères varient par âge et par sexe.
> Un agent qui les génère de mémoire produira des valeurs plausibles et fausses,
> qui serviront ensuite de base à des conseils destinés à des enfants.

**Procédure de remplissage :**

1. Récupérer les références d'apports de l'**ANSES** (références nutritionnelles
   pour la population française) et les repères du **PNNS** en vigueur.
2. Remplir `nutrient_reference` avec, pour chaque ligne, le champ `source`
   renseigné (ex. `ANSES 2021`).
3. Toute tranche d'âge non couverte par la source reste **absente**.
4. Si un membre tombe dans une tranche absente, l'UI affiche la barre en état
   « repère indisponible » — pas une barre à 0, pas une barre estimée.

**Nutriments minimum pour la V1 :** `protein_g`, `carb_g`, `fat_g`, `fiber_g`.
`kcal` est stocké mais n'est jamais affiché comme objectif (I5).

---

## 10. Schéma Postgres

> **Le schéma a évolué depuis, par migrations numérotées** (13/09/2026). Ce qui
> suit est l'état initial, transcrit dans `db/migrations/001_init.sql`. Les
> suivantes, et pourquoi :
>
> | Migration | Ce qu'elle ajoute, et la raison |
> |---|---|
> | `002` | `meal_nutrition.grams_total / grams_plant / grams_classified`. Agréger une part végétale sur une journée demande les deux termes du rapport ; la moyenne de deux pourcentages de repas ne mesure rien. |
> | `003` | `food.*_100g_max` et `meal_nutrition.*_max`. Ciqual publie des majorants (« < 0,5 ») que la doc de la table appelle « une valeur maximale » : un nutriment devient un intervalle plutôt qu'un point. |
> | `004` | `jow_food_link`. L'ObjectId d'un ingrédient Jow est stable : on le rattache une fois, pas une fois par recette. |
> | `005` | `nutrient_reference.kind` et `.basis` — voir l'encart du §9. |
> | `006` | `nutrient_reference.derived` et la table `energy_reference` — voir l'encart du §9. |
> | `007` | Comptes individuels, foyers multiples, `member` → `eater` — voir l'encart du §7. |
> | `008` | Row-Level Security : l'étanchéité entre foyers descend dans la base (§16). |
> | `009` | `eater.user_id` / `.claim_email` (le lien facultatif avec un compte), et `eater.weight_kg` / `.weight_recorded_at` / `.height_cm`, **majeurs seulement** — voir les encarts des §7 et §9. |

```sql
create extension if not exists "pgcrypto";

-- ═══════════════════════════════════════════════════════════
-- AUTH & FOYER
-- ═══════════════════════════════════════════════════════════

create table household (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  timezone       text not null default 'Europe/Paris',
  login          text not null unique,
  password_hash  text not null,          -- argon2id
  created_at     timestamptz not null default now()
);

create table session (
  token         text primary key,        -- aléatoire 256 bits
  household_id  uuid not null references household(id) on delete cascade,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index on session (expires_at);

-- ═══════════════════════════════════════════════════════════
-- MEMBRES
-- ═══════════════════════════════════════════════════════════

create table member (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  first_name    text not null,
  birth_date    date not null,           -- l'âge se calcule, ne se stocke pas
  sex           text not null check (sex in ('F','M')),
  -- Combien cette personne mange par rapport à un adulte de référence.
  -- Démarrer grossier (0.5 / 0.75 / 1), affiner à l'usage.
  portion_coef  numeric(3,2) not null default 1.00
                check (portion_coef > 0 and portion_coef <= 2),
  diets         text[] not null default '{}',   -- 'vegetarien','sans_porc',...
  color         text,                           -- couleur d'affichage
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index on member (household_id) where active;

-- Faits déclarés, pas jugements (I2).
create table member_preference (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references member(id) on delete cascade,
  food_id     uuid,           -- FK ajoutée après création de food
  label       text not null,
  stance      text not null check (stance in ('aime','naime_pas','evite')),
  created_at  timestamptz not null default now()
);

-- ⚠️ Donnée de santé. Justifiée fonctionnellement (sécurité alimentaire).
-- Strictement locale. Jamais transmise au LLM (I3).
create table member_allergen (
  member_id   uuid not null references member(id) on delete cascade,
  label       text not null,
  severity    text check (severity in ('intolerance','allergie')),
  primary key (member_id, label)
);

-- ═══════════════════════════════════════════════════════════
-- RÉFÉRENTIEL ALIMENTS
-- ═══════════════════════════════════════════════════════════

create table food (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('ciqual','off','jow','manuel')),
  external_id   text,
  name          text not null,
  category      text,                    -- groupe Ciqual simplifié
  plant_based   boolean,                 -- null = non classé, PAS false
  -- macros pour 100 g : socle commun à toutes les sources
  kcal_100g     numeric(8,2),
  protein_100g  numeric(8,2),
  carb_100g     numeric(8,2),
  fat_100g      numeric(8,2),
  fiber_100g    numeric(8,2),
  -- le reste varie selon la source → jsonb plutôt que 40 colonnes NULL
  micros        jsonb not null default '{}'::jsonb,   -- {"fer_mg":2.1}
  -- conversions spécifiques : {"piece":110,"poignee":30}
  unit_weights  jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (source, external_id)
);

create index on food using gin (to_tsvector('french', name));
-- ⚠️ Remplacé le 18/09/2026 par la 018 : même index sur `french_unaccent`,
-- pour que « pates » tapé sans accents trouve les pâtes (dette n° 5).
create index on food (plant_based) where plant_based is not null;

-- Saisonnalité (§8bis). Table statique, saisie une fois à la main :
-- elle n'existe ni dans Ciqual ni dans Open Food Facts.
create table seasonal_produce (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  food_id  uuid references food(id),
  kind     text not null check (kind in ('legume','fruit')),
  months   int[] not null,              -- [9,10,11]
  region   text not null default 'FR',
  unique (name, region)
);
-- produits du mois courant : where 9 = any(months)

alter table member_preference
  add constraint member_preference_food_fk
  foreign key (food_id) references food(id) on delete set null;

-- ═══════════════════════════════════════════════════════════
-- RECETTES
-- ═══════════════════════════════════════════════════════════

create table recipe (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('jow','manuel')),
  jow_recipe_id   text,        -- ObjectId issu du lien de partage
  jow_slug        text,        -- suffixe de l'URL web, mis en cache
  title           text not null,
  url             text,
  image_url       text,
  base_servings   int not null default 1,
  -- snapshot Jow : figé à la capture, jamais recalculé
  kcal_serving    numeric(8,2),
  protein_serving numeric(8,2),
  carb_serving    numeric(8,2),
  fat_serving     numeric(8,2),
  fiber_serving   numeric(8,2),
  nutri_score     char(1),
  green_score     text,
  raw             jsonb,       -- dump __NEXT_DATA__ intégral
  confidence      text not null default 'haute'
                  check (confidence in ('haute','moyenne','basse')),
  fetched_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (source, jow_recipe_id)
);

create table recipe_ingredient (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references recipe(id) on delete cascade,
  food_id      uuid references food(id),   -- null si non résolu
  jow_food_id  text,                       -- ObjectId ingrédient Jow
  label        text not null,              -- libellé Jow brut
  quantity     numeric(10,3),
  unit         text,
  quantity_g   numeric(10,2),              -- résolu, null si irrésolu
  optional     boolean not null default false,
  position     int not null default 0
);

-- ═══════════════════════════════════════════════════════════
-- REPAS
-- ═══════════════════════════════════════════════════════════

create table meal (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  eaten_at      timestamptz not null,
  slot          text not null check (slot in
                  ('petit_dej','dejeuner','gouter','diner','collation')),
  source        text not null check (source in
                  ('jow','texte','photo','template','manuel')),
  recipe_id     uuid references recipe(id),
  servings      numeric(4,2) not null default 1,   -- parts préparées
  -- Restes : 2e service d'un plat déjà enregistré (§6bis).
  -- La somme des servings n'est PAS contrainte à base_servings.
  leftover_of   uuid references meal(id) on delete set null,
  -- Convives hors foyer. Entrent au dénominateur des shares, sans
  -- être attribués à personne.
  guest_count   int not null default 0 check (guest_count >= 0),
  raw_input     text,
  photo_path    text,
  note          text,
  created_by    uuid references member(id),
  created_at    timestamptz not null default now()
);

create index on meal (household_id, eaten_at desc);
create index on meal (household_id, slot, eaten_at desc);

-- Hors-Jow, ou ajustements d'un repas Jow
create table meal_item (
  id          uuid primary key default gen_random_uuid(),
  meal_id     uuid not null references meal(id) on delete cascade,
  food_id     uuid references food(id),
  label       text not null,
  quantity    numeric(10,3),
  unit        text,
  quantity_g  numeric(10,2),
  position    int not null default 0
);

-- Qui a mangé, et quelle part.
-- R2 : `share` est résolu à l'écriture depuis portion_coef, puis FIGÉ.
-- Changer le coefficient d'un enfant qui grandit ne doit jamais réécrire
-- l'historique — sinon les tendances passées deviennent ininterprétables.
create table meal_participant (
  meal_id     uuid not null references meal(id) on delete cascade,
  member_id   uuid not null references member(id) on delete cascade,
  share       numeric(4,3) not null check (share >= 0),
  primary key (meal_id, member_id)
);

-- Totaux calculés en applicatif à l'enregistrement, puis stockés.
-- La résolution (snapshot Jow vs somme des meal_item) est trop tordue à
-- exprimer en SQL pur : la faire en code, une fois.
create table meal_nutrition (
  meal_id     uuid primary key references meal(id) on delete cascade,
  kcal        numeric(10,2),
  protein_g   numeric(10,2),
  carb_g      numeric(10,2),
  fat_g       numeric(10,2),
  fiber_g     numeric(10,2),
  plant_ratio numeric(5,2),                -- 0-100, null si indéterminable
  micros      jsonb not null default '{}'::jsonb,
  confidence  text not null check (confidence in ('haute','moyenne','basse')),
  computed_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════
-- TEMPLATES (levier anti-friction)
-- ═══════════════════════════════════════════════════════════

create table meal_template (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  name          text not null,             -- « Petit-déj de Stéphane »
  slot          text,
  payload       jsonb not null,            -- items + participants pré-remplis
  use_count     int not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index on meal_template (household_id, use_count desc);

-- ═══════════════════════════════════════════════════════════
-- REPÈRES (§9 — livrée VIDE, à sourcer)
-- ═══════════════════════════════════════════════════════════

create table nutrient_reference (
  id        uuid primary key default gen_random_uuid(),
  sex       text not null check (sex in ('F','M','ALL')),
  age_min   int not null,
  age_max   int not null,
  nutrient  text not null,        -- 'protein_g','carb_g','fat_g','fiber_g'
  value     numeric(10,2) not null,
  unit      text not null,
  source    text not null,        -- obligatoire (I1)
  unique (sex, age_min, age_max, nutrient)
);

-- ═══════════════════════════════════════════════════════════
-- COUCHE IA
-- ═══════════════════════════════════════════════════════════

-- Mémoire narrative. Faits datés uniquement (I2).
-- ✅ « Léa a goûté les épinards et a aimé »
-- ❌ « Léa mange mal »
create table family_note (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  member_id     uuid references member(id) on delete cascade,  -- null = foyer
  content       text not null,
  occurred_on   date not null default current_date,
  author        text not null check (author in ('user','ai')),
  created_at    timestamptz not null default now()
);

create index on family_note (household_id, occurred_on desc);

create table weekly_insight (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  week_start    date not null,
  content       text not null,
  facts_used    jsonb,            -- ce qui a été injecté : traçabilité
  model         text,
  generated_at  timestamptz not null default now(),
  unique (household_id, week_start)
);
```

---

## 11. Calcul nutritionnel — algorithme

> **Quatre points tranchés à l'écriture** (13/09/2026). Le pseudo-code
> ci-dessous les laisse implicites, et chacun se résout dans le sens de I1 :
>
> - **Les totaux sont des intervalles, pas des points.** Une mesure exacte est
>   un intervalle de largeur nulle ; un « < 0,5 » de Ciqual vaut `[0 ; 0,5]` ;
>   « traces » reste sans majorant, l'ANSES écrivant « très faible » sans jamais
>   donner de seuil.
> - **Un aliment hors référentiel ne détruit pas le total, il en retire le
>   plafond.** Un repas avec un plat de cantine vaut « au moins 31 g de
>   protéines » — vrai, vérifiable, et plus utile que « valeur inconnue ».
> - **Les parts sont arrondies au millième par la méthode du plus fort reste**,
>   et non chacune dans son coin. Trois convives à coefficient égal donneraient
>   sinon 0,333 × 3 = 0,999, et le repas perdrait un millième à chaque
>   enregistrement.
> - **« jamais 0 par défaut » vaut aussi à l'échelle de la journée.** Un repas
>   dont aucun gramme n'est classé est écarté du rapport de part végétale, et
>   non compté au dénominateur : l'y laisser reviendrait à le traiter comme
>   entièrement non végétal, c'est-à-dire à réintroduire le zéro qu'on vient de
>   refuser au niveau du repas.

Exécuté **en applicatif**, à chaque écriture ou modification d'un repas.

```
calculerNutrition(meal):

  # 1. Totaux du repas
  si meal.recipe_id existe ET recipe a un snapshot nutritionnel complet:
      totaux = snapshot_par_portion × meal.servings
      confidence = recipe.confidence
  sinon:
      totaux = 0 ; confidence = 'haute'
      pour chaque item de meal_item:
          si item.quantity_g est null:
              item.quantity_g = résoudreUnité(item)     # §6
              si irrésolu → confidence = 'basse' ; ignorer l'item
          si item.food_id est null:
              confidence = 'basse' ; ignorer l'item
          totaux += food.valeurs_100g × item.quantity_g / 100
      si meal.source == 'photo': confidence = 'basse'

  # 2. Part végétale
  grammes_total   = Σ quantity_g connus
  grammes_vegetal = Σ quantity_g où food.plant_based is true
  plant_ratio = grammes_vegetal / grammes_total × 100  si grammes_total > 0
                sinon null                              # jamais 0 par défaut

  # 3. Persister dans meal_nutrition
```

> **Précisé le 15/09/2026 — sans recette, les items sont ce qui a été servi.**
>
> Pour un repas sans recette, les totaux **et** les grammes du point 2 sont
> multipliés par la part mangée, `servings / (servings + remaining_servings)`
> (§6bis). Les grammes aussi : la journée les somme pour sa part végétale, et
> un reste compté y pèserait. `remaining_servings` absent vaut 0 — les repas
> d'avant ne bougent pas. Avec recette, rien ne change : `servings` y est déjà
> la part mangée, et un item ajouté au plat compte entier — il ne se ressert
> pas non plus.
>
> La fraction est déclarée à table, en paliers. Elle ne dégrade pas la
> confiance, pas plus que le nombre de parts d'un repas Jow ne l'a jamais fait.

```
calculerShares(meal, membres_présents):
  # R2 — appelé UNE SEULE FOIS, à l'écriture
  somme_coefs = Σ portion_coef des membres présents + (meal.guest_count × 1.0)
  pour chaque membre:
      share = portion_coef / somme_coefs
  # Σ share < 1 s'il y a des invités : leur part est consommée mais
  # attribuée à personne. C'est voulu — on ne gonfle pas les assiettes
  # du foyer avec ce qu'ont mangé les convives.
```

```
bilanJournalier(membre, date):
  repas = meals du jour où le membre est participant
  pour chaque nutriment:
      consommé = Σ (meal_nutrition.nutriment × share)
      repère   = nutrient_reference(sexe, âge, nutriment)
      si repère absent → état 'indisponible'   # §9, pas de barre à 0
      sinon → pourcentage = consommé / repère × 100
```

---

## 12. Contrat d'API

Toutes les routes sous `/api`, authentifiées par cookie de session, scopées au
`household_id` de la session. Erreurs au format `{ error: { code, message } }`.

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/login` | `{login, password}` → cookie de session |
| `POST` | `/api/auth/logout` | Invalide la session |
| `GET` | `/api/members` | Liste des membres actifs |
| `POST` | `/api/members` | Créer un membre |
| `PATCH` | `/api/members/:id` | Modifier (dont `portion_coef`) |
| `GET` | `/share?text=…` | **Share target.** Page, pas API. Parse et pré-remplit. |
| `POST` | `/api/recipes/resolve` | `{text}` → recette résolue (ou `confidence:'basse'`) |
| `POST` | `/api/meals` | Crée meal + participants + nutrition |
| `GET` | `/api/meals?from=&to=` | Repas sur une période, avec nutrition |
| `PATCH` | `/api/meals/:id` | Modifier (recalcule la nutrition, **pas** les shares) |
| `DELETE` | `/api/meals/:id` | Supprimer |
| `GET` | `/api/foods/search?q=` | Recherche plein texte française |
| `GET` | `/api/templates` | Templates triés par `use_count` |
| `POST` | `/api/templates` | Créer depuis un repas existant |
| `POST` | `/api/templates/:id/apply` | Applique → crée un repas |
| `GET` | `/api/dashboard?date=` | Bilan du jour, par membre, en % des repères |
| `GET` | `/api/insights/weekly?week=` | Synthèse hebdo (V3) |
| `POST` | `/api/notes` | Ajouter une `family_note` (V3) |

> **Routes ajoutées depuis** (13/09/2026), toutes sous la même session :
>
> | Méthode | Route | Pourquoi elle existe |
> |---|---|---|
> | `GET` | `/api/auth/session` | Une PWA qui ouvre sur un formulaire alors que la session est valide, c'est un tap perdu à chaque lancement. |
> | `GET` | `/api/meals/leftovers?days=` | La liste du bouton « Restes de… » (§6bis). |
> | `GET` | `/api/meals/:id` | Écran de détail. |
> | `GET` | `/api/recipes/:id` | Une recette et ses ingrédients, pour proposer de les rattacher au référentiel. |
> | `POST` | `/api/recipes/peek` | Ce qu'on tire d'un texte partagé **sans accès réseau**, pour afficher quelque chose tout de suite. |
> | `POST` | `/api/recipes/ingredients/:id/food` | Rattache un ingrédient Jow au référentiel, et propage à toutes les recettes qui l'emploient. |
> | `GET` | `/api/recipes/links` | Les correspondances déjà posées, pour les relire et les corriger. |
> | `POST` | `/api/foods` | Créer un aliment saisi à la main, sans aucune valeur déduite. |
> | `DELETE` | `/api/templates/:id` | |
> | `GET` | `/api/templates/suggestions` | V2 — « ce repas revient souvent, en faire un bouton ? » |
> | `GET` | `/api/week?from=&days=` | V2 — la grille 7 jours × membres. |
>
> **Ajoutées le 15/09/2026** :
>
> | Méthode | Route | Pourquoi elle existe |
> |---|---|---|
> | `POST` | `/api/meals/:id/image` | V3 — l'image d'un repas décrit avec l'IA (source `ia`), que l'écran de saisie demande sitôt le repas enregistré, sans l'attendre. Les mêmes ingrédients reprennent l'image du foyer ; sinon Gemini 3.1 Flash Lite Image la dessine depuis les aliments et la description, prénoms retirés. `409` pour un autre repas, même plafond que le découpage, `503` sans `GEMINI_API_KEY`. Migration 015, dette n° 21. |
> | `GET` | `/api/images/:id` | L'image elle-même, derrière la session et la RLS : elle dessine une description du foyer, elle ne se sert pas à un autre. |
>
> **Ajoutées le 14/09/2026** :
>
> | Méthode | Route | Pourquoi elle existe |
> |---|---|---|
> | `POST` | `/api/meals/decoupage` | V3 — un texte libre découpé en lignes rapprochées de Ciqual, **sans rien écrire** : l'écran enregistre ce que la personne garde. Deux appels au modèle par requête depuis le 14/09/2026 : le découpage, puis le choix de l'aliment, par numéro, parmi quinze candidats Ciqual par ligne. Dix appels par minute par compte, et par route, parce que chaque appel se paie. 503 sans clé API. |
> | `POST` | `/api/assistant` | V3 — une question sur les repas du foyer, avec la conversation en cours que l'écran renvoie (douze messages au plus). Rien n'est gardé. Même plafond et même 503 que le découpage. Encart du §14. *Précisé le 15/09/2026* : la réponse arrive en Server-Sent Events — des `texte` au fil de la génération, puis `fin`, qui porte la réponse entière et fait foi, ou `erreur` si le flux casse en route. Ce qui est refusé avant le flux (400, 429, 503) reste une erreur JSON. |
> | `POST` | `/api/assistant/recipes` | V3 — le bouton « Demander à l'assistant des recettes » de l'accueil, pour rendre la semaine plus équilibrée. Même résumé du foyer que `/api/assistant`, plus l'ordre des repères et la liste des recettes Jow du foyer : le modèle **choisit** par numéro parmi elles et ajoute une ou deux idées de plats marquées « à vérifier », sans jamais écrire une valeur (R1). Le texte envoyé revient dans la réponse, pour se relire à l'écran. `409` quand il n'aurait rien sur quoi s'appuyer ; même plafond et même 503 que le découpage. Ce qu'il approxime : dette n° 20. |
> | `GET` | `/api/recipes` | Les recettes que le foyer connaît, jamais mangées en tête. Elles étaient déjà toutes en base — `saveJowRecipe` écrit à la lecture du partage, avant l'enregistrement du repas — et aucun écran ne les montrait. Voir la 011 : une recette Jow est globale, c'est `household_recipe` qui dit qui la connaît. *Depuis le 25/09/2026, un repas décrit avec l'IA ou photographié y entre aussi : `createMeal` lui crée une recette `manuel` (titre reformulé, quantités par part) et l'y rattache — sinon « Mes recettes » ignorait tout ce qui ne venait pas de Jow. La recette est un instantané comme le snapshot Jow : le calcul nutritionnel l'ignore et lit les items du repas, et la rejouer sans composition reprend ses ingrédients remis à l'échelle.* |
>
> **Ajoutées le 13/09/2026 avec les comptes** (§7 renversé) :
>
> | Méthode | Route | Pourquoi elle existe |
> |---|---|---|
> | `GET` | `/api/me` | Les trois états d'authentification. Voir l'encart du §7. |
> | `GET` | `/api/household` | Le foyer courant, pour que l'écran de gestion se rafraîchisse sans recharger la session. |
> | `PATCH` | `/api/household` | Nom et fuseau, réservé au rôle `parent`. Le fuseau n'est pas un réglage d'affichage : il découpe les journées et les mois de saisonnalité **dans le SQL**, d'où une validation stricte plutôt qu'un texte libre. |
> | `GET` | `/api/invitations/:id/lien` | L'URL à transmettre. Sans SMTP, l'invitation est un lien qu'on copie. *Depuis le 14/09/2026, la réponse porte aussi `mailed` : sur une instance qui envoie des mails (encart du §7), l'invitation part aussi par là, et le parent doit savoir s'il lui reste à transmettre le lien.* |
>
> Tout le reste de la gestion — comptes, rôles, invitations, suppression du
> foyer — est servi par better-auth sous `/api/auth/organization/*` et n'a pas
> de route propre : la réécrire serait dupliquer des garde-fous déjà éprouvés,
> à commencer par les trois refus qui empêchent le dernier parent de se
> verrouiller dehors de son propre foyer.

> **Ajoutées le 14/09/2026 avec le lien convive ↔ compte** (migration 009) :
>
> | Méthode | Route | Pourquoi elle existe |
> |---|---|---|
> | `PUT` | `/api/eaters/:id/compte` | `{ self: true }` ou `{ email }`. Rattache la fiche à un compte, ou la lui **réserve** s'il n'est pas encore dans le foyer. Réservé au `parent`. La réponse porte `lié`, parce que « réservée » n'est pas « rattachée » et que l'interface doit dire lequel des deux. |
> | `DELETE` | `/api/eaters/:id/compte` | La fiche n'est plus à personne, et n'attend plus personne. La fiche elle-même reste. |
>
> `POST /api/eaters` accepte en outre `self: true` (« cette fiche est la
> mienne » — le seul geste qu'un non-parent puisse faire ici) et `claimEmail`
> (« réservée à cette adresse »), et `PATCH` accepte `weightKg` / `heightCm`
> pour un profil majeur. Deux conflits ont leur code : `compte_deja_convive`
> (409) et `adresse_deja_reservee` (409) — ce sont des situations d'interface,
> pas des erreurs internes.

**`POST /api/meals` — corps :**

```json
{
  "eaten_at": "2026-09-13T19:30:00+02:00",
  "slot": "diner",
  "source": "jow",
  "recipe_id": "uuid",
  "servings": 4,
  "items": [],
  "participants": [
    { "member_id": "uuid", "present": true },
    { "member_id": "uuid", "present": true }
  ]
}
```

Le client envoie `present`, **pas** `share` : le serveur calcule les shares
depuis les `portion_coef` courants (R2).

---

## 13. Écrans

| Écran | Contenu |
|---|---|
| **Aujourd'hui** (accueil) | Une carte par membre, les 5 barres en %, les repas du jour. Bouton d'ajout flottant. *Précisé le 14/09/2026 :* le bilan est ouvert d'office, pour une personne à la fois — les anneaux servent à la choisir. Barres horizontales sur une échelle commune (0 à 160 % du repère), statut en mots et en icône (à compléter, dans le repère, au-delà), et au plus deux phrases pour le foyer, qui ne nomment personne. Mise en page et sens des couleurs : `docs/proposition-accueil.html`. |
| **/share** | Intercepte le partage Jow. Affiche la recette, le nombre de parts, les cases « qui a mangé ». Deux taps pour valider. |
| **Ajout rapide** | Templates en premier (gros boutons), puis **« Restes de… »** (repas des 3 derniers jours avec recette), puis recherche texte, puis photo. |
| **Détail repas** | Composition, nutrition, participants, badge de confiance. Éditable. |
| **Semaine** | Grille 7 jours × membres. Tendances des 5 barres. *Précisé le 14/09/2026 :* seule la part végétale est tracée, un petit graphe par personne avec la moyenne des jours saisis. `/api/week` ne renvoie pas les quatre autres barres, et « dans le repère 5 jours sur 7 » serait un score (§14bis). |
| **Membres** | Fiches : âge, sexe, coefficient, régimes, préférences, allergènes. Depuis le 14/09/2026, l'état du rattachement à un compte (à personne / réservée à une adresse / rattachée), et le poids **des majeurs seulement**. |
| **/bienvenue** | *Ajouté le 14/09/2026.* Un foyer vide n'a rien à afficher et rien à enregistrer : un repas sans assiette n'a personne à qui être attribué. Deux temps — votre assiette, puis qui d'autre est à table, avec l'invitation préparée dans le même geste pour un adulte. Sautable pour qui a un compte sans manger ici. `/share` en est exclu : détourner cette navigation perdrait la recette partagée. |
| **/reinitialiser** | *Ajouté le 14/09/2026.* L'écran qu'ouvre le lien « mot de passe oublié » reçu par mail ; better-auth a vérifié le jeton avant d'y rediriger. Placé avant la porte d'authentification, puisqu'on y arrive par définition sans session. Utile seulement sur une instance qui envoie des mails (encart du §7) : ailleurs, l'écran de connexion dit à qui s'adresser. |
| **Présentation** (sans session) | *Ajoutée le 15/09/2026.* Ce que voit un visiteur non connecté, à la place du formulaire de connexion : ce que fait Tablée en trois temps, ce qu'elle refuse — calories à compter, scores, fiches confiées à une IA —, puis l'inscription. L'exemple montre un plat partagé entre des assiettes de tailles différentes, et **aucun bilan** : des barres d'exemple seraient des valeurs nutritionnelles sans source. La connexion passe sur `/connexion`, qu'une session ouverte renvoie à l'accueil. `/share` et `/invitation/…` y mènent directement, sans présentation : la traverser perdrait la recette ou l'invitation. |
| **Synthèse** (V3) | Texte hebdomadaire + notes famille. |
| **Conseils** (V3) | *Ajouté le 14/09/2026.* Une question, une réponse de l'assistant, et la conversation qui suit. Dit avant la première question ce qu'il ne sait pas — prénoms, allergies — et qu'il n'est pas un avis médical. Onglet absent sans clé API. La conversation s'efface en changeant d'onglet. *Précisé le 15/09/2026* : la réponse s'écrit au fil de sa génération ; si le flux casse en route, le début de réponse disparaît, la question revient dans le champ et l'erreur s'affiche. |

**Contraintes UI :**
- Enregistrer un repas Jow ≤ **3 taps** après le partage.
- Appliquer un template ≤ **2 taps** depuis l'accueil.
- Mobile d'abord. Cible : Android, PWA installée.
- Badge de confiance visible partout où une valeur est estimée (R6).
- Aucun objectif de calories ni de poids sur un profil mineur (I5).

---

## 14. Couche IA — trois étages séparés

### Étage 1 — Les faits → en base, pas dans le LLM

`member`, `member_preference`, `member_allergen`. Structuré, éditable, visible
dans l'UI. Le LLM lit, il ne stocke pas.

### Étage 2 — Les observations → du SQL, pas de l'IA

Déterministe, vérifiable, ne dérive jamais.

```sql
-- Jours depuis le dernier poisson
select current_date - max(m.eaten_at::date) as jours_sans_poisson
from meal m
join meal_item mi on mi.meal_id = m.id
join food f       on f.id = mi.food_id
where m.household_id = $1
  and f.category = 'poisson';

-- Répartition semaine / week-end de la part végétale
select case when extract(isodow from m.eaten_at) >= 6 then 'week-end'
            else 'semaine' end as periode,
       round(avg(mn.plant_ratio), 1) as part_vegetale_moy
from meal m
join meal_nutrition mn on mn.meal_id = m.id
where m.household_id = $1
  and m.eaten_at > now() - interval '30 days'
  and mn.plant_ratio is not null
group by 1;
```

### Étage 3 — Le narratif → là où le LLM sert vraiment

`family_note` : ce qui est dit en conversation, daté, rattaché à un membre.

**Contexte injecté = agrégats calculés + notes récentes + tranches d'âge.**
Jamais l'historique brut : trop long, trop cher, et le modèle se met à inventer
des tendances dans le bruit.

**Forme du prompt (conforme à I3) :**

```
Foyer de 4 personnes : 2 adultes, 1 enfant (6-9 ans), 1 adolescent (13-15 ans).
Régimes : 1 végétarien.
Semaine du 7 au 13 septembre :
- part végétale moyenne : 41 % (moyenne 4 semaines : 38 %)
- fibres : 68 % du repère en moyenne
- poisson : 0 occurrence depuis 12 jours
- légumes verts : 7 occurrences, dont 5 le week-end
Notes récentes : épinards testés et appréciés (03/09).
```

Pas de prénom, pas de date de naissance, pas d'allergène.

### Garde-fous de génération

- Synthèse **hebdomadaire** uniquement (I4).
- Ton : constat et suggestion, jamais reproche. Pas de vocabulaire de régime.
- Le LLM ne produit **aucun chiffre** : il commente ceux qu'on lui donne (R1).
- `facts_used` stocke ce qui a été injecté → une synthèse bizarre est traçable.

> **Ajouté le 14/09/2026 — l'assistant, avant la synthèse.** Un onglet
> « Conseils » où l'on pose une question sur les repas du foyer
> (`POST /api/assistant`, `server/llm/conseil.ts`). Il reçoit la forme de
> prompt ci-dessus, et rien d'autre : tranches d'âge, régimes, part végétale
> sur 7 et 28 jours, % du repère des protéines, glucides, lipides et fibres en
> **moyenne du foyer** — jamais par personne, ni l'énergie — et les libellés
> des plats de la semaine. Les prénoms du foyer sont retirés de tout ce qui
> part, question comprise (dette n° 17).
>
> Les garde-fous de la synthèse valent pour lui, adaptés à une conversation :
> il répond quand on lui demande, jamais après un repas (I4) ; aucun chiffre
> absent des faits, repères chiffrés compris (R1, I1) ; aucun jugement ; la
> saisie est dite incomplète pour qu'un pourcentage bas ne devienne pas un
> manque. **Rien n'est stocké** — ni conversation, ni réponse : une réponse
> relue plus tard se lirait comme un fait sur la famille (I2), et `facts_used`
> n'a de sens que pour une synthèse qu'on garde. Il ne connaît pas les
> allergies — elles ne sont saisies nulle part, et I3 les lui interdirait —
> et l'écran le dit.

---

## 14bis. Modules mémoire — V4

Ces modules transforment l'app d'outil en objet de famille. Ils supposent tous
de l'**historique** : un souvenir d'il y a un an n'existe qu'après un an, un
compteur de premières fois est absurde quand tout est une première fois. D'où
leur placement tardif.

| Module | Principe | Donnée |
|---|---|---|
| **Souvenirs** | « Il y a un an jour pour jour » | `meal` — gratuit |
| **Premières fois** | Un aliment qui apparaît pour la 1ʳᵉ fois dans l'historique du foyer | `meal_item` + `family_note` |
| **Diversité** | Compteur d'aliments distincts sur le mois, présenté comme une collection | `meal_item` distinct |
| **Qui a cuisiné** | Un champ de plus, et l'app raconte aussi qui s'est mis aux fourneaux | `meal.cooked_by` |

**Règle d'affichage :** ces cartes n'apparaissent **que quand elles ont quelque
chose à dire**. Jamais un emplacement fixe affichant « rien à signaler ».

### ⚠️ Ce qu'on n'implémente pas

**Ni séries, ni scores par personne.** Un « 12 jours d'affilée » ou un « 87/100 »
sur la fiche d'un enfant transforme les repas en performance. La gamification
peut porter sur la découverte et la variété — jamais sur la régularité ni sur la
note (voir I5).

C'est aussi pourquoi la diversité est un **compteur qui monte** et non un score :
on accumule, on ne juge personne.

---

## 15. Roadmap et critères d'acceptation

### Tâche 0 — Contrat Jow (§3) — **bloquant** — ✅ terminée le 13/09/2026
- [x] `docs/jow-contract.md` écrit, avec échantillon figé (8 recettes)
- [x] Script : texte partagé → JSON complet, sur 5 recettes différentes
      (`npm run jow:resolve`)
- [x] Structure inattendue → `confidence='basse'`, pas de crash
- [x] Test de non-régression vert (`npm test`)

### V1 — Aucune IA
- [x] Schéma migré, seed Ciqual chargé (`food` non vide)
- [x] `nutrient_reference` rempli, `source` renseigné partout — fibres recopiées
      de l'ANSES, trois autres macros dérivées ; voir l'encart du §9
- [x] Login foyer, session persistante
- [x] CRUD membres avec `portion_coef`
- [x] Share target : partage Jow → repas enregistré en ≤ 3 taps
- [x] Saisie texte avec recherche `food`
- [x] Les 5 créneaux disponibles
- [x] **Templates** : créer depuis un repas, appliquer en ≤ 2 taps
- [x] Bouton « Restes de… » : repas des 3 derniers jours, re-log en ≤ 2 taps
- [x] Champ invités sur l'écran de saisie
- [x] Accueil : 5 barres en % par membre
- [ ] `seasonal_produce` saisie — **reste à faire.** La bande est écrite et
      testée ; elle ne s'affiche pas tant que la table est vide. Gabarit dans
      `db/seeds/seasonal-produce.csv`
- [x] Badge « N produits de saison » sur les cartes de repas Jow
- [x] Identité visuelle appliquée (§8ter) : terracotta chrome, fond crème, palette nutriments sur les données uniquement
- [x] **Test** : Σ des `share` d'un repas = 1 (sans invité)
- [x] **Test** : avec 2 invités, Σ des `share` < 1 et les assiettes du foyer ne gonflent pas
- [x] **Test** : modifier un `portion_coef` ne change aucun repas passé
- [x] **Test** : tranche d'âge sans repère → « indisponible », pas 0

> **Objectif du jalon :** savoir si la famille logue encore trois semaines plus
> tard. Si non, tout le reste était du travail perdu. Ne pas enchaîner sur V2
> avant d'avoir la réponse.

> **État au 13/09/2026 :** V1 et V2 sont écrites et testées (176 tests). Il
> reste deux collectes de données avant un usage réel — `seasonal_produce` et
> `unit_default` — et une vérification que rien ne remplace : **installer la
> PWA sur un téléphone**. Le share target est le chemin critique du produit et
> n'a jamais tourné ailleurs que dans un Chromium de test (dette n° 4).

### V2 — Le confort
- [x] Historique, favoris, récents
- [x] Vue semaine
- [x] Édition d'un repas passé
- [x] Suggestion automatique de template quand un même repas revient 3 fois

> **Objectif :** passer de « on a testé » à « on l'utilise ».

### V3 — L'IA
- [x] Parsing texte libre par LLM, avec validation utilisateur — 14/09/2026,
      encart du §5
- [ ] Synthèse hebdomadaire + `facts_used`
- [ ] `family_note` (saisie et relecture)
- [x] Photo en fallback — 17/09/2026, source `photo`, photo non conservée, couverture
      redessinée par l'IA (dette n° 23)
- [ ] **Revue manuelle** : 4 synthèses successives relues — aucun jugement sur
      personne, aucun chiffre inventé

**L'ordre compte.** La tentation sera de commencer par l'IA. Un assistant
diététicien branché sur trois repas mal saisis ne produit que des banalités.

> **Commencée le 14/09/2026 par le texte libre, et par lui seul.** C'est la
> seule case de la V3 qui ne demande aucun historique : elle attaque la
> friction de saisie — le vrai risque du projet — au lieu de commenter des
> repas qui n'existent pas encore. Un conseiller sans données a été discuté et
> écarté pour la même raison que ci-dessus. La synthèse hebdomadaire et
> `family_note` attendent trois à quatre semaines de repas réels : sans elles,
> la revue manuelle des quatre synthèses n'aurait rien à relire.
>
> ⚠️ **Renversé le même jour pour le conseiller.** Le propriétaire du projet a
> demandé l'assistant sans attendre l'historique : il répond à partir de la
> semaine telle qu'elle est saisie, et sa consigne lui dit qu'elle est
> incomplète. Encart du §14. La phrase au-dessus reste vraie pour la synthèse
> hebdomadaire et `family_note`, qui attendent toujours leurs semaines.

### V4 — Modules mémoire (§14bis)
- [ ] Souvenirs « il y a un an »
- [ ] Premières fois
- [ ] Compteur de diversité mensuelle
- [ ] `meal.cooked_by`
- [ ] **Revue** : aucune série, aucun score par personne dans l'interface

> **Prérequis :** au moins un an d'historique pour les souvenirs, quelques mois
> pour le reste.

---

## 16. Stack et déploiement

> ⚠️ **L'app sort du foyer — décidé le 13/09/2026.** Cette section prévenait :
> *« si l'app sort un jour du foyer, ce n'est pas un changement d'échelle mais
> de nature […] À décider avant, jamais après. »* C'est décidé, et avant.
>
> **Plusieurs foyers sur une instance, étanches entre eux, y compris vis-à-vis
> de l'hébergeur.**
>
> ### Ce que l'étanchéité garantit, et ce qu'elle ne garantit pas
>
> **Garanti** — aucun chemin par l'application ne laisse un foyer en lire un
> autre. Pas de mode administrateur, pas de vue globale. Deux verrous plutôt
> qu'un :
>
> 1. le scoping applicatif, qui existe déjà (`household_id` est sur toutes les
>    tables de premier niveau depuis `001_init.sql`) ;
> 2. **Row-Level Security Postgres** — posée le 13/09/2026 par la migration
>    008. Jusque-là l'isolation tenait par discipline : `delete from meal_item
>    where meal_id = $1` est correct parce que l'appelant a vérifié avant. Chez
>    soi, un oubli est un bug ; avec les enfants des autres dans la table, un
>    oubli est une fuite. La base refuse désormais d'elle-même.
>
> ⚠️ **Le rôle Postgres de l'application ne doit pas être superutilisateur.**
> Un superutilisateur contourne la RLS *en silence* — les policies existent,
> `\d` les affiche, et rien ne filtre. C'est arrivé pendant l'écriture de la
> 008 : 178 tests au vert avec une isolation entièrement décorative. Le serveur
> refuse maintenant de démarrer dans cet état (`assertIsolation`), et un test
> vérifie que la RLS est effective et pas seulement déclarée — sans lui, tous
> les autres tests d'étanchéité peuvent passer sans rien prouver.
>
> `household` reste hors RLS, délibérément : c'est la table qui *détermine* le
> foyer courant, une policy dessus rendrait la connexion impossible. Elle n'est
> lue que par une jointure obligatoire sur l'appartenance, ce qui est plus fort
> qu'un filtre qu'on peut oublier.
>
> **Non garanti, et dit tel quel aux familles invitées** — l'hébergeur a le
> root et le mot de passe postgres. Aucune policy applicative n'arrête le
> propriétaire de la machine.
>
> La version forte — chiffrer chaque foyer avec une clé dérivée du mot de passe
> de ses membres — a été **écartée le 13/09/2026** en connaissance de son prix :
> elle tue la V3 (synthèse calculée côté serveur), tue la récupération de mot
> de passe (oubli = perte définitive), et remonte le calcul nutritionnel dans
> le navigateur. C'est un autre produit.
>
> ### Ce que ça change au partitionnement des tables
>
> | Portée | Tables |
> |---|---|
> | Globale | `food`, `nutrient_reference`, `energy_reference`, `unit_default`, `seasonal_produce` — référentiel public |
> | Globale | Recettes **Jow** : donnée publique, dédupliquée entre foyers |
> | **Par foyer** | Recettes **manuelles** — `recipe.household_id`, ajouté par la 007. Sans lui, « Blanquette de mamie Jeanne » aurait été visible par tous les foyers. Une contrainte interdit qu'une recette Jow soit scopée ou qu'une recette manuelle soit globale. |
> | À trancher | `jow_food_link` — le rattachement manuel ingrédient → Ciqual. Le partager mutualise un vrai travail et ne révèle qu'une correspondance de libellés, mais ça se décide exprès. |
>
> ### Ce que ça fait de l'hébergeur
>
> Tant que c'était une famille sur sa propre machine, l'exemption « activité
> strictement personnelle ou domestique » du RGPD s'appliquait. Héberger les
> données d'autres familles — **dont leurs enfants** — en fait un responsable
> de traitement. Trois conséquences dans le produit, pas dans un document :
>
> 1. **Supprimer un foyer et tout son contenu**, à la demande. Les
>    `on delete cascade` sont là, le bouton manque.
> 2. **Dire ce qui est stocké**, en une page lisible.
> 3. **Les sauvegardes.** Un dump contient désormais les enfants des autres.
>    `CLAUDE.md` interdit déjà les dumps dans le dépôt ; sur la machine, la
>    question est neuve.


| Couche | Choix |
|---|---|
| Front | Vite + React + TypeScript, PWA |
| Back | Node — Fastify ou Hono |
| Base | PostgreSQL 16+ |
| Migrations | Fichiers SQL numérotés, versionnés |
| Reverse proxy | Caddy — HTTPS obligatoire pour le share target |
| Hébergement | Proxmox local |
| LLM | Appelé côté serveur uniquement (R4) |

**Périmètre de données :** tout reste sur le réseau du foyer. Seuls des libellés
d'aliments et des agrégats anonymisés sortent, vers le LLM (R5).

> **Précisé le 14/09/2026 — ce qui sort avec le mail.** Sur une instance qui
> envoie des mails (`TABLEE_MAIL`, encart du §7), le transporteur — Resend, ou
> le relais SMTP choisi par l'hébergeur — reçoit à chaque envoi l'adresse du
> destinataire et un lien qui porte un jeton ; pour une invitation, en plus, le
> prénom du compte qui invite et le nom du foyer. **Aucune donnée de convive**
> ne part : ni enfant, ni âge, ni allergène, ni repas.
>
> Le prénom et le nom du foyer sont gardés **exprès** : une invitation qui ne
> dit pas qui invite ressemble à du hameçonnage et reste sans réponse. Sans
> `TABLEE_MAIL`, rien de tout ça ne sort. Avec, le transporteur est un tiers de
> plus à nommer dans « dire ce qui est stocké » (point 2 ci-dessus).

> **Précisé le 14/09/2026 — ce qui passe par Google.** Sur une instance qui
> propose la connexion Google (encart du §7), Google apprend qu'un de ses
> comptes se connecte à cette instance, et Tablée reçoit de Google l'adresse,
> le nom et l'URL de la photo du compte. **Rien ne part vers Google** : ni
> convive, ni repas, ni foyer. Sans `GOOGLE_CLIENT_ID`, rien de tout ça.

**Si l'app sort un jour du foyer**, ce n'est pas un changement d'échelle mais de
nature : données de santé de mineurs, hébergement adapté, consentement parental,
multi-tenant, auth individuelle. À décider avant, jamais après.

---

## 17. Non tranché — demander, ne pas décider

1. ~~**Valeurs de `nutrient_reference`**~~ — **levé le 13/09/2026, en partie.**
   Les fibres sont recopiées de l'ANSES ; protéines, lipides et glucides sont
   dérivés d'intervalles en % de l'AET, faute d'être publiés en grammes. Voir
   l'encart du §9. Restent découverts : les 0-3 ans, et les tranches prolongées
   au-delà de 69/59 ans (dette n° 1).
2. **Valeurs de `unit_default`** — §6. Chaque ligne exige une `source`. Les
   sept unités effectivement utilisées par Jow sont inventoriées au §4 de
   `docs/jow-contract.md`.
3. **Contenu de `seasonal_produce`** — §8bis. Environ 40 produits × leurs mois,
   à saisir à la main pour la France. Pas de source automatisable identifiée.
4. ~~**Base des valeurs nutritionnelles des pages ingrédients Jow**~~ — **levé
   le 13/09/2026.** Les valeurs se rapportent à `averageEstimatedValues`, pas
   systématiquement à 100 g. Elles restent inexploitées, pour une raison
   désormais connue : arrondies à l'entier et mutuellement incohérentes. Voir
   le §5 de `docs/jow-contract.md`.

Les points 2 et 3 restent des **collectes de données**, pas des arbitrages : la
source existe, il faut aller la chercher. Ne rien inventer à la place (I1).
Leurs gabarits commentés sont dans `db/seeds/`.

### Décidé depuis la v2

- **Nom de l'app** → **Tablée**. Le manifeste du §4 est aligné.
- **Structure de `__NEXT_DATA__`** → établie, `docs/jow-contract.md` (Tâche 0)
- **Restes** → 2ᵉ `meal` pointant la même recette (§6bis)
- **Invités** → `meal.guest_count` (§6bis)
- **Périmètre V1** → les cinq créneaux, templates livrés en V1 (§6bis)
- **Micronutriments** → hors V1. Fer, calcium et consorts sont disponibles via
  Ciqual mais doublent le travail d'ETL pour un affichage que personne ne
  consulte au démarrage. À rouvrir en V3.
- **Auth** → compte foyer unique (§7)
- **5ᵉ barre** → Végétal (§8)
- **Saisonnalité** → en V1, deux emplacements (§8bis)
- **Identité visuelle** → terracotta chrome + palette nutriments sur données seules (§8ter)
- **Modules mémoire** → V4, sans séries ni scores (§14bis)
