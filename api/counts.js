// GET /api/counts → riders, captains and plates left per city, and how many are going to Founding Night.
import { env } from './_lib/env.js';
import { json } from './_lib/http.js';
import { rpc } from './_lib/supabase.js';

export async function GET() {
  const cfg = env();
  if (!cfg.hasDb) return json({ ok: false, reason: 'not_configured' });
  try {
    const data = await rpc(cfg, 'public_counts', {});
    return json({ ok: true, ...data }, 200, { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' });
  } catch (e) {
    console.error('counts', e && e.message);
    return json({ ok: false, reason: 'unavailable' }, 200);
  }
}
