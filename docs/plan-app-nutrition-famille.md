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

**Le point critique est dans l'UI, pas dans le modèle.** L'écran d'ajout doit
proposer un bouton **« Restes de… »** listant les repas des 3 derniers jours
ayant une `recipe_id` : un tap, on choisit qui mange, c'est enregistré. Sans
cette affordance, les restes ne seront jamais saisis et les déjeuners
resteront vides.

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

## 7. Authentification — **décidé**

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
| **Aujourd'hui** (accueil) | Une carte par membre, les 5 barres en %, les repas du jour. Bouton d'ajout flottant. |
| **/share** | Intercepte le partage Jow. Affiche la recette, le nombre de parts, les cases « qui a mangé ». Deux taps pour valider. |
| **Ajout rapide** | Templates en premier (gros boutons), puis **« Restes de… »** (repas des 3 derniers jours avec recette), puis recherche texte, puis photo. |
| **Détail repas** | Composition, nutrition, participants, badge de confiance. Éditable. |
| **Semaine** | Grille 7 jours × membres. Tendances des 5 barres. |
| **Membres** | Fiches : âge, sexe, coefficient, régimes, préférences, allergènes. |
| **Synthèse** (V3) | Texte hebdomadaire + notes famille. |

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
- [ ] Schéma migré, seed Ciqual chargé (`food` non vide)
- [ ] `nutrient_reference` rempli depuis l'ANSES, `source` renseigné partout
- [ ] Login foyer, session persistante
- [ ] CRUD membres avec `portion_coef`
- [ ] Share target : partage Jow → repas enregistré en ≤ 3 taps
- [ ] Saisie texte avec recherche `food`
- [ ] Les 5 créneaux disponibles
- [ ] **Templates** : créer depuis un repas, appliquer en ≤ 2 taps
- [ ] Bouton « Restes de… » : repas des 3 derniers jours, re-log en ≤ 2 taps
- [ ] Champ invités sur l'écran de saisie
- [ ] Accueil : 5 barres en % par membre
- [ ] `seasonal_produce` saisie ; bande « De saison en <mois> » en haut de l'accueil
- [ ] Badge « N produits de saison » sur les cartes de repas Jow
- [ ] Identité visuelle appliquée (§8ter) : terracotta chrome, fond crème, palette nutriments sur les données uniquement
- [ ] **Test** : Σ des `share` d'un repas = 1 (sans invité)
- [ ] **Test** : avec 2 invités, Σ des `share` < 1 et les assiettes du foyer ne gonflent pas
- [ ] **Test** : modifier un `portion_coef` ne change aucun repas passé
- [ ] **Test** : tranche d'âge sans repère → « indisponible », pas 0

> **Objectif du jalon :** savoir si la famille logue encore trois semaines plus
> tard. Si non, tout le reste était du travail perdu. Ne pas enchaîner sur V2
> avant d'avoir la réponse.

### V2 — Le confort
- [ ] Historique, favoris, récents
- [ ] Vue semaine
- [ ] Édition d'un repas passé
- [ ] Suggestion automatique de template quand un même repas revient 3 fois

> **Objectif :** passer de « on a testé » à « on l'utilise ».

### V3 — L'IA
- [ ] Parsing texte libre par LLM, avec validation utilisateur
- [ ] Synthèse hebdomadaire + `facts_used`
- [ ] `family_note` (saisie et relecture)
- [ ] Photo en fallback
- [ ] **Revue manuelle** : 4 synthèses successives relues — aucun jugement sur
      personne, aucun chiffre inventé

**L'ordre compte.** La tentation sera de commencer par l'IA. Un assistant
diététicien branché sur trois repas mal saisis ne produit que des banalités.

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

**Si l'app sort un jour du foyer**, ce n'est pas un changement d'échelle mais de
nature : données de santé de mineurs, hébergement adapté, consentement parental,
multi-tenant, auth individuelle. À décider avant, jamais après.

---

## 17. Non tranché — demander, ne pas décider

1. **Valeurs de `nutrient_reference`** — §9. À sourcer auprès de l'ANSES.
2. **Valeurs de `unit_default`** — §6. Chaque ligne exige une `source`. Les
   sept unités effectivement utilisées par Jow sont inventoriées au §4 de
   `docs/jow-contract.md`.
3. **Contenu de `seasonal_produce`** — §8bis. Environ 40 produits × leurs mois,
   à saisir à la main pour la France. Pas de source automatisable identifiée.
4. **Base des valeurs nutritionnelles des pages ingrédients Jow** — non
   documentée dans le payload. Le §5 suppose « /100 g » ; ce n'est pas établi.
   À confirmer avant d'exploiter ces pages (§5 de `docs/jow-contract.md`).

Les points 1 à 3 sont des **collectes de données**, pas des arbitrages : la
source existe, il faut aller la chercher. Ne rien inventer à la place (I1).

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
