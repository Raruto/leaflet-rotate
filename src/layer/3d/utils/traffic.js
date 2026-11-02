// Average urban speed used to turn hourly flow (vehicles/h) into vehicles on the road.
export const speed = 8;
const hour = 3600000, week = 7 * 24 * hour;

/** Requested hour, moved back by whole weeks when the counts are not published yet. */
export function trafficHour(date, latest) {
  const time = Math.floor(new Date(date).getTime() / hour) * hour;
  if (!Number.isFinite(time)) throw new Error('Invalid traffic date');
  return new Date(time > latest ? time - Math.ceil((time - latest) / week) * week : time);
}

/** Evenly spaced starting offsets (metres) for `flow` vehicles/h on a `length` metres lane. */
export function vehicleOffsets(length, flow) {
  const count = Math.round(length * flow / 3600 / speed);
  return Array.from({ length: count }, (_, i) => (i + 0.5) * length / count);
}

/** Point and unit direction at distance `s` along `points` ([x, z, y?]) with cumulative `lengths`. */
export function along(points, lengths, s) {
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < s) i++;
  const a = points[i - 1], b = points[i], d = lengths[i] - lengths[i - 1] || 1;
  const t = (s - lengths[i - 1]) / d;
  return { x: a[0] + (b[0] - a[0]) * t, y: (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / d, dz: (b[1] - a[1]) / d };
}
