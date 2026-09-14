-- 009 — Rattacher une assiette à un compte, sans les refusionner.
--
-- ── Ce que la 007 a séparé, et pourquoi il faut quand même un lien ──────────
--
-- La 007 a scindé `member` en deux : `eater`, une assiette, et `"user"`, un
-- compte. La séparation est juste et ne bouge pas — les enfants sont des
-- convives sans compte, une nounou un compte sans convive.
--
-- Il manquait pourtant le cas le plus courant du foyer : **les deux à la
-- fois**. Un parent a une assiette *et* un compte, et rien ne disait laquelle
-- est la sienne. Conséquences observées à la mise en service :
--
--   - à l'inscription, on crée un compte et l'app est vide. Il faut ensuite
--     penser à se créer une assiette, ce que personne ne fait ;
--   - un conjoint saisi à la main aujourd'hui, qui s'inscrit dans trois
--     semaines, se retrouve avec une assiette d'un côté et un compte de
--     l'autre, sans que rien ne les rejoigne ;
--   - un `adulte` ne peut pas modifier « sa » fiche, faute de savoir laquelle.
--
-- D'où **un lien facultatif**, et rien de plus :
--
--   `eater.user_id`     le compte de ce convive, quand il en a un. NULL pour
--                       les enfants, et c'est l'état normal, pas un manque.
--   `eater.claim_email` l'adresse à qui l'assiette est réservée, en attendant
--                       que cette personne s'inscrive. Effacée au rattachement.
--
-- ⚠️ **Ce n'est pas la refusion que la 007 répare.** Les deux tables restent
-- distinctes, la cardinalité est 0..1 des deux côtés, et rien dans le domaine
-- ne dérive « qui a agi » d'un convive : `meal.created_by` et
-- `jow_food_link.confirmed_by` continuent de pointer vers `"user"`. Le lien
-- ajoute une information — *cette assiette-ci est la vôtre* — il n'en retire
-- aucune.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Le lien
-- ───────────────────────────────────────────────────────────────────────────

alter table eater
  add column user_id     text references "user" ("id") on delete set null,
  add column claim_email text;

comment on column eater.user_id is
  'Le compte de ce convive, s''il en a un. NULL est l''état normal : un enfant '
  'est à table sans compte. `on delete set null` — un compte supprimé ne '
  'supprime pas l''assiette : la personne a mangé.';

comment on column eater.claim_email is
  'L''adresse à qui cette assiette est réservée, tant que personne ne l''a '
  'réclamée. Effacée au rattachement — elle n''a plus rien à dire une fois que '
  '`user_id` est posé.';

-- Un compte a **au plus une** assiette par foyer. Il peut en avoir une dans
-- deux foyers différents (un grand-parent qui mange chez ses deux enfants) :
-- l'unicité est donc par foyer, pas globale.
create unique index eater_un_compte_par_foyer
  on eater (household_id, user_id)
  where user_id is not null;

-- Deux assiettes réservées à la même adresse dans un même foyer rendraient le
-- rattachement ambigu — et un rattachement ambigu se résout au hasard.
create unique index eater_une_reservation_par_adresse
  on eater (household_id, lower(claim_email))
  where claim_email is not null;

-- Une réservation qui a été honorée n'a plus de sens : soit l'assiette attend
-- quelqu'un, soit elle a son compte.
alter table eater add constraint eater_reservation_ou_compte
  check (user_id is null or claim_email is null);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Poids et taille — **majeurs uniquement**, et la base ne peut pas le dire
-- ───────────────────────────────────────────────────────────────────────────
--
-- Le §10 refusait le poids, et la 005 le redit : « donnée que le §10 ne stocke
-- volontairement pas ». Décision revue le 14/09/2026, avec une portée
-- strictement réduite — demandée à la mise en service, et arbitrée à trois
-- conditions :
--
--   1. **Jamais sur un profil mineur.** I5 interdit tout objectif chiffré de
--      poids sur la fiche d'un enfant, et une valeur qu'on stocke finit par
--      s'afficher. Les colonnes ci-dessous ne sont donc renseignables que pour
--      un majeur — et par lui ou par un parent.
--   2. **Jamais une cible.** Aucune barre, aucune série, aucun écart à un poids
--      « idéal ». C'est une mesure, pas un objectif, et le vocabulaire produit
--      parle qualité et variété (§8ter).
--   3. **Une mesure porte sa date.** Un poids sans date dérive en silence :
--      `weight_recorded_at` est posé par le serveur à chaque écriture, et
--      l'interface affiche « pesé le … » plutôt qu'un nombre hors du temps.
--
-- ⚠️ **La condition 1 n'est pas dans la base, et ne peut pas y être.** L'âge se
-- dérive de `birth_date` et de la date du jour ; un `check` l'utilisant serait
-- non-immutable, donc refusé par Postgres — et de toute façon faux le
-- lendemain de l'anniversaire. C'est `server/routes/eaters.ts` qui refuse, et
-- un test qui le vérifie. Le savoir compte : un script qui écrirait
-- directement en base contournerait la règle sans que rien ne bronche.
--
-- À quoi ça sert : la RNP des protéines de l'ANSES s'exprime **par kilogramme
-- de poids corporel** (0,83 g/kg/j chez l'adulte), la seule chose qui manquait
-- pour en dériver une cible en grammes plutôt qu'un intervalle en % de l'AET.
-- Ce calcul n'est **pas** fait ici : le contenu de `nutrient_reference` ne se
-- décide pas seul (CLAUDE.md), et une ligne dérivée exige sa chaîne de sources.
-- Les colonnes existent, elles sont lues par personne, et c'est volontaire.

alter table eater
  add column weight_kg          numeric(5,2)
      check (weight_kg is null or (weight_kg > 0 and weight_kg <= 400)),
  add column weight_recorded_at timestamptz,
  add column height_cm          numeric(5,1)
      check (height_cm is null or (height_cm > 30 and height_cm <= 260));

comment on column eater.weight_kg is
  'Majeurs uniquement (refusé en applicatif — un check l''âge serait non '
  'immutable). Mesure, jamais objectif : aucune cible, aucune série, jamais '
  'affiché sur un profil mineur (I5).';

comment on column eater.weight_recorded_at is
  'Quand ce poids a été saisi. Posé par le serveur. Un poids sans date dérive.';
