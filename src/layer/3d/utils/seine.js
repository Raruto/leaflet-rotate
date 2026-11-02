// Approximate navigation line, not a surveyed channel or GPS track. Coordinates are [lat, lng].
const upstream = [
  [48.86353, 2.30491], [48.86357, 2.30714], [48.86361, 2.30998],
  [48.86367, 2.31351], [48.86380, 2.31663], [48.86297, 2.32096],
  [48.86211, 2.32394], [48.86123, 2.32681], [48.86027, 2.32945],
  [48.85944, 2.33250], [48.85879, 2.33540], [48.85845, 2.33764],
  [48.85817, 2.34005], [48.85776, 2.34209], [48.85727, 2.34441],
  [48.85663, 2.34684], [48.85593, 2.34921], [48.85485, 2.35176],
  [48.85399, 2.35380], [48.85320, 2.35613], [48.85224, 2.35892],
  [48.85103, 2.36054], [48.84936, 2.36056], [48.84972, 2.35852],
];
const leftBankReturn = [
  [48.85047, 2.35617], [48.85139, 2.35351], [48.85180, 2.35084],
  [48.85229, 2.34926], [48.85300, 2.34759], [48.85385, 2.34526],
  [48.85487, 2.34290], [48.85654, 2.34087], [48.85747, 2.33894],
  [48.85815, 2.33730],
];
const downstream = [
  [48.86349, 2.30143], [48.86284, 2.29846], [48.86185, 2.29576],
  [48.86036, 2.29281], [48.85877, 2.29052], [48.85708, 2.28871],
  [48.85601, 2.28786], [48.85575, 2.28735], [48.85575, 2.28699],
  [48.85595, 2.28695], [48.85617, 2.28734],
];
export const cruiseRoute = [
  ...upstream, ...leftBankReturn,
  ...upstream.slice(0, 11).reverse().map(([lat, lng]) => [lat - 0.00020, lng]),
  ...downstream,
  ...downstream.slice(0, 6).reverse().map(([lat, lng]) => [lat + 0.00025, lng - 0.00025]),
  [48.86365, 2.30200], [48.86365, 2.30350], upstream[0],
];
export const radians = Math.PI / 180;
export const lengths = [0];
for (let i = 1; i < cruiseRoute.length; i++) {
  const a = cruiseRoute[i - 1], b = cruiseRoute[i];
  const latitude = (b[0] - a[0]) * radians / 2;
  const longitude = (b[1] - a[1]) * radians / 2;
  const haversine = Math.sin(latitude) ** 2 +
    Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(longitude) ** 2;
  lengths.push(lengths[i - 1] + 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine))));
}
export const cruiseDistance = lengths.at(-1);

export function cruisePosition(progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Invalid cruise progress');
  const travelled = progress * cruiseDistance;
  const end = lengths.findIndex((length, i) => i > 0 && length >= travelled);
  const i = end < 0 ? lengths.length - 1 : end;
  const a = cruiseRoute[i - 1], b = cruiseRoute[i];
  const t = (travelled - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
  return {
    lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t,
    heading: Math.atan2((b[1] - a[1]) * Math.cos(a[0] * radians), b[0] - a[0]) / radians,
  };
}

export function scheduledCruises(date) {
  const time = new Date(date);
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid cruise date');
  const parisClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(parisClock.formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const minute = parts.hour * 60 + parts.minute + (parts.second + time.getUTCMilliseconds() / 1000) / 60;
  const summer = parts.month >= 4 && parts.month <= 10;
  const departures = [];
  for (let departure = summer ? 600 : 615; departure <= 1290; departure += summer ? 30 : 45) departures.push(departure);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (parts.month === 10 && weekday === 6) departures.push(1320);
  return departures.filter(departure => minute >= departure && minute < departure + 60).map(departure => {
    const progress = (minute - departure) / 60;
    return {
      id: `${parts.year}-${parts.month}-${parts.day}-${departure}`,
      departure: `${String(Math.floor(departure / 60)).padStart(2, '0')}:${String(departure % 60).padStart(2, '0')}`,
      progress, ...cruisePosition(progress),
    };
  });
}
