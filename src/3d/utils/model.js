const types = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Decode a static glTF JSON document or GLB v2 container. */
export function decodeModel(data) {
  const view = new DataView(data),
     decoder = new TextDecoder();
  let description;
  if (view.getUint32(0, true) === 0x46546c67) {
    // Decode GLB v2 chunks; unknown types are skipped.
    if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) {
      throw new Error('Invalid GLB header');
    }
    let binary;
    for (let offset = 12; offset < data.byteLength;) {
      if (offset + 8 > data.byteLength) {
        throw new Error('Truncated GLB chunk');
      }
      const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
      offset += 8;
      if (offset + length > data.byteLength) {
        throw new Error('Truncated GLB data');
      }
      const chunk = data.slice(offset, offset + length);
      if (type === 0x4e4f534a) {
        description = JSON.parse(decoder.decode(chunk));
      }
      if (type === 0x004e4942) {
        binary = chunk;
      }
      offset += length;
    }
    if (!description) {
      throw new Error('Missing GLB JSON');
    }
    if (binary) {
      description.buffers[0].binary = binary;
    }
  } else {
    description = JSON.parse(decoder.decode(data));
  }
  if (description.skins?.length || description.animations?.length || description.extensionsRequired?.length || description.meshes?.some(mesh => mesh.primitives.some(primitive => primitive.targets || (primitive.mode !== undefined && primitive.mode !== 4)))) {
    throw new Error('Layer3D supports static triangle glTF models without required extensions');
  }
  return description;
}

/** Decode packed, interleaved, normalized or sparse glTF accessor data. */
export function readAccessor(description, index) {
  const spec = description.accessors[index],
        Type = types[spec.componentType],
        size = sizes[spec.type];
  if (!Type || !size || !Number.isInteger(spec.count) || spec.count < 0) {
    throw new Error('Invalid glTF accessor');
  }
  const data = new Type(spec.count * size);
  // The destination callback is sequential for base data and sparse-indexed for overrides.
  const read = (viewIndex, offset, count, stride, output) => {
    const view = description.bufferViews[viewIndex], bytes = Type.BYTES_PER_ELEMENT;
    const buffer = description.buffers[view.buffer].binary;
    stride ||= size * bytes;
    if (!buffer || stride < size * bytes || offset < 0 ||
      (view.byteOffset || 0) + view.byteLength > buffer.byteLength ||
      (count - 1) * stride + size * bytes + offset > view.byteLength) throw new Error('glTF accessor outside buffer view');
    for (let i = 0; i < count; i++) {
      const values = new Type(buffer.slice((view.byteOffset || 0) + offset + i * stride,
        (view.byteOffset || 0) + offset + i * stride + size * bytes));
      data.set(values, output(i) * size);
    }
  };
  if (spec.bufferView !== undefined) {
    read(
      spec.bufferView,
      spec.byteOffset || 0,
      spec.count,
      description.bufferViews[spec.bufferView].byteStride,
      i => i
    );
  }
  if (spec.sparse) {
    const sparse = spec.sparse, Index = types[sparse.indices.componentType];
    if (![Uint8Array, Uint16Array, Uint32Array].includes(Index)) {
      throw new Error('Invalid sparse glTF indices');
    }
    const view = description.bufferViews[sparse.indices.bufferView];
    const offset = (view.byteOffset || 0) + (sparse.indices.byteOffset || 0);
    if (sparse.count > spec.count || (sparse.indices.byteOffset || 0) + sparse.count * Index.BYTES_PER_ELEMENT > view.byteLength) {
      throw new Error('Invalid sparse glTF indices');
    }
    const indices = new Index(description.buffers[view.buffer].binary.slice(offset, offset + sparse.count * Index.BYTES_PER_ELEMENT));
    read(
      sparse.values.bufferView,
      sparse.values.byteOffset || 0,
      sparse.count,
      0,
      i => {
        if (indices[i] >= spec.count) throw new Error('Invalid sparse glTF index');
        return indices[i];
      }
    );
  }
  if (spec.componentType === 5126) {
    return { data, size };
  }
  const normalized = new Float32Array(data.length);
  // Normalization is a glTF accessor rule, not sRGB conversion; indices stay integers.
  for (let i = 0; i < data.length; i++) {
    normalized[i] = spec.normalized
      ? Math.max(-1, data[i] / (Type === Int8Array ? 127 : Type === Int16Array ? 32767 : Type === Uint8Array ? 255 : Type === Uint32Array ? 4294967295 : 65535))
      : data[i];
  }
  return { data: normalized, size, indices: data };
}

/** glTF quaternion/translation/scale to a column-major matrix. */
export function nodeMatrix(spec) {
  if (spec.matrix) return Array.from(spec.matrix);
  // glTF stores quaternions [x,y,z,w]; convert directly to a scaled column-major matrix.
  const [x, y, z, w] = spec.rotation || [0, 0, 0, 1],
        [sx, sy, sz] = spec.scale    || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    ...(spec.translation || [0, 0, 0]),
    1,
  ];
}

/** Area-weighted vertex normals, for indexed or non-indexed triangles. */
export function vertexNormals(p, indices) {
  // Accumulate area-weighted face normals for shared vertices, then normalize.
  const normals = new Float32Array(p.length);
  for (let i = 0; i < (indices?.length || p.length / 3); i += 3) {
    const a = indices ? indices[i] : i,
          b = indices ? indices[i + 1] : i + 1,
          c = indices ? indices[i + 2] : i + 2;
    const u = [0, 1, 2].map(j => p[b * 3 + j] - p[a * 3 + j]), v = [0, 1, 2].map(j => p[c * 3 + j] - p[a * 3 + j]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const index of [a, b, c]) {
      for (let j = 0; j < 3; j++) {
        normals[index * 3 + j] += n[j];
      }
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(...normals.subarray(i, i + 3)) || 1;
    for (let j = 0; j < 3; j++) {
      normals[i + j] /= length;
    }
  }
  return normals;
}

/** Translate glTF sampler constants into WebGPU sampler options. */
export function textureSampler(sampler) {
  return {
    addressModeU: sampler.wrapS === 33071 ? 'clamp-to-edge' : sampler.wrapS === 33648 ? 'mirror-repeat' : 'repeat',
    addressModeV: sampler.wrapT === 33071 ? 'clamp-to-edge' : sampler.wrapT === 33648 ? 'mirror-repeat' : 'repeat',
    magFilter: sampler.magFilter === 9728 ? 'nearest' : 'linear',
    minFilter: sampler.minFilter === 9728 || sampler.minFilter === 9984 || sampler.minFilter === 9986 ? 'nearest' : 'linear',
  };
}
