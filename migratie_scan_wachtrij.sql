-- Migratie: Centrale scan-wachtrij voor cross-device scannen (mobiel -> pc).
-- Uitvoeren op het TESTPROJECT eerst (zie CLAUDE.md), pas daarna op productie.
-- Idempotent: kan veilig meerdere keren worden uitgevoerd.

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

-- RLS inschakelen
alter table scan_wachtrij enable row level security;

-- Alleen de ingelogde coördinator mag bij de scan-wachtrij (zelfde regel als in
-- migratie_beveiliging.sql). Een eventuele oude "iedereen mag alles"-policy wordt weggehaald,
-- zodat dit bestand opnieuw uitvoeren de beveiliging nooit kan terugdraaien.
-- Vereist dat migratie_beveiliging.sql al is uitgevoerd (voor de functie is_coordinator()).
drop policy if exists "anon volledige toegang scan_wachtrij" on scan_wachtrij;
drop policy if exists "coordinator mag alles met scan_wachtrij" on scan_wachtrij;
create policy "coordinator mag alles met scan_wachtrij" on scan_wachtrij
  for all to authenticated using (is_coordinator()) with check (is_coordinator());
