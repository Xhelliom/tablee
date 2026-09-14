-- 010 — ce qui a été importé dans le référentiel, et depuis quelle source.
--
-- ── Pourquoi ce fichier existe ──────────────────────────────────────────────
--
-- Jusqu'ici, charger la table Ciqual était un geste d'opérateur : télécharger
-- 3,5 Mo chez l'ANSES, les décompresser dans un conteneur, lancer le seed. Un
-- geste qui se fait une fois, qu'on oublie d'avoir fait, et dont rien ne dit
-- s'il a eu lieu — une instance fraîche servait donc une recherche d'aliments
-- vide sans que personne sache pourquoi.
--
-- Le seed sait maintenant se télécharger tout seul et tourne à chaque
-- déploiement. Pour que ce soit tenable, il faut qu'il puisse répondre à
-- « est-ce déjà fait ? » **sans** relire 57 Mo de XML : c'est tout l'objet de
-- cette table. Une ligne, lue en une requête, qui évite un import de trente
-- secondes à chaque redémarrage de pod.
--
-- ── Ce que dit chaque colonne ───────────────────────────────────────────────
--
-- `version` et `sha256` viennent de `db/seeds/ciqual-source.json`, le fichier
-- versionné qui épingle l'archive de l'ANSES. `etl` est notre propre lecture
-- de cette archive : l'incrémenter réimporte sans changer de source, ce qu'il
-- faut faire quand le classement des groupes change. Les trois ensemble
-- décident de rejouer ou non.
--
-- ── Hors RLS, comme `food` ──────────────────────────────────────────────────
--
-- Cette table ne décrit aucun foyer : elle décrit le référentiel public, que
-- toutes les instances lisent (voir l'en-tête de la 008). Elle n'est écrite
-- que par un script de seed, jamais par une route.

create table referential_import (
  source      text primary key,
  version     text        not null,
  sha256      text        not null,
  etl         integer     not null,
  row_count   integer     not null,
  imported_at timestamptz not null default now()
);

comment on table referential_import is
  'Trace du dernier import d''un référentiel public (Ciqual). Sert à ne pas '
  'réimporter à chaque démarrage, et à dire dans l''app depuis quand les '
  'aliments sont là.';

comment on column referential_import.version is
  'Version de la source amont — pour Ciqual, la date de publication ANSES.';

comment on column referential_import.sha256 is
  'Empreinte de l''archive effectivement importée, épinglée dans '
  'db/seeds/ciqual-source.json. « local » quand les fichiers ont été posés à '
  'la main : on ne peut alors rien promettre sur leur provenance.';

comment on column referential_import.etl is
  'Version de notre lecture de l''archive (colonnes retenues, classement des '
  'groupes). Incrémentée à la main quand le mapping change.';
