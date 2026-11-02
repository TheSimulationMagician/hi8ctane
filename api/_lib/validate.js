// Input checks shared by the sign-up and RSVP endpoints. The database checks again; these give friendly errors.
export const SPORTS = ['kite', 'wing', 'surf', 'sup', 'mtb', 'mx'];
export const LEVELS = ['rookie', 'regular', 'ripper'];
export const HUBS = ['west', 'cs', 'zuid', 'hlm', 'bcn', 'sants', 'gracia', 'sagrera', 'own', 'other'];
export const DAYS = ['weekdays', 'fri', 'sat', 'sun'];
export const SESSIONS = ['kite-wing', 'sup-surf', 'mtb', 'night-only'];
export const NIGHT_HUBS = ['sants', 'gracia', 'sagrera', 'own'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const clean = (s, max) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '');

export function checkSignup(b) {
  const errors = {};
  const city = clean(b.city, 40).toLowerCase();
  const first_name = clean(b.first_name, 40);
  const email = clean(b.email, 254).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(city)) errors.city = 'Pick a city.';
  if (!first_name) errors.first_name = 'Your first name, so the crew knows who you are.';
  if (!EMAIL.test(email)) errors.email = 'That email looks wrong.';
  const sports = Array.isArray(b.sports) ? [...new Set(b.sports.filter((s) => SPORTS.includes(s)))] : [];
  const levels = {};
  if (b.levels && typeof b.levels === 'object') for (const [k, v] of Object.entries(b.levels)) if (SPORTS.includes(k) && LEVELS.includes(v)) levels[k] = v;
  const hub = HUBS.includes(b.hub) ? b.hub : null;
  const captain = b.captain === true;
  const captain_sport = SPORTS.includes(b.captain_sport) ? b.captain_sport : null;
  const captain_days = Array.isArray(b.captain_days) ? [...new Set(b.captain_days.filter((d) => DAYS.includes(d)))] : [];
  const value = { p_city: city, p_first_name: first_name, p_email: email, p_hub: hub, p_sports: sports, p_levels: levels,
    p_captain: captain, p_captain_sport: captain ? captain_sport : null, p_captain_days: captain ? captain_days : [],
    p_consent: b.consent === true, p_source: clean(b.source, 80) || null, p_ref: clean(b.ref, 40) || null };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function checkRsvp(b) {
  const errors = {};
  const first_name = clean(b.first_name, 40);
  const email = clean(b.email, 254).toLowerCase();
  if (!first_name) errors.first_name = 'Your first name, for the list at the door.';
  if (!EMAIL.test(email)) errors.email = 'That email looks wrong.';
  if (!SESSIONS.includes(b.session)) errors.session = 'Pick a session, or night only.';
  if (!NIGHT_HUBS.includes(b.hub)) errors.hub = 'Pick where you leave from.';
  if (b.waiver !== true) errors.waiver = 'Tick this to come out on the water or the trails.';
  const value = { p_first_name: first_name, p_email: email, p_session: b.session, p_hub: b.hub, p_waiver: b.waiver === true, p_photo: b.photo === true };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// Bots fill every field; people never see this one.
export const isBot = (b) => typeof b.website === 'string' && b.website.trim() !== '';
