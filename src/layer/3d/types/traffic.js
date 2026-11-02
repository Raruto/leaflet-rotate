import './3d.js';
import { along, speed, trafficHour, vehicleOffsets } from '../utils/traffic.js';
import { cruiseRoute, scheduledCruises } from '../utils/seine.js';

// Models are [ring of [x, z], bottom, top, rgb] prisms in metres; forward is -z, right is +x.
const paints = [[0.86, 0.86, 0.88], [0.1, 0.1, 0.12], [0.5, 0.53, 0.57], [0.65, 0.1, 0.08], [0.12, 0.25, 0.55], [0.85, 0.7, 0.15]];
const car = i => [[[[-0.9, -2.2], [0.9, -2.2], [0.9, 2.2], [-0.9, 2.2]], 0, 1.5, paints[i % paints.length]]];
const boat = () => [
  [[[-4.5, 16], [4.5, 16], [4.5, -12], [2, -18], [-2, -18], [-4.5, -12]], 0.1, 1.2, [0.83, 0.87, 0.89]],
  [[[-3.4, 10], [3.4, 10], [3.4, -10], [-3.4, -10]], 1.2, 2.5, [0.16, 0.35, 0.43]],
  [[[-3.7, 11], [3.7, 11], [3.7, -11], [-3.7, -11]], 2.5, 2.7, [0.93, 0.94, 0.90]],
  ...[-3.6, 3.6].map(x => [[[x - 0.15, 13], [x + 0.15, 13], [x + 0.15, -12], [x - 0.15, -12]], 1.2, 1.8, [0.75, 0.15, 0.12]]),
];

const build = parts => {
  const position = [], normal = [], color = [];
  const triangle = (a, b, c, tint) => {
    const u = b.map((v, i) => v - a[i]), v = c.map((w, i) => w - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n);
    for (const point of [a, b, c]) { position.push(...point); normal.push(...n.map(w => w / length)); color.push(...tint); }
  };
  for (const [ring, bottom, top, tint] of parts) for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    const a = [x0, bottom, z0], b = [x1, bottom, z1], c = [x1, top, z1], d = [x0, top, z0];
    triangle(a, b, c, tint); triangle(a, c, d, tint);
    triangle([0, top, 0], d, c, tint); triangle([0, bottom, 0], b, a, tint);
  }
  return { position, normal, color };
};

/**
 * A network loads lanes ({latlngs, properties, elevation?}) for a time and places trips ({id, lane, distance, properties}) on them.
 * Lanes get `points` ([x, z, ground]), `lengths` and `length` in layer-local metres once loaded.
 */
const networks = {
  // Cars spaced from the measured hourly flow of Paris permanent road counters: denser roads carry more traffic.
  roads({ url = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents', radius = 2000 }) {
    let latest, lanes;
    return {
      label: 'Traffic', side: 1.8, model: car, rate: () => speed,
      title: 'Hourly flow from Paris permanent road counters (Ville de Paris open data). Vehicles are spaced from the measured flow at an assumed 30 km/h; positions are illustrative.',
      tooltip({ properties: p }) {
        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-line';
        content.textContent = `${String(p.libelle || 'Road').replace(/_/g, ' ')}\n${Math.round(p.q)} vehicles/hour (measured)\nIllustrative vehicle, not a live position.`;
        return content;
      },
      async load(time, layer, signal) {
        const where = `within_distance(geo_point_2d, geom'POINT(${layer.location.lng} ${layer.location.lat})', ${radius}m) and q > 0`;
        const get = async query => {
          const response = await fetch(`${url}/${query}`, { signal });
          if (!response.ok) throw new Error(`Traffic counts: HTTP ${response.status}`);
          return response.json();
        };
        if (!latest) {
          const { results: [last] } = await get(`records?limit=1&select=max(t_1h) as hour&where=${encodeURIComponent(where)}`);
          if (!last?.hour) throw new Error('No traffic counts published');
          latest = Date.parse(last.hour);
        }
        const hour = trafficHour(time, latest).toISOString();
        if (hour === lanes?.hour) return lanes;
        const { features } = await get(`exports/geojson?select=q,libelle,geo_shape&where=${encodeURIComponent(`${where} and t_1h = date'${hour}'`)}`);
        const label = new Date(hour).toLocaleString('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        return lanes = Object.assign(features.filter(feature => feature.geometry?.type === 'LineString' && feature.properties.q > 0)
          .map(({ geometry, properties }) => ({ latlngs: geometry.coordinates.map(([lng, lat]) => [lat, lng]), properties })),
        { hour, note: `${label}${hour === trafficHour(time, Infinity).toISOString() ? '' : ' (same weekday, latest published)'}` });
      },
      trips(time, lanes) {
        const travelled = time / 1000 * speed;
        return lanes.flatMap((lane, l) => lane.length ? (lane.offsets ||= vehicleOffsets(lane.length, lane.properties.q))
          .map((offset, k) => ({ id: `${l}-${k}`, lane, distance: (offset + travelled) % lane.length, properties: lane.properties })) : []);
      },
      status: (trips, lanes) => lanes.note ? `Traffic: ${trips.length} vehicles · counts of ${lanes.note}` : 'Traffic: loading counts…',
    };
  },
  // Scheduled Bateaux-Mouches sightseeing boats on the Seine.
  seine() {
    // Illustrative NGF level, just above the archive's 26.35–27 m river surface; never sampled from riverbed terrain.
    const lanes = [{ latlngs: cruiseRoute, elevation: 27.15, properties: {} }];
    return {
      label: 'Cruises', side: 0, model: boat, route: true, rate: lane => lane.length / 3600,
      title: 'Bateaux-Mouches sightseeing timetable, Europe/Paris. Approximate route and 60-minute duration; no holiday extras, cancellations, GPS or river-level changes.',
      tooltip({ properties: p }) {
        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-line';
        content.textContent = `Bateaux-Mouches · sightseeing cruise\nDeparture ${p.departure} Europe/Paris · approx. 60 min\nEstimated position, not live GPS.\nSchematic route/model; no holiday extras, cancellations or river-level changes.`;
        return content;
      },
      load: async () => lanes,
      trips: (time, [lane]) => lane?.length ? scheduledCruises(time).map(trip => ({ id: trip.id, lane, distance: trip.progress * lane.length, properties: trip })) : [],
      status: trips => trips.length ? `Cruises: ${trips.length} underway · estimated, not live GPS` : 'Cruises: outside published service hours',
    };
  },
};

function installTraffic(layer, network) {
  const L = globalThis.L;
  // The 'sunlight' layer on the same map drives the simulation time; without one, vehicles run live.
  const now = () => {
    let control = { live: true };
    layer._map?.eachLayer(other => { if (other.control?.time) control = other.control; });
    return { live: control.live, time: control.live ? new Date() : control.time };
  };
  const status = L.DomUtil.create('small', 'traffic-status');
  status.style.display = 'block';
  status.title = network.title;
  const template = build(network.model(0)), stride = template.position.length, vertices = stride / 3;
  let ready = false, frame, request, lanes = [], tripsKey, mesh, route;
  // Vehicles move on the GPU: `trips` are rebased at most once per second, a compute pass places them every frame.
  let trips = [], rebasedAt = 0, nextCheck = -Infinity, elapsed = 0, gpu = null, lanesDirty = true, stale = false;
  const params = new ArrayBuffer(16), paramFloats = new Float32Array(params), paramInts = new Uint32Array(params);

  const createMesh = (data, featureFaces, material, usage = 0) => {
    const { device } = layer.renderer, attributes = {};
    for (const [name, values] of Object.entries(data)) {
      const array = new Float32Array(values);
      const buffer = device.createBuffer({ size: array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | usage });
      device.queue.writeBuffer(buffer, 0, array);
      attributes[name] = { size: 3, data: array, count: array.length / 3, buffer };
    }
    const result = {
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      worldMatrix: Array.from(new DOMMatrix().toFloat64Array()), children: [], visible: true, device,
      geometry: { device, attributes, drawRange: { start: 0, count: attributes.position.count } },
      program: layer._createProgram({ vertexColors: true, doubleSided: true, ...material }),
      id: L.Layer.types['3d']._nextId++, renderOrder: 0, extras: { featureFaces },
    };
    layer.add(result);
    return result;
  };
  const dispose = object => {
    if (!object) return;
    if (layer.highlightedFeature?.mesh === object) {
      layer._setHighlight(null);
      layer.hoveredFeature = null;
      layer._showFeature(null);
    }
    layer.remove(object);
    for (const attribute of Object.values(object.geometry.attributes)) attribute.buffer.destroy();
    layer._removeProgram(object.program);
  };
  const fail = error => {
    status.textContent = `${network.label} error: ${error.message}`;
    status.setAttribute('role', 'alert');
    console.error(network.label, error);
  };

  const ground = () => {
    for (const lane of lanes) lane.points.forEach((point, i) => {
      const elevation = lane.elevation ?? layer._map._terrain3D?._getElevation(lane.latlngs[i]);
      point[2] = Number.isFinite(elevation) && Number.isFinite(layer.root.position[1]) ? elevation - layer.root.position[1] : 0;
    });
    lanesDirty = true;
    nextCheck = -Infinity;
  };
  const prepare = () => {
    const crs = layer._map.options.crs, origin = crs.project(layer.location);
    const metres = Math.cos(layer.location.lat * Math.PI / 180);
    for (const lane of lanes) {
      lane.points = lane.latlngs.map(([lat, lng]) => {
        const point = crs.project(new L.LatLng(lat, lng));
        return [(point.x - origin.x) * metres, -(point.y - origin.y) * metres, 0];
      });
      lane.lengths = [0];
      for (let i = 1; i < lane.points.length; i++) {
        lane.lengths.push(lane.lengths[i - 1] + Math.hypot(lane.points[i][0] - lane.points[i - 1][0], lane.points[i][1] - lane.points[i - 1][1]));
      }
      lane.length = lane.lengths.at(-1);
    }
    ground();
    dispose(route); route = null;
    tripsKey = null;
  };

  // Dashed lane outline, drawn over the terrain.
  const drawRoute = () => {
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
        const p = [a[0] + dx * start, a[1] + dz * start], q = [a[0] + dx * end, a[1] + dz * end], y = a[2] + 0.03;
        for (const point of [[p[0] - x, p[1] - z], [p[0] + x, p[1] + z], [q[0] + x, q[1] + z],
          [p[0] - x, p[1] - z], [q[0] + x, q[1] + z], [q[0] - x, q[1] - z]]) {
          position.push(point[0], y, point[1]); normal.push(0, 1, 0); color.push(0.08, 0.7, 0.85);
        }
      }
    }
    route = createMesh({ position, normal, color }, [], { emissive: [0.03, 0.25, 0.3], alphaMode: 'BLEND', depthTest: false });
    route.renderOrder = 1000;
  };

  // One batched mesh, `vertices` per vehicle; the compute pass writes its position/normal buffers (STORAGE).
  const rebuild = () => {
    dispose(mesh); mesh = null;
    if (!trips.length) return;
    const color = trips.flatMap((trip, i) => build(network.model(i)).color), count = color.length / 3;
    mesh = createMesh({ position: color.map(() => 0), normal: color.map(() => 0), color },
      trips.map((trip, i) => ({ id: trip.id, properties: trip.properties, faceStart: i * vertices / 3, faceEnd: (i + 1) * vertices / 3,
        vertexStart: i * vertices, vertexEnd: (i + 1) * vertices })), {}, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    mesh.geometry.drawRange.count = count;
    bounds();
  };
  // Vehicles never leave their lanes: cull and pick against the lanes' extent.
  const bounds = () => {
    const extent = { attributes: { position: { data: lanes.flatMap(lane => lane.points.flatMap(([x, z, y]) => [x - 20, y, z - 20, x + 20, y + 5, z + 20])) } } };
    layer._computeBounds(extent);
    mesh.geometry.bounds = extent.bounds;
  };

  const destroyGpu = () => {
    for (const buffer of [gpu?.params, gpu?.template, gpu?.points, gpu?.vehicles]) buffer?.destroy();
    gpu = null;
  };
  const storage = (device, data) => {
    const buffer = device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  // Lane points are [x, z, ground, cumulative length]. Mirrors along() and place().
  const shader = `
    struct Params { seconds: f32, side: f32, vertices: u32, total: u32 }
    struct Vehicle { start: u32, count: u32, base: f32, speed: f32 }
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> model: array<f32>;
    @group(0) @binding(2) var<storage, read> points: array<vec4f>;
    @group(0) @binding(3) var<storage, read> vehicles: array<Vehicle>;
    @group(0) @binding(4) var<storage, read_write> position: array<f32>;
    @group(0) @binding(5) var<storage, read_write> normal: array<f32>;
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3u) {
      let v = id.x;
      if (v >= params.total) { return; }
      let vehicle = vehicles[v / params.vertices];
      let last = vehicle.start + vehicle.count - 1u;
      let length = points[last].w;
      var s = vehicle.base + params.seconds * vehicle.speed;
      s -= length * floor(s / length);
      var i = vehicle.start + 1u;
      while (i < last && points[i].w < s) { i++; }
      let a = points[i - 1u];
      let b = points[i];
      let d = select(b.w - a.w, 1.0, b.w == a.w);
      let t = (s - a.w) / d;
      let dx = (b.x - a.x) / d;
      let dz = (b.y - a.y) / d;
      let cx = a.x + (b.x - a.x) * t - dz * params.side;
      let cz = a.y + (b.y - a.y) * t + dx * params.side;
      let y = a.z + (b.z - a.z) * t;
      let k = (v % params.vertices) * 3u;
      let n = params.vertices * 3u + k;
      let o = v * 3u;
      position[o] = cx - model[k] * dz - model[k + 2u] * dx;
      position[o + 1u] = y + model[k + 1u];
      position[o + 2u] = cz + model[k] * dx - model[k + 2u] * dz;
      normal[o] = -model[n] * dz - model[n + 2u] * dx;
      normal[o + 1u] = model[n + 1u];
      normal[o + 2u] = model[n] * dx - model[n + 2u] * dz;
    }`;
  // Upload lanes and the rebased trips; the CPU copy is refreshed only for picking (place()).
  const rebase = () => {
    const { device } = layer.renderer;
    if (gpu?.device !== device) {
      destroyGpu();
      gpu = {
        device,
        pipeline: device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: shader }), entryPoint: 'main' } }),
        params: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        template: storage(device, new Float32Array([...template.position, ...template.normal])),
      };
      lanesDirty = true;
    }
    if (lanesDirty) {
      const data = new Float32Array(lanes.reduce((count, lane) => count + lane.points.length, 0) * 4);
      let offset = 0;
      for (const lane of lanes) {
        lane.start = offset / 4;
        lane.points.forEach((point, i) => { data.set([point[0], point[1], point[2], lane.lengths[i]], offset); offset += 4; });
      }
      gpu.points?.destroy();
      gpu.points = storage(device, data);
      lanesDirty = false;
    }
    const data = new Float32Array(trips.length * 4), index = new Uint32Array(data.buffer);
    trips.forEach((trip, i) => {
      index[i * 4] = trip.lane.start;
      index[i * 4 + 1] = trip.lane.points.length;
      data[i * 4 + 2] = trip.distance;
      data[i * 4 + 3] = network.rate(trip.lane);
      mesh.extras.featureFaces[i].properties = trip.properties;
    });
    if (gpu.vehicles?.size >= data.byteLength) device.queue.writeBuffer(gpu.vehicles, 0, data);
    else {
      gpu.vehicles?.destroy();
      gpu.vehicles = storage(device, data);
    }
    const { position, normal } = mesh.geometry.attributes;
    gpu.bindGroup = device.createBindGroup({
      layout: gpu.pipeline.getBindGroupLayout(0),
      entries: [gpu.params, gpu.template, gpu.points, gpu.vehicles, position.buffer, normal.buffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  };
  const move = seconds => {
    const { device } = gpu;
    paramFloats[0] = elapsed = seconds;
    paramFloats[1] = network.side;
    paramInts[2] = vertices;
    paramInts[3] = trips.length * vertices;
    device.queue.writeBuffer(gpu.params, 0, params);
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(gpu.pipeline);
    pass.setBindGroup(0, gpu.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(paramInts[3] / 64));
    pass.end();
    device.queue.submit([encoder.finish()]);
    stale = true;
  };
  // CPU twin of the compute pass, run lazily before picking.
  const place = () => {
    if (!mesh || !stale) return;
    stale = false;
    const { position, normal } = mesh.geometry.attributes;
    trips.forEach((trip, i) => {
      const { points, lengths, length } = trip.lane;
      let distance = trip.distance + elapsed * network.rate(trip.lane);
      distance -= length * Math.floor(distance / length);
      const { x, y, z, dx, dz } = along(points, lengths, distance);
      const cx = x - dz * network.side, cz = z + dx * network.side;
      for (let k = 0, o = i * stride; k < stride; k += 3, o += 3) {
        const lx = template.position[k], lz = template.position[k + 2], nx = template.normal[k], nz = template.normal[k + 2];
        position.data[o] = cx - lx * dz - lz * dx;
        position.data[o + 1] = y + template.position[k + 1];
        position.data[o + 2] = cz + lx * dx - lz * dz;
        normal.data[o] = -nx * dz - nz * dx;
        normal.data[o + 1] = template.normal[k + 1];
        normal.data[o + 2] = nx * dx - nz * dz;
      }
    });
  };
  const raycast = layer.raycast;
  layer.raycast = function (...args) {
    place();
    return raycast.apply(this, args);
  };

  const tick = () => {
    frame = undefined;
    if (!ready || !layer._map) return;
    // Re-adding after the last GPU owner was removed can attach asynchronously.
    if (!layer.renderer) { frame = requestAnimationFrame(tick); return; }
    // A renderer change re-creates vertex buffers without STORAGE: rebuild the mesh.
    if (mesh && !(mesh.geometry.attributes.position.buffer.usage & GPUBufferUsage.STORAGE)) { tripsKey = null; nextCheck = -Infinity; }
    const { live, time } = now(), ms = time?.getTime(), valid = Number.isFinite(ms);
    let changed = false;
    // Trips only change at timetable/hour boundaries: re-check once per second while live.
    if (!live || !valid || !(ms >= rebasedAt && ms < nextCheck)) {
      let text;
      try {
        trips = valid ? network.trips(time, lanes) : [];
        text = valid ? network.status(trips, lanes) : `${network.label}: select a valid simulation date`;
      } catch (error) { return fail(error); }
      rebasedAt = ms;
      nextCheck = ms + 1000;
      const key = trips.map(trip => trip.id).join();
      changed = key !== tripsKey || (network.route && !route && lanes.length);
      if (network.route && !route && lanes.length) drawRoute();
      if (key !== tripsKey) { rebuild(); tripsKey = key; }
      if (mesh) rebase();
      if (status.textContent !== text) status.textContent = text;
      status.removeAttribute('role');
    }
    if (mesh) move((ms - rebasedAt) / 1000);
    if (mesh || changed) layer.update();
    if (live && valid) frame = requestAnimationFrame(tick);
  };
  const load = () => {
    const { time } = now();
    if (!Number.isFinite(time?.getTime())) return;
    request?.abort();
    const { signal } = request = new AbortController();
    network.load(time, layer, signal).then(next => {
      if (signal.aborted || !layer._map || next === lanes) return;
      lanes = next;
      prepare();
      if (!frame) tick();
    }, error => { if (error.name !== 'AbortError') fail(error); });
  };
  // 'layerremove' fires once the clock layer has really left the map.
  const update = event => {
    if (event?.layer === layer) return;
    cancelAnimationFrame(frame);
    load();
    tick();
  };
  const terrain = () => {
    if (!lanes.length) return;
    ground();
    dispose(route); route = null;
    if (mesh) bounds();
    if (!frame) tick();
  };
  const start = () => {
    layer._map.off('simulationtimechange layerremove', update).on('simulationtimechange layerremove', update);
    layer._map.off('terrainchange', terrain).on('terrainchange', terrain);
    layer._map.getContainer().querySelector('.leaflet-control-layers-list')?.append(status);
    update();
  };
  layer.on('ready', () => { ready = true; if (layer._map) start(); });
  layer.on('add', () => { if (ready) start(); });
  layer.on('remove', () => {
    request?.abort();
    cancelAnimationFrame(frame); frame = undefined;
    layer._map.off('simulationtimechange layerremove', update).off('terrainchange', terrain);
    dispose(mesh); dispose(route); mesh = route = null;
    destroyGpu();
    lanes = []; trips = []; tripsKey = null;
    status.textContent = `${network.label}: layer off`;
  });
}

// Moving vehicles on a network: `network: 'roads'` (default, measured Paris road counts) or 'seine' (Bateaux-Mouches timetable).
L.Layer.types.traffic = L.Layer.types['3d'].extend({
  initialize({ network = 'roads', url, radius, ...options } = {}) {
    if (!networks[network]) throw new Error(`Unknown traffic network: ${network}`);
    const source = networks[network]({ url, radius });
    L.Layer.types['3d'].prototype.initialize.call(this, { center: [48.85826, 2.29450], tooltipContent: source.tooltip, ...options });
    installTraffic(this, source);
  },
});
