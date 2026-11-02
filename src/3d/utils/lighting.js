/** Pack world-space point lights into the shader's spatial grid. */
export function lightGrid(packed, maxBytes) {
  const count = packed.reduce((sum, values) => sum + values.length / 8, 0), cellSize = 32;
  let data = new Float32Array(8);
  if (count) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const values of packed) for (let i = 0; i < values.length; i += 8) {
      minX = Math.min(minX, values[i] - values[i + 3]); maxX = Math.max(maxX, values[i] + values[i + 3]);
      minZ = Math.min(minZ, values[i + 2] - values[i + 3]); maxZ = Math.max(maxZ, values[i + 2] + values[i + 3]);
    }
    const columns = Math.ceil((maxX - minX) / cellSize) + 1, rows = Math.ceil((maxZ - minZ) / cellSize) + 1;
    const each = callback => {
      for (const values of packed) for (let i = 0; i < values.length; i += 8) {
        const radius = values[i + 3], x = values[i] - minX, z = values[i + 2] - minZ;
        for (let y = Math.floor((z - radius) / cellSize); y <= Math.floor((z + radius) / cellSize); y++) {
          for (let c = Math.floor((x - radius) / cellSize); c <= Math.floor((x + radius) / cellSize); c++) callback(y * columns + c, values, i);
        }
      }
    };
    // Counting sort: count the lights of each cell, then fill each cell's slice.
    const counts = new Uint32Array(columns * rows), next = new Uint32Array(columns * rows);
    each(key => counts[key]++);
    const entries = counts.reduce((sum, value) => sum + value, 0);
    const length = (2 + columns * rows + entries * 2) * 4;
    if (length * 4 > maxBytes) throw new Error('Streetlight grid exceeds GPU storage limit');
    data = new Float32Array(length);
    data.set([minX, minZ, cellSize, columns, rows, count, 0, 0]);
    let offset = 2 + columns * rows;
    for (let key = 0; key < counts.length; key++) if (counts[key]) {
      data[(2 + key) * 4] = next[key] = offset;
      data[(2 + key) * 4 + 1] = counts[key];
      offset += counts[key] * 2;
    }
    each((key, values, i) => {
      for (let j = 0, o = next[key] * 4; j < 8; j++) data[o + j] = values[i + j];
      next[key] += 2;
    });
  }
  return { data, count };
}

/** World-space [x, y, z, radius, r, g, b, intensity] for one mesh's point lights. */
export function worldLights(lights, m) {
  const values = new Float32Array(lights.length * 8);
  lights.forEach(({ position: [x, y, z], radius, color, flux }, i) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    values.set([(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, radius, ...color, flux / (4 * Math.PI) * 0.03], i * 8);
  });
  return values;
}
