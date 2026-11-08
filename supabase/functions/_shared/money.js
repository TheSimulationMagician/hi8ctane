// Hi8ctane money: the Stripe side of the wallet, the Hi8 Pass and drivers' withdrawals.
// Plain JavaScript (fetch + Web Crypto), so the same file runs in Supabase Edge Functions (Deno) and in the tests (Node).
//
// env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL (https://hi8ctane.com)
// deps: { fetch } (the tests pass a fake one)

const enc = new TextEncoder();

// Stripe's form encoding: { a: { b: 1 }, c: [ { d: 2 } ] } -> a[b]=1&c[0][d]=2
export function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}

async function stripe(env, deps, method, path, params) {
  const r = await deps.fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'stripe_error'), { status: 502 });
  return j;
}

async function rpc(env, deps, fn, body) {
  const r = await deps.fetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.message) || 'db_error'), { status: r.status >= 500 ? 502 : 400, hint: j && j.hint });
  return j;
}

// Stripe-Signature: t=…,v1=… ; v1 = HMAC-SHA256(secret, `${t}.${payload}`), within 5 minutes
export async function verifySignature(payload, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const t = Number(parts.t), sigs = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!t || !sigs.length || Math.abs(nowSec - t) > tolerance) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

const bad = (message, hint, status = 400) => Object.assign(new Error(message), { status, hint });

// POST /stripe-checkout { key, kind: 'topup' | 'pass' | 'payout', cents?, plan?, back? } -> { url } or { done, cents }
export async function checkout(body, env, deps) {
  const site = (env.SITE_URL || 'https://hi8ctane.com').replace(/\/+$/, '');
  const back = typeof body.back === 'string' && body.back.startsWith(site) ? body.back : site + '/#me';
  if (!body || !/^[0-9a-f-]{36}$/i.test(body.key || '')) throw bad('unknown_key', 'Sign up again on this phone.', 401);
  const me = await rpc(env, deps, 'hi8_key_owner', { p_key: body.key });
  if (!me.live) throw bad('payments_off', 'Paying in the app opens soon.');

  if (body.kind === 'topup') {
    const cents = Number(body.cents);
    if (!(me.topups || [1000, 2000, 5000]).includes(cents)) throw bad('bad_amount', 'Pick €10, €20 or €50.');
    if (me.balance_cents + cents > me.max_cents) throw bad('wallet_full', 'Your wallet holds up to €' + me.max_cents / 100 + '.');
    const s = await stripe(env, deps, 'POST', 'checkout/sessions', {
      mode: 'payment', customer_email: me.stripe_cus ? undefined : me.email, customer: me.stripe_cus || undefined,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents, product_data: { name: 'Hi8ctane wallet top-up' } } }],
      metadata: { kind: 'topup', email: me.email, cents },
      payment_intent_data: { metadata: { kind: 'topup', email: me.email, cents } },
      success_url: back + (back.includes('?') ? '&' : '?') + 'paid=topup', cancel_url: back,
    });
    return { url: s.url };
  }
  if (body.kind === 'pass') {
    if (me.pass) throw bad('pass_active', 'Your Hi8 Pass is already on.');
    const plan = body.plan === 'year' ? 'year' : 'month';
    const amount = plan === 'year' ? (me.pass_year_cents || 3900) : (me.pass_month_cents || 399);
    const s = await stripe(env, deps, 'POST', 'checkout/sessions', {
      mode: 'subscription', customer_email: me.stripe_cus ? undefined : me.email, customer: me.stripe_cus || undefined,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: Number(amount), recurring: { interval: plan }, product_data: { name: 'Hi8 Pass (' + (plan === 'year' ? 'a year' : 'a month') + ')' } } }],
      metadata: { kind: 'pass', email: me.email, plan },
      subscription_data: { metadata: { kind: 'pass', email: me.email, plan } },
      success_url: back + (back.includes('?') ? '&' : '?') + 'paid=pass', cancel_url: back,
    });
    return { url: s.url };
  }
  if (body.kind === 'payout') {
    let acct = me.stripe_acct;
    if (!acct) {
      const a = await stripe(env, deps, 'POST', 'accounts', { type: 'express', email: me.email, country: body.country === 'ES' ? 'ES' : 'NL',
        capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { email: me.email } });
      acct = a.id;
      await rpc(env, deps, 'hi8_payout_account', { p_email: me.email, p_acct: acct, p_ready: false });
    }
    let ready = me.payout_ready;
    if (!ready) {
      const a = await stripe(env, deps, 'GET', 'accounts/' + acct);
      ready = !!a.payouts_enabled;
      if (ready) await rpc(env, deps, 'hi8_payout_account', { p_email: me.email, p_acct: acct, p_ready: true });
    }
    if (!ready) {
      const l = await stripe(env, deps, 'POST', 'account_links', { account: acct, type: 'account_onboarding', refresh_url: back, return_url: back + (back.includes('?') ? '&' : '?') + 'paid=payout' });
      return { url: l.url };
    }
    const p = await rpc(env, deps, 'hi8_payout_start', { p_email: me.email });
    try {
      const t = await stripe(env, deps, 'POST', 'transfers', { amount: p.cents, currency: 'eur', destination: acct, metadata: { email: me.email, ledger: p.ledger_id } });
      await rpc(env, deps, 'hi8_payout_done', { p_ledger: p.ledger_id, p_ref: t.id, p_ok: true });
      return { done: true, cents: p.cents };
    } catch (e) {
      await rpc(env, deps, 'hi8_payout_done', { p_ledger: p.ledger_id, p_ref: null, p_ok: false });
      throw bad('payout_failed', 'The transfer didn\'t go through. Your money is back in your wallet.', 502);
    }
  }
  throw bad('bad_request');
}

// POST /stripe-webhook (raw body, Stripe-Signature) -> what was done
export async function webhook(raw, sigHeader, env, deps, nowSec) {
  if (!(await verifySignature(raw, sigHeader, env.STRIPE_WEBHOOK_SECRET, nowSec))) throw bad('bad_signature', null, 400);
  const ev = JSON.parse(raw), o = ev.data && ev.data.object || {}, md = o.metadata || {};
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (md.kind === 'topup' && o.payment_status === 'paid') {
        await rpc(env, deps, 'hi8_topup_paid', { p_email: md.email, p_cents: Number(o.amount_total), p_ref: o.id });
        return { done: 'topup', cents: Number(o.amount_total) };
      }
      return { done: 'ignored' };
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      if (md.kind !== 'pass' || !md.email) return { done: 'ignored' };
      await rpc(env, deps, 'hi8_pass_update', { p_email: md.email, p_plan: md.plan === 'year' ? 'year' : 'month',
        p_status: ev.type === 'customer.subscription.deleted' ? 'canceled' : o.status,
        p_until: o.current_period_end ? new Date(o.current_period_end * 1000).toISOString() : (o.items && o.items.data && o.items.data[0] && o.items.data[0].current_period_end ? new Date(o.items.data[0].current_period_end * 1000).toISOString() : null),
        p_sub: o.id, p_cus: o.customer || null });
      return { done: 'pass', status: o.status };
    case 'account.updated':
      if (!md.email) return { done: 'ignored' };
      await rpc(env, deps, 'hi8_payout_account', { p_email: md.email, p_acct: o.id, p_ready: !!o.payouts_enabled });
      return { done: 'account', ready: !!o.payouts_enabled };
    default:
      return { done: 'ignored' };
  }
}

// CORS for the website calling /stripe-checkout
export function cors(origin, env) {
  const ok = [(env.SITE_URL || 'https://hi8ctane.com').replace(/\/+$/, ''), 'https://www.hi8ctane.com'].concat((env.EXTRA_ORIGINS || '').split(',').filter(Boolean));
  return { 'access-control-allow-origin': ok.includes(origin) ? origin : ok[0], 'access-control-allow-headers': 'content-type, apikey, authorization', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
}
