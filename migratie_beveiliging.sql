-- Migratie: echte beveiliging via Row Level Security (RLS) + Supabase Auth.
-- Uitvoeren op het TESTPROJECT eerst (zie CLAUDE.md), pas daarna op productie.
-- Idempotent: kan veilig meerdere keren worden uitgevoerd.
--
-- Na deze migratie:
--   * niet ingelogd (anon, leraren): boeken lezen, aanvraag indienen (alleen status
--     'aangevraagd') en een boekentip TOEVOEGEN (via de functie voeg_boekentip_toe; bestaande
--     tips wijzigen of wissen kan alleen de coördinator). Verder niets.
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
      -- (scan_wachtrij bestaat alleen als migratie_scan_wachtrij.sql is uitgevoerd)
  loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

alter table boeken enable row level security;
alter table instellingen enable row level security;

-- ---------- boeken ----------
create policy "iedereen mag boeken lezen" on boeken
  for select to anon, authenticated using (true);

create policy "leraren mogen een aanvraag indienen" on boeken
  for insert to anon
  with check (status = 'aangevraagd' and besteld_op is null and binnen_op is null);

-- Leraren mogen niets rechtstreeks wijzigen of verwijderen.
revoke update, delete, truncate on boeken from anon;
revoke update (boekentip) on boeken from anon;

-- Boekentip toevoegen gaat via deze functie: die kan alleen een tip ACHTERAAN toevoegen, dus
-- niemand kan zonder inlog tips van collega's wijzigen of wissen.
-- Geeft de nieuwe inhoud van het veld boekentip terug (JSON-lijst als tekst).
create or replace function voeg_boekentip_toe(p_boek_id text, p_html text, p_author text default '')
returns text
language plpgsql security definer set search_path = public
as $$
declare
  huidige text;
  lijst jsonb;
  resultaat text;
begin
  if p_html is null or btrim(p_html) = '' then
    raise exception 'De boekentip is leeg.';
  end if;
  if length(p_html) > 20000 then
    raise exception 'De boekentip is te lang.';
  end if;

  select boekentip into huidige from boeken where id::text = p_boek_id for update;
  if not found then
    raise exception 'Boek niet gevonden.';
  end if;

  lijst := null;
  if huidige is not null and btrim(huidige) <> '' then
    begin
      lijst := huidige::jsonb;
    exception when others then
      lijst := null;
    end;
    if lijst is null or jsonb_typeof(lijst) <> 'array' then
      -- Oude notatie (losse regels tekst): elke regel wordt een eigen tip.
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', 'legacy-' || (r.nr - 1),
               'html', '<p>' || replace(replace(replace(r.regel, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>',
               'author', '',
               'created_at', '') order by r.nr), '[]'::jsonb)
        into lijst
        from (
          select row_number() over (order by t.ord) as nr, regexp_replace(btrim(t.regel), '^-\s*', '') as regel
          from regexp_split_to_table(huidige, E'\r?\n') with ordinality as t(regel, ord)
          where btrim(t.regel) <> ''
        ) r;
    end if;
  end if;
  lijst := coalesce(lijst, '[]'::jsonb);

  if jsonb_array_length(lijst) >= 100 then
    raise exception 'Dit boek heeft al het maximale aantal boekentips.';
  end if;

  lijst := lijst || jsonb_build_array(jsonb_build_object(
    'id', 'tip-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 5),
    'html', p_html,
    'author', left(coalesce(btrim(p_author), ''), 100),
    'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  resultaat := lijst::text;
  update boeken set boekentip = resultaat where id::text = p_boek_id;
  return resultaat;
end;
$$;
revoke all on function voeg_boekentip_toe(text, text, text) from public;
grant execute on function voeg_boekentip_toe(text, text, text) to anon, authenticated;

create policy "coordinator mag alles met boeken" on boeken
  for all to authenticated using (is_coordinator()) with check (is_coordinator());

-- ---------- instellingen en scan_wachtrij: alleen coördinator ----------
create policy "coordinator mag alles met instellingen" on instellingen
  for all to authenticated using (is_coordinator()) with check (is_coordinator());

do $$
begin
  if to_regclass('public.scan_wachtrij') is not null then
    alter table scan_wachtrij enable row level security;
    create policy "coordinator mag alles met scan_wachtrij" on scan_wachtrij
      for all to authenticated using (is_coordinator()) with check (is_coordinator());
  end if;
end $$;
