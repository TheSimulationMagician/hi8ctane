// POST /api/rsvp → the Founding Night RSVP (session, pickup hub, waiver, photo consent).
import { env } from './_lib/env.js';
import { json, readJson, sameSite } from './_lib/http.js';
import { rpc } from './_lib/supabase.js';
import { checkRsvp, isBot } from './_lib/validate.js';
import { sendMail } from './_lib/mail.js';

export async function POST(request) {
  const cfg = env();
  if (!sameSite(request, cfg.siteUrl)) return json({ ok: false, error: 'forbidden' }, 403);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_request' }, 400);
  if (isBot(body)) return json({ ok: true, going: null });
  const v = checkRsvp(body);
  if (!v.ok) return json({ ok: false, error: 'invalid', fields: v.errors }, 422);
  if (!cfg.hasDb) return json({ ok: false, error: 'not_configured' }, 503);
  let r;
  try { r = await rpc(cfg, 'rsvp_night', v.value); }
  catch (e) {
    if (e.code === '22023') return json({ ok: false, error: 'invalid', fields: { waiver: 'Tick this to come out on the water or the trails.' } }, 422);
    console.error('rsvp', e && e.message);
    return json({ ok: false, error: 'unavailable' }, 502);
  }
  if (!r.existing) {
    await sendMail(cfg, { to: v.value.p_email, subject: "You're going to Founding Night",
      text: `Hey ${v.value.p_first_name},\n\nYou're on the list for Founding Night in Barcelona. We send the venue and your crew's pickup a week before, and the call 3 hours before the first session.\n\nEvery session is your own call. Captains ride alongside; nobody teaches.\n\nSee you out there,\nFrancisco, Hi8ctane` });
  }
  return json({ ok: true, ...r });
}
