// Supabase Edge Function: een ingelogde coördinator nodigt een nieuwe coördinator uit.
// Draait op de server van Supabase, dus de service_role-sleutel (automatisch beschikbaar als
// omgevingsvariabele) komt nooit in de browser of in deze repo.
//
// Deployen: Supabase-dashboard → Edge Functions → Deploy a new function → Via Editor,
// naam "nodig-coordinator-uit", deze code plakken, Deploy.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function antwoord(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return antwoord({ error: 'Alleen POST.' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // 1. Is de aanvrager een ingelogde coördinator?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await admin.auth.getUser(token);
  const aanvrager = userData?.user;
  if (!aanvrager) return antwoord({ error: 'Je bent niet ingelogd.' }, 401);

  const { data: rij } = await admin
    .from('coordinatoren').select('user_id').eq('user_id', aanvrager.id).maybeSingle();
  if (!rij) return antwoord({ error: 'Alleen coördinatoren mogen iemand uitnodigen.' }, 403);

  // 2. Invoer controleren
  let body: { email?: string; redirectTo?: string };
  try { body = await req.json(); } catch { return antwoord({ error: 'Ongeldige aanvraag.' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return antwoord({ error: 'Vul een geldig e-mailadres in.' }, 400);
  }

  // 3. Uitnodigen (Supabase controleert redirectTo zelf tegen de lijst met Redirect URLs)
  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirectTo,
  });
  let userId = invite?.user?.id;
  let bestaandAccount = false;
  if (inviteError) {
    if (!/already.*registered|already exists/i.test(inviteError.message)) {
      return antwoord({ error: 'Uitnodigen mislukt: ' + inviteError.message }, 400);
    }
    // Account bestaat al (bijv. aangemaakt via het dashboard): dat account koppelen.
    const { data: lijst, error: lijstError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (lijstError) return antwoord({ error: 'Opzoeken van het account mislukt.' }, 500);
    userId = lijst.users.find((u) => (u.email ?? '').toLowerCase() === email)?.id;
    if (!userId) return antwoord({ error: 'Account bestaat al, maar is niet gevonden.' }, 500);
    bestaandAccount = true;
  }

  // 4. Als coördinator koppelen
  const { error: koppelError } = await admin
    .from('coordinatoren').upsert({ user_id: userId });
  if (koppelError) {
    return antwoord({ error: 'Koppelen als coördinator mislukt: ' + koppelError.message }, 500);
  }

  return antwoord({ ok: true, email, bestaandAccount });
});
