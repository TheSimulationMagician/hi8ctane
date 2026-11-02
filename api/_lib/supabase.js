// Calls a Postgres function through Supabase's REST API with the server-only secret key.
// New secret keys (sb_secret_...) go in the apikey header only; legacy service_role keys also need Authorization.
export async function rpc(cfg, name, args, { timeoutMs = 6000, fetchImpl = fetch } = {}) {
  const headers = { 'content-type': 'application/json', apikey: cfg.supabaseKey };
  if (!cfg.supabaseKey.startsWith('sb_')) headers.authorization = 'Bearer ' + cfg.supabaseKey;
  const res = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.hint)) || String(res.status);
    const err = new Error(msg); err.status = res.status; err.code = body && body.code; throw err;
  }
  return body;
}
