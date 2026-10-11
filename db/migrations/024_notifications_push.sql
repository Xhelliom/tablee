-- 024 — les rappels « Aujourd'hui, lequel ? » par notification push (10/2026).
--
-- `push_subscription` : un appareil abonné. L'`endpoint` est l'adresse que le
-- service push du navigateur nous donne ; il identifie l'appareil et ne se
-- partage pas entre comptes, d'où l'unicité. `p256dh` et `auth` sont les clés
-- **publiques** de chiffrement du message, pas un secret du serveur.
--
-- `reminder_sent` : « ce foyer a déjà été prévenu pour ce créneau, ce jour ».
-- La clé primaire est le verrou — l'insertion qui réussit envoie, l'autre
-- constate qu'un tour précédent (ou un second processus) s'en est chargé.
-- Une relance après redémarrage du serveur ne double donc jamais le message.
create table push_subscription (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references household(id) on delete cascade,
  user_id      text        not null references "user"(id)    on delete cascade,
  endpoint     text        not null unique,
  p256dh       text        not null,
  auth         text        not null,
  created_at   timestamptz not null default now()
);
create index on push_subscription (household_id);

create table reminder_sent (
  household_id uuid not null references household(id) on delete cascade,
  day          date not null,
  slot         text not null check (slot in ('midi', 'soir')),
  primary key (household_id, day, slot)
);

alter table push_subscription enable row level security;
alter table push_subscription force  row level security;
create policy push_subscription_foyer on push_subscription
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());

alter table reminder_sent enable row level security;
alter table reminder_sent force  row level security;
create policy reminder_sent_foyer on reminder_sent
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());
