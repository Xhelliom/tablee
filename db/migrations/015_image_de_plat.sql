-- 015 — l'image d'un plat saisi avec l'IA (15/09/2026, à la demande du
-- propriétaire).
--
-- Un repas découpé par l'IA n'a pas de recette, donc pas de photo Jow : sa
-- carte restait un bol dessiné. Le serveur fait dessiner le plat par un modèle
-- d'image, et le garde ici. Ce qui part, et pourquoi ce modèle : en-tête de
-- `server/llm/image.ts`.
--
-- ── Une image par ensemble d'ingrédients ────────────────────────────────────
--
-- `tag` est l'empreinte des ingrédients, sans ordre ni doublon : les mêmes
-- ingrédients reprennent l'image déjà payée au lieu d'en redessiner une.
--
-- ── Par foyer, et pas mutualisée comme une recette Jow ──────────────────────
--
-- L'image dessine aussi la description tapée par le foyer. Celle d'un foyer
-- n'a rien à faire sur la carte du voisin (§16), même à ingrédients égaux.
--
-- ── En base, et pas sur un disque ───────────────────────────────────────────
--
-- Rien à monter dans le cluster, et les sauvegardes de la base la couvrent.
-- Quelques centaines de Ko par image, une par plat distinct : le volume reste
-- celui d'un foyer.

create table dish_image (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references household(id) on delete cascade,
  tag          text        not null,
  mime_type    text        not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes        bytea       not null,
  created_at   timestamptz not null default now(),
  unique (household_id, tag)
);

comment on column dish_image.tag is
  'Empreinte des ingrédients (aliment Ciqual, sinon libellé), sans ordre ni '
  'doublon. La description n''y entre pas : elle change, le plat non.';

-- `set null` : supprimer une image rend au repas son bol dessiné, rien de plus.
alter table meal
  add column image_id uuid references dish_image(id) on delete set null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Table du domaine, scopée comme les autres (008), `force` compris.

alter table dish_image enable row level security;
alter table dish_image force  row level security;

create policy dish_image_foyer on dish_image
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());
