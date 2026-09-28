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

type Resultaat = {
  title: string;
  author: string;
  coverUrl: string | null;
  source: string;
  price?: number | null;
};

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
  if (!data.items || data.items.length === 0) return null;

  // Zoek bij voorkeur een Nederlandstalige editie binnen de resultaten
  const item = data.items.find((it: { volumeInfo?: { language?: string } }) => it.volumeInfo?.language === 'nl') || data.items[0];
  const info = item?.volumeInfo;
  if (!info?.title) return null;
  const title = info.subtitle ? `${info.title}: ${info.subtitle}` : info.title;
  let coverUrl: string | null = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  if (coverUrl) coverUrl = coverUrl.replace(/^http:\/\//, 'https://');

  let price: number | null = null;
  const sale = item?.saleInfo;
  if (sale?.retailPrice?.amount) {
    price = sale.retailPrice.amount;
  } else if (sale?.listPrice?.amount) {
    price = sale.listPrice.amount;
  }

  return { title, author: (info.authors ?? []).join(', '), coverUrl, source: 'google', price };
}

async function zoekEasyCB(isbn: string): Promise<{ title?: string; author?: string; price?: number } | null> {
  try {
    const res = await fetch(`https://easycbapi.nl/isbn/${isbn}`, {
      headers: { 'User-Agent': 'BoekenSterrenwerk/1.0 (hetsterrenwerk@onderwijs)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().startsWith('Not found')) return null;

    let title: string | undefined;
    let author: string | undefined;
    let price: number | undefined;

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();

      if (key === 'price' && val) {
        const num = parseFloat(val.replace(',', '.'));
        if (!isNaN(num) && num > 0) price = Math.round(num * 100) / 100;
      } else if (key === 'title' && val && !title) {
        title = val;
      } else if (key === 'author' && val && !author) {
        author = val;
      }
    }

    if (title || price != null) {
      return { title, author, price };
    }
    return null;
  } catch (e) {
    console.warn('EasyCB lookup fout:', e);
    return null;
  }
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

  // 1. Haal CB-data op (Centraal Boekhuis / TitelBank: officiële NL uitgeverstitel, auteur en vaste boekenprijs)
  let cbData: { title?: string; author?: string; price?: number } | null = null;
  try {
    cbData = await zoekEasyCB(isbn);
  } catch (e) {
    console.warn('EasyCB mislukt:', e);
  }

  // 2. Google Books raadplegen (voor omslagafbeelding en aanvulling)
  let googleResult: Resultaat | null = null;
  try {
    googleResult = await zoekGoogle(isbn, key);
  } catch (e) {
    console.warn('Google Books mislukt:', e);
  }

  // Centraal Boekhuis is de officiële Nederlandse uitgeversbron en heeft altijd voorrang op titel & auteur!
  // Dit voorkomt dat een buitenlandse editie of foute vertaling uit Google Books wordt overgenomen.
  if (cbData && cbData.title) {
    return antwoord({
      gevonden: true,
      title: cbData.title,
      author: cbData.author || googleResult?.author || '',
      coverUrl: googleResult?.coverUrl || null,
      source: 'centraal-boekhuis',
      price: cbData.price ?? googleResult?.price ?? null,
    });
  }

  // Als Centraal Boekhuis het boek niet kent (bijv. buitenlandse uitgave):
  if (googleResult) {
    if (googleResult.price == null && cbData?.price != null) {
      googleResult.price = cbData.price;
    }
    return antwoord({ gevonden: true, ...googleResult });
  }

  // 3. Fallback: Open Library
  try {
    const ol = await zoekOpenLibrary(isbn);
    if (ol) {
      if (cbData?.price != null) ol.price = cbData.price;
      return antwoord({ gevonden: true, ...ol });
    }
  } catch (e) {
    console.warn('Open Library mislukt:', e);
  }

  return antwoord({ gevonden: false });
});
