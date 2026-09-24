// Supabase Edge Function: titel, auteur en omslag opzoeken bij een ISBN.
// Google Books zonder API key deelt één wereldwijd dagquotum met iedereen en geeft daardoor
// bijna altijd "429 Quota exceeded". Met een eigen key (1000 verzoeken/dag gratis) werkt het
// wel. Die key staat als secret op de server van Supabase, dus nooit in de browser of in de repo.
//
// Eenmalig instellen:
// 1. Google Cloud Console → nieuw project → "Books API" inschakelen → Credentials →
//    Create credentials → API key (beperken tot "Books API").
// 2. Supabase-dashboard → Edge Functions → Secrets → GOOGLE_BOOKS_API_KEY = <de key>.
// 3. Edge Functions → Deploy a new function → Via Editor, naam "zoek-isbn", deze code plakken,
//    Deploy. Zet bij de functie-instellingen "Enforce JWT verification" UIT (iedereen mag
//    zoeken, ook leraren die niet zijn ingelogd).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Resultaat = { title: string; author: string; coverUrl: string | null; source: string };

function antwoord(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function zoekGoogle(isbn: string, key?: string): Promise<Resultaat | null> {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', 'isbn:' + isbn);
  if (key) url.searchParams.set('key', key);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn('Google Books', res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const data = await res.json();
  const info = data.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const title = info.subtitle ? `${info.title}: ${info.subtitle}` : info.title;
  let coverUrl: string | null = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  if (coverUrl) coverUrl = coverUrl.replace(/^http:\/\//, 'https://');
  return { title, author: (info.authors ?? []).join(', '), coverUrl, source: 'google' };
}

async function zoekOpenLibrary(isbn: string): Promise<Resultaat | null> {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`,
  );
  if (!res.ok) return null;
  const boek = (await res.json())[`ISBN:${isbn}`];
  if (!boek?.title) return null;
  return {
    title: boek.title,
    author: (boek.authors ?? []).map((a: { name: string }) => a.name).join(', '),
    coverUrl: boek.cover?.medium ?? boek.cover?.small ?? null,
    source: 'openlibrary',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return antwoord({ error: 'Alleen POST.' }, 405);

  let body: { isbn?: string };
  try { body = await req.json(); } catch { return antwoord({ error: 'Ongeldige aanvraag.' }, 400); }
  const isbn = String(body.isbn ?? '').replace(/\D/g, '');
  if (isbn.length !== 10 && isbn.length !== 13) {
    return antwoord({ error: 'ISBN moet 10 of 13 cijfers zijn.' }, 400);
  }

  const key = Deno.env.get('GOOGLE_BOOKS_API_KEY') || undefined;
  const bronnen = [() => zoekGoogle(isbn, key), () => zoekOpenLibrary(isbn)];
  for (const bron of bronnen) {
    try {
      const resultaat = await bron();
      if (resultaat) return antwoord({ gevonden: true, ...resultaat });
    } catch (e) {
      console.warn('Opzoeken mislukt:', e);
    }
  }
  return antwoord({ gevonden: false });
});
