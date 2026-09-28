-- Migratie: Kolommen toevoegen voor afwijs- en uitstelredenen
-- Uitgevoerd op testproject en productie.
-- Idempotent: kan veilig meerdere keren worden uitgevoerd.

alter table boeken add column if not exists afwijs_reden text;
alter table boeken add column if not exists afwijs_toelichting text;
