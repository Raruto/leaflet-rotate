import { computeBounds } from './geometry.js';

/** Nearest triangle hit per mesh, sorted by world-space distance. */
export function intersectMeshes(ray, meshes, night = 0) {
  const hits = [],
             a = [0, 0, 0],
             b = [0, 0, 0],
             c = [0, 0, 0],
           sub = (a, b) => a.map((v, i) => v - b[i]),
         cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
          dot  = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  for (const mesh of meshes) {
    // Test in mesh-local space; compare distances only after returning to shared world space.
    const inverse       = new DOMMatrix(mesh.worldMatrix).inverse();
    const inverseValues = inverse.toFloat64Array();
    if (![...inverseValues].every(Number.isFinite)) {
      throw new Error('Singular 3D transform');
    }
    const localOrigin    = new DOMPoint(...ray.origin, 1).matrixTransform(inverse);
    const origin         = [
      localOrigin.x / localOrigin.w,
      localOrigin.y / localOrigin.w,
      localOrigin.z / localOrigin.w
    ];
    const localDirection  = new DOMPoint(...ray.direction, 0).matrixTransform(inverse);
    const direction       = [
      localDirection.x,
      localDirection.y,
      localDirection.z
    ];
    const directionLength = Math.hypot(...direction) || 1;
    direction[0] /= directionLength; direction[1] /= directionLength; direction[2] /= directionLength;
    // AABB slab test reuses the same local ray as the triangle test.
    if (!mesh.geometry.bounds) {
      computeBounds(mesh.geometry);
    }
    let near = 0, far = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(direction[i]) < 1e-12) {
        if (origin[i] < mesh.geometry.bounds.min[i] || origin[i] > mesh.geometry.bounds.max[i]) {
          far = -Infinity;
          break;
        }
      } else {
        const a = (mesh.geometry.bounds.min[i] - origin[i]) / direction[i],
              b = (mesh.geometry.bounds.max[i] - origin[i]) / direction[i];
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
    }
    if (far < near) {
      continue;
    }
    const { position, index } = mesh.geometry.attributes;
    let closest = Infinity, faceIndex;
    for (let i = 0; i < (index?.count || position.count); i += 3) {
      const ai = (index ? index.data[i] : i) * position.size;
      const bi = (index ? index.data[i + 1] : i + 1) * position.size;
      const ci = (index ? index.data[i + 2] : i + 2) * position.size;
      a[0] = position.data[ai];
      a[1] = position.data[ai + 1];
      a[2] = position.data[ai + 2];
      b[0] = position.data[bi];
      b[1] = position.data[bi + 1];
      b[2] = position.data[bi + 2];
      c[0] = position.data[ci];
      c[1] = position.data[ci + 1];
      c[2] = position.data[ci + 2];
      // Moller-Trumbore: barycentric triangle coordinates and local ray distance.
      const e = sub(b, a),
            f = sub(c, a),
            p = cross(direction, f),
            det = dot(e, p);
      if (mesh.program.cullFace !== null ? det < 1e-9 : Math.abs(det) < 1e-9) {
        continue;
      }
      const t = sub(origin, a),
            u = dot(t, p) / det;
      if (u < 0 || u > 1) {
        continue;
      }
      const q = cross(t, e),
            v = dot(direction, q) / det;
      if (v < 0 || u + v > 1) {
        continue;
      }
      if (mesh.program.nightLight) {
        const uv = mesh.geometry.attributes.uv.data;
        const ids = index ? [index.data[i], index.data[i + 1], index.data[i + 2]] : [i, i + 1, i + 2];
        const x = uv[ids[0] * 2] * (1 - u - v) + uv[ids[1] * 2] * u + uv[ids[2] * 2] * v;
        const y = uv[ids[0] * 2 + 1] * (1 - u - v) + uv[ids[1] * 2 + 1] * u + uv[ids[2] * 2 + 1] * v;
        if (x <= 2 && (!night || x * x + y * y > 0.9)) continue;
      }
      const distance = dot(f, q) / det;
      if (distance > 0 && distance < closest) {
        closest = distance; faceIndex = i / 3;
      }
    }
    if (faceIndex === undefined) continue;
    const point = new DOMPoint(
      direction[0] * closest + origin[0],
      direction[1] * closest + origin[1],
      direction[2] * closest + origin[2],
      1
    ).matrixTransform(new DOMMatrix(mesh.worldMatrix));
    const worldPoint = [point.x / point.w, point.y / point.w, point.z / point.w];
    hits.push({
      faceIndex,
      object:     mesh,
      point:      worldPoint,
      distance:   Math.hypot(
        worldPoint[0] - ray.origin[0],
        worldPoint[1] - ray.origin[1],
        worldPoint[2] - ray.origin[2]
      )
    });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}
