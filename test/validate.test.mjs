import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSignup, checkRsvp, isBot } from '../api/_lib/validate.js';

test('a good sign-up passes and is cleaned', () => {
  const v = checkSignup({ city: 'Amsterdam', first_name: '  Frankie <b>', email: ' Frankie@Example.com ', hub: 'west', sports: ['kite', 'kite', 'golf'], levels: { kite: 'regular', golf: 'pro', mtb: 'god' }, captain: true, captain_sport: 'kite', captain_days: ['sat', 'xmas'], consent: true });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.p_sports, ['kite']);
  assert.deepEqual(v.value.p_levels, { kite: 'regular' });
  assert.equal(v.value.p_first_name, 'Frankie b');
  assert.equal(v.value.p_email, 'frankie@example.com');
  assert.equal(v.value.p_city, 'amsterdam');
  assert.deepEqual(v.value.p_captain_days, ['sat']);
});
test('missing name and bad email are reported per field', () => {
  const v = checkSignup({ city: 'amsterdam', first_name: '', email: 'nope' });
  assert.equal(v.ok, false); assert.ok(v.errors.first_name && v.errors.email);
});
test('captain fields are dropped when not a captain', () => {
  const v = checkSignup({ city: 'lisbon', first_name: 'A', email: 'a@b.co', captain: false, captain_sport: 'surf', captain_days: ['sat'] });
  assert.equal(v.value.p_captain_sport, null); assert.deepEqual(v.value.p_captain_days, []);
});
test('rsvp needs the waiver', () => {
  assert.equal(checkRsvp({ first_name: 'Sam', email: 's@x.io', session: 'mtb', hub: 'sants', waiver: false }).errors.waiver !== undefined, true);
  assert.equal(checkRsvp({ first_name: 'Sam', email: 's@x.io', session: 'mtb', hub: 'sants', waiver: true }).ok, true);
  assert.equal(checkRsvp({ first_name: 'Sam', email: 's@x.io', session: 'golf', hub: 'sants', waiver: true }).ok, false);
});
test('honeypot', () => { assert.equal(isBot({ website: 'http://spam' }), true); assert.equal(isBot({ website: '' }), false); assert.equal(isBot({}), false); });
