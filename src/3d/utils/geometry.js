/**
 * HSL inputs are linear-space to preserve the original building styling.
 * Numeric/CSS/RGB inputs are already sRGB; CSS alpha is not used for extrusion.
 * @param {number|string|Object} value 0xRRGGBB, CSS color, {r,g,b}, or {h,s,l} in 0..1.
 * @returns {Object} sRGB {r,g,b} components in 0..1.
 */
export function parseColor(value) {
  if (value && typeof value === 'object' && 'h' in value) {
    const { h, s, l } = value;
    const a = s * Math.min(l, 1 - l);
    const channel = n => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const toSRGB = value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    return { r: toSRGB(channel(0)), g: toSRGB(channel(8)), b: toSRGB(channel(4)) };
  }
  if (value && typeof value === 'object' && 'r' in value) return value;
  if (typeof value === 'number') return {
    r: (value >> 16 & 255) / 255, g: (value >> 8 & 255) / 255, b: (value & 255) / 255,
  };
  if (typeof value !== 'string' || !CSS.supports('color', value)) throw new Error('Invalid 3D color');
  const context = document.createElement('canvas').getContext('2d');
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/**
 * Paints the vertices `[start, end)` of a mesh and marks its color buffer dirty.
 * @param {Object} mesh Layer-created mesh with a color attribute.
 * @param {number} start Inclusive vertex index, not an offset into the RGB array.
 * @param {number} end Exclusive vertex index.
 * @param {Object} color sRGB {r,g,b}, typically from parseColor().
 */
export function setVertexColor(mesh, start, end, color) {
  for (let i = start; i < end; i++) {
    mesh.geometry.attributes.color.data.set([color.r, color.g, color.b], i * 3);
  }
  mesh.geometry.attributes.color.needsUpdate = true;
}

/**
 * Triangulates a polygon given as `{x, y}` points.
 * Rings omit the repeated closing point; winding is normalized internally.
 * Vertex indices remain relative to the original inputs after duplicate/collinear
 * cleanup. Hole bridges duplicate endpoints, not source vertices.
 * @param {Object[]} contour Outer boundary.
 * @param {Object[][]} [holes] Interior boundaries.
 *
 * @returns {number[][]} Triangles as indices in `[...contour, ...holes.flat()]`.
 */
export function triangulate(contour, holes = []) {
  const points = [contour, ...holes].flat();
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid polygon coordinates');
  // Translate near the origin to avoid cancellation with geographic coordinates.
  const vertices = points.map((p, index) => ({ x: p.x - contour[0].x, y: p.y - contour[0].y, index }));
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const equal = (a, b) => a.x === b.x && a.y === b.y;
  // Remove zero-area corners before connecting holes; keep original vertex indices.
  const clean = ring => {
    let changed = true;
    while (changed && ring.length > 3) {
      changed = false;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
        if (equal(a, b) || Math.abs(cross(a, b, c)) < 1e-10) {
          ring.splice(i, 1); changed = true; break;
        }
      }
    }
    if (ring.length < 3) throw new Error('Degenerate polygon ring');
    return ring;
  };
  let offset = 0;
  const rings = [contour, ...holes].map((path, index) => {
    const ring = clean(vertices.slice(offset, offset += path.length));
    if (isClockWise(ring) !== Boolean(index)) ring.reverse();
    return ring;
  });
  const inside = (point, ring) => {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
    }
    return result;
  };
  const intersects = (a, b, c, d) => {
    if (equal(a, c) || equal(a, d) || equal(b, c) || equal(b, d)) return false;
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    const on = (p, q, r) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) &&
      Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
    return abC * abD < 0 && cdA * cdB < 0 ||
      abC === 0 && on(a, b, c) || abD === 0 && on(a, b, d) ||
      cdA === 0 && on(c, d, a) || cdB === 0 && on(c, d, b);
  };
  let polygon = rings[0].slice();
  // A bridge must stay inside the outer boundary, outside every hole, and cross no edge.
  // ponytail: quadratic ear clipping for building footprints; use spatial indexing for large rings.
  for (const hole of rings.slice(1).sort((a, b) => Math.min(...a.map(p => p.x)) - Math.min(...b.map(p => p.x)))) {
    let bridge, distance = Infinity;
    for (let h = 0; h < hole.length; h++) for (let p = 0; p < polygon.length; p++) {
      const a = hole[h], b = polygon[p], d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (d >= distance) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!inside(mid, rings[0]) || rings.slice(1).some(r => inside(mid, r))) continue;
      if ([polygon, ...rings.slice(1)].some(r => r.some((c, i) => intersects(a, b, c, r[(i + 1) % r.length])))) continue;
      bridge = [h, p]; distance = d;
    }
    if (!bridge) throw new Error('Unable to connect polygon hole');
    const [h, p] = bridge;
    polygon = [...polygon.slice(0, p + 1), ...hole.slice(h), ...hole.slice(0, h + 1),
    polygon[p], ...polygon.slice(p + 1)];
  }
  // Clip a convex corner only when no other vertex is inside/on its triangle.
  const result = [];
  while (polygon.length > 3) {
    let clipped = false;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[(i + polygon.length - 1) % polygon.length], b = polygon[i], c = polygon[(i + 1) % polygon.length];
      if (cross(a, b, c) <= 1e-10) continue;
      if (polygon.some(p => !equal(p, a) && !equal(p, b) && !equal(p, c) &&
        cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0)) continue;
      result.push([a.index, b.index, c.index]); polygon.splice(i, 1); clipped = true; break;
    }
    if (!clipped) throw new Error('Unable to triangulate polygon: invalid or self-intersecting rings');
  }
  if (cross(...polygon) > 1e-10) result.push(polygon.map(p => p.index));
  const area = ring => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
  // Reject incomplete coverage instead of silently emitting a partial roof.
  const expected = area(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + area(ring), 0);
  const actual = result.reduce((sum, triangle) => sum + cross(...triangle.map(i => vertices[i])) / 2, 0);
  if (expected <= 0 || Math.abs(actual - expected) > Math.max(1e-7, expected * 1e-8)) throw new Error('Polygon triangulation area mismatch');
  return result;
}

/**
 * @returns {boolean} Whether the `{x, y}` points are in clockwise order.
 */
export function isClockWise(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0;
}

/** Low-poly tree, sharing the source block's buffers, picking and terrain offset. */
export function treeGeometry(point, style, addTriangle) {
  const { top, bottom = 0, trunkRadius, crownRadius, crownBottom, crownShape = 'round' } = style;
  if (![trunkRadius, crownRadius, crownBottom].every(Number.isFinite) ||
    trunkRadius <= 0 || crownRadius < trunkRadius || crownBottom <= bottom || crownBottom >= top ||
    !['round', 'cone'].includes(crownShape)) {
      throw new Error('Invalid tree dimensions or crown shape');
    }
  const trunk = parseColor(style.trunkColor ?? 0x72513a);
  const crown = parseColor(style.color ?? 0x4f823b);
  const ring = radius => Array.from({ length: 8 }, (_, i) => ({
    x: point.x + Math.cos(i * Math.PI / 4) * radius,
    y: point.y + Math.sin(i * Math.PI / 4) * radius,
    ground: point.ground,
  }));
  const surface = (lowRadius, low, highRadius, high, color) => {
    const lower = ring(lowRadius), upper = ring(highRadius);
    for (let i = 0; i < 8; i++) {
      const next = (i + 1) % 8;
      const angle = (i + 0.5) * Math.PI / 4;
      const slope = (lowRadius - highRadius) / (high - low);
      const length = Math.hypot(1, slope);
      const nx = Math.cos(angle) / length, ny = slope / length, nz = -Math.sin(angle) / length;
      if (lowRadius) addTriangle(lower[i], low, lower[next], low, upper[next], high, nx, ny, nz, color);
      if (highRadius) addTriangle(lower[i], low, upper[next], high, upper[i], high, nx, ny, nz, color);
    }
  };
  surface(trunkRadius, bottom, trunkRadius, crownBottom + (top - crownBottom) * 0.25, trunk);
  if (crownShape === 'cone') {
    const base = ring(crownRadius);
    for (let i = 0; i < 8; i++) addTriangle(point, crownBottom, base[i], crownBottom,
      base[(i + 1) % 8], crownBottom, 0, -1, 0, crown);
    surface(crownRadius, crownBottom, 0, top, crown);
  } else {
    const profile = [[0, 0], [0.35, 0.8], [0.6, 1], [0.85, 0.7], [1, 0]];
    for (let i = 1; i < profile.length; i++) {
      const [low, lr] = profile[i - 1], [high, hr] = profile[i];
      surface(lr * crownRadius, crownBottom + low * (top - crownBottom),
        hr * crownRadius, crownBottom + high * (top - crownBottom), crown);
    }
  }
}

/** Three crossed emitter discs; illumination itself is evaluated on receiving surfaces. */
export function lightGeometry(point, style, addTriangle) {
  if (!Number.isFinite(style.lightRadius) || style.lightRadius <= 0) throw new Error('Invalid light radius');
  const color = parseColor(style.color);
  const quad = (a, b, c, d, height, normal) => {
    addTriangle(a, height, b, height, c, height, ...normal, color);
    addTriangle(a, height, c, height, d, height, ...normal, color);
  };
  const r = 0.65;
  const emitter = (u, v, axis) => ({
    x: point.x + (axis === 2 ? 0 : u * r),
    y: point.y + (axis === 1 ? 0 : axis === 2 ? u * r : v * r),
    ground: point.ground + (axis === 0 ? 0 : v * r), uv: [u, v],
  });
  for (let axis = 0; axis < 3; axis++) {
    quad(emitter(-1, -1, axis), emitter(1, -1, axis), emitter(1, 1, axis), emitter(-1, 1, axis),
      style.top, axis === 0 ? [0, 1, 0] : axis === 1 ? [0, 0, 1] : [1, 0, 0]);
  }
}

/** Schematic support and lamp head; wall-mounted fixtures do not get an invented pole. */
export function lampPostGeometry(point, style, addTriangle) {
  const color = parseColor(0x50565a), radius = style.poleRadius;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Invalid lamp pole radius');
  const ring = r => Array.from({ length: 6 }, (_, i) => ({
    x: point.x + Math.cos(i * Math.PI / 3) * r,
    y: point.y + Math.sin(i * Math.PI / 3) * r, ground: point.ground, uv: [3, 3],
  }));
  const center = { ...point, uv: [3, 3] };
  for (const [r, low, high] of [[radius, 0, style.top], [radius * 2.5, style.top - 0.25, style.top + 0.15]]) {
    const points = ring(r);
    for (let i = 0; i < 6; i++) {
      const a = points[i], b = points[(i + 1) % 6], angle = (i + 0.5) * Math.PI / 3;
      const nx = Math.cos(angle), nz = -Math.sin(angle);
      addTriangle(a, low, b, low, b, high, nx, 0, nz, color);
      addTriangle(a, low, b, high, a, high, nx, 0, nz, color);
      addTriangle(center, high, a, high, b, high, 0, 1, 0, color);
      addTriangle(center, low, b, low, a, low, 0, -1, 0, color);
    }
  }
}

/** Cache local AABB and center for ray picking and transparent mesh sorting. */
export function computeBounds(geometry) {
  const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity],
        data = geometry.attributes.position.data;
  for (let i = 0; i < data.length; i++) {
    min[i % 3] = Math.min(min[i % 3], data[i]);
    max[i % 3] = Math.max(max[i % 3], data[i]);
  }
  const center = min.map((v, i) => (v + max[i]) / 2);
  let radius = 0;
  for (let i = 0; i < data.length; i += 3) {
    radius = Math.max(radius, Math.hypot(
      data[i] - center[0], data[i + 1] - center[1], data[i + 2] - center[2]
    ));
  }
  geometry.bounds = { min, max, center, radius };
}
