import './3d.js';
import { along, scheduledTrips, speed, vehicleOffsets } from '../utils/traffic.js';
import { build, vehicles } from '../utils/vehicles.js';
import { underEntry } from '../utils/control.js';

// GeoJSON (Multi)LineStrings become lanes ({latlngs, properties, elevation?}); prepare() adds `points` ([x, z, ground]),
// `lengths` and `length` in layer-local metres.
const toLanes = ({ features = [] }) => features.flatMap(({ geometry, properties }) => {
  const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
  return lines.map(line => ({ latlngs: line.map(([lng, lat]) => [lat, lng]), properties: properties ?? {}, elevation: properties?.elevation }));
});

// A lane with a `timetable` runs scheduled trips end to end; one with a `flow` (vehicles/h) loops evenly spaced vehicles.
const tripsAt = (time, lanes, velocity) => lanes.flatMap((lane, l) => {
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

const tooltip = ({ properties: p }) => {
  const content = document.createElement('div');
  content.style.whiteSpace = 'pre-line';
  content.textContent = [p.name, p.departure && `Departure ${p.departure} ${p.timetable.timeZone}`, p.description].filter(Boolean).join('\n');
  return content;
};

function installTraffic(layer, { url, model, lights, side, outline, velocity }) {
  const L = globalThis.L;
  // The 'sunlight' layer on the same map drives the simulation time; without one, vehicles run live.
  const now = () => {
    let control = { live: true };
    layer._map?.eachLayer(other => { if (other.control?.time) control = other.control; });
    return { live: control.live, time: control.live ? new Date() : control.time };
  };
  const status = L.DomUtil.create('small', 'traffic-status');
  status.style.cssText = 'display:block;max-width:200px;margin:0 0 4px 20px;color:#555;';
  const template = build(model(0)), stride = template.position.length, vertices = stride / 3;
  let ready = false, frame, request, lanes = [], tripsKey, mesh, route, deck, litAt = -Infinity;
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
    status.textContent = `Error: ${error.message}`;
    status.setAttribute('role', 'alert');
    console.error('Traffic layer', error);
  };

  const ground = () => {
    const terrain = layer._map._terrain3D?._terrainReady && layer._map._terrain3D, base = layer.root.position[1];
    for (const lane of lanes) lane.points.forEach((point, i) => {
      const elevation = terrain && (lane.elevation ?? terrain._getElevation(lane.latlngs[i]));
      point[2] = Number.isFinite(elevation) && Number.isFinite(base) ? elevation - base : 0;
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
    dispose(route); dispose(deck); route = deck = null;
    tripsKey = null;
  };

  // Dashed lane outline, just above the lanes.
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
        const p = [a[0] + dx * start, a[1] + dz * start], q = [a[0] + dx * end, a[1] + dz * end], y = a[2] + 0.4;
        for (const point of [[p[0] - x, p[1] - z], [p[0] + x, p[1] + z], [q[0] + x, q[1] + z],
          [p[0] - x, p[1] - z], [q[0] + x, q[1] + z], [q[0] - x, q[1] - z]]) {
          position.push(point[0], y, point[1]); normal.push(0, 1, 0); color.push(0.08, 0.7, 0.85);
        }
      }
    }
    route = createMesh({ position, normal, color }, [], { emissive: [0.03, 0.25, 0.3], alphaMode: 'BLEND' });
    route.renderOrder = 1000;
  };
  // Bare-earth DEMs drop bridge decks: where a lane runs 2 m or more above the terrain, draw a 10 m wide, 1.2 m thick deck.
  const drawDeck = () => {
    const terrain = layer._map._terrain3D, base = layer.root.position[1], position = [], normal = [], color = [];
    deck = false;
    if (!terrain?._terrainReady) return;
    const quad = (corners, n) => {
      for (const i of [0, 1, 2, 0, 2, 3]) { position.push(...corners[i]); normal.push(...n); color.push(0.6, 0.58, 0.54); }
    };
    for (const { points, lengths, latlngs } of lanes) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = lengths[i] - lengths[i - 1];
      if (!length) continue;
      const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length, steps = Math.ceil(length / 4);
      const at = t => [a[0] + (b[0] - a[0]) * t - uz * side, a[2] + (b[2] - a[2]) * t - 0.02, a[1] + (b[1] - a[1]) * t + ux * side];
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps, lat = latlngs[i - 1][0] + (latlngs[i][0] - latlngs[i - 1][0]) * t;
        const elevation = terrain._getElevation([lat, latlngs[i - 1][1] + (latlngs[i][1] - latlngs[i - 1][1]) * t]);
        if (!Number.isFinite(elevation) || a[2] + (b[2] - a[2]) * t - (elevation - base) < 2) continue;
        const p = at(k / steps), q = at((k + 1) / steps), x = -uz * 5, z = ux * 5;
        const [pl, pr, ql, qr] = [[p, -1], [p, 1], [q, -1], [q, 1]].map(([[px, py, pz], s]) => [px + x * s, py, pz + z * s]);
        const below = c => [c[0], c[1] - 1.2, c[2]];
        quad([pl, pr, qr, ql], [0, 1, 0]);
        quad([below(pl), below(ql), below(qr), below(pr)], [0, -1, 0]);
        quad([pr, below(pr), below(qr), qr], [-uz, 0, ux]);
        quad([pl, ql, below(ql), below(pl)], [uz, 0, -ux]);
      }
    }
    if (position.length) deck = createMesh({ position, normal, color }, []);
  };

  // One batched mesh, `vertices` per vehicle; the compute pass writes its position/normal buffers (STORAGE).
  const rebuild = () => {
    dispose(mesh); mesh = null;
    if (!trips.length) return;
    const color = trips.flatMap((trip, i) => build(model(i)).color), count = color.length / 3;
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
      data[i * 4 + 3] = trip.speed;
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
    paramFloats[1] = side;
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
  // CPU twin of the compute pass: the centre of `trip` and its heading.
  const locate = trip => {
    const { points, lengths, length } = trip.lane;
    let distance = trip.distance + elapsed * trip.speed;
    distance -= length * Math.floor(distance / length);
    const { x, y, z, dx, dz } = along(points, lengths, distance);
    return { x: x - dz * side, y, z: z + dx * side, dx, dz };
  };
  // Run lazily before picking.
  const place = () => {
    if (!mesh || !stale) return;
    stale = false;
    const { position, normal } = mesh.geometry.attributes;
    trips.forEach((trip, i) => {
      const { x: cx, y, z: cz, dx, dz } = locate(trip);
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
        trips = valid ? tripsAt(time, lanes, velocity) : [];
        text = !valid ? 'Select a valid simulation date' : !loaded ? 'Loading…' :
          `${trips.length} vehicle${trips.length === 1 ? '' : 's'}${loaded.note ? ` · ${loaded.note}` : ''}`;
      } catch (error) { return fail(error); }
      rebasedAt = ms;
      nextCheck = ms + 1000;
      const key = trips.map(trip => trip.id).join();
      changed = key !== tripsKey || (outline && !route && lanes.length);
      if (outline && !route && lanes.length) drawRoute();
      if (deck == null && lanes.length) { drawDeck(); changed ||= Boolean(deck); }
      if (key !== tripsKey) { rebuild(); tripsKey = key; }
      if (mesh) rebase();
      if (status.textContent !== text) status.textContent = text;
      status.removeAttribute('role');
    }
    if (mesh) move((ms - rebasedAt) / 1000);
    // ponytail: night point lights follow the vehicles at 10 Hz via the shared CPU light grid (~5 ms with thousands of lamps);
    // bin the lights in a compute pass if it shows up in profiles.
    if (mesh && lights && (!live || !(performance.now() - litAt < 100))) {
      litAt = performance.now();
      mesh.extras.lights = trips.flatMap(trip => {
        const { x, y, z, dx, dz } = locate(trip);
        return lights.map(({ position: [lx, ly, lz], ...light }) => ({ ...light, position: [x - lx * dz - lz * dx, y + ly, z + lx * dx - lz * dz] }));
      });
    }
    if (mesh || changed) layer.update();
    if (live && valid) frame = requestAnimationFrame(tick);
  };
  let loaded, file;
  // A JS module serves time-dependent lanes; anything else is a static GeoJSON file, fetched once.
  const fetchLanes = async (time, signal) => {
    const href = new URL(url, document.baseURI).href;
    if (/\.m?js(?:[?#]|$)/i.test(url)) return (await import(href)).default(time, layer, signal);
    if (!file) {
      const response = await fetch(href, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      file = await response.json();
    }
    return file;
  };
  const load = () => {
    const { time } = now();
    if (!Number.isFinite(time?.getTime())) return;
    request?.abort();
    const { signal } = request = new AbortController();
    fetchLanes(time, signal).then(data => {
      if (signal.aborted || !layer._map || data === loaded) return;
      loaded = data;
      lanes = toLanes(data);
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
    dispose(route); dispose(deck); route = deck = null;
    if (mesh) bounds();
    if (!frame) tick();
  };
  const start = () => {
    layer._map.off('simulationtimechange layerremove', update).on('simulationtimechange layerremove', update);
    layer._map.off('terrainchange', terrain).on('terrainchange', terrain);
    underEntry(layer, status);
    update();
  };
  layer.on('ready', () => { ready = true; if (layer._map) start(); });
  layer.on('add', () => { if (ready) start(); });
  layer.on('remove', () => {
    request?.abort();
    cancelAnimationFrame(frame); frame = undefined;
    layer._map.off('simulationtimechange layerremove', update).off('terrainchange', terrain);
    dispose(mesh); dispose(route); dispose(deck); mesh = route = deck = null;
    destroyGpu();
    lanes = []; trips = []; tripsKey = loaded = null;
  });
}

/**
 * Vehicles moving along GeoJSON lanes; a compute pass places them on the GPU every frame.
 * Source options:
 * - `url`: GeoJSON (Multi)LineStrings, or a JS module whose default export `(time, layer, signal)` returns them (time-dependent data);
 * - `vehicle`: 'car' (default) or 'boat'; `side`: offset right of the lane centreline in metres (vehicle default);
 * - `speed`: m/s of `flow` lanes; `outline`: draw the lanes.
 * Lane properties: `flow` (vehicles/h) or `timetable` (see scheduledTrips in utils/traffic.js), optional fixed `elevation`
 * in metres, `name`/`description` for the default tooltip. The status line (vehicle count, then the FeatureCollection `note`) sits under the layer's entry in the layers control.
 * The 'sunlight' layer on the same map drives the time; without one, vehicles run live.
 */
L.Layer.types.traffic = L.Layer.types['3d'].extend({
  initialize({ url, vehicle = 'car', side, outline = false, speed: velocity = speed, ...options } = {}) {
    if (!url) throw new Error('Traffic needs a source url');
    if (!vehicles[vehicle]) throw new Error(`Unknown vehicle: ${vehicle}`);
    L.Layer.types['3d'].prototype.initialize.call(this, { tooltipContent: tooltip, nightLight: Boolean(vehicles[vehicle].lights), ...options });
    installTraffic(this, { url, ...vehicles[vehicle], side: side ?? vehicles[vehicle].side, outline, velocity });
  },
});
