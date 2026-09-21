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

-- Anon toegangspolicy (gelijk aan de boeken-tabel in dit project)
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'scan_wachtrij' and policyname = 'anon volledige toegang scan_wachtrij'
  ) then
    create policy "anon volledige toegang scan_wachtrij" on scan_wachtrij
      for all to anon using (true) with check (true);
  end if;
end $$;
