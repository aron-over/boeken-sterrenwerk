-- Migratie: echte beveiliging via Row Level Security (RLS) + Supabase Auth.
-- Uitvoeren op het TESTPROJECT eerst (zie CLAUDE.md), pas daarna op productie.
-- Idempotent: kan veilig meerdere keren worden uitgevoerd.
--
-- Na deze migratie:
--   * niet ingelogd (anon, leraren): boeken lezen, aanvraag indienen (alleen status
--     'aangevraagd') en het veld boekentip bijwerken. Verder niets.
--   * ingelogde coördinator: alles. "Coördinator" = een gebruiker die in de tabel
--     coordinatoren staat, dus niet zomaar iedereen die een account weet aan te maken.
--
-- Daarna eenmalig (niet in deze repo, want het e-mailadres hoort niet in de broncode):
--   insert into coordinatoren (user_id)
--   select id from auth.users where email = '<e-mailadres van de coördinator>'
--   on conflict do nothing;

-- ---------- Wie is coördinator ----------
create table if not exists coordinatoren (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table coordinatoren enable row level security;
-- Geen policies: via de API is deze tabel voor niemand leesbaar of schrijfbaar.

create or replace function is_coordinator() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from coordinatoren where user_id = auth.uid());
$$;
revoke all on function is_coordinator() from public;
grant execute on function is_coordinator() to anon, authenticated;

-- ---------- Oude "iedereen mag alles"-policies weghalen ----------
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('boeken', 'instellingen', 'scan_wachtrij')
  loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

alter table boeken enable row level security;
alter table instellingen enable row level security;
alter table scan_wachtrij enable row level security;

-- ---------- boeken ----------
create policy "iedereen mag boeken lezen" on boeken
  for select to anon, authenticated using (true);

create policy "leraren mogen een aanvraag indienen" on boeken
  for insert to anon
  with check (status = 'aangevraagd' and besteld_op is null and binnen_op is null);

-- Leraren mogen alleen de kolom boekentip wijzigen (afgedwongen via kolomrechten hieronder).
create policy "leraren mogen boekentips toevoegen" on boeken
  for update to anon using (true) with check (true);

revoke update, delete, truncate on boeken from anon;
grant update (boekentip) on boeken to anon;

create policy "coordinator mag alles met boeken" on boeken
  for all to authenticated using (is_coordinator()) with check (is_coordinator());

-- ---------- instellingen en scan_wachtrij: alleen coördinator ----------
create policy "coordinator mag alles met instellingen" on instellingen
  for all to authenticated using (is_coordinator()) with check (is_coordinator());

create policy "coordinator mag alles met scan_wachtrij" on scan_wachtrij
  for all to authenticated using (is_coordinator()) with check (is_coordinator());
