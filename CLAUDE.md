# Boeken Sterrenwerk — projectcontext voor Claude Code

## Wat dit is
Eén-pagina website (`index.html`, geen build-stap, geen framework) voor Basisschool Het
Sterrenwerk (Sassenheim) om schoolboeken bij te houden: aanvragen door leraren, bestel/
ontvangst-workflow door de taalcoördinator, en een doorzoekbare catalogus.

- **Hosting**: GitHub Pages, repo `github.com/aron-over/boeken-sterrenwerk`
- **Live**: https://aron-over.github.io/boeken-sterrenwerk/
- **Database**: Supabase (Postgres), rechtstreeks vanuit de browser via `@supabase/supabase-js`
  met de **anon key** — die staat bewust in de broncode, dat hoort zo bij Supabase.
- **Geen build/deploy-stap**: wat in `index.html` op de `main`-branch staat, is precies wat
  live staat. Committen + pushen = live.

## Database-schema

Tabel **boeken**:
`id, titel, auteur, isbn, prijs, categorie, groep, jeelo_thema, overig_thema, klas_of_kast
(ongebruikt, locatie volgt nu uit categorie/thema), aantal (altijd 1), besteld (oude ongebruikte
kolom, genegeerd), opmerking, naam_aanvrager, status, besteld_op, binnen_op, boekentip`

Tabel **instellingen**: `id, jaarbudget` (één rij, het jaarbudget van de coördinator)

`categorie` is altijd een van `Groep` / `Jeelo` / `Overig`, met het bijbehorende thema-veld
ingevuld (groep, jeelo_thema, of overig_thema — de andere twee blijven leeg). Vaste lijsten
staan als `GROEPEN`, `JEELO_THEMAS`, `OVERIGE_THEMAS` bovenin het `<script>` van `index.html`.

`status` doorloopt: `aangevraagd` → `besteld` → `binnen`, met een aparte tak `afgewezen`
(kan terug naar `aangevraagd`). Budget wordt berekend over boeken met `besteld_op` in het
huidige kalenderjaar.

## Structuur van de site (3 tabbladen)
1. **Aanvraag indienen** — open voor iedereen, geen wachtwoord. Verplicht: naam, titel, ISBN
   (exact 13 cijfers, wordt live gevalideerd). Waarschuwt bij een titel/ISBN die al lijkt te
   bestaan (client-side check tegen de al geladen boekenlijst).
2. **Boeken zoeken** — toont alleen `status = binnen`. Pil-filters op categorie + dynamisch
   thema. Elk boek heeft een gedeeld "boekentip"-veld (lesideeën van leraren, stapelt op,
   overschrijft niet).
3. **Coördinator** — achter een simpel wachtwoord (`COORD_PASSWORD` in de code — dit is puur
   een drempel tegen per-ongeluk-klikken, GEEN echte beveiliging, de broncode is voor iedereen
   leesbaar). Bevat: jaarbudget-balk, "Te bestellen" en "Onderweg" met bulk-acties +
   totaalbedrag van de selectie en inline bewerkbare velden, "Niet leverbaar" met een
   terugzet-knop, en "Alle boeken" als compacte inklapbare lijst (klik open om te bewerken,
   inclusief status handmatig wijzigen — handig als een boek kwijt/kapot is en opnieuw
   aangevraagd moet worden).

## Stijl
Space Grotesk (koppen) + Inter (body) via Google Fonts. Kleurenschema: navy (`--ink`) +
goud (`--gold`) — bewust gekozen bij de naam "Sterrenwerk" (sterren tegen een nachtblauwe
hemel). Het logo laadt rechtstreeks van de officiële schoolwebsite. Mobielvriendelijk, geen
frameworks — alles is vanilla HTML/CSS/JS in dat ene bestand.

## Testworkflow — BELANGRIJK, altijd zo werken
Er is (of komt) een **los Supabase-testproject** met hetzelfde schema (zie
`testdatabase-schema.sql` als die in deze map staat) en nepdata (`boeken_testdata.csv`,
rijen herkenbaar aan "TESTDATA" in de opmerking).

Vaste regel: **verander nooit rechtstreeks iets aan de productie-Supabase-database
(schema, rijen, of instellingen) tenzij daar expliciet om gevraagd wordt.** Schema-
experimenten en losse tests horen in het testproject.

Vóór elke `git commit`:
1. Controleer met `grep` dat `SUPABASE_URL` en `SUPABASE_ANON_KEY` in `index.html` de
   **productie**-waarden zijn, niet de testproject-waarden. Als dat niet zo is: zet ze terug
   en meld dat expliciet voordat je commit.
2. Nooit een wachtwoord, personal access token, of database-connectiestring in een bestand
   zetten dat gecommit wordt. Die horen in een lokaal `.env`-bestand dat in `.gitignore` staat.

Standaard commit-boodschappen: kort en in het Nederlands, beschrijf wat er functioneel
verandert (bijv. "Boekentip-veld toevoegen aan zoekresultaten"), niet de technische details.

## Wie is wie
- Aron (jij, deze gebruiker): bouwt en beheert de site voor zijn vrouw.
- Zijn vrouw: taalcoördinator op Het Sterrenwerk, de "coördinator"-gebruiker van de site.
- Collega-leraren: gebruiken alleen de tabbladen "Aanvraag indienen" en "Boeken zoeken".

## Nog openstaand / bekend werk in uitvoering
- Twee grote bronlijsten (~1450 titels, Prentenboeken + "nieuw op school") worden via een
  losse Claude Code-taak voorzien van ISBN's via de Google Books API — resultaat komt als
  `gevonden.csv` / `niet_gevonden.csv`, moet later nog tegen de bestaande database op
  duplicaten gecheckt en geïmporteerd worden.
- ISBN is verplicht bij nieuwe aanvragen via het formulier, maar historische/bulk-imports
  mogen zonder ISBN (dat is een client-side check, geen database-constraint).
