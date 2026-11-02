// TEST ONLY. Serves a site folder like GitHub Pages and stands in for Supabase on the same origin:
//   /rest/v1/*  -> the local PostgREST (adds X-Forwarded-For from the X-Test-Ip header, like Supabase's gateway)
//   /auth/v1/*  -> recorded, so tests can check what the site asked Supabase Auth to do
// Usage: node serve.mjs <siteDir> <port> <live|off> [postgrestPort]
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const [dir, port, mode, pgrst = '3300'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const authLog = [];

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__auth') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(authLog)); }
  if (url.pathname.startsWith('/auth/v1/')) {
    let body = ''; for await (const c of req) body += c;
    authLog.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), apikey: req.headers.apikey, body });
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}');
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    if (req.headers.apikey !== 'sb_publishable_test') { res.writeHead(401); return res.end('{"message":"no apikey"}'); }
    const headers = { 'content-type': req.headers['content-type'] || 'application/json', accept: 'application/json', 'x-forwarded-for': req.headers['x-test-ip'] || '10.0.0.1' };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const up = request({ host: '127.0.0.1', port: Number(pgrst), method: req.method, path: url.pathname.replace('/rest/v1', '') + url.search, headers }, (r) => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' }); r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  if (mode === 'live' && p === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(`window.HI8_CONFIG = { supabaseUrl: "http://localhost:${port}", publishableKey: "sb_publishable_test", emailLink: ${process.env.EMAIL_LINK === '1'}, google: ${process.env.GOOGLE === '1'} };`);
  }
  try {
    let f = join(dir, p);
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(b);
  } catch {
    try { const b = await readFile(join(dir, '404.html')); res.writeHead(404, { 'content-type': 'text/html' }); res.end(b); }
    catch { res.writeHead(404); res.end('not found'); }
  }
}).listen(Number(port), () => console.log(`serving ${dir} on ${port} (${mode})`));
