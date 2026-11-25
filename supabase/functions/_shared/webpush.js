// Web push without dependencies, on WebCrypto, so it runs the same in a Supabase Edge Function (Deno) and in Node 20+:
// the payload encrypted for the phone (RFC 8291, aes128gcm) and signed by us (VAPID, RFC 8292).
const C = globalThis.crypto.subtle;
const te = new TextEncoder();

export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/'), p = t + '==='.slice((t.length + 3) % 4), r = atob(p), o = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i);
  return o;
}
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key, data) { const k = await C.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await C.sign('HMAC', k, data)); }

// a new VAPID key pair: { publicKey (65 bytes, base64url: the site reads it), privateKey (32 bytes, base64url: a secret) }
export async function vapidKeys() {
  const k = await C.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await C.exportKey('raw', k.publicKey)), jwk = await C.exportKey('jwk', k.privateKey);
  return { publicKey: b64u(raw), privateKey: jwk.d };
}
async function vapidAuth(endpoint, subject, publicKey, privateKey) {
  const pub = unb64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('bad VAPID public key');
  const key = await C.importKey('jwk', { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await C.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body))); // WebCrypto gives r||s, as JWT wants
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + publicKey;
}
async function keys(secret, shared, ua, asPub, salt) {
  const ikm = await hmac(await hmac(secret, shared), cat(te.encode('WebPush: info\0'), ua, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).subarray(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).subarray(0, 12);
  return { cek, nonce };
}
// the encrypted body for one subscription
export async function encrypt(payload, p256dh, auth) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length < 16) throw new Error('bad subscription keys');
  const as = await C.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await C.exportKey('raw', as.publicKey));
  const uaKey = await C.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await C.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await keys(secret, shared, ua, asPub, salt);
  const k = await C.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await C.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(te.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, asPub, ct);
}
// for tests: what the phone does with it (ua: an ECDH key pair { privateKey, publicRaw })
export async function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const asKey = await C.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await C.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const { cek, nonce } = await keys(unb64u(auth), shared, ua.publicRaw, asPub, salt);
  const k = await C.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await C.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  return new TextDecoder().decode(pt.subarray(0, pt.lastIndexOf(2)));
}
// for tests: a phone's key pair
export async function phoneKeys() {
  const k = await C.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privateKey: k.privateKey, publicRaw: new Uint8Array(await C.exportKey('raw', k.publicKey)) };
}
// for tests: is the VAPID header really signed by this public key -> its claims, or false
export async function verifyVapid(header, publicKey) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || ''); if (!m || m[2] !== publicKey) return false;
  const [h, b, s] = m[1].split('.'), pub = unb64u(publicKey);
  const key = await C.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await C.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(s), te.encode(h + '.' + b));
  return ok ? JSON.parse(new TextDecoder().decode(unb64u(b))) : false;
}
// send one message to one subscription -> the HTTP status (201 = with the push service; 404/410 = gone; 0 = no answer)
export async function send(sub, message, { subject, publicKey, privateKey, ttl = 6 * 3600, urgency = 'normal', topic, fetch: f = fetch, debug } = {}) {
  try {
    const body = await encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
    const headers = { Authorization: await vapidAuth(sub.endpoint, subject, publicKey, privateKey), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency };
    if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    const r = await f(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    return r.status;
  } catch (e) { if (debug) debug('push failed: ' + (e && (e.cause || e.message) || e)); return 0; }
}
