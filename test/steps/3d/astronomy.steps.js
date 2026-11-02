import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';
import { atmosphere, moonPosition, solarPosition } from '../../../src/3d/utils/sun.js';

const eiffel = [48.858, 2.2945];
const unit = direction => Math.abs(Math.hypot(...direction) - 1) < 1e-12;

When('the sun is computed for {string} at the Eiffel Tower', function (time) {
  this.body = solarPosition(time, ...eiffel);
});

When('the moon is computed for {string} at the Eiffel Tower', function (time) {
  this.time = time;
  this.body = moonPosition(time, ...eiffel);
});

Then('its altitude is between {int} and {int} degrees', function (low, high) {
  assert.ok(this.body.altitude > low && this.body.altitude < high, String(this.body.altitude));
});

Then('its azimuth is between {int} and {int} degrees', function (low, high) {
  assert.ok(this.body.azimuth > low && this.body.azimuth < high, String(this.body.azimuth));
});

Then('its direction is a unit vector', function () {
  assert.ok(unit(this.body.direction));
});

Then('the same instant written as {string} gives the same sun', function (time) {
  assert.deepEqual(solarPosition(new Date(time), ...eiffel), this.body);
});

Then('its direction points east at {string} and west at {string}', function (morning, evening) {
  assert.ok(solarPosition(morning, ...eiffel).direction[0] > 0);
  assert.ok(solarPosition(evening, ...eiffel).direction[0] < 0);
});

Then('it is opposite the sun', function () {
  const sun = solarPosition(this.time, ...eiffel).direction;
  assert.ok(this.body.direction.reduce((sum, value, i) => sum + value * sun[i], 0) < -0.99);
});

Then('it changes one hour later and in the southern hemisphere', function () {
  const later = new Date(Date.parse(this.time) + 3600000);
  assert.notDeepEqual(moonPosition(later, ...eiffel), this.body);
  assert.notDeepEqual(moonPosition(this.time, -eiffel[0], eiffel[1]), this.body);
});

Then('daylight has a neutral tint', function () {
  assert.deepEqual(atmosphere(65).tint, [1, 1, 1]);
});

Then('the tint stays constant below -18 and above 25 degrees', function () {
  assert.deepEqual(atmosphere(-90), atmosphere(-18));
  assert.deepEqual(atmosphere(90), atmosphere(25));
});

Then('night is blue while sunset is red', function () {
  const night = atmosphere(-18), sunset = atmosphere(0);
  assert.ok(night.tint[2] > night.tint[0]);
  assert.ok(sunset.tint[0] > sunset.tint[2]);
  assert.notEqual(night.background, sunset.background);
});

Then('the tint is continuous around -18, -6, 0, 10 and 25 degrees', function () {
  for (const altitude of [-18, -6, 0, 10, 25]) {
    const before = atmosphere(altitude - 0.001), after = atmosphere(altitude + 0.001);
    assert.ok(before.tint.every((value, i) => Math.abs(value - after.tint[i]) < 0.001), String(altitude));
  }
});

const invalid = {
  'the sun with an empty date': () => solarPosition('', 48, 2),
  'the sun with latitude 91': () => solarPosition(new Date(), 91, 2),
  'the moon with "invalid" date': () => moonPosition('invalid', 48, 2),
  'the atmosphere with NaN altitude': () => atmosphere(NaN),
};

Then(/^computing (.+) fails with "(.+)"$/, function (input, error) {
  assert.throws(invalid[input], new RegExp(error));
});
