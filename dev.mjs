// Local preview: serves public/ with clean URLs and runs the api/ handlers, like Vercel does.
// Usage: npm run dev  (reads .env if there is one)   →  http://localhost:3000
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
if (existsSync(join(ROOT, '.env'))) for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const PORT = Number(process.env.PORT || 3000);
const CFG = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon' };

function rewrite(path) {
  for (const r of CFG.rewrites || []) {
    const re = new RegExp('^' + r.source.replace(/:[a-z]+/g, '[^/]+') + '$');
    if (re.test(path)) return r.destination;
  }
  return path;
}

async function file(path) {
  const pub = join(ROOT, 'public');
  for (const p of [path, path + '.html', join(path, 'index.html')]) {
    const full = normalize(join(pub, p));
    if (!full.startsWith(pub)) return null;
    try { if ((await stat(full)).isFile()) return full; } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/') && !url.pathname.includes('/_')) {
      const mod = await import(join(ROOT, url.pathname + '.js') + '?t=' + Date.now());
      const handler = mod[req.method] || (mod.default && mod.default.fetch);
      if (!handler) { res.writeHead(405); return res.end('method not allowed'); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await handler(request);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    const f = await file(rewrite(url.pathname));
    if (!f) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end(await readFile(join(ROOT, 'public/404.html'))); }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch (e) {
    console.error(e); res.writeHead(500); res.end('error');
  }
}).listen(PORT, () => console.log(`Hi8ctane day zero on http://localhost:${PORT}`));
