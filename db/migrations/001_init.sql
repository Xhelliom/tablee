-- 001_init.sql — schéma initial de Tablée.
-- Transcription du §10 de docs/plan-app-nutrition-famille.md, qui fait autorité.
-- Une fois appliqué, ce fichier n'est plus modifié : toute évolution passe par
-- une migration numérotée suivante.

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

-- Unités de repli (§6). Livrée VIDE : chaque ligne exige une source, et une
-- équivalence inventée est une valeur nutritionnelle fausse (I1). Tant qu'une
-- unité est absente, la résolution demande à l'utilisateur.
create table unit_default (
  unit    text primary key,
  grams   numeric(8,2) not null,
  source  text not null
);

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

create index on recipe_ingredient (recipe_id);

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

create index on meal_item (meal_id);

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

-- I1 s'applique ici en priorité : un repère inventé produit un conseil faux
-- destiné à un enfant. Une tranche d'âge non couverte par la source reste
-- absente, et l'UI affiche « repère indisponible » — jamais une barre à 0.
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
