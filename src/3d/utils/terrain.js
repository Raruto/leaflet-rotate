/** Height inside a bridge deck, or null outside its triangles. */
export function bridgeElevation(point, bridges) {
  // Bridges bucketed by 64 DEM pixels.
  for (const bridge of bridges?.get(`${Math.floor(point.x / 64)}/${Math.floor(point.y / 64)}`) || []) {
    if (point.x < bridge.min[0] || point.x > bridge.max[0] || point.y < bridge.min[1] || point.y > bridge.max[1]) continue;
    for (const [a, b, c] of bridge.triangles) {
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const u = ((b[1] - c[1]) * (point.x - c[0]) + (c[0] - b[0]) * (point.y - c[1])) / d;
      const v = ((c[1] - a[1]) * (point.x - c[0]) + (a[0] - c[0]) * (point.y - c[1])) / d;
      if (u >= 0 && v >= 0 && u + v <= 1) return u * a[2] + v * b[2] + (1 - u - v) * c[2];
    }
  }
  return null;
}

/** Bilinear DEM sampling, with the original first-valid-neighbour no-data rule. */
export function terrainElevation(point, tiles) {
  const x = point.x - 0.5, y = point.y - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sample = (px, py) => {
    const tileX = Math.floor(px / 256), tileY = Math.floor(py / 256);
    const tile = tiles.get(`${tileX}/${tileY}`);
    if (!tile) return null;
    const elevation = tile[(py - tileY * 256) * 256 + px - tileX * 256];
    return Number.isFinite(elevation) && elevation > -1000 ? elevation : null;
  };
  const values = [sample(x0, y0), sample(x0 + 1, y0), sample(x0, y0 + 1), sample(x0 + 1, y0 + 1)];
  const valid = values.map((value, i) => Number.isFinite(value) ? i : -1).filter(i => i >= 0);
  if (!valid.length) return null;
  if (valid.length < 4) return values[valid[0]];
  return (values[0] * (1 - fx) + values[1] * fx) * (1 - fy) +
    (values[2] * (1 - fx) + values[3] * fx) * fy;
}

/** Unit tile grid; the vertex shader supplies the elevation. */
export function terrainGrid(divisions) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let row = 0; row <= divisions; row++) {
    for (let column = 0; column <= divisions; column++) {
      positions.push(column / divisions, 0, row / divisions);
      normals.push(0, 1, 0);
      uvs.push(column / divisions, row / divisions);
      if (row < divisions && column < divisions) {
        const a = row * (divisions + 1) + column;
        const b = a + 1, c = a + divisions + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  return {
    position: { size: 3, data: new Float32Array(positions) },
    normal:   { size: 3, data: new Float32Array(normals) },
    uv:       { size: 2, data: new Float32Array(uvs) },
    index:    { data: new Uint16Array(indices) },
  };
}

/** Float32 DEM atlas; missing samples retain the shader no-data sentinel. */
export function terrainAtlas(tiles, bounds) {
  const columns = bounds.max.x - bounds.min.x + 1, rows = bounds.max.y - bounds.min.y + 1;
  const elevations = new Float32Array(columns * rows * 65536).fill(-1e9);
  let low = Infinity, high = -Infinity;
  for (const [key, values] of tiles) {
    const [x, y] = key.split('/').map(Number);
    const start = (y - bounds.min.y) * 256 * columns * 256 + (x - bounds.min.x) * 256;
    for (let row = 0; row < 256; row++) {
      for (let column = 0; column < 256; column++) {
        const value = values[row * 256 + column];
        if (!Number.isFinite(value) || value <= -1000) continue;
        elevations[start + row * columns * 256 + column] = value;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
  }
  return { elevations, low, high };
}
