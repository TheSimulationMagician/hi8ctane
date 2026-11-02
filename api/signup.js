// POST /api/signup → join a city's founding list (and get a plate), or say you'll captain.
import { env } from './_lib/env.js';
import { json, readJson, sameSite } from './_lib/http.js';
import { rpc } from './_lib/supabase.js';
import { checkSignup, isBot } from './_lib/validate.js';
import { sendMail, welcomeText } from './_lib/mail.js';

export async function POST(request) {
  const cfg = env();
  if (!sameSite(request, cfg.siteUrl)) return json({ ok: false, error: 'forbidden' }, 403);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_request' }, 400);
  if (isBot(body)) return json({ ok: true, plate: null, existing: false });
  const v = checkSignup(body);
  if (!v.ok) return json({ ok: false, error: 'invalid', fields: v.errors }, 422);
  if (!cfg.hasDb) return json({ ok: false, error: 'not_configured' }, 503);
  let r;
  try { r = await rpc(cfg, 'join_waitlist', v.value); }
  catch (e) {
    if (e.code === 'P0002') return json({ ok: false, error: 'invalid', fields: { city: 'We don\'t know that city yet.' } }, 422);
    if (e.code === '23514') return json({ ok: false, error: 'invalid', fields: { email: 'Something in the form looks wrong.' } }, 422);
    console.error('signup', e && e.message);
    return json({ ok: false, error: 'unavailable' }, 502);
  }
  if (!r.existing) {
    await sendMail(cfg, { to: v.value.p_email, subject: r.plate ? `You're in: founding plate #${String(r.plate).padStart(3, '0')}` : `You're on the list for ${r.city_name}`,
      text: welcomeText({ firstName: v.value.p_first_name, plate: r.plate, city: r.city, cityName: r.city_name, status: r.status, siteUrl: cfg.siteUrl }) });
  }
  return json({ ok: true, ...r });
}
