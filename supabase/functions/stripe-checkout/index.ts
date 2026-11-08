// Supabase Edge Function: the website asks for a Stripe Checkout (wallet top-up, Hi8 Pass) or a withdrawal.
// Deploy: supabase functions deploy stripe-checkout --no-verify-jwt   (secrets: see site/README.md, "Payments")
import { checkout, cors } from '../_shared/money.js';

const env = Deno.env.toObject();

Deno.serve(async (req: Request) => {
  const h = cors(req.headers.get('origin') || '', env);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return new Response('{"message":"bad_request"}', { status: 405, headers: h });
  try {
    const out = await checkout(await req.json(), env, { fetch });
    return new Response(JSON.stringify(out), { headers: { ...h, 'content-type': 'application/json' } });
  } catch (e) {
    const err = e as { message?: string; hint?: string; status?: number };
    return new Response(JSON.stringify({ message: err.message || 'error', hint: err.hint || null }), { status: err.status || 500, headers: { ...h, 'content-type': 'application/json' } });
  }
});
