// Small helpers for Web-standard handlers (Request in, Response out).
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// Reads a JSON body of at most 8 KB. Returns null when it isn't valid JSON or is too big.
export async function readJson(request, limit = 8192) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  const text = await request.text();
  if (text.length > limit) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// Same-site check for form posts: browsers send Origin on POST; refuse other sites.
export function sameSite(request, siteUrl) {
  const origin = request.headers.get('origin');
  if (!origin) return true;                       // curl, server-to-server, older browsers
  try {
    const o = new URL(origin), self = new URL(request.url);
    if (o.host === self.host) return true;
    const site = new URL(siteUrl);
    return o.host === site.host || o.host === 'www.' + site.host || o.host.endsWith('.vercel.app');
  } catch { return false; }
}
