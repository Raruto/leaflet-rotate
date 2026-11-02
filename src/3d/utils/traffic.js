// Pure helpers of the 'traffic' type: lane interpolation and vehicle scheduling.

/** Default urban speed (m/s) used to turn a lane's hourly `flow` into vehicles on the road. */
export const speed = 8;

/** Evenly spaced starting offsets (metres) for `flow` vehicles/h moving at `velocity` m/s on a `length` metres lane. */
export function vehicleOffsets(length, flow, velocity = speed) {
  const count = Math.round(length * flow / 3600 / velocity);
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

/**
 * Trips of a frequency-based timetable (like GTFS frequencies.txt) underway at `date`, in the timetable's local time.
 * @param {{timeZone: string, duration: number, services: Array<{from: string, to: string, every?: number, months?: number[], weekdays?: number[]}>}} timetable
 * `duration` and `every` are minutes; `from`/`to` are 'HH:MM' first/last departures; months are 1-12, weekdays 0 (Sunday)-6.
 * @returns {Array<{id: string, departure: string, progress: number}>} `progress` is 0-1 along the lane.
 */
export function scheduledTrips(date, { timeZone, duration, services }) {
  const time = new Date(date);
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid date');
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(clock.formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const minute = parts.hour * 60 + parts.minute + (parts.second + time.getUTCMilliseconds() / 1000) / 60;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const minutes = clockTime => clockTime.split(':').reduce((hours, value) => hours * 60 + Number(value));
  const departures = [];
  for (const { from, to, every = Infinity, months, weekdays } of services) {
    if (months?.includes(parts.month) === false || weekdays?.includes(weekday) === false) continue;
    for (let departure = minutes(from); departure <= minutes(to); departure += every) departures.push(departure);
  }
  return departures.sort((a, b) => a - b).filter(departure => minute >= departure && minute < departure + duration).map(departure => ({
    id: `${parts.year}-${parts.month}-${parts.day}-${departure}`,
    departure: `${String(Math.floor(departure / 60)).padStart(2, '0')}:${String(departure % 60).padStart(2, '0')}`,
    progress: (minute - departure) / duration,
  }));
}

// GeoJSON (Multi)LineStrings become lanes ({latlngs, properties, elevation?}); prepare() adds `points` ([x, z, ground]),
// `lengths` and `length` in layer-local metres.
export const toLanes = ({ features = [] }) => features.flatMap(({ geometry, properties }) => {
  const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
  return lines.map(line => ({ latlngs: line.map(([lng, lat]) => [lat, lng]), properties: properties ?? {}, elevation: properties?.elevation }));
});

// A lane with a `timetable` runs scheduled trips end to end; one with a `flow` (vehicles/h) loops evenly spaced vehicles.
export const tripsAt = (time, lanes, velocity) => lanes.flatMap((lane, l) => {
  const { timetable, flow = 0 } = lane.properties;
  if (!lane.length) return [];
  if (timetable) return scheduledTrips(time, timetable).map(trip => ({
    id: `${l}-${trip.id}`, lane, distance: trip.progress * lane.length, speed: lane.length / (timetable.duration * 60),
    properties: { ...lane.properties, departure: trip.departure },
  }));
  const travelled = time / 1000 * velocity;
  return (lane.offsets ||= vehicleOffsets(lane.length, flow, velocity))
    .map((offset, k) => ({ id: `${l}-${k}`, lane, distance: (offset + travelled) % lane.length, speed: velocity, properties: lane.properties }));
});

/** Dashed lane outline, in layer-local metres. */
export function routeGeometry(lanes) {
  const position = [], normal = [], color = [];
  for (const { points, lengths } of lanes) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = lengths[i] - lengths[i - 1];
    if (!length) continue;
    const x = -dz / length * 2.5, z = dx / length * 2.5;
    for (let distance = Math.floor(lengths[i - 1] / 30) * 30; distance < lengths[i]; distance += 30) {
      const start = Math.max(0, (distance - lengths[i - 1]) / length);
      const end = Math.min(1, (distance + 18 - lengths[i - 1]) / length);
      if (end <= start) continue;
      const p = [a[0] + dx * start, a[1] + dz * start], q = [a[0] + dx * end, a[1] + dz * end], y = a[2] + 0.4;
      for (const point of [[p[0] - x, p[1] - z], [p[0] + x, p[1] + z], [q[0] + x, q[1] + z],
        [p[0] - x, p[1] - z], [q[0] + x, q[1] + z], [q[0] - x, q[1] - z]]) {
        position.push(point[0], y, point[1]); normal.push(0, 1, 0); color.push(0.08, 0.7, 0.85);
      }
    }
  }
  return { position, normal, color };
}
