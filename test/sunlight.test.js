import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atmosphere, moonPosition, solarPosition } from './scene-time-helpers.js';

test('solar geometry follows seasons, night and east/west direction', () => {
  const summer = solarPosition('2026-06-21T12:00:00Z', 48.858, 2.2945);
  const winter = solarPosition('2026-12-21T12:00:00Z', 48.858, 2.2945);
  assert.ok(summer.altitude > 64 && summer.altitude < 65);
  assert.ok(winter.altitude > 17 && winter.altitude < 18);
  assert.ok(summer.azimuth > 175 && summer.azimuth < 190);
  assert.ok(solarPosition('2026-06-21T00:00:00Z', 48.858, 2.2945).altitude < 0);
  assert.ok(solarPosition('2026-06-21T06:00:00Z', 48.858, 2.2945).direction[0] > 0);
  assert.ok(solarPosition('2026-06-21T18:00:00Z', 48.858, 2.2945).direction[0] < 0);
  assert.ok(Math.abs(Math.hypot(...summer.direction) - 1) < 1e-12);
  assert.deepEqual(solarPosition(new Date('2026-06-21T14:00:00+02:00'), 48.858, 2.2945), summer);
  assert.throws(() => solarPosition('', 48, 2), /Invalid solar/);
  assert.throws(() => solarPosition(new Date(), 91, 2), /Invalid solar/);
});

test('atmosphere blends daylight, warm twilight and cool dark nights continuously', () => {
  assert.deepEqual(atmosphere(65).tint, [1, 1, 1]);
  assert.deepEqual(atmosphere(-90), atmosphere(-18));
  assert.deepEqual(atmosphere(90), atmosphere(25));
  const night = atmosphere(-18), sunset = atmosphere(0);
  assert.ok(night.tint[2] > night.tint[0]);
  assert.ok(sunset.tint[0] > sunset.tint[2]);
  assert.notEqual(night.background, sunset.background);
  for (const altitude of [-18, -6, 0, 10, 25]) {
    const before = atmosphere(altitude - 0.001), after = atmosphere(altitude + 0.001);
    assert.ok(before.tint.every((value, i) => Math.abs(value - after.tint[i]) < 0.001));
  }
  assert.throws(() => atmosphere(NaN), /Invalid solar altitude/);
});

test('the lunar orbit is independent of the sun and changes with time and location', () => {
  const full = moonPosition('2026-03-03T11:38:00Z', 48.858, 2.2945);
  const sun = solarPosition('2026-03-03T11:38:00Z', 48.858, 2.2945);
  assert.ok(full.direction.reduce((sum, value, i) => sum + value * sun.direction[i], 0) < -0.99);
  assert.ok(Math.abs(Math.hypot(...full.direction) - 1) < 1e-12);
  assert.notDeepEqual(full, moonPosition('2026-03-03T12:38:00Z', 48.858, 2.2945));
  assert.notDeepEqual(full, moonPosition('2026-03-03T11:38:00Z', -48.858, 2.2945));
  assert.throws(() => moonPosition('invalid', 48, 2), /Invalid solar/);
});
