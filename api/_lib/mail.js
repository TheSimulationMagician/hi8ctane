// The "you're in" email through Resend. Optional: without a key it does nothing, and a failure never blocks a sign-up.
export async function sendMail(cfg, { to, subject, text }, { fetchImpl = fetch } = {}) {
  if (!cfg.resendKey) return { sent: false, reason: 'no_key' };
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + cfg.resendKey, 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.mailFrom, to: [to], reply_to: cfg.mailReplyTo, subject, text }),
      signal: AbortSignal.timeout(4000),
    });
    return { sent: res.ok, status: res.status };
  } catch (e) { return { sent: false, reason: String(e && e.name || e) }; }
}

export function welcomeText({ firstName, plate, city, cityName, status, siteUrl }) {
  const p = plate ? `#${String(plate).padStart(3, '0')}` : null;
  const lines = [`Hey ${firstName},`, ''];
  if (status === 'open') {
    lines.push(p ? `You're in. Founding plate ${p} in ${cityName} is yours for good.` : `You're in for ${cityName}. The founding plates are gone, but your spot on the list isn't.`);
    lines.push('', 'We ping you the night before the first good day, with the first crews and a seat in a car.');
  } else {
    lines.push(`You're on the list for ${cityName}. Hi8 opens there at 25 riders and 3 captains.`);
    if (p) lines.push(`When it does, plate ${p} is yours.`);
    lines.push('', `Bring your mates: ${siteUrl}/city/${city}`);
  }
  lines.push('', 'See you out there,', 'Francisco, Hi8ctane', '', `Not you, or want out? Reply to this email and we delete everything.`);
  return lines.join('\n');
}
