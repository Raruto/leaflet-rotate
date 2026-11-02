import { box } from './vehicles.js';

// Pedestrian, about 1.77 m tall, prisms as in utils/vehicles.js (forward -z). Limbs hang from their pivot at y = 0.
const skin = [0.85, 0.64, 0.5], shirt = [0.75, 0.2, 0.15], trousers = [0.16, 0.2, 0.32], dark = [0.08, 0.07, 0.06];
export const parts = {
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
export const limbs = [['body', 0, 0, 0], ['leg', -0.09, 0.9, 1], ['leg', 0.09, 0.9, -1], ['arm', -0.25, 1.42, -1], ['arm', 0.25, 1.42, 1]];
// Walls (non-horizontal triangles) of a mesh in world space, bucketed by 8 m cells; `origin` is the world translation
// at build time, since layer roots only move vertically with the terrain afterwards.
export const CELL = 8;
const colliders = new WeakMap();
export function collider(mesh) {
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
export function horizontalRay(v, t, ox, oy, oz, dx, dz) {
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
