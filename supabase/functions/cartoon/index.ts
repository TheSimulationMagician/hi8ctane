// Supabase Edge Function: a rider's selfie -> a surf-mag cartoon (2.18). The selfie is never stored.
// Deploy: supabase functions deploy cartoon --no-verify-jwt
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SITE_URL as for Stripe)
import { cartoon, cors } from '../_shared/cartoon.js';

const env = Deno.env.toObject();

Deno.serve(async (req: Request) => {
  const h = cors(req.headers.get('origin') || '', env);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return new Response('{"message":"bad_request"}', { status: 405, headers: h });
  try {
    const out = await cartoon(await req.json(), env, { fetch });
    return new Response(JSON.stringify(out), { headers: { ...h, 'content-type': 'application/json' } });
  } catch (e) {
    const err = e as { message?: string; hint?: string; status?: number };
    return new Response(JSON.stringify({ message: err.message || 'error', hint: err.hint || null }), { status: err.status || 500, headers: { ...h, 'content-type': 'application/json' } });
  }
});
