// Supabase Edge Function: the home-screen widget's feed. GET ?city=amsterdam&sport=kite&kg=75
// One small JSON: the next good session for the region and sport, who's going, and the week.
// Same engine and ratings as the site (site/fx.js) through widget/feed.mjs. Cached 15 minutes per city, sport and weight band.
// Deploy: supabase functions deploy widget --no-verify-jwt   (needs SUPABASE_URL and SUPABASE_ANON_KEY, which Supabase sets)
//
// NOT YET DEPLOYED. It imports site/fx.js and site/hi8.js from outside supabase/functions/: check on the
// first deploy that the bundler includes them; if it doesn't, copy the two files into supabase/functions/_shared/.

// The two site scripts are browser scripts: they attach FX and HI8 to the global object.
(globalThis as Record<string, unknown>).window = globalThis;
await import('../../../site/fx.js');
await import('../../../site/hi8.js');
import { widgetFeed } from '../../../widget/feed.mjs';

// deno-lint-ignore no-explicit-any
const G = globalThis as any;
const env = Deno.env.toObject();
const cache = new Map<string, { at: number; body: string }>();
const head = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=900' };

async function crews(): Promise<unknown[]> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return [];
  try {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/hi8_crews', {
      method: 'POST', body: '{}',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    });
    return r.ok ? await r.json() : [];
  } catch (_e) {
    return []; // the forecast alone still makes a useful widget
  }
}

Deno.serve(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const city = (q.get('city') || 'amsterdam').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 30);
  const sport = (q.get('sport') || 'kite').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  const kg = Math.min(130, Math.max(40, Math.round(Number(q.get('kg')) / 5) * 5 || 75));
  const key = city + '.' + sport + '.' + kg, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return new Response(hit.body, { headers: head });
  try {
    const spots = G.HI8.spotsOf(city);
    const out = await widgetFeed({ FX: G.FX, spots, crews: await crews(), city, sport, kg });
    const body = JSON.stringify(out);
    cache.set(key, { at: Date.now(), body });
    return new Response(body, { headers: head });
  } catch (e) {
    if (hit) return new Response(hit.body, { headers: head }); // an older answer beats none
    return new Response(JSON.stringify({ message: (e as Error).message || 'error' }), { status: 502, headers: { ...head, 'cache-control': 'no-store' } });
  }
});
