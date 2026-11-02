import './3d.js';
import { box, build } from '../utils/vehicles.js';

// Pedestrian, about 1.77 m tall, prisms as in utils/vehicles.js (forward -z). Limbs hang from their pivot at y = 0.
const skin = [0.85, 0.64, 0.5], shirt = [0.75, 0.2, 0.15], trousers = [0.16, 0.2, 0.32], dark = [0.08, 0.07, 0.06];
const parts = {
  body: [
    [box(-0.17, 0.17, -0.1, 0.1), 0.82, 0.95, trousers],
    [box(-0.19, 0.19, -0.11, 0.11), 0.95, 1.44, shirt],
    [box(-0.05, 0.05, -0.05, 0.05), 1.44, 1.5, skin],
    [box(-0.1, 0.1, -0.11, 0.1), 1.5, 1.72, skin],
    [box(-0.105, 0.105, -0.06, 0.115), 1.58, 1.77, dark],
    [box(-0.105, 0.105, -0.115, -0.06), 1.7, 1.77, dark],
  ],
  leg: [[box(-0.07, 0.07, -0.07, 0.07), -0.82, 0, trousers], [box(-0.07, 0.07, -0.17, 0.07), -0.9, -0.82, dark]],
  arm: [[box(-0.05, 0.05, -0.05, 0.05), -0.55, 0, shirt], [box(-0.045, 0.045, -0.045, 0.045), -0.66, -0.55, skin]],
};
// [part, pivot x, pivot y, swing sign]
const limbs = [['body', 0, 0, 0], ['leg', -0.09, 0.9, 1], ['leg', 0.09, 0.9, -1], ['arm', -0.25, 1.42, -1], ['arm', 0.25, 1.42, 1]];
// W/S (↑/↓) run forward/back along the heading, A/D (←/→) turn: [forward, turn].
const moves = { KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyD: [0, 1], ArrowRight: [0, 1], KeyA: [0, -1], ArrowLeft: [0, -1] };
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Walls (non-horizontal triangles) of a mesh in world space, bucketed by 8 m cells; `origin` is the world translation
// at build time, since layer roots only move vertically with the terrain afterwards.
const CELL = 8, colliders = new WeakMap();
function collider(mesh) {
  let c = colliders.get(mesh.geometry);
  if (c) return c;
  const m = mesh.worldMatrix, { position: { data: p }, index, normal, uv } = mesh.geometry.attributes;
  const count = index ? index.count : p.length / 3, tri = [], nrm = [], cells = new Map(), v = [];
  for (let i = 0; i < count; i += 3) {
    const first = index ? index.data[i] : i;
    // Streetlight halos (uv.x <= 2, see scene/picking.js) are light, not matter.
    if (mesh.program.nightLight && uv && uv.data[first * 2] <= 2) continue;
    for (let k = 0; k < 3; k++) {
      const j = (index ? index.data[i + k] : i + k) * 3, x = p[j], y = p[j + 1], z = p[j + 2];
      v[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      v[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      v[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const ex = v[3] - v[0], ey = v[4] - v[1], ez = v[5] - v[2], fx = v[6] - v[0], fy = v[7] - v[1], fz = v[8] - v[2];
    let nx = ey * fz - ez * fy, nz = ex * fy - ey * fx;
    const ny = ez * fx - ex * fz, length = Math.hypot(nx, ny, nz);
    if (!length || Math.abs(ny) > 0.9 * length) continue;
    if (normal) {
      // The stored normal tells the outside, whatever the winding.
      const j = first * 3, a = normal.data;
      if ((m[0] * a[j] + m[4] * a[j + 1] + m[8] * a[j + 2]) * nx + (m[2] * a[j] + m[6] * a[j + 1] + m[10] * a[j + 2]) * nz < 0) { nx = -nx; nz = -nz; }
    }
    const h = Math.hypot(nx, nz), t = nrm.length / 2;
    tri.push(...v); nrm.push(nx / h, nz / h);
    for (let ix = Math.floor(Math.min(v[0], v[3], v[6]) / CELL); ix <= Math.floor(Math.max(v[0], v[3], v[6]) / CELL); ix++)
      for (let iz = Math.floor(Math.min(v[2], v[5], v[8]) / CELL); iz <= Math.floor(Math.max(v[2], v[5], v[8]) / CELL); iz++) {
        const key = ix + ',' + iz;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(t);
      }
  }
  c = { tri: Float32Array.from(tri), nrm: Float32Array.from(nrm), cells, origin: [m[12], m[13], m[14]] };
  colliders.set(mesh.geometry, c);
  return c;
}

// Möller-Trumbore for the horizontal ray (ox, oy, oz) + d·(dx, 0, dz) against triangle t; returns d or -1.
function ray(v, t, ox, oy, oz, dx, dz) {
  const i = t * 9, ex = v[i + 3] - v[i], ey = v[i + 4] - v[i + 1], ez = v[i + 5] - v[i + 2];
  const fx = v[i + 6] - v[i], fy = v[i + 7] - v[i + 1], fz = v[i + 8] - v[i + 2];
  const px = -dz * fy, py = dz * fx - dx * fz, pz = dx * fy, det = ex * px + ey * py + ez * pz;
  if (Math.abs(det) < 1e-9) return -1;
  const tx = ox - v[i], ty = oy - v[i + 1], tz = oz - v[i + 2], u = (tx * px + ty * py + tz * pz) / det;
  if (u < 0 || u > 1) return -1;
  const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex, w = (dx * qx + dz * qz) / det;
  if (w < 0 || u + w > 1) return -1;
  return (fx * qx + fy * qy + fz * qz) / det;
}

// Horizontal normal of the nearest wall faced within `reach` metres of the feet at world (x, y, z), walking along
// the unit (dx, dz); knee and chest rays, so arches and tree crowns above the head let the walker through.
// ponytail: traffic vehicles and boats move on the GPU and are not obstacles.
function hit(layer, x, y, z, dx, dz, reach) {
  const types = globalThis.L.Layer.types, skip = other => other === layer ||
    ['terrain', 'traffic'].some(name => types[name] && other instanceof types[name]);
  layer._updateWorldMatrix(layer.scene, true);
  let best = reach, found = null;
  for (const other of layer._shared._layers) {
    if (skip(other)) continue;
    layer.traverse(other.root, mesh => {
      if (!mesh.visible) return true;
      if (!mesh.geometry?.attributes?.position?.data || mesh.program?.depthTest === false) return;
      if (!mesh.geometry.bounds) layer._computeBounds(mesh.geometry);
      const m = mesh.worldMatrix, { center: k, radius } = mesh.geometry.bounds;
      if (Math.hypot(m[0] * k[0] + m[4] * k[1] + m[8] * k[2] + m[12] - x, m[2] * k[0] + m[6] * k[1] + m[10] * k[2] + m[14] - z) >
        radius * Math.hypot(m[0], m[1], m[2]) + reach) return;
      const c = collider(mesh), ox = x - m[12] + c.origin[0], oy = y - m[13] + c.origin[1], oz = z - m[14] + c.origin[2];
      const seen = new Set();
      for (let ix = Math.floor(Math.min(ox, ox + dx * reach) / CELL); ix <= Math.floor(Math.max(ox, ox + dx * reach) / CELL); ix++)
        for (let iz = Math.floor(Math.min(oz, oz + dz * reach) / CELL); iz <= Math.floor(Math.max(oz, oz + dz * reach) / CELL); iz++)
          for (const t of c.cells.get(ix + ',' + iz) || []) {
            // Walls are one-way: walking out of a building (e.g. starting inside one) is allowed.
            if (seen.has(t) || dx * c.nrm[t * 2] + dz * c.nrm[t * 2 + 1] >= 0) continue;
            seen.add(t);
            for (const height of [0.4, 1.5]) {
              const d = ray(c.tri, t, ox, oy + height, oz, dx, dz);
              if (d >= 0 && d < best) { best = d; found = [c.nrm[t * 2], c.nrm[t * 2 + 1]]; }
            }
          }
    });
  }
  return found;
}

function installWalk(layer, { speed, distance, position }) {
  const L = globalThis.L, keys = new Set();
  // Map button (leaflet-bar look) toggling the walk; the key hint shows beside it while walking.
  const control = new L.Control({ position });
  const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
  container.style.cssText = 'display:flex;align-items:center;background:#fff;';
  const button = L.DomUtil.create('button', '', container);
  button.type = 'button';
  button.title = 'Walk';
  button.setAttribute('aria-label', 'Walk');
  button.setAttribute('aria-pressed', 'false');
  button.textContent = '🚶';
  button.style.cssText = 'width:30px;height:30px;padding:0;border:0;border-radius:4px;background:#fff;font-size:18px;line-height:30px;cursor:pointer;';
  const hint = L.DomUtil.create('small', '', container);
  hint.style.cssText = 'display:none;padding:0 8px;color:#333;white-space:nowrap;';
  hint.textContent = 'W/S: run · A/D: turn · drag: look around · Esc: exit';
  L.DomEvent.disableClickPropagation(container);
  control.onAdd = () => container;
  let meshes, frame, last, swing = 0, saved, drag;
  // Walker state: position, compass heading (radians, clockwise from north) and stride phase.
  const state = layer.walker = { latlng: null, heading: 0, phase: 0 };

  // Feet position in this layer's root space.
  const local = () => {
    const map = layer._map, crs = map.options.crs, origin = crs.project(layer.location), metres = Math.cos(layer.location.lat * Math.PI / 180);
    const p = crs.project(state.latlng), terrain = map._terrain3D?._terrainReady && map._terrain3D;
    const ground = (terrain && terrain._getElevation(state.latlng)) || 0;
    return [(p.x - origin.x) * metres, ground - layer.root.position[1], -(p.y - origin.y) * metres];
  };
  const place = () => {
    const [x, y, z] = local();
    // Model forward is -z; a yaw of -heading turns it to the compass heading (x east, -z north).
    const yaw = -state.heading, cos = Math.cos(yaw), sin = Math.sin(yaw);
    limbs.forEach(([, px, py, sign], i) => {
      const mesh = meshes[i];
      mesh.position[0] = x + px * cos; mesh.position[1] = y + py; mesh.position[2] = z - px * sin;
      mesh.rotation[0] = sign * swing * Math.sin(state.phase);
      mesh.rotation[1] = yaw;
    });
    layer.update();
  };

  const step = now => {
    frame = requestAnimationFrame(step);
    const map = layer._map, dt = Math.min(0.1, (now - (last ?? now)) / 1000);
    last = now;
    if (!layer.renderer) return;
    let changed = false;
    if (!meshes) { meshes = limbs.map(([part]) => layer._createMesh(build(parts[part]))); changed = true; }
    let forward = 0, turn = 0;
    for (const key of keys) { forward += moves[key]?.[0] || 0; turn += moves[key]?.[1] || 0; }
    forward = Math.sign(forward); turn = Math.sign(turn);
    if (turn) { state.heading = wrap(state.heading + turn * 2.5 * dt); changed = true; }
    if (forward) {
      const metres = forward * speed * dt, { lat, lng } = state.latlng, { position, scale } = layer.root;
      let east = Math.sin(state.heading) * metres, north = Math.cos(state.heading) * metres;
      const feet = local().map((value, i) => position[i] + scale[i] * value);
      // World x is east, z south; keep 0.3 m from walls and slide along the one in the way.
      const blocked = () => {
        const length = Math.hypot(east, north);
        return length > 1e-6 && hit(layer, feet[0], feet[1], feet[2], east / length, -north / length, length + 0.3);
      };
      const wall = blocked();
      if (wall) {
        const into = east * wall[0] - north * wall[1];
        east -= into * wall[0]; north += into * wall[1];
        if (blocked()) east = north = 0;
      }
      state.latlng = new L.LatLng(lat + north / 111320, lng + east / (111320 * Math.cos(lat * Math.PI / 180)));
      state.phase += Math.hypot(east, north) / 1.6 * Math.PI;
      changed = true;
    }
    if (forward || turn) {
      // The camera (looking along -bearing) swings back behind the walker.
      const bearing = map.getBearing() * Math.PI / 180, behind = wrap(-state.heading - bearing);
      if (Math.abs(behind) > 1e-3) map._setPitchAndBearing(map.getPitch(), (bearing + behind * Math.min(1, dt * 4)) * 180 / Math.PI);
      map.setView(state.latlng, map.getZoom(), { animate: false });
    }
    const target = forward ? 0.9 : 0;
    if (Math.abs(swing - target) > 1e-3) { swing += (target - swing) * Math.min(1, dt * 10); changed = true; }
    if (changed) place();
  };

  const onKey = event => {
    // Text fields and sliders keep their keys; buttons and checkboxes (e.g. the Walk button, focused once clicked) don't.
    if (event.target.closest?.('input:not([type=checkbox], [type=radio]), select, textarea, [contenteditable]') ||
      event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.type === 'keydown' && event.code === 'Escape') { stop(); return; }
    if (!moves[event.code]) return;
    event.preventDefault();
    if (event.type === 'keydown') keys.add(event.code); else keys.delete(event.code);
  };
  const onBlur = () => keys.clear();
  // Dragging only turns the camera around the walker: horizontal = bearing, vertical = pitch.
  const onPointer = event => {
    const map = layer._map;
    if (event.type === 'pointerdown') {
      if (event.button !== 0 || event.target.closest('.leaflet-control')) return;
      drag = { x: event.clientX, y: event.clientY };
      map.getContainer().setPointerCapture(event.pointerId);
    } else if (drag && event.type === 'pointermove') {
      map._setPitchAndBearing(Math.max(20, Math.min(85, map.getPitch() - (event.clientY - drag.y) * 0.2)),
        map.getBearing() - (event.clientX - drag.x) * 0.25);
      drag = { x: event.clientX, y: event.clientY };
    } else drag = null;
  };
  const onTerrain = () => { if (meshes) place(); };

  const start = () => {
    const map = layer._map;
    if (saved || !map) return;
    state.latlng = map.getCenter();
    // Zoom whose camera distance (1.5 viewport heights, as in scene/render.js) is about `distance` metres behind the walker.
    const pixelsPerMetre = map.getSize().y * 1.5 / distance;
    const zoom = Math.min(map.getMaxZoom(), Math.log2(pixelsPerMetre * 40075016.68557849 * Math.cos(state.latlng.lat * Math.PI / 180) / 256));
    saved = { zoom: map.getZoom(), pitch: map.getPitch(), scrollWheelZoom: map.options.scrollWheelZoom,
      handlers: ['dragging', 'keyboard', 'doubleClickZoom', 'boxZoom'].filter(name => map[name]?.enabled()) };
    for (const name of saved.handlers) map[name].disable();
    // Wheel zoom moves the camera closer or farther, keeping the walker centred.
    map.options.scrollWheelZoom = saved.scrollWheelZoom && 'center';
    state.heading = -map.getBearing() * Math.PI / 180;
    map.setView(state.latlng, zoom, { animate: false });
    map.setPitch(75);
    L.DomEvent.on(document, 'keydown keyup', onKey);
    L.DomEvent.on(window, 'blur', onBlur);
    L.DomEvent.on(map.getContainer(), 'pointerdown pointermove pointerup pointercancel', onPointer);
    map.on('terrainchange', onTerrain);
    button.setAttribute('aria-pressed', 'true');
    button.style.background = '#e4e4e4';
    hint.style.display = '';
    last = undefined;
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    const map = layer._map;
    cancelAnimationFrame(frame);
    keys.clear(); drag = null;
    L.DomEvent.off(document, 'keydown keyup', onKey);
    L.DomEvent.off(window, 'blur', onBlur);
    for (const mesh of meshes || []) layer._disposeMesh(mesh);
    meshes = null;
    button.setAttribute('aria-pressed', 'false');
    button.style.background = '#fff';
    hint.style.display = 'none';
    if (!map || !saved) return;
    L.DomEvent.off(map.getContainer(), 'pointerdown pointermove pointerup pointercancel', onPointer);
    map.off('terrainchange', onTerrain);
    map.options.scrollWheelZoom = saved.scrollWheelZoom;
    for (const name of saved.handlers) map[name].enable();
    map.setView(state.latlng, saved.zoom, { animate: false });
    map.setPitch(saved.pitch);
    saved = null;
  };
  L.DomEvent.on(button, 'click', () => (saved ? stop() : start()));
  let ready = false;
  layer.on('ready', () => { ready = true; if (layer._map) control.addTo(layer._map); });
  layer.on('add', () => { if (ready) control.addTo(layer._map); });
  layer.on('remove', () => { stop(); control.remove(); });
}

/**
 * Third-person walk mode, toggled by a map button (and Esc): a pedestrian at the map centre runs with W/S (or ↑/↓) and
 * turns with A/D (or ←/→); the camera swings back behind it while it moves. Dragging the map only turns the camera
 * (bearing, pitch); the wheel changes the camera distance.
 * The walker follows the terrain, bridges included, and `layer.walker` exposes `{ latlng, heading, phase }`.
 * Source options: `speed` (m/s, default 6), `distance` (camera distance in metres, default 20), `position` (button corner, default 'topleft').
 * Visible meshes of the other 3D layers (buildings, trees, models, streetlights) are solid; terrain and traffic are not.
 */
L.Layer.types.walk = L.Layer.types['3d'].extend({
  initialize({ speed = 70, distance = 20, position = 'bottomright', ...options } = {}) {
    L.Layer.types['3d'].prototype.initialize.call(this, options);
    installWalk(this, { speed, distance, position });
  },
});
