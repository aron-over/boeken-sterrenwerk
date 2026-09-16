-- Migratie: Kleuters wordt een eigen hoofdcategorie i.p.v. een groep onder "Groep".
-- Uitvoeren op het TESTPROJECT eerst (zie CLAUDE.md), pas daarna eventueel op productie.
-- Idempotent: kan zonder problemen twee keer worden uitgevoerd.

-- 1. Nieuwe kolom voor het kleuterthema.
alter table boeken add column if not exists kleuters_thema text;

-- 2. Categorie-check-constraint verruimen met 'Kleuters'.
--    De constraint-naam kan verschillen tussen projecten, dus zoeken we hem dynamisch op
--    (elke CHECK-constraint op boeken die over de kolom "categorie" gaat).
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'boeken'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%categorie%'
  loop
    execute format('alter table boeken drop constraint %I', r.conname);
  end loop;
end $$;

alter table boeken add constraint boeken_categorie_check
  check (categorie in ('Groep', 'Jeelo', 'Overig', 'Kleuters'));

-- 3. Bestaande rijen migreren: categorie 'Groep' + groep 'Kleuters' -> categorie 'Kleuters'.
update boeken
set categorie = 'Kleuters', groep = null
where categorie = 'Groep' and groep = 'Kleuters';

-- 4. Voor de gemigreerde rijen proberen we kleuters_thema te vullen op basis van de
--    (case-insensitive, getrimde) opmerking. "Sociaal-emotioneel" en "Sociaal emotioneel"
--    matchen allebei op hetzelfde thema. Geen match? Dan blijft kleuters_thema leeg en
--    blijft de tekst gewoon in opmerking staan.
update boeken
set kleuters_thema = t.thema
from (values
  ('Baby familie'), ('Beroepen'), ('Bouwen'), ('Verkeer'), ('Lente'), ('Zomer'),
  ('Herfst'), ('Winter'), ('Seizoenen'), ('Zoekboek'), ('Gezondheid'),
  ('Sociaal emotioneel'), ('Dieren'), ('Natuur'), ('Koningshuis'),
  ('Koken en bakken'), ('Rekenen'), ('Sprookjes'), ('Taal'), ('Vakantie'),
  ('Vriendschap'), ('Kikker'), ('Voorlezen'), ('Boerderij'), ('Ruimte'),
  ('Kerst'), ('Sinterklaas'), ('Pasen'), ('Emoties')
) as t(thema)
where boeken.categorie = 'Kleuters'
  and boeken.kleuters_thema is null
  and lower(regexp_replace(trim(boeken.opmerking), '-', ' ', 'g'))
    = lower(regexp_replace(trim(t.thema), '-', ' ', 'g'));
