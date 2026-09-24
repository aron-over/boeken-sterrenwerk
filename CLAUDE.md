# Boeken Sterrenwerk — projectcontext voor Claude Code

## Wat dit is
Eén-pagina website (`index.html`, geen build-stap, geen framework) voor Basisschool Het
Sterrenwerk (Sassenheim) om schoolboeken bij te houden: aanvragen door leraren, bestel/
ontvangst-workflow door de taalcoördinator, en een doorzoekbare catalogus.

- **Hosting**: GitHub Pages, repo `github.com/aron-over/boeken-sterrenwerk`
- **Live**: https://aron-over.github.io/boeken-sterrenwerk/
- **Database**: Supabase (Postgres), rechtstreeks vanuit de browser via `@supabase/supabase-js`
  met de **anon key** — die staat bewust in de broncode, dat hoort zo bij Supabase.
- **Geen build/deploy-stap**: directe koppeling naar `style.css` en `app.js` in `index.html`. Wat op de `main`-branch staat, is direct live via GitHub Pages.
- **Stijlgids & Componentenbibliotheek**: `stijlgids.html` toont alle componenten, knoppen, statussen en de 5 NL Design System huisregels interactief.

## Bestandsstructuur
- `index.html`: Semantische HTML-structuur van de 3 tabbladen, modals en navigatie.
- `style.css`: Centraal Design System conform NL Design System voor Onderwijs (design tokens, `.btn` knoppensysteem, WCAG AA contrast, kaarten, tabellen en print-stylesheet voor bestelbonnen).
- `app.js`: Alle client-side logica, Supabase koppeling (inclusief in-memory testomgeving), Google Books ISBN auto-lookup, barcode camera-scanner, en exportfuncties.
- `stijlgids.html`: Levende stijlgids en documentatie van alle visuele elementen en interactieregels.

## NL Design System Knoppenstandaard (.btn)
In alle HTML en dynamische templates gebruiken we de gestandaardiseerde `.btn`-klassen:
- `.btn`: basisklasse (min-height: 44px voor touch-targets, 8px afronding, focus-ring `3px solid var(--gold)`).
- `.btn-primary`: Nachtblauw (`#14213D`) met wit. Maximaal 1 per formulier/scherm voor de hoofdactie.
- `.btn-secondary`: Zacht goud (`#FBF0D4`) met donker goud (`#8F6800`). Voor nevenacties zoals bewerken of statuswijziging.
- `.btn-neutral`: Wit met grijze rand (`--line`). Voor exports, filters en hulpmiddelen.
- `.btn-danger`: Zacht rood (`#FCE8E6`) met rood (`#B83228`). Voor destructieve acties (afwijzen, verwijderen — altijd met bevestiging).
- `.btn-ghost`: Zonder achtergrond of rand. Voor annuleren en subtiele tekstknoppen.
- `.btn-sm`: Compacte maat (32px hoog) voor rijen in tabellen en overzichten.

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
1. **Boek aanvragen** — open voor iedereen, geen wachtwoord. Verplicht: naam, titel, ISBN
   (exact 13 cijfers, wordt live gevalideerd). Waarschuwt bij een titel/ISBN die al lijkt te
   bestaan (client-side check tegen de al geladen boekenlijst).
2. **Boeken zoeken** — toont alleen `status = binnen`. Pil-filters op categorie + dynamisch
   thema. Elk boek heeft een gedeeld "boekentip"-veld (lesideeën van leraren, stapelt op,
   overschrijft niet).
3. **Coördinator** — inloggen met e-mail + wachtwoord via Supabase Auth (lokaal/testomgeving:
   geen login, één klik). De echte beveiliging zit in de database-RLS (`migratie_beveiliging.sql`):
   anon mag alleen lezen, aanvragen indienen (status `aangevraagd`) en `boekentip` wijzigen;
   alleen gebruikers in de tabel `coordinatoren` mogen de rest. Bevat: jaarbudget-balk, "Te bestellen" en "Onderweg" met bulk-acties +
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
   Ook geen API keys van andere diensten (bijv. Google): GitHub secret scanning slaat daarop aan.
   De Google Books-lookup werkt bewust zonder key.

Standaard commit-boodschappen: kort en in het Nederlands, beschrijf wat er functioneel
verandert (bijv. "Boekentip-veld toevoegen aan zoekresultaten"), niet de technische details.

## Wie is wie
- Aron (jij, deze gebruiker): bouwt en beheert de site voor zijn vrouw.
- Zijn vrouw: taalcoördinator op Het Sterrenwerk, de "coördinator"-gebruiker van de site.
- Collega-leraren: gebruiken alleen de tabbladen "Boek aanvragen" en "Boeken zoeken".

## Nog openstaand / bekend werk in uitvoering
- Twee grote bronlijsten (~1450 titels, Prentenboeken + "nieuw op school") worden via een
  losse Claude Code-taak voorzien van ISBN's via de Google Books API — resultaat komt als
  `gevonden.csv` / `niet_gevonden.csv`, moet later nog tegen de bestaande database op
  duplicaten gecheckt en geïmporteerd worden.
- ISBN is verplicht bij nieuwe aanvragen via het formulier, maar historische/bulk-imports
  mogen zonder ISBN (dat is een client-side check, geen database-constraint).
