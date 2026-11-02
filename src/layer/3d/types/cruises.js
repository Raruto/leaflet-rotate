import './3d.js';
import { cruiseDistance, cruisePosition, cruiseRoute, lengths, radians, scheduledCruises } from '../utils/seine.js';

function installCruiseBoats(layer) {
  // The 'sunlight' layer on the same map drives the simulation time.
  const clock = () => {
    let control = {};
    layer._map?.eachLayer(other => { if (other.control?.time) control = other.control; });
    return control;
  };
  const L = globalThis.L;
  const status = L.DomUtil.create('small', 'cruise-status');
  status.style.display = 'block';
  status.title = 'Bateaux-Mouches sightseeing timetable, Europe/Paris. Approximate route and 60-minute duration; no holiday extras, cancellations, GPS or river-level changes.';
  let ready = false, timer, route, clockAvailable = true;
  const boats = new Map();
  const createMesh = (data, featureFaces = [], material = {}) => {
    const { device } = layer.renderer, attributes = {};
    for (const [name, values] of Object.entries(data)) {
      const array = new Float32Array(values);
      const buffer = device.createBuffer({ size: array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, array);
      attributes[name] = { size: 3, data: array, count: array.length / 3, buffer };
    }
    const mesh = {
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      worldMatrix: Array.from(new DOMMatrix().toFloat64Array()), children: [], visible: true, device,
      geometry: { device, attributes, drawRange: { start: 0, count: attributes.position.count } },
      program: layer._createProgram({ vertexColors: true, doubleSided: true, ...material }),
      id: L.Layer.types['3d']._nextId++, renderOrder: 0, extras: { featureFaces },
    };
    layer.add(mesh);
    return mesh;
  };
  const fail = error => {
    clearInterval(timer); timer = undefined;
    status.textContent = `Cruise error: ${error.message}`;
    status.setAttribute('role', 'alert');
    console.error('Seine cruises', error);
  };
  const update = event => {
    if (!ready || !layer._map || !layer.renderer) return;
    try {
      if (event?.type === 'simulationtimechange') clockAvailable = event.time !== null;
      const valid = clockAvailable && Number.isFinite(clock().time?.getTime());
      if (valid && clock().live && !timer) timer = setInterval(update, 250);
      else if (!valid || !clock().live) { clearInterval(timer); timer = undefined; }
      const trips = valid ? scheduledCruises(clock().live ? new Date() : clock().time) : [];
      let changed = false;
      const active = new Set(trips.map(trip => trip.id));
      for (const [id, mesh] of boats) if (!active.has(id)) { dispose(mesh); boats.delete(id); changed = true; }
      const crs = layer._map.options.crs, origin = crs.project(layer.location);
      const metres = Math.cos(layer.location.lat * radians);
      if (!route) {
        const position = [], normal = [], color = [];
        for (let i = 1; i < cruiseRoute.length; i++) {
          const project = ([lat, lng]) => {
            const point = crs.project(new L.LatLng(lat, lng));
            return [(point.x - origin.x) * metres, -(point.y - origin.y) * metres];
          };
          const a = project(cruiseRoute[i - 1]), b = project(cruiseRoute[i]);
          const dx = b[0] - a[0], dz = b[1] - a[1], length = lengths[i] - lengths[i - 1];
          const width = Math.hypot(dx, dz), x = -dz / width * 2.5, z = dx / width * 2.5;
          for (let distance = Math.floor(lengths[i - 1] / 30) * 30; distance < lengths[i]; distance += 30) {
            const start = Math.max(0, (distance - lengths[i - 1]) / length);
            const end = Math.min(1, (distance + 18 - lengths[i - 1]) / length);
            if (end <= start) continue;
            const p = [a[0] + dx * start, a[1] + dz * start], q = [a[0] + dx * end, a[1] + dz * end];
            for (const point of [[p[0] - x, p[1] - z], [p[0] + x, p[1] + z], [q[0] + x, q[1] + z],
              [p[0] - x, p[1] - z], [q[0] + x, q[1] + z], [q[0] - x, q[1] - z]]) {
              position.push(point[0], 0, point[1]); normal.push(0, 1, 0); color.push(0.08, 0.7, 0.85);
            }
          }
        }
        route = createMesh({ position, normal, color }, [], { emissive: [0.03, 0.25, 0.3], alphaMode: 'BLEND', depthTest: false });
        route.renderOrder = 1000;
        changed = true;
      }
      // Illustrative NGF level, just above the archive's 26.35–27 m river surface.
      const waterSurface = 27.15;
      const surface = waterSurface - layer.root.position[1];
      changed ||= route.position[1] !== surface + 0.03 || !route.visible;
      route.position[1] = surface + 0.03;
      route.visible = true;
      for (const trip of trips) {
        let mesh = boats.get(trip.id);
        if (!mesh) {
          const position = [], normal = [], color = [];
          const triangle = (a, b, c, tint) => {
            const u = b.map((v, i) => v - a[i]), v = c.map((value, i) => value - a[i]);
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const length = Math.hypot(...n);
            for (const point of [a, b, c]) { position.push(...point); normal.push(...n.map(value => value / length)); color.push(...tint); }
          };
          const solid = (ring, bottom, top, tint) => {
            for (let i = 0; i < ring.length; i++) {
              const a = [ring[i][0], bottom, ring[i][1]], b = [ring[(i + 1) % ring.length][0], bottom, ring[(i + 1) % ring.length][1]];
              const c = [b[0], top, b[2]], d = [a[0], top, a[2]];
              triangle(a, b, c, tint); triangle(a, c, d, tint);
              triangle([0, top, 0], d, c, tint);
              triangle([0, bottom, 0], b, a, tint);
            }
          };
          solid([[-4.5, 16], [4.5, 16], [4.5, -12], [2, -18], [-2, -18], [-4.5, -12]], 0.1, 1.2, [0.83, 0.87, 0.89]);
          solid([[-3.4, 10], [3.4, 10], [3.4, -10], [-3.4, -10]], 1.2, 2.5, [0.16, 0.35, 0.43]);
          solid([[-3.7, 11], [3.7, 11], [3.7, -11], [-3.7, -11]], 2.5, 2.7, [0.93, 0.94, 0.90]);
          for (const x of [-3.6, 3.6]) solid([[x - 0.15, 13], [x + 0.15, 13], [x + 0.15, -12], [x - 0.15, -12]], 1.2, 1.8, [0.75, 0.15, 0.12]);
          const data = { position, normal, color }, count = position.length / 3;
          mesh = createMesh(data, [{ id: trip.id, properties: trip, faceStart: 0, faceEnd: count / 3, vertexStart: 0, vertexEnd: count }]);
          boats.set(trip.id, mesh);
          changed = true;
        }
        changed ||= !mesh.visible;
        mesh.visible = true;
        mesh.extras.featureFaces[0].properties = trip;
        const point = crs.project(new L.LatLng(trip.lat, trip.lng));
        // Fixed illustrative Seine surface (metres NGF), never sampled from riverbed terrain.
        const position = [(point.x - origin.x) * metres, surface, -(point.y - origin.y) * metres];
        const heading = -trip.heading * radians;
        changed ||= mesh.position.some((value, i) => value !== position[i]) || mesh.rotation[1] !== heading;
        mesh.position = position;
        mesh.rotation[1] = heading;
      }
      status.removeAttribute('role');
      status.textContent = !valid ? 'Cruises: select a valid simulation date' : trips.length ?
        `Cruises: ${trips.length} underway · estimated, not live GPS` : 'Cruises: outside published service hours';
      if (changed) layer.update();
    } catch (error) {
      for (const mesh of boats.values()) mesh.visible = false;
      clearInterval(timer); timer = undefined;
      layer.update();
      fail(error);
    }
  };
  const dispose = mesh => {
    if (layer.highlightedFeature?.mesh === mesh) {
      layer._setHighlight(null);
      layer.hoveredFeature = null;
      layer._showFeature(null);
    }
    layer.remove(mesh);
    for (const attribute of Object.values(mesh.geometry.attributes)) attribute.buffer.destroy();
    layer._removeProgram(mesh.program);
  };
  const start = () => {
    layer._map.off('simulationtimechange terrainchange', update);
    layer._map.on('simulationtimechange terrainchange', update);
    layer._map.getContainer().querySelector('.leaflet-control-layers-list')?.append(status);
    // Re-adding after the last GPU owner was removed can attach asynchronously.
    if (!layer.renderer && !timer) timer = setInterval(update, 250);
    update();
  };
  layer.on('error', ({ error }) => fail(error));
  layer.on('ready', () => { ready = true; if (layer._map) start(); });
  layer.on('add', () => { if (ready) start(); });
  layer.on('remove', () => {
    clearInterval(timer); timer = undefined;
    layer._map.off('simulationtimechange terrainchange', update);
    for (const mesh of boats.values()) dispose(mesh);
    boats.clear();
    if (route) { dispose(route); route = null; }
    status.textContent = 'Cruises: layer off';
  });
}

// Scheduled Bateaux-Mouches boats on the Seine, timed by the map's 'sunlight' layer.
L.Layer.types.cruises = L.Layer.types['3d'].extend({
  statics: { cruiseDistance, cruisePosition, cruiseRoute, scheduledCruises },
  initialize(options) {
    L.Layer.types['3d'].prototype.initialize.call(this, {
      center: [48.85826, 2.29450],
      tooltipContent({ properties: p }) {
        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-line';
        content.textContent = `Bateaux-Mouches · sightseeing cruise\nDeparture ${p.departure} Europe/Paris · approx. 60 min\nEstimated position, not live GPS.\nSchematic route/model; no holiday extras, cancellations or river-level changes.`;
        return content;
      },
      ...options,
    });
    installCruiseBoats(this);
  },
});
