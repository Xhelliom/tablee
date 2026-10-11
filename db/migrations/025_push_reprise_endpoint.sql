-- 025 — un appareil qui change de foyer peut se réabonner (10/2026).
--
-- `push_subscription.endpoint` est unique sur toute l'instance, et la RLS de
-- la 024 cache la ligne d'un autre foyer : le réabonnement d'un appareil passé
-- d'un foyer à l'autre heurtait donc une ligne invisible, et l'`on conflict do
-- update` levait (500).
--
-- Ces policies n'ouvrent qu'une porte : une ligne se voit et se supprime hors
-- du foyer courant **si on nomme son endpoint**, posé dans `app.push_endpoint`
-- le temps d'une transaction (`subscribe`, `server/repo/push.ts`, seul à le
-- poser). L'endpoint est l'adresse secrète que le service push a donnée à cet
-- appareil ; qui la présente tient l'appareil.
--
-- Deux policies et pas une : un `delete … where endpoint = $1` lit la colonne,
-- et Postgres lui applique alors aussi les policies `select`. Avec la seule
-- policy `delete`, la ligne restait invisible et rien n'était supprimé. Ce que
-- la lecture découvre — le foyer et le compte de l'ancien abonné — ne sort pas
-- de `subscribe`, qui ne la lit pas ; aucune `update` n'est ouverte.
--
-- Une `security definer` n'aurait pas suffi : l'application est propriétaire
-- des tables, et `force row level security` (008) s'applique au propriétaire.
create policy push_subscription_reprise on push_subscription for delete
  using (endpoint = nullif(current_setting('app.push_endpoint', true), ''));
create policy push_subscription_reprise_lue on push_subscription for select
  using (endpoint = nullif(current_setting('app.push_endpoint', true), ''));
