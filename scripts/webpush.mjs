// Web push without dependencies (Node 18+): the payload encrypted for the phone (RFC 8291, aes128gcm)
// and signed by us (VAPID, RFC 8292). Used by scripts/alerts.mjs.
import crypto from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// a new VAPID key pair: { publicKey (65 bytes, base64url: goes in site/config.js), privateKey (32 bytes, base64url: a secret) }
export function vapidKeys() {
  const e = crypto.createECDH('prime256v1'); e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
}

function vapidAuth(endpoint, subject, publicKey, privateKey) {
  const pub = unb64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('bad VAPID public key');
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + publicKey;
}

// the encrypted body for one subscription
export function encrypt(payload, p256dh, auth, _as) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length < 16) throw new Error('bad subscription keys');
  const as = _as || crypto.createECDH('prime256v1'); if (!_as) as.generateKeys();
  const asPub = as.getPublicKey(), shared = as.computeSecret(ua), salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, asPub, ct]);
}

// for tests: what the phone does with it
export function decrypt(body, uaECDH, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ua = uaECDH.getPublicKey(), shared = uaECDH.computeSecret(asPub), secret = unb64u(auth);
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return pt.subarray(0, pt.lastIndexOf(2)).toString();
}

// for tests: is the VAPID header really signed by this public key
export function verifyVapid(header, publicKey) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || ''); if (!m || m[2] !== publicKey) return false;
  const [h, b, s] = m[1].split('.'), pub = unb64u(publicKey);
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  return crypto.verify('sha256', Buffer.from(h + '.' + b), { key, dsaEncoding: 'ieee-p1363' }, unb64u(s)) ? JSON.parse(unb64u(b)) : false;
}

// send one message to one subscription -> the HTTP status (201 = delivered to the push service; 404/410 = gone)
export async function send(sub, message, { subject, publicKey, privateKey, ttl = 6 * 3600, urgency = 'normal', topic } = {}) {
  const body = encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
  const headers = { Authorization: vapidAuth(sub.endpoint, subject, publicKey, privateKey), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const r = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    return r.status;
  } catch (e) { if (process.env.PUSH_DEBUG) console.error('push failed:', e.cause || e); return 0; }
}
