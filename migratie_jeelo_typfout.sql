-- Migratie: typfout in het Jeelo-thema herstellen ("Bebeleven" -> "Beleven van onze planeet").
-- Idempotent: kan veilig meerdere keren worden uitgevoerd.

update boeken
set jeelo_thema = 'Beleven van onze planeet'
where jeelo_thema = 'Bebeleven van onze planeet';

do $$
begin
  if to_regclass('public.scan_wachtrij') is not null then
    update scan_wachtrij
    set jeelo_thema = 'Beleven van onze planeet'
    where jeelo_thema = 'Bebeleven van onze planeet';
  end if;
end $$;
