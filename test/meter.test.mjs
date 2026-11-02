import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourScore, dayScore, label, outside, compass } from '../api/_lib/meter.js';

const wijk = { good_from: 200, good_to: 320 };
test('labels', () => { assert.equal(label(9), 'EPIC'); assert.equal(label(6), 'GOOD'); assert.equal(label(4), 'OK'); assert.equal(label(3), 'NO GO'); });
test('direction ranges, also across north', () => {
  assert.equal(outside(250, 200, 320), 0); assert.equal(outside(90, 200, 320), 110);
  assert.equal(outside(10, 300, 40), 0); assert.equal(outside(100, 300, 40), 60);
  assert.equal(compass(225), 'SW'); assert.equal(compass(359), 'N');
});
test('kite: steady SW 20 kt at Wijk is epic, offshore is a no go', () => {
  assert.equal(hourScore('kite', { w: 20, g: 24, dir: 230, rainP: 0 }, wijk), 9);
  assert.ok(hourScore('kite', { w: 20, g: 24, dir: 90, rainP: 0 }, wijk) <= 1, 'offshore E');
  assert.ok(hourScore('kite', { w: 9, g: 12, dir: 230, rainP: 0 }, wijk) <= 2, 'too light');
  assert.ok(hourScore('kite', { w: 22, g: 34, dir: 230, rainP: 0 }, wijk) <= 6, 'very gusty');
  assert.ok(hourScore('kite', { w: 20, g: 24, dir: 230, rainP: 80 }, wijk) < 9, 'rain costs');
});
test('wing goes lighter than kite', () => {
  assert.ok(hourScore('wing', { w: 13, g: 16, dir: 250, rainP: 0 }, wijk) > hourScore('kite', { w: 13, g: 16, dir: 250, rainP: 0 }, wijk));
});
test('sup wants it glassy', () => {
  assert.equal(hourScore('sup', { w: 3, g: 5, dir: 90, rainP: 0, temp: 12 }), 10);
  assert.ok(hourScore('sup', { w: 15, g: 20, dir: 90, rainP: 0, temp: 12 }) <= 2);
});
test('surf: long-period head-high waves with light wind beat onshore slop', () => {
  const good = hourScore('surf', { w: 4, g: 6, dir: 90, rainP: 0, wave: 1.4, period: 10 }, wijk);
  const slop = hourScore('surf', { w: 20, g: 26, dir: 250, rainP: 0, wave: 1.4, period: 6 }, wijk);
  assert.ok(good >= 9 && slop <= 5, `${good} vs ${slop}`);
  assert.ok(hourScore('surf', { w: 3, g: 4, dir: 90, rainP: 0, wave: 0.2, period: 4 }, wijk) <= 2, 'flat');
});
test('mtb: dry beats wet, mud after rain costs', () => {
  assert.equal(hourScore('mtb', { w: 10, g: 14, rainP: 10, rain: 0, temp: 11, wetBefore: 0 }), 9);
  assert.ok(hourScore('mtb', { w: 10, g: 14, rainP: 10, rain: 0, temp: 11, wetBefore: 8 }) <= 6);
  assert.ok(hourScore('mtb', { w: 10, g: 14, rainP: 80, rain: 2, temp: 11, wetBefore: 0 }) <= 2);
});
test('a day is its best two hours, with the window', () => {
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17].map((hour) => ({ hour, w: hour >= 13 && hour <= 15 ? 20 : 10, g: hour >= 13 && hour <= 15 ? 24 : 13, dir: 230, rainP: 0 }));
  const d = dayScore('kite', hours, wijk);
  assert.equal(d.label, 'EPIC'); assert.equal(d.window, '13–15'); assert.equal(d.key, '20 KT SW');
  assert.equal(dayScore('kite', [], wijk), null);
});
