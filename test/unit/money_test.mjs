// TEST ONLY. The Stripe functions (supabase/functions/_shared/money.js) against the real database (through
// serve.mjs on 8801, as the service role) and a fake Stripe that records what it was asked.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const { checkout, webhook, verifySignature, form } = await import('../../supabase/functions/_shared/money.js');

let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
const SERVICE = `${head}.${body}.` + createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(`${head}.${body}`).digest('base64url');
const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', SUPABASE_URL: 'http://localhost:8801', SUPABASE_SERVICE_ROLE_KEY: SERVICE, SITE_URL: 'https://hi8ctane.com' };

// a fake Stripe: records calls, answers like Stripe; everything else goes to the real database
const calls = []; let accountReady = false, failTransfer = false;
const fake = async (url, init) => {
  if (!url.startsWith('https://api.stripe.com/')) {
    return fetch(url, { ...init, headers: { ...init.headers, apikey: 'sb_publishable_test', 'x-test-ip': '10.9.9.9' } }); // the test gateway's key; the JWT carries the role
  }
  const path = url.slice('https://api.stripe.com/v1/'.length), params = new URLSearchParams(init.body || '');
  calls.push({ path, method: init.method, params, auth: init.headers.authorization });
  const ans = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (path === 'checkout/sessions') return ans({ id: 'cs_' + calls.length, url: 'https://checkout.stripe.com/c/pay/cs_' + calls.length });
  if (path === 'accounts') return ans({ id: 'acct_123' });
  if (path === 'accounts/acct_123') return ans({ id: 'acct_123', payouts_enabled: accountReady });
  if (path === 'account_links') return ans({ url: 'https://connect.stripe.com/setup/e/acct_123' });
  if (path === 'transfers') return failTransfer ? ans({ error: { message: 'insufficient funds' } }, 400) : ans({ id: 'tr_1' });
  return ans({ error: { message: 'not found' } }, 404);
};
const deps = { fetch: fake };
const sign = (payload, t = Math.floor(Date.now() / 1000), secret = 'whsec_test') => `t=${t},v1=` + createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
const fails = async (p, code) => { try { await p; return false; } catch (e) { return e.message === code; } };

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.outbox, public.wallet_ledger, public.passes, public.payout_accounts cascade");
sql("update public.app_settings set value = 'false' where key = 'payments_live'");
const j = await (await fetch('http://localhost:8801/rest/v1/rpc/hi8_join', { method: 'POST', headers: { apikey: 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.9.0.1' }, body: JSON.stringify({ p_email: 'lu@example.com', p_city: 'barcelona' }) })).json();
const key = j.key;

console.log('form encoding and signatures');
check(form({ a: { b: 1 }, c: [{ d: 'x y' }] }) === 'a%5Bb%5D=1&c%5B0%5D%5Bd%5D=x%20y', 'nested Stripe form fields');
const raw = '{"x":1}';
check(await verifySignature(raw, sign(raw), 'whsec_test'), 'a good signature passes');
check(!(await verifySignature(raw, sign(raw, undefined, 'whsec_other'), 'whsec_test')), 'a wrong secret fails');
check(!(await verifySignature(raw, sign(raw, Math.floor(Date.now() / 1000) - 600), 'whsec_test')), 'an old signature (10 min) fails');
check(!(await verifySignature('{"x":2}', sign(raw), 'whsec_test')), 'a changed body fails');

console.log('top-ups');
check(await fails(checkout({ key, kind: 'topup', cents: 2000 }, env, deps), 'payments_off'), 'payments off: no checkout');
sql("update public.app_settings set value = 'true' where key = 'payments_live'");
check(await fails(checkout({ key: 'nope', kind: 'topup', cents: 2000 }, env, deps), 'unknown_key'), 'a made-up key: no');
check(await fails(checkout({ key, kind: 'topup', cents: 1234 }, env, deps), 'bad_amount'), 'only €10, €20 or €50');
let out = await checkout({ key, kind: 'topup', cents: 2000, back: 'https://hi8ctane.com/?c=ABC123' }, env, deps);
let c = calls.at(-1);
check(out.url.startsWith('https://checkout.stripe.com/') && c.auth === 'Bearer sk_test_x' && c.params.get('mode') === 'payment' && c.params.get('line_items[0][price_data][unit_amount]') === '2000'
  && c.params.get('metadata[email]') === 'lu@example.com' && c.params.get('success_url') === 'https://hi8ctane.com/?c=ABC123&paid=topup', 'a €20 Stripe Checkout, back to the crew page after');
check(!c.params.has('payment_method_types[0]'), 'payment methods come from the Stripe dashboard (iDEAL, Bizum, Bancontact, cards)');
await checkout({ key, kind: 'topup', cents: 1000, back: 'https://evil.example/' }, env, deps);
check(calls.at(-1).params.get('cancel_url') === 'https://hi8ctane.com/#me', 'a return address off the site is ignored');
const done = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_paid_1', payment_status: 'paid', amount_total: 2000, metadata: { kind: 'topup', email: 'lu@example.com', cents: '2000' } } } });
check(await fails(webhook(done, sign(done, undefined, 'whsec_wrong'), env, deps), 'bad_signature'), 'a webhook without Stripe\'s signature: refused');
out = await webhook(done, sign(done), env, deps);
check(out.done === 'topup' && sql("select public.hi8_balance('lu@example.com')") === '2000', 'Stripe says paid: €20 in the wallet');
await webhook(done, sign(done), env, deps);
check(sql("select public.hi8_balance('lu@example.com')") === '2000', 'Stripe sends it again: still €20');
const unpaid = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_sepa', payment_status: 'unpaid', amount_total: 1000, metadata: { kind: 'topup', email: 'lu@example.com' } } } });
await webhook(unpaid, sign(unpaid), env, deps);
check(sql("select public.hi8_balance('lu@example.com')") === '2000', 'a payment still on its way: not credited yet');
sql("insert into wallet_ledger (email, kind, cents, note) values ('lu@example.com', 'adjust', 7500, 'test')");
check(await fails(checkout({ key, kind: 'topup', cents: 5000 }, env, deps), 'wallet_full'), 'over €100 in the wallet: no');

console.log('the Hi8 Pass');
out = await checkout({ key, kind: 'pass', plan: 'year' }, env, deps); c = calls.at(-1);
check(out.url && c.params.get('mode') === 'subscription' && c.params.get('line_items[0][price_data][recurring][interval]') === 'year' && c.params.get('line_items[0][price_data][unit_amount]') === '3900'
  && c.params.get('subscription_data[metadata][email]') === 'lu@example.com', 'a yearly Pass at €39, by subscription');
const sub = JSON.stringify({ type: 'customer.subscription.created', data: { object: { id: 'sub_9', status: 'active', customer: 'cus_9', current_period_end: Math.floor(Date.now() / 1000) + 365 * 86400, metadata: { kind: 'pass', email: 'lu@example.com', plan: 'year' } } } });
out = await webhook(sub, sign(sub), env, deps);
check(out.done === 'pass' && sql("select public.hi8_has_pass('lu@example.com')") === 't', 'Stripe says active: the Pass is on');
check(await fails(checkout({ key, kind: 'pass', plan: 'month' }, env, deps), 'pass_active'), 'no second Pass');
const gone = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_9', status: 'canceled', customer: 'cus_9', metadata: { kind: 'pass', email: 'lu@example.com', plan: 'year' } } } });
await webhook(gone, sign(gone), env, deps);
check(sql("select public.hi8_has_pass('lu@example.com')") === 'f', 'cancelled: the Pass is off');

console.log('drivers withdraw');
out = await checkout({ key, kind: 'payout' }, env, deps);
check(out.url.startsWith('https://connect.stripe.com/') && calls.some((x) => x.path === 'accounts' && x.params.get('type') === 'express'), 'first time: a Stripe account to fill in (Stripe keeps the bank details)');
const acc = JSON.stringify({ type: 'account.updated', data: { object: { id: 'acct_123', payouts_enabled: true, metadata: { email: 'lu@example.com' } } } });
await webhook(acc, sign(acc), env, deps); accountReady = true;
failTransfer = true;
check(await fails(checkout({ key, kind: 'payout' }, env, deps), 'payout_failed') && sql("select public.hi8_balance('lu@example.com')") === '9500', 'a failed transfer: the money stays in the wallet');
failTransfer = false;
out = await checkout({ key, kind: 'payout' }, env, deps);
check(out.done && out.cents === 9500 && calls.at(-1).params.get('destination') === 'acct_123' && sql("select public.hi8_balance('lu@example.com')") === '0', '€95 to the bank, the wallet at €0');
sql("update public.app_settings set value = 'false' where key = 'payments_live'");

console.log(`\nALL ${ok} MONEY CHECKS PASSED`);
