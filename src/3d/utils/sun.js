// Solar centre, without atmospheric refraction.
export function solarPosition(date, lat, lng) {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
    !Number.isFinite(lng) || Math.abs(lng) > 180) throw new Error('Invalid solar date or location');
  const rad = Math.PI / 180, d = time / 86400000 - 10957.5;
  const mean = (357.5291 + 0.98560028 * d) * rad;
  const longitude = mean + (1.9148 * Math.sin(mean) + 0.02 * Math.sin(2 * mean) +
    0.0003 * Math.sin(3 * mean) + 102.9372 + 180) * rad;
  const obliquity = 23.4397 * rad;
  const declination = Math.asin(Math.sin(longitude) * Math.sin(obliquity));
  const ascension = Math.atan2(Math.sin(longitude) * Math.cos(obliquity), Math.cos(longitude));
  return horizontalPosition(d, lat, lng, ascension, declination);
}

function horizontalPosition(d, lat, lng, ascension, declination) {
  const rad = Math.PI / 180;
  const hourAngle = (280.16 + 360.9856235 * d + lng) * rad - ascension;
  const latitude = lat * rad;
  const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const southAzimuth = Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude));
  const azimuth = (southAzimuth / rad + 180 + 360) % 360;
  return { altitude: altitude / rad, azimuth,
    direction: [Math.sin(azimuth * rad) * Math.cos(altitude), Math.sin(altitude),
      -Math.cos(azimuth * rad) * Math.cos(altitude)] };
}

// Low-precision geocentric lunar orbit; no parallax or atmospheric refraction.
export function moonPosition(date, lat, lng) {
  solarPosition(date, lat, lng);
  const rad = Math.PI / 180, d = new Date(date).getTime() / 86400000 - 10957.5;
  const anomaly = (134.963 + 13.064993 * d) * rad;
  const longitude = (218.316 + 13.176396 * d + 6.289 * Math.sin(anomaly)) * rad;
  const latitude = 5.128 * Math.sin((93.272 + 13.229350 * d) * rad) * rad;
  const obliquity = 23.4397 * rad;
  const x = Math.cos(latitude) * Math.cos(longitude);
  const y = Math.cos(latitude) * Math.sin(longitude) * Math.cos(obliquity) - Math.sin(latitude) * Math.sin(obliquity);
  const z = Math.cos(latitude) * Math.sin(longitude) * Math.sin(obliquity) + Math.sin(latitude) * Math.cos(obliquity);
  return horizontalPosition(d, lat, lng, Math.atan2(y, x), Math.asin(z));
}

export function atmosphere(altitude) {
  if (!Number.isFinite(altitude)) throw new Error('Invalid solar altitude');
  const stops = [
    [-18, [3, 7, 20], [17, 28, 54], [0.025, 0.04, 0.09]],
    [-6, [37, 53, 84], [182, 106, 86], [0.12, 0.10, 0.14]],
    [0, [101, 131, 171], [246, 170, 115], [0.38, 0.24, 0.18]],
    [10, [74, 147, 208], [197, 221, 237], [0.80, 0.75, 0.68]],
    [25, [53, 144, 213], [223, 238, 250], [1, 1, 1]],
  ];
  const upper = stops.findIndex(stop => stop[0] >= altitude);
  const b = stops[upper < 0 ? stops.length - 1 : upper], a = stops[Math.max(0, upper - 1)];
  const t = a === b || upper < 0 ? 1 : (altitude - a[0]) / (b[0] - a[0]);
  const mix = index => a[index].map((value, i) => value + (b[index][i] - value) * t);
  const rgb = values => `rgb(${values.map(Math.round).join(', ')})`;
  return { background: `linear-gradient(${rgb(mix(1))}, ${rgb(mix(2))})`, tint: mix(3) };
}
