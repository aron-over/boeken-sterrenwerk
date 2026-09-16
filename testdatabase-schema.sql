-- Schema voor het losse Supabase-testproject van Boeken Sterrenwerk.
-- Spiegelt de structuur van de productiedatabase (zie CLAUDE.md).
-- Uitvoeren op het TESTPROJECT, nooit op productie.

create extension if not exists pgcrypto;

create table if not exists boeken (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  auteur text,
  isbn text,
  prijs numeric,
  categorie text check (categorie in ('Groep', 'Jeelo', 'Overig', 'Kleuters')),
  groep text,
  jeelo_thema text,
  overig_thema text,
  kleuters_thema text,
  klas_of_kast text,
  aantal integer default 1,
  besteld boolean default false,
  opmerking text,
  naam_aanvrager text,
  status text default 'aangevraagd' check (status in ('aangevraagd', 'besteld', 'binnen', 'afgewezen')),
  besteld_op timestamptz,
  binnen_op timestamptz,
  boekentip text
);

create table if not exists instellingen (
  id uuid primary key default gen_random_uuid(),
  jaarbudget numeric
);

alter table boeken enable row level security;
alter table instellingen enable row level security;

-- De site werkt volledig client-side met de anon key, zonder login
-- (het coördinator-wachtwoord is alleen een UI-drempel, geen echte auth).
-- Daarom mag de anon-rol hier alles: lezen/schrijven voor leraren en coördinator.
create policy "anon volledige toegang boeken" on boeken
  for all to anon using (true) with check (true);

create policy "anon volledige toegang instellingen" on instellingen
  for all to anon using (true) with check (true);
