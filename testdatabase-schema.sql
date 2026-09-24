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

create table if not exists scan_wachtrij (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  isbn text,
  titel text,
  auteur text,
  prijs numeric,
  categorie text,
  groep text,
  jeelo_thema text,
  overig_thema text,
  kleuters_thema text,
  opmerking text,
  cover_url text,
  status text default 'binnen',
  gescand_door text default 'Mobiel'
);

alter table boeken enable row level security;
alter table instellingen enable row level security;
alter table scan_wachtrij enable row level security;

-- De site werkt volledig client-side met de anon key, zonder login
-- (het coördinator-wachtwoord is alleen een UI-drempel, geen echte auth).
-- LET OP: dit zijn de oude, open policies. Voer daarna migratie_beveiliging.sql uit
-- voor de echte rechten (anon beperkt, coördinator via Supabase Auth).
create policy "anon volledige toegang boeken" on boeken
  for all to anon using (true) with check (true);

create policy "anon volledige toegang instellingen" on instellingen
  for all to anon using (true) with check (true);

create policy "anon volledige toegang scan_wachtrij" on scan_wachtrij
  for all to anon using (true) with check (true);

