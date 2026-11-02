// Run once on your own machine before the app launches: `npm run fonts`.
// Downloads the latin font files from Google Fonts into public/fonts/ and rewrites public/css/fonts.css to use them,
// so visitors' browsers never contact Google (GDPR). Then commit public/fonts and public/css/fonts.css.
// All seven families are under the SIL Open Font License, which allows self-hosting.
import { writeFile, mkdir } from 'node:fs/promises';

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Bowlby+One&family=Permanent+Marker&family=Shrikhand&family=Space+Mono:wght@400;700&family=Special+Elite&display=swap';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Keeps only the /* latin */ blocks and returns [{ family, weight, url }]. Exported for the test.
export function latinFaces(css) {
  const out = [];
  for (const m of css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const family = (body.match(/font-family:\s*'([^']+)'/) || [])[1];
    const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const url = (body.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    if (family && url) out.push({ family, weight, url });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const css = await (await fetch(CSS_URL, { headers: { 'user-agent': UA } })).text();
  const faces = latinFaces(css);
  if (!faces.length) { console.error('No font files found in the Google Fonts response.'); process.exit(1); }
  await mkdir(new URL('../public/fonts/', import.meta.url), { recursive: true });
  let out = '/* Self-hosted (npm run fonts). SIL Open Font License. */\n';
  for (const f of faces) {
    const file = `${f.family.toLowerCase().replace(/\s+/g, '-')}-${f.weight}.woff2`;
    const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    await writeFile(new URL(`../public/fonts/${file}`, import.meta.url), buf);
    out += `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${f.weight}; font-display: swap; src: url('/fonts/${file}') format('woff2'); }\n`;
    console.log('saved', file, buf.length, 'bytes');
  }
  await writeFile(new URL('../public/css/fonts.css', import.meta.url), out);
  console.log('public/css/fonts.css now points at /fonts/. Commit both, then remove Google Fonts from the CSP in vercel.json.');
}
