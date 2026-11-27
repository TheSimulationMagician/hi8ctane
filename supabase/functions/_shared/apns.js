// Notifications to the iPhone app (Apple Push Notification service), without dependencies, on WebCrypto, so it runs
// the same in the Supabase Edge Function (Deno) and in Node 20+.
//
// Apple needs HTTP/2. Deno's fetch speaks it; in Node, scripts/alerts.mjs passes an http2 poster instead.
// The key is Apple's .p8 "APNs key" (Certificates, IDs & Profiles > Keys), pasted by the founder into the Edge
// Function's secrets: APNS_KEY_P8, APNS_KEY_ID, APPLE_TEAM_ID, APNS_TOPIC (the bundle ID, com.hi8ctane.app).
import { b64u } from './webpush.js';

const C = globalThis.crypto.subtle;
const te = new TextEncoder();
const HOST = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };

// which buttons a message gets, by what it is about (push_queue.tag). The buttons are set in the app (AppDelegate.swift).
export function categoryFor(tag) {
  const p = String(tag || '').split(':')[0];
  return p === 'ask' ? 'crew' : p === 'fx' ? 'recheck' : p === 'rate' ? 'spot' : null;
}

function pemBody(p8) {
  const s = String(p8 || '').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const r = atob(s), o = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i);
  return o;
}

// the token Apple wants: ES256, signed with the .p8 key, valid an hour; we make a new one every 50 minutes
let cached = null;
export async function apnsJwt(cfg, now = Date.now()) {
  if (cached && cached.kid === cfg.keyId && cached.team === cfg.teamId && now - cached.at < 50 * 60 * 1000) return cached.jwt;
  const key = await C.importKey('pkcs8', pemBody(cfg.keyP8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(te.encode(JSON.stringify({ alg: 'ES256', kid: cfg.keyId })));
  const body = b64u(te.encode(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) })));
  const sig = new Uint8Array(await C.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body)));   // raw r||s, as JOSE wants
  const jwt = head + '.' + body + '.' + b64u(sig);
  cached = { jwt, at: now, kid: cfg.keyId, team: cfg.teamId };
  return jwt;
}

// the message as the phone gets it: the alert, the buttons (category), and what native.js needs (url, ref)
export function apnsPayload(q) {
  const aps = { alert: { title: String(q.title || ''), body: String(q.body || '') }, sound: 'default' };
  const cat = categoryFor(q.tag);
  if (cat) aps.category = cat;
  if (q.tag) aps['thread-id'] = String(q.tag).slice(0, 64);
  return { aps, url: q.url || null, ref: q.tag || null };
}

// fetchPost(url, headers, body) -> { status, body }. Default: fetch (HTTP/2 in Deno).
const viaFetch = (f) => async (url, headers, body) => { const r = await f(url, { method: 'POST', headers, body }); return { status: r.status, body: await r.text() }; };

// one message to one phone. Returns 'ok' | 'gone' (the app was removed, or the token is wrong: forget it) | 'failed'
export async function sendApns(token, q, cfg, opts = {}) {
  const post = opts.post || viaFetch(opts.fetch || fetch);
  const host = HOST[token.env === 'sandbox' ? 'sandbox' : 'production'];
  const headers = {
    authorization: 'bearer ' + await apnsJwt(cfg),
    'apns-topic': cfg.topic || 'com.hi8ctane.app',
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 6 * 3600),
    'content-type': 'application/json'
  };
  if (q.tag) headers['apns-collapse-id'] = String(q.tag).slice(0, 64);
  let r;
  try { r = await post(host + '/3/device/' + token.token, headers, JSON.stringify(apnsPayload(q))); } catch (e) { if (opts.debug) opts.debug('apns', e.message || e); return 'failed'; }
  if (r.status === 200) return 'ok';
  let reason = ''; try { reason = JSON.parse(r.body || '{}').reason || ''; } catch (e) {}
  if (opts.debug) opts.debug('apns', r.status, reason);
  if (r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return 'gone';
  if (r.status === 403 && reason.indexOf('Token') >= 0) cached = null;   // our token expired or was refused: make a new one next time
  return 'failed';
}

// the APNs settings from the environment, or null when they're not set yet (then the iPhone part waits)
export function apnsConfig(env) {
  const keyP8 = env.APNS_KEY_P8 || '', keyId = env.APNS_KEY_ID || '', teamId = env.APPLE_TEAM_ID || '';
  if (!keyP8 || !keyId || !teamId) return null;
  return { keyP8, keyId, teamId, topic: env.APNS_TOPIC || 'com.hi8ctane.app' };
}
