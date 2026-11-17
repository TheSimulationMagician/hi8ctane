// Hi8ctane cartoons: a rider's selfie, drawn by an image AI as a surf-mag cartoon (2.18).
// Plain JavaScript (fetch, FormData, Blob), so the same file runs in Supabase Edge Functions (Deno) and in the tests (Node).
//
// The selfie is only passed through: it goes to OpenAI and is never stored. The cartoon is kept in Storage
// (bucket "avatars", a random file name) and recorded with hi8_cartoon_done (0017_cartoons.sql).
//
// env: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//      optional: OPENAI_IMAGE_MODEL (gpt-image-1), CARTOON_QUALITY (medium), CARTOON_PROMPT
// deps: { fetch, uuid } (the tests pass fakes)

export const PROMPT = [
  'Redraw the person in this photo as a gritty action-sports comic portrait with an anime edge: head and shoulders, facing the viewer, centred, with space around the head.',
  'Realistic proportions, not chibi, not big-eyed. Sharp, angular, straight-edged linework: squared jaw and chin, faceted cheekbones, hair drawn as sharp spiky clumps and shards.',
  'Thick black ink outlines, hard-cut cel shadows with hatching, halftone dots, a sharp anime catch-light in the eyes, warm late-afternoon sunlight from one side.',
  'Sun, sea and salt: hair bleached lighter at the tips by sun and saltwater, a little tousled and stiff with salt, a few dry strands; sun-tanned skin with a light flush across the nose and cheeks, faint freckles.',
  'Grunge print texture: grain, a few ink specks, faded like a sun-bleached poster. Natural, weathered palette: warm sand, sun-faded browns, deep sea blue and ink black. No neon, no pink, no lime, no glowing rim light.',
  'Keep the person clearly recognisable: same face shape, nose, eyes, brows, skin tone, hair colour, texture and length, same facial hair, glasses and visible accessories, same clothing.',
  'A confident, focused expression. No text, no logos, no frame, no background scenery. Transparent background.',
].join(' ');

const MAX_BYTES = 3 * 1024 * 1024;
const bad = (message, hint, status = 400) => Object.assign(new Error(message), { status, hint });

async function rpc(env, deps, fn, body) {
  const r = await deps.fetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.message) || 'db_error'), { status: r.status === 429 || (j && j.code === 'PT429') ? 429 : r.status >= 500 ? 502 : 400, hint: j && j.hint });
  return j;
}

const storage = (env) => env.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object';
const svc = (env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY });

// a data URL from the browser -> bytes and type; only JPEG, PNG or WebP, at most 3 MB
export function readImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('bad_image', 'Pick a photo (JPEG, PNG or WebP).');
  if (m[2].length * 0.75 > MAX_BYTES) throw bad('too_big', 'That photo is too big. Try another one.');
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1], bytes };
}

// files waiting in avatar_trash (replaced or erased cartoons): delete them from Storage, a few per call
async function sweep(env, deps) {
  try {
    const paths = await rpc(env, deps, 'hi8_avatar_trash_take', { p_n: 20 });
    if (paths && paths.length) {
      await deps.fetch(storage(env) + '/avatars', { method: 'DELETE', headers: { ...svc(env), 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
    }
    return paths || [];
  } catch { return []; } // never fails the rider's request
}

// POST /cartoon { key, image: dataURL, consent: true } -> { path }
// POST /cartoon { key, kind: 'remove' } -> { removed }
export async function cartoon(body, env, deps) {
  if (!body || typeof body.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.key)) throw bad('no_key', 'Get your founding plate first.');
  if (body.kind === 'remove') {
    const out = await rpc(env, deps, 'hi8_avatar_remove', { p_key: body.key });
    await sweep(env, deps);
    return out;
  }
  if (body.consent !== true) throw bad('no_consent', 'Tick the box to send your photo for drawing.');
  if (!env.OPENAI_API_KEY) throw bad('cartoons_off', 'Cartoons are not switched on yet.', 503);
  const img = readImage(body.image);
  const who = await rpc(env, deps, 'hi8_cartoon_start', { p_key: body.key });

  const fd = new FormData();
  fd.append('model', env.OPENAI_IMAGE_MODEL || 'gpt-image-1');
  fd.append('image', new Blob([img.bytes], { type: img.type }), 'selfie.' + img.type.split('/')[1]);
  fd.append('prompt', env.CARTOON_PROMPT || PROMPT);
  fd.append('size', '1024x1024');
  fd.append('quality', env.CARTOON_QUALITY || 'medium');
  fd.append('background', 'transparent');
  fd.append('output_format', 'webp');
  fd.append('output_compression', '80');
  fd.append('input_fidelity', 'high');
  fd.append('n', '1');
  const r = await deps.fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: 'Bearer ' + env.OPENAI_API_KEY }, body: fd });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const code = j && j.error && (j.error.code || j.error.type);
    if (code === 'moderation_blocked' || /safety|moderation/i.test((j && j.error && j.error.message) || '')) throw bad('not_drawn', 'We couldn\'t draw that one. Try a clear selfie of just you.');
    throw bad('draw_failed', 'The drawing didn\'t work. Try again in a minute.', 502);
  }
  const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw bad('draw_failed', 'The drawing didn\'t work. Try again in a minute.', 502);
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);

  const path = (deps.uuid ? deps.uuid() : crypto.randomUUID()) + '.webp';
  const up = await deps.fetch(storage(env) + '/avatars/' + path, {
    method: 'POST', headers: { ...svc(env), 'content-type': 'image/webp', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' }, body: out,
  });
  if (!up.ok) throw bad('store_failed', 'Saving your cartoon didn\'t work. Try again.', 502);
  const done = await rpc(env, deps, 'hi8_cartoon_done', { p_email: who.email, p_path: path });
  await sweep(env, deps);
  return { path: done.path };
}

// the same CORS rule as the money functions
export { cors } from './money.js';
