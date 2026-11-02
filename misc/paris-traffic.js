/**
 * Paris road traffic for the 'traffic' layer type: hourly flow measured by the city's permanent road counters
 * (Ville de Paris open data, ODbL), as GeoJSON lanes with a `flow` property (vehicles/hour).
 *
 * @example new L.Layer({ source: { type: 'traffic', url: '../misc/paris-traffic.js', radius: 2000 } })
 */
const api = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents';
const hour = 3600000, week = 7 * 24 * hour;
let latest, data;

/** Requested hour, moved back by whole weeks when the counts are not published yet. */
export function trafficHour(date, latest) {
  const time = Math.floor(new Date(date).getTime() / hour) * hour;
  if (!Number.isFinite(time)) throw new Error('Invalid traffic date');
  return new Date(time > latest ? time - Math.ceil((time - latest) / week) * week : time);
}

/** Counts of the hour of `time` within `radius` metres of the layer; the same object is returned while the hour is unchanged. */
export default async function (time, { location, options: { radius = 2000 } }, signal) {
  const where = `within_distance(geo_point_2d, geom'POINT(${location.lng} ${location.lat})', ${radius}m) and q > 0`;
  const get = async query => {
    const response = await fetch(`${api}/${query}`, { signal });
    if (!response.ok) throw new Error(`Traffic counts: HTTP ${response.status}`);
    return response.json();
  };
  if (!latest) {
    const { results: [last] } = await get(`records?limit=1&select=max(t_1h) as hour&where=${encodeURIComponent(where)}`);
    if (!last?.hour) throw new Error('No traffic counts published');
    latest = Date.parse(last.hour);
  }
  const counted = trafficHour(time, latest).toISOString();
  if (counted === data?.hour) return data;
  const { features } = await get(`exports/geojson?select=q,libelle,geo_shape&where=${encodeURIComponent(`${where} and t_1h = date'${counted}'`)}`);
  const label = new Date(counted).toLocaleString('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return data = {
    type: 'FeatureCollection', hour: counted,
    note: `counts of ${label}${counted === trafficHour(time, Infinity).toISOString() ? '' : ' (same weekday, latest published)'}`,
    features: features.map(({ geometry, properties: { q, libelle } }) => ({
      type: 'Feature', geometry,
      properties: {
        flow: q,
        name: String(libelle || 'Road').replace(/_/g, ' '),
        description: `${Math.round(q)} vehicles/hour (measured)\nIllustrative vehicle, not a live position.`,
      },
    })),
  };
}
