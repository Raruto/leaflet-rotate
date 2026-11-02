import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduledCruises, cruisePosition, cruiseRoute, cruiseDistance } from './scene-time-helpers.js';

test('seasonal departures follow Paris local time, not UTC or the computer timezone', () => {
  assert.deepEqual(scheduledCruises('2026-11-02T09:14:59Z'), []);
  const first = scheduledCruises('2026-11-02T09:15:00Z');
  assert.equal(first.length, 1);
  assert.equal(first[0].departure, '10:15');
  assert.equal(first[0].progress, 0);
  assert.equal(scheduledCruises('2026-11-02T10:00:00Z').length, 2);
  assert.deepEqual(scheduledCruises('2026-11-02T10:15:00Z').map(trip => trip.departure), ['11:00']);
  assert.equal(scheduledCruises('2026-06-21T08:30:00Z').length, 2);
  assert.equal(scheduledCruises('2026-06-21T08:30:00Z')[1].departure, '10:30');
  assert.equal(scheduledCruises('2026-06-21T08:30:00Z')[0].progress, 0.5);
  assert.equal(scheduledCruises('2026-11-02T21:29:59Z').length, 1);
  assert.deepEqual(scheduledCruises('2026-11-02T21:30:00Z'), []);
  assert.deepEqual(scheduledCruises('2026-11-02T02:00:00Z'), []);
  assert.equal(scheduledCruises('2026-10-24T20:30:00Z')[0].departure, '22:00');
  assert.deepEqual(scheduledCruises('2026-10-23T20:30:00Z'), []);
  assert.equal(scheduledCruises('2026-03-28T09:15:00Z')[0].departure, '10:15');
  assert.equal(scheduledCruises('2026-03-29T08:15:00Z')[0].departure, '10:15');
  assert.equal(scheduledCruises('2026-10-24T08:00:00Z')[0].departure, '10:00');
  assert.equal(scheduledCruises('2026-10-25T09:00:00Z')[0].departure, '10:00');
  assert.throws(() => scheduledCruises('invalid'), /Invalid cruise date/);
});

test('boats follow a continuous closed river route at a consistent estimated speed', () => {
  assert.ok(cruiseDistance > 10000 && cruiseDistance < 16000, `Route length ${cruiseDistance}`);
  assert.deepEqual(cruiseRoute[0], cruiseRoute.at(-1));
  assert.equal(cruisePosition(0).lat, cruisePosition(1).lat);
  assert.equal(cruisePosition(0).lng, cruisePosition(1).lng);
  for (let second = 1; second <= 3600; second++) {
    const previous = cruisePosition((second - 1) / 3600), next = cruisePosition(second / 3600);
    const distance = Math.hypot((next.lat - previous.lat) * 111200,
      (next.lng - previous.lng) * 111200 * Math.cos(next.lat * Math.PI / 180));
    assert.ok(distance < 5 && distance > 0.5, `No jumps at second ${second}: ${distance}`);
    assert.ok(Number.isFinite(next.heading));
    assert.ok(next.lat > 48.849 && next.lat < 48.865 && next.lng > 2.285 && next.lng < 2.362);
  }
  const a = scheduledCruises('2026-06-21T09:10:00Z')[0], b = scheduledCruises('2026-06-21T09:10:01Z')[0];
  assert.notEqual(a.lat, b.lat);
  for (const value of [-1, 2, NaN]) assert.throws(() => cruisePosition(value), /Invalid cruise progress/);
});
