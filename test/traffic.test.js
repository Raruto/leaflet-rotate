import assert from 'node:assert/strict';
import test from 'node:test';
import { along, speed, trafficHour, vehicleOffsets } from '../src/layer/3d/utils/traffic.js';

test('vehicle count follows the measured flow', () => {
  assert.equal(vehicleOffsets(300, 0).length, 0);
  assert.equal(vehicleOffsets(300, 1200).length, Math.round(300 * 1200 / 3600 / speed));
  assert.ok(vehicleOffsets(300, 1600).length > vehicleOffsets(300, 400).length * 3);
  assert.ok(vehicleOffsets(300, 900).every(offset => offset > 0 && offset < 300));
});

test('unpublished hours fall back to the same weekday and hour', () => {
  const latest = Date.parse('2026-11-01T23:00:00Z');
  assert.equal(trafficHour('2026-11-01T17:40:00Z', latest).toISOString(), '2026-11-01T17:00:00.000Z');
  assert.equal(trafficHour('2026-11-02T12:59:00Z', latest).toISOString(), '2026-10-26T12:00:00.000Z');
  assert.throws(() => trafficHour('nope', latest));
});

test('along interpolates position, ground and direction', () => {
  const p = along([[0, 0, 10], [100, 0, 20], [100, 50, 20]], [0, 100, 150], 50);
  assert.deepEqual(p, { x: 50, y: 15, z: 0, dx: 1, dz: 0 });
  assert.deepEqual(along([[0, 0], [100, 0], [100, 50]], [0, 100, 150], 125), { x: 100, y: 0, z: 25, dx: 0, dz: 1 });
});
