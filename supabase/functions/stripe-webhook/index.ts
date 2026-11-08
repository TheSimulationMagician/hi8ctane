// Supabase Edge Function: Stripe tells us a top-up was paid, a Pass changed, or a driver's payout account is ready.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Stripe > Developers > Webhooks > Add endpoint: https://<project>.supabase.co/functions/v1/stripe-webhook
//   events: checkout.session.completed, checkout.session.async_payment_succeeded,
//           customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, account.updated
import { webhook } from '../_shared/money.js';

const env = Deno.env.toObject();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('bad_request', { status: 405 });
  const raw = await req.text();
  try {
    const out = await webhook(raw, req.headers.get('stripe-signature') || '', env, { fetch });
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    const err = e as { message?: string; status?: number };
    // 4xx: Stripe stops retrying (bad signature); 5xx: Stripe retries later
    return new Response(JSON.stringify({ message: err.message || 'error' }), { status: err.status || 500, headers: { 'content-type': 'application/json' } });
  }
});
