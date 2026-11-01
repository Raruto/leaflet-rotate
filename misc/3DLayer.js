/**
 * A native WebGL scene drawn above the map tiles and kept in sync with the map camera
 * (center, zoom, bearing, pitch and zoom animations).
 *
 * No rendering dependencies. Use the `ready` event before using the helpers.
 * All instances on one map share a canvas, scene and camera, with one group per layer.
 *
 * World coordinates are metres relative to `location`: x east, y up, z south.
 * The shared scene instead uses the first attached layer's origin. `root` converts
 * each layer's local metres into that shared space, including latitude scaling.
 *
 * Lifecycle: initialize CPU state -> attach shared GPU context -> load configured
 * data/model -> ready. Removal cancels source work and detaches this layer only;
 * the last removal destroys the context. Model CPU arrays/images survive for re-add.
 *
 * File layout: Leaflet lifecycle and public helpers; GLB/material loading; polygon
 * triangulation and picking; PMTiles extrusion; shared camera; procedural math/GPU operations.
 * PMTiles v3 reading is implemented directly by this layer. Models are static triangles, without
 * animation, skinning, morph targets, normal maps, shadows or required extensions.
 *
 * Events: ready; error {error}; progress {enabled, loaded, skipped, pending, errors};
 * featurehover/featureclick {feature, originalEvent}. A feature may be null on a miss.
 * Picking tests geometry, not texture alpha: a transparent texel can still be hit.
 *
 * @example
 * const layer = new L.Layer3D({ center: [48.8582601, 2.29449985], model: 'tower.glb' }).addTo(map);
 *
 * @typedef {Object} Layer3DOptions
 * @property {number[]} [center] Local origin [lat,lng]; defaults to the first map center.
 * @property {string} [model] GLB/glTF URL relative to the page; loaded before ready.
 * @property {number[]} [rotation] Model Euler rotation [x,y,z] in radians, YXZ order.
 * @property {number[]} [scale] Model scale [x,y,z]; independent of geographic scaling.
 * @property {string} [source] PMTiles URL containing Polygon/MultiPolygon GeoJSON.
 * @property {function(Object): (ExtrusionStyle|null)} [featureStyle] Source styling; null skips.
 * @property {function(PickedFeature): (Node|string)} [tooltipContent] No HTML string evaluation.
 * @property {string} [attribution] Standard Leaflet attribution HTML.
 * @property {string} [ariaLabel='3D scene'] Shared canvas accessible name.
 *
 * @typedef {Object} ExtrusionStyle
 * @property {number} top Roof height in metres; must exceed bottom.
 * @property {number} [bottom=0] Nonnegative base height; positive values create an underside.
 * @property {number|string|Object} [color=0xd9b38c] RGB/CSS color, or linear-space {h,s,l}.
 *
 * @typedef {Object} PickedFeature
 * @property {string|number} id Source feature id or configured model URL.
 * @property {Object} properties GeoJSON properties or model-level glTF extras.
 * @property {Object} mesh Intersected mesh.
 * @property {number[]} point Intersection [x,y,z] in shared scene metres, not layer-local metres.
 * @property {Object} [model] Configured model root; absent for source polygons.
 * @property {number} [vertexStart] First polygon vertex in the batched mesh.
 * @property {number} [vertexEnd] Exclusive end of the polygon's vertex range.
 *
 * @typedef {Object} SourceArea
 * @property {Object} coords Archive block {z,x,y}; z is header.minZoom, not display zoom.
 * @property {AbortController} request Cancellation also prevents attaching obsolete results.
 * @property {boolean} [started] Enqueued work has consumed a concurrency slot.
 * @property {boolean} [done] Geometry built successfully, including empty blocks.
 * @property {Object|null} [mesh] One batched GPU mesh per non-empty block.
 * @property {number} [buildings] Emitted feature count, not number of triangles.
 * @property {number} [skipped] Features intentionally skipped by featureStyle.
 * @property {string} [error] Failed load/build message; reported through error and progress.
 *
 * @since leaflet-rotate (v0.6.0)
 */

L.Layer3D = L.Layer.extend({
  /**
   * PMTiles v3 range reader.
   * Supports uncompressed/gzip sections. Other compression methods fail explicitly.
   * Specification: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
   */
  /** Read exactly one archive range; reject changed archives rather than mix revisions. */
  async _read(offset, length, signal) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length <= 0 || !Number.isSafeInteger(offset + length)) {
      throw new Error('Invalid PMTiles byte range');
    }
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal,
    });
    if (!response.ok) throw new Error(`Unable to read PMTiles: HTTP ${response.status}`);
    const etag = response.headers.get('ETag');
    if (this._etag && etag !== this._etag) {
      throw new Error('PMTiles archive changed; recreate the layer');
    }
    if (etag) {
      this._etag = etag;
    }
    let data = await response.arrayBuffer();
    if (response.status === 200) {
      data = data.slice(offset, offset + length);
    } else if (response.status !== 206 || !response.headers.get('Content-Range')?.startsWith(`bytes ${offset}-${offset + length - 1}/`)) {
      throw new Error('Invalid PMTiles range response');
    }
    if (data.byteLength !== length) {
      throw new Error('Truncated PMTiles range');
    }
    return data;
  },

  async _decompress(data, compression) {
    if (compression === 1) return data;
    if (compression !== 2) throw new Error(`Unsupported PMTiles compression: ${compression}`);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  },

  /** Cache header initialization; failures remain visible to all callers. */
  getHeader() {
    return this._header ||= this._read(0, 127).then(data => {
      const view = new DataView(data);
      const header = {};
      ['rootDirectoryOffset', 'rootDirectoryLength', 'jsonMetadataOffset', 'jsonMetadataLength', 'leafDirectoryOffset', 'leafDirectoryLength', 'tileDataOffset', 'tileDataLength', 'numAddressedTiles', 'numTileEntries', 'numTileContents'].forEach((name, i) => { header[name] = Number(view.getBigUint64(8 + i * 8, true)); });
      ['clustered', 'internalCompression', 'tileCompression', 'tileType', 'minZoom', 'maxZoom'].forEach((name, i) => { header[name] = view.getUint8(96 + i); });
      ['minLon', 'minLat', 'maxLon', 'maxLat'].forEach((name, i) => { header[name] = view.getInt32(102 + i * 4, true) / 1e7; });
      header.centerZoom = view.getUint8(118);
      header.centerLon  = view.getInt32(119, true) / 1e7;
      header.centerLat  = view.getInt32(123, true) / 1e7;
      return header;
    });
  },

  /** Nearest directory entry at/before the Hilbert ID, then follow leaf pointers. */
  async getZxy(z, x, y, signal) {
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 26 ||
      x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid PMTiles tile coordinates');
    signal?.throwIfAborted();
    let tileId = (4 ** z - 1) / 3;
    const n = 2 ** z;
    // Same cumulative Hilbert ordering used by build/pmtiles.js.
    for (let s = n / 2; s >= 1; s /= 2) {
      const rx = (x & s) ? 1 : 0,
            ry = (y & s) ? 1 : 0;
      tileId += s * s * ((3 * rx) ^ ry);
      if (!ry) {
        if (rx) { x = n - 1 - x; y = n - 1 - y; }
        [x, y] = [y, x];
      }
    }
    const header = await this.getHeader();
    signal?.throwIfAborted();
    if (z < header.minZoom || z > header.maxZoom) return;
    let offset = header.rootDirectoryOffset, length = header.rootDirectoryLength;
    const visited = new Set();
    for (let depth = 0; depth < 4; depth++) {
      if (visited.has(offset)) {
        throw new Error('Cyclic PMTiles directory');
      }
      visited.add(offset);
      const key = `${offset}:${length}`;
      if (!this._directories.has(key)) {
        if (this._directories.size >= 32) {
          this._directories.delete(this._directories.keys().next().value);
        }
        const pending = this._read(offset, length)
          .then(data => this._decompress(data, header.internalCompression))
          .then(data => {
            const bytes = new Uint8Array(data);
            let cursor = 0;
            const varint = () => {
              let value = 0;
              for (let factor = 1; factor <= 2 ** 49; factor *= 128) {
                if (cursor >= bytes.length) throw new Error('Truncated PMTiles directory');
                const byte = bytes[cursor++];
                value += (byte & 127) * factor;
                if (!Number.isSafeInteger(value)) throw new Error('Invalid PMTiles directory integer');
                if (byte < 128) return value;
              }
              throw new Error('Invalid PMTiles directory integer');
            };
            const count = varint();
            if (count > (bytes.length - cursor) / 4) throw new Error('Invalid PMTiles directory count');
            const entries = [];
            let tileId = 0;
            for (let i = 0; i < count; i++) {
              tileId += varint();
              if (!Number.isSafeInteger(tileId) || (i && tileId <= entries[i - 1].tileId)) {
                throw new Error('Invalid PMTiles directory tile IDs');
              }
              entries.push({ tileId });
            }
            for (const entry of entries) entry.runLength = varint();
            for (const entry of entries) {
              entry.length = varint();
              if (!entry.length) throw new Error('Invalid PMTiles directory length');
            }
            entries.forEach((entry, i) => {
              const value = varint();
              if (!value && !i) throw new Error('Invalid PMTiles directory offset');
              entry.offset = value ? value - 1 : entries[i - 1].offset + entries[i - 1].length;
            });
            if (cursor !== bytes.length) throw new Error('Trailing PMTiles directory data');
            return entries;
          })
          .catch(error => {
            if (this._directories.get(key) === pending) this._directories.delete(key);
            throw error;
          });
        this._directories.set(key, pending);
      }
      const entries = await this._directories.get(key);
      signal?.throwIfAborted();
      let low = 0,
         high = entries.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (entries[mid].tileId <= tileId) low = mid + 1;
        else high = mid - 1;
      }
      const entry = entries[high];
      if (!entry) return;
      if (entry.runLength) {
        if (tileId - entry.tileId >= entry.runLength) return;
        if (entry.offset + entry.length > header.tileDataLength) throw new Error('PMTiles tile outside data section');
        const data = await this._decompress(await this._read(header.tileDataOffset + entry.offset, entry.length, signal), header.tileCompression);
        signal?.throwIfAborted();
        return { data };
      }
      if (entry.offset + entry.length > header.leafDirectoryLength) throw new Error('PMTiles directory outside leaf section');
      offset = header.leafDirectoryOffset + entry.offset;
      length = entry.length;
    }
    throw new Error('PMTiles directory depth exceeds four levels');
  },

  statics: {
    /** Rendering owner per map; entries are removed on the last layer removal. */
    _renderers: new WeakMap(),
  },

  options: {
    // Accessible description of the canvas.
    ariaLabel: '3D scene',
  },

  /**
   * @param {Layer3DOptions} [options] World origin comes from center or the first map centre.
   * Public state: `location` is fixed after first addition; `root` is this layer's
   * transform; `group` aliases root only for sources; `model` is the configured
   * model wrapper. `_shared` references the rendering owner (a Layer3D instance);
   * `scene`, `camera` and `renderer` alias its resources while attached.
   *
   */
  initialize(options) {
    L.Util.setOptions(this, options);
    this.url = this.options.source ? new URL(this.options.source, document.baseURI).href : null;
    this._directories = new Map();
    if (this.options.center) {
      this.location = new L.LatLng(this.options.center[0], this.options.center[1]);
    }
    /** @type {Map<string, SourceArea>} Keys are archive x/y, not screen tiles. */
    this._areas = new Map();
    // Counts pending archive/build tasks, including ones cancelled after a pan.
    this._inflight = 0;
    // Gate GPU work on attachment; replaced on removal to support delayed loads.
    this._added = Promise.withResolvers();
    // Defer initialization so callers can subscribe to ready/error after construction.
    queueMicrotask(async () => {
      try {
        this.root = {
          position:    [0, 0, 0],
          rotation:    [0, 0, 0],
          scale:       [1, 1, 1],
          worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          children:    [],
          visible:     true,
        };
        this.raycaster = {
          origin:    [0, 0, 0],
          direction: [0, 0, 0]
        };
        if (this.options.source) {
          this.group = this.root;
          this.header = await this.getHeader();
        }
        if (this._map) this._attach(this._map);
        if (this.options.model) {
          await this._added.promise;
          const url      = new URL(this.options.model, document.baseURI).href;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Unable to load model: HTTP ${response.status}`);
          }
          const data = await response.arrayBuffer();
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
          const directory = new URL('.', url).href;
          await Promise.all((description.buffers || []).map(async buffer => {
            if (buffer.binary) {
              return;
            }
            const response = await fetch(new URL(buffer.uri, directory).href);
            if (!response.ok) {
              throw new Error(`Unable to load model buffer: HTTP ${response.status}`);
            }
            buffer.binary = await response.arrayBuffer();
          }));
          await this._added.promise;
          const images = await Promise.all((description.images || []).map(async image => {
            let blob;
            if (image.bufferView !== undefined) {
              const view = description.bufferViews[image.bufferView];
              const buffer = description.buffers[view.buffer].binary;
              blob = new Blob([buffer.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)],
                { type: image.mimeType });
            } else {
              const response = await fetch(new URL(image.uri, directory).href);
              if (!response.ok) throw new Error(`Unable to load model texture: HTTP ${response.status}`);
              blob = await response.blob();
            }
            // Preserve straight alpha and raw samples; GPU sRGB formats do color decoding.
            return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          }));
          const textures = new Map();
          const textureFor = (reference, color = false) => {
            if (!reference) return null;
            if ((reference.texCoord || 0) !== 0 || reference.extensions) {
              throw new Error('Model textures currently require untransformed TEXCOORD_0 UVs');
            }
            const gl = this.renderer.gl;
            // A glTF image may serve both color and data maps: those cannot share a GPU format.
            const key = `${reference.index}:${color && gl.SRGB8_ALPHA8 || gl.RGBA}`;
            if (!textures.has(key)) {
              const texture = description.textures[reference.index];
              const sampler = description.samplers?.[texture.sampler] || {};
              textures.set(key, {
                gl,
                texture:        gl.createTexture(),
                internalFormat: gl.RGBA,
                wrapS:          gl.CLAMP_TO_EDGE,
                wrapT:          gl.CLAMP_TO_EDGE,
                minFilter:      gl.LINEAR_MIPMAP_LINEAR,
                magFilter:      gl.LINEAR,
                image:          images[texture.source],
                flipY:          false,
                internalFormat: color && gl.SRGB8_ALPHA8 || gl.RGBA,
                wrapS:          sampler.wrapS || gl.REPEAT,
                wrapT:          sampler.wrapT || gl.REPEAT,
                minFilter:      sampler.minFilter || gl.LINEAR_MIPMAP_LINEAR,
                magFilter:      sampler.magFilter || gl.LINEAR,
              });
            }
            return textures.get(key);
          };
          // Convert glTF materials directly to the shader's retained CPU styles.
          const materials = (description.materials || []).map(material => {
            const pbr = material.pbrMetallicRoughness || {};
            return {
              color:             (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3),
              opacity:           pbr.baseColorFactor?.[3] ?? 1,
              metallic:          pbr.metallicFactor ?? 1,
              roughness:         pbr.roughnessFactor ?? 1,
              baseTexture:       textureFor(pbr.baseColorTexture, true),
              metalTexture:      textureFor(pbr.metallicRoughnessTexture),
              emissiveTexture:   textureFor(material.emissiveTexture, true),
              occlusionTexture:  textureFor(material.occlusionTexture),
              emissive:          material.emissiveFactor || [0, 0, 0],
              occlusionStrength: material.occlusionTexture?.strength ?? 1,
              alphaMode:         material.alphaMode || 'OPAQUE',
              alphaCutoff:       material.alphaCutoff ?? 0.5,
              doubleSided:       material.doubleSided,
            };
          });
          let nodes;
          {
            // Decode packed/interleaved/sparse accessors and build independent scene nodes.
            const types = {
              5120: Int8Array,
              5121: Uint8Array,
              5122: Int16Array,
              5123: Uint16Array,
              5125: Uint32Array,
              5126: Float32Array
            };
            const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
            const accessor = index => {
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
            };
            // Track only the recursion path: shared mesh references are valid, cycles are not.
            const active = new Set(), resources = [];
            const node = index => {
              if (active.has(index)) throw new Error('Cyclic glTF nodes');
              const spec = description.nodes[index];
              if (!spec) throw new Error('Invalid glTF node');
              active.add(index);
              const group = {
                position:    [0, 0, 0],
                rotation:    [0, 0, 0],
                scale:       [1, 1, 1],
                worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                children:    [],
                visible:     true,
                name:        spec.name
              };
              if (spec.matrix) {
                group.matrix = Array.from(spec.matrix);
              } else {
                // glTF stores quaternions [x,y,z,w]; convert directly to a scaled column-major matrix.
                const [x, y, z, w] = spec.rotation || [0, 0, 0, 1],
                      [sx, sy, sz] = spec.scale    || [1, 1, 1];
                group.matrix = [
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
              if (spec.mesh !== undefined) {
                for (const primitive of description.meshes[spec.mesh].primitives) {
                  const attributes = {};
                  for (const [semantic, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
                    if (primitive.attributes[semantic] !== undefined) attributes[name] = accessor(primitive.attributes[semantic]);
                  }
                  if (!attributes.position) throw new Error('glTF mesh has no positions');
                  const vertexCount = attributes.position.data.length / 3;
                  if (attributes.position.size !== 3 || vertexCount < 3 ||
                    Object.values(attributes).some(attribute => attribute.data.length / attribute.size !== vertexCount)) throw new Error('Invalid glTF vertex attributes');
                  if (primitive.indices !== undefined) {
                    const index = accessor(primitive.indices);
                    attributes.index = { size: 1, data: index.indices };
                    if (![Uint8Array, Uint16Array, Uint32Array].some(Type => index.indices instanceof Type) ||
                      index.size !== 1 || index.indices.length % 3 || [...index.indices].some(i => i >= vertexCount)) throw new Error('Invalid glTF triangle indices');
                  }
                  if (!attributes.index && vertexCount % 3) throw new Error('Incomplete glTF triangle');
                  if (!attributes.normal) {
                    // Accumulate area-weighted face normals for shared vertices, then normalize.
                    const normals = new Float32Array(attributes.position.data.length),
                                p = attributes.position.data,
                          indices = attributes.index?.data;
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
                    attributes.normal = { size: 3, data: normals };
                  }
                  const style = materials[primitive.material] || { color: [1, 1, 1], metallic: 1 };
                  if ([style.baseTexture, style.metalTexture, style.emissiveTexture, style.occlusionTexture].some(Boolean) && !attributes.uv) {
                    throw new Error('Textured model mesh requires UV coordinates');
                  }
                  const program = this._createProgram(style);
                  resources.push(program);
                  const geometry = this._createGeometry(this.renderer.gl, attributes);
                  resources.push(geometry);
                  const mesh = {
                    position:    [0, 0, 0],
                    rotation:    [0, 0, 0],
                    scale:       [1, 1, 1],
                    worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    children:    [],
                    visible:     true,
                    gl: this.renderer.gl,
                    geometry,
                    program,
                    id: L.Layer3D._nextId++,
                    renderOrder: 0
                  };
                  mesh.name = description.meshes[spec.mesh].name; mesh.extras = spec.extras || {};
                  this.setParent(mesh, group);
                }
              }
              for (const child of spec.children || []) this.setParent(node(child), group);
              active.delete(index);
              return group;
            };
            const scene = description.scenes?.[description.scene || 0];
            if (!scene) throw new Error('Missing glTF scene');
            try {
              nodes = scene.nodes.map(node);
            } catch (error) {
              // Parsing can fail after earlier primitives allocated buffers/programs.
              for (const resource of resources) {
                if (resource.attributes) {
                  for (const attribute of Object.values(resource.attributes)) resource.gl.deleteBuffer(attribute.buffer);
                } else this._removeProgram(resource);
              }
              throw error;
            }
          }
          const model = {
            position:    [0, 0, 0],
            rotation:    [0, 0, 0],
            scale:       [1, 1, 1],
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            children:    [],
            visible:     true,
            id:          url,
            extras:      description.extras || {},
          };
          if (!nodes.length) throw new Error('Expected a glTF model with a non-empty scene');
          for (const node of nodes) this.setParent(node, model);
          this.model = model;
          if (this.options.rotation) {
            const [x, y = x, z = x] = this.options.rotation;
            this.model.rotation[0] = x; this.model.rotation[1] = y; this.model.rotation[2] = z;
          }
          if (this.options.scale) {
            const [x, y = x, z = x] = this.options.scale;
            this.model.scale[0] = x; this.model.scale[1] = y; this.model.scale[2] = z;
          }
          this.setParent(this.model, this.root);
        }
        if (this._shared) this.update();
        this.fire('ready');
      } catch (error) {
        this.fire('error', { error });
      }
    });
  },

  /** Attach interaction immediately; initialization may finish before or after onAdd. */
  onAdd(map) {
    this._added.resolve();
    if (!this.location) {
      const center = map.getCenter();
      this.location = new L.LatLng(center.lat, center.lng);
    }
    if (this.options.source || this.options.tooltipContent || this.options.model) {
      this.container = map.getContainer();
      if (this.options.tooltipContent) {
        this._tooltip = L.DomUtil.create('div', 'leaflet-3d-tooltip', this.container);
        this._tooltip.hidden = true;
        this._tooltip.setAttribute('role', 'tooltip');
        this._tooltip.setAttribute('aria-live', 'polite');
        this._tooltip.style.cssText = 'position:absolute;z-index:600;max-width:220px;padding:10px 12px;border:1px solid #6b5140;border-radius:6px;background:#fffaf0;box-shadow:0 3px 12px #0005;color:#30251d;font:13px/1.45 sans-serif;pointer-events:none';
      }
      L.DomEvent.on(this.container, {
        mousemove: this._onPointerMove,
        click: this._onClick,
        mouseleave: this._onPointerLeave,
      }, this);
    }
    if (this.root) this._attach(map);
  },

  /** Reconcile source coverage when the visible ground footprint changes. */
  getEvents() {
    return this.options.source ? {
      moveend:       this._updateArea,
      zoomend:       this._updateArea,
      rotate:        this._updateArea,
      pitch:         this._updateArea,
      resize:        this._updateArea,
      terrainchange: this._onTerrainChange,
    } : {};
  },

  /** Release source meshes/UI; retain manually added objects and model CPU data. */
  onRemove(map) {
    this._added = Promise.withResolvers();
    if (this.container) {
      this._onPointerLeave();
      L.DomEvent.off(this.container, {
        mousemove:  this._onPointerMove,
        click:      this._onClick,
        mouseleave: this._onPointerLeave,
      }, this);
      this.container = null;
    }
    for (const area of this._areas.values()) this._releaseArea(area);
    this._areas.clear();
    this._tooltip?.remove();
    this._tooltip = null;
    if (this.options.source) this._updateStatus(false);
    const shared = this._shared;
    if (!shared) return;
    this.setParent(this.root, null);
    shared._layers.delete(this);
    if (shared === this) {
      map.off('move zoom rotate pitch resize viewreset layeradd layerremove', this.update, this);
      map.off('zoomstart', this._startZoom, this);
      map.off('zoomanim', this._animateZoom, this);
      map.off('zoomend', this._endZoom, this);
      cancelAnimationFrame(this._frame);
      this._frame = null;
      this._queued = false;
      if (this._layers.size) {
        // Keep the original scene origin and GPU resources when ownership changes.
        const next = this._layers.values().next().value;
        for (const key of ['_layers', '_sceneOrigin', '_size', '_zoomLevel', '_zoomTransitions', '_cursor', '_roofRaster']) {
          next[key] = this[key];
          delete this[key];
        }
        for (const layer of next._layers) layer._shared = next;
        L.Layer3D._renderers.set(map, next);
        map.on('move zoom rotate pitch resize viewreset layeradd layerremove', next.update, next);
        map.on('zoomstart', next._startZoom, next);
        map.on('zoomanim', next._animateZoom, next);
        map.on('zoomend', next._endZoom, next);
        next.update();
      } else {
        if (this._roofRaster) this.renderer.gl.deleteTexture(this._roofRaster.texture.texture);
        this._roofRaster = null;
        for (const animation of this._zoomTransitions?.keys() || []) animation.play();
        this._zoomTransitions = null;
        this.renderer.gl.canvas.remove();
        this.renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
        L.Layer3D._renderers.delete(map);
        for (const key of ['_layers', '_sceneOrigin', '_size', '_zoomLevel', '_cursor']) delete this[key];
      }
    } else shared.update();
    this._shared = null;
    this.renderer = this.scene = this.camera = null;
  },

  /**
   * Join/create this map's shared scene and rebuild GPU objects if its context changed.
   * Buffer/program handles belong to one context; typed arrays and decoded images do not.
   * @private
   */
  _attach(map) {
    let shared = L.Layer3D._renderers.get(map);
    if (!shared) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
      shared = this;
      this._shared = this;
      this._layers = new Set();
      this._sceneOrigin = this.location;
      this.scene = {
        position:    [0, 0, 0],
        rotation:    [0, 0, 0],
        scale:       [1, 1, 1],
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        children:    [],
        visible:     true,
      };
      // Perspective camera state: fov in degrees, near/far in scene metres.
      this.camera = {
        position:             [0, 0, 0],
        up:                   [0, 1, 0],
        target:               [0, 0, 0],
        viewMatrix:           [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        projectionMatrix:     [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        projectionViewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        fov:                  45,
        aspect:               1,
        near:                 0.1,
        far:                  10000,
      };
      this.renderer = { gl, dpr: Math.min(window.devicePixelRatio, 2) };
      gl.clearColor(0, 0, 0, 0);
      shared._size = null;
      canvas.className = 'leaflet-3d';
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', this.options.ariaLabel);
      let pane = map.getPane('webglPane');
      if (!pane) {
        pane = map.createPane('webglPane', map.getContainer());
        pane.style.zIndex = 450;
      }
      pane.append(canvas);
      map.on('move zoom rotate pitch resize viewreset layeradd layerremove', shared.update, shared);
      map.on('zoomstart', shared._startZoom, shared);
      map.on('zoomanim', shared._animateZoom, shared);
      map.on('zoomend', shared._endZoom, shared);
      shared._render();
      L.Layer3D._renderers.set(map, shared);
    }
    const origin = map.options.crs.project(shared._sceneOrigin);
    const point  = map.options.crs.project(this.location);
    const metres = Math.cos(shared._sceneOrigin.lat * Math.PI / 180);
    this._terrainBaseY ??= this.root.position[1];
    this.root.position[0] = (point.x - origin.x) * metres;
    this.root.position[1] = this._terrainBaseY;
    this.root.position[2] = -(point.y - origin.y) * metres;
    this._setTerrainHeight();
    // Each group's metres are measured at its own latitude, not the shared camera origin.
    this.root.scale.fill(metres / Math.cos(this.location.lat * Math.PI / 180));
    this._shared = shared;
    this.renderer = shared.renderer;
    this.scene = shared.scene;
    this.camera = shared.camera;
    shared._layers.add(this);
    this.setParent(this.root, shared.scene);
    this.traverse(this.root, object => {
      if (object.geometry && object.geometry.gl !== shared.renderer.gl) {
        const geometry = object.geometry;
        const material = object.program._layerMaterial;
        // Retain packed CPU attributes, never old-context GPU buffer handles.
        const attributes = {};
        for (const name of ['position', 'normal', 'color', 'uv', 'index']) {
          const attribute = geometry.attributes[name];
          if (!attribute) continue;
          const { data, size, count, normalized } = attribute;
          attributes[name] = { data: data.slice(0, count * size), size, normalized };
        }
        object.geometry = this._createGeometry(shared.renderer.gl, attributes);
        for (const attribute of Object.values(geometry.attributes)) geometry.gl.deleteBuffer(attribute.buffer);
        this._removeProgram(object.program);
        object.program = this._createProgram(material);
        object.gl = shared.renderer.gl;
      }
      if (object.texture && object.texture.gl !== shared.renderer.gl) {
        object.texture = {
          ...object.texture,
          gl: shared.renderer.gl,
          texture: shared.renderer.gl.createTexture(),
          uploaded: null,
          needsUpdate: true,
        };
      }
    });
    shared.update();
    if (this.header) this._updateArea();
  },

  /**
   * Adds a scene node or mesh in layer-local coordinates and schedules a redraw.
   * Requires initialization and a compatible scene node.
   * @param {Object} object
   * @returns {L.Layer3D} This layer.
   */
  add(object) {
    this.setParent(object, this.root);
    return this.update();
  },

  _setTerrainHeight() {
    if (!this.root || !this.location) return;
    this._terrainBaseY ??= this.root.position[1];
    this.root.position[1] = this._terrainBaseY + (this._map?._terrain3D?._getElevation(this.location) ?? 0);
  },

  /**
   * Without an argument, removes this Leaflet layer. With an object, only detaches it:
   * geometry/program resources are not disposed, so it can be added again.
   * @param {Object} [object]
   * @returns {L.Layer3D}
   */
  remove(object) {
    if (object === undefined) return L.Layer.prototype.remove.call(this);
    this.setParent(object, null);
    return this.update();
  },

  /**
   * Build a shader variant from a retained style and re-create textures on context changes.
   * Model color factors are linear; polygon vertex colors are stored as sRGB.
   * BLEND disables depth writes and needs mesh sorting; MASK discards texels below
   * alphaCutoff. OPAQUE ignores texture alpha for the final output.
   * `_layerMaterial` retains CPU style for re-add.
   * @param {Object} [material] Internal style: colors, PBR factors, alpha policy and Texture objects.
   * @returns {Object} WebGL program; callers own its GPU lifetime.
   * @private
   */
  _createProgram(material = {}) {
     if (material.baseTexture && material.baseTexture.gl !== this.renderer.gl) {
       material.baseTexture = {
         gl:             this.renderer.gl,
         texture:        this.renderer.gl.createTexture(),
         image:          material.baseTexture.image,
         flipY:          false,
         wrapS:          material.baseTexture.wrapS,
         wrapT:          material.baseTexture.wrapT,
         minFilter:      material.baseTexture.minFilter,
         magFilter:      material.baseTexture.magFilter,
         internalFormat: material.baseTexture.internalFormat,
       };
     }
     if (material.metalTexture && material.metalTexture.gl !== this.renderer.gl) {
       material.metalTexture = {
         gl:             this.renderer.gl,
         texture:        this.renderer.gl.createTexture(),
         image:          material.metalTexture.image,
         flipY:          false,
         wrapS:          material.metalTexture.wrapS,
         wrapT:          material.metalTexture.wrapT,
         minFilter:      material.metalTexture.minFilter,
         magFilter:      material.metalTexture.magFilter,
         internalFormat: material.metalTexture.internalFormat,
       };
     }
     if (material.emissiveTexture && material.emissiveTexture.gl !== this.renderer.gl) {
       material.emissiveTexture = {
         gl:             this.renderer.gl,
         texture:        this.renderer.gl.createTexture(),
         image:          material.emissiveTexture.image,
         flipY:          false,
         wrapS:          material.emissiveTexture.wrapS,
         wrapT:          material.emissiveTexture.wrapT,
         minFilter:      material.emissiveTexture.minFilter,
         magFilter:      material.emissiveTexture.magFilter,
         internalFormat: material.emissiveTexture.internalFormat,
       };
     }
     if (material.occlusionTexture && material.occlusionTexture.gl !== this.renderer.gl) {
       material.occlusionTexture = {
         gl:             this.renderer.gl,
         texture:        this.renderer.gl.createTexture(),
         image:          material.occlusionTexture.image,
         flipY:          false,
         wrapS:          material.occlusionTexture.wrapS,
         wrapT:          material.occlusionTexture.wrapT,
         minFilter:      material.occlusionTexture.minFilter,
         magFilter:      material.occlusionTexture.magFilter,
         internalFormat: material.occlusionTexture.internalFormat,
       };
     }
    const textured = Boolean(material.baseTexture || material.metalTexture || material.emissiveTexture || material.occlusionTexture);
    const gl = this.renderer.gl;
    const program = {
      gl,
      cullFace:    material.doubleSided ? null : this.renderer.gl.BACK,
      transparent: material.alphaMode === 'BLEND',
      depthWrite:  material.alphaMode !== 'BLEND',
      uniforms: {
        baseColor:                      { value: material.color || [1, 1, 1] },
        lightDirection:                 { value: [0, 0, 0] }, skyDirection: { value: [0, 0, 0] },
        metallic:                       { value: material.metallic ?? 0 }, roughness: { value: material.roughness ?? 0.85 },
        opacity:                        { value: material.opacity ?? 1 }, alphaCutoff: { value: material.alphaCutoff ?? 0.5 },
        occlusionStrength:              { value: material.occlusionStrength ?? 1 },
        emissive:                       { value: material.emissive || [0, 0, 0] },
        ...(material.baseTexture ?      { baseTexture: { value: material.baseTexture } } : {}),
        ...(material.metalTexture ?     { metalTexture: { value: material.metalTexture } } : {}),
        ...(material.emissiveTexture ?  { emissiveTexture: { value: material.emissiveTexture } } : {}),
        ...(material.occlusionTexture ? { occlusionTexture: { value: material.occlusionTexture } } : {}),
      },
      program: gl.createProgram(),
      shaders: [],
    };
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, `
      attribute vec3 position;
      attribute vec3 normal;
      ${material.vertexColors ? 'attribute vec3 color;' : ''}
      ${textured              ? 'attribute vec2 uv; varying vec2 vUv;' : ''}
      ${material.roofTexture  ? `uniform mat4 worldMatrix, roofMatrix; varying vec2 vRoofUv; varying float vRoof;` : ''}
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform mat3 normalMatrix;
      uniform vec3 baseColor;
      varying vec3 vColor, vNormal, vPosition;
      void main() {
          vColor = ${material.vertexColors ? 'color' : 'baseColor'};
          // Normalize after interpolation, especially with nonuniform model scaling.
          vNormal = normalMatrix * normal;
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          ${textured ? 'vUv = uv;' : ''}
          ${material.roofTexture ? `vRoofUv = (roofMatrix * worldMatrix * vec4(position, 1.0)).xz; vRoof = step(0.5, normal.y);` : ''}
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(vertexShader);
      gl.deleteShader(vertexShader);
      this._removeProgram(program);
      throw new Error(`Unable to compile Layer3D shader: ${error}`);
    }
    program.shaders.push(vertexShader);
    gl.attachShader(program.program, vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, `
      precision highp float;
      uniform vec3 lightDirection, skyDirection, emissive;
      uniform float metallic, roughness, opacity, alphaCutoff, occlusionStrength;
      ${textured                  ? 'varying vec2 vUv;' : ''}
      ${material.baseTexture      ? 'uniform sampler2D baseTexture;' : ''}
      ${material.metalTexture     ? 'uniform sampler2D metalTexture;' : ''}
      ${material.emissiveTexture  ? 'uniform sampler2D emissiveTexture;' : ''}
      ${material.occlusionTexture ? 'uniform sampler2D occlusionTexture;' : ''}
      ${material.roofTexture      ? `uniform sampler2D roofTexture; varying vec2 vRoofUv; varying float vRoof;` : ''}
      varying vec3 vColor, vNormal, vPosition;
      const float PI = 3.14159265;
      vec3 toLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
      }
      vec3 toSRGB(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
      }
      void main() {
        ${material.unlit ? `vec4 rasterTexel = texture2D(baseTexture, vUv); gl_FragColor = vec4(toSRGB(toLinear(rasterTexel.rgb)), ${material.alphaMode === 'BLEND' ? 'opacity * rasterTexel.a' : '1.0'}); return;` : ''}
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec4 texel = ${material.baseTexture ? 'texture2D(baseTexture, vUv)' : 'vec4(1.0)'};
        float alpha = opacity * texel.a;
        ${material.alphaMode === 'MASK' ? 'if (alpha < alphaCutoff) discard;' : ''}
        ${material.alphaMode === 'BLEND' ? 'if (alpha < 0.01) discard;' : ''}
        vec3 base = ${material.vertexColors ? 'toLinear(vColor)' : 'vColor'} * ${material.baseTexture?.internalFormat === this.renderer.gl.SRGB8_ALPHA8 ? 'texel.rgb' : 'toLinear(texel.rgb)'};
        ${material.roofTexture ? `
          if (vRoof > 0.5 && all(greaterThanEqual(vRoofUv, vec2(0.0))) &&
            all(lessThanEqual(vRoofUv, vec2(1.0))) &&
            distance(vColor, vec3(72.0 / 255.0, 217.0 / 255.0, 1.0)) > 0.001) {
            vec4 roof = texture2D(roofTexture, vRoofUv);
            base = mix(base, toLinear(roof.rgb), roof.a);
          }
        ` : ''}
        vec4 mr = ${material.metalTexture ? 'texture2D(metalTexture, vUv)' : 'vec4(1.0)'};
        float metal = clamp(metallic * mr.b, 0.0, 1.0);
        float rough = clamp(roughness * mr.g, 0.08, 1.0);
        vec3 view = normalize(-vPosition);
        vec3 halfVector = normalize(view + lightDirection);
        float nl = max(dot(normal, lightDirection), 0.0);
        float nv = max(dot(normal, view), 0.001);
        float nh = max(dot(normal, halfVector), 0.0);
        float vh = max(dot(view, halfVector), 0.0);
        // GGX distribution, correlated Smith visibility and Schlick Fresnel.
        float a2 = pow(rough, 4.0);
        float d = a2 / max(PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0), 0.0001);
        float gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
        float gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
        float visibility = 0.5 / max(gv + gl, 0.0001);
        vec3 f0 = mix(vec3(0.04), base, metal);
        vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
        vec3 specular = d * visibility * fresnel;
        vec3 diffuse = (1.0 - metal) * base / PI;
        float sky = dot(normal, skyDirection) * 0.5 + 0.5;
        vec3 ambient = mix(toLinear(vec3(0.455, 0.412, 0.322)), vec3(1.0), sky) * (2.0 / PI);
        float ao = ${material.occlusionTexture ? 'mix(1.0, texture2D(occlusionTexture, vUv).r, occlusionStrength)' : '1.0'};
        vec3 glow = emissive * ${
          material.emissiveTexture
          ? material.emissiveTexture.internalFormat === this.renderer.gl.SRGB8_ALPHA8
            ? 'texture2D(emissiveTexture, vUv).rgb'
            : 'toLinear(texture2D(emissiveTexture, vUv).rgb)'
            : 'vec3(1.0)'
        };
        vec3 color = ambient * base * (1.0 - metal) * ao + (diffuse + specular) * nl * toLinear(vec3(1.0, 0.937, 0.835)) * 3.0 + glow;
        ${material.vertexColors ? 'color = base * (ambient + toLinear(vec3(1.0, 0.937, 0.835)) * (3.0 / PI) * nl);' : ''}
        gl_FragColor = vec4(toSRGB(color), ${material.alphaMode === 'BLEND' ? 'alpha' : '1.0'});
      }`);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(fragmentShader);
      gl.deleteShader(fragmentShader);
      this._removeProgram(program);
      throw new Error(`Unable to compile Layer3D shader: ${error}`);
    }

    program.shaders.push(fragmentShader);
    gl.attachShader(program.program, fragmentShader);
    gl.linkProgram(program.program);
    program.locations = new Map();
    for (let i = 0; i < gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(program.program, i);
      program.locations.set(info.name, { location: gl.getUniformLocation(program.program, info.name), type: info.type });
    }
    if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program.program);
      this._removeProgram(program);
      throw new Error(`Unable to compile Layer3D material: ${error}`);
    }
    if (material.alphaMode === 'BLEND') {
      // Straight-alpha textures; accumulate canvas alpha independently of RGB.
      program.blend = [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    }
    program._layerMaterial = material;
    return program;
  },

  /**
   * HSL inputs are linear-space to preserve the original building styling.
   * Numeric/CSS/RGB inputs are already sRGB; CSS alpha is not used for extrusion.
   * @param {number|string|Object} value 0xRRGGBB, CSS color, {r,g,b}, or {h,s,l} in 0..1.
   * @returns {Object} sRGB {r,g,b} components in 0..1.
   */
  color(value) {
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
  },

  /**
   * Paints the vertices `[start, end)` of a mesh with vertex colors, then redraws.
   * @param {Object} mesh Layer-created mesh with a color attribute.
   * @param {number} start Inclusive vertex index, not an offset into the RGB array.
   * @param {number} end Exclusive vertex index.
   * @param {Object} color sRGB {r,g,b}, typically from color().
   */
  setVertexColor(mesh, start, end, color) {
    const attribute = mesh.geometry.attributes.color;
    for (let i = start; i < end; i++) attribute.data.set([color.r, color.g, color.b], i * 3);
    attribute.needsUpdate = true;
    return this.update();
  },

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
  triangulate(contour, holes = []) {
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
      if (this.isClockWise(ring) !== Boolean(index)) ring.reverse();
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
  },

  /**
   * @returns {boolean} Whether the `{x, y}` points are in clockwise order.
   */
  isClockWise(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area < 0;
  },

  /**
   * Finds the objects under a mouse or pointer event, nearest first.
   *
   * @param {MouseEvent} event
   * @param {Object[]} [objects] Defaults to this layer's root children, not all map layers.
   * @param {boolean} [recursive] Also test the descendants of `objects`.
   * @returns {Object[]} Nearest hit per mesh: object, shared-world point/distance and triangle faceIndex.
   */
  raycast(event, objects = this.root.children, recursive = true) {
    if (!this.renderer) {
      return [];
    }
    const rect = this._map.getContainer().getBoundingClientRect();
    this._updateWorldMatrix(this.scene, true);
    this._updateCamera(this.camera);
    // Unproject the mouse (-1..1) into a world-space ray from the camera.
    const inverseCamera       = new DOMMatrix(this.camera.projectionViewMatrix).inverse();
    const inverseCameraValues = inverseCamera.toFloat64Array();
    if (![...inverseCameraValues].every(Number.isFinite)) {
      throw new Error('Singular 3D transform');
    }
    this.raycaster.origin[0] = this.camera.position[0];
    this.raycaster.origin[1] = this.camera.position[1];
    this.raycaster.origin[2] = this.camera.position[2];
    const unprojected = new DOMPoint(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0,
      1
    ).matrixTransform(inverseCamera);
    const end = [
      unprojected.x / unprojected.w,
      unprojected.y / unprojected.w,
      unprojected.z / unprojected.w
    ];
    this.raycaster.direction[0] = end[0] - this.raycaster.origin[0];
    this.raycaster.direction[1] = end[1] - this.raycaster.origin[1];
    this.raycaster.direction[2] = end[2] - this.raycaster.origin[2];
    const rayLength = Math.hypot(...this.raycaster.direction) || 1;
    this.raycaster.direction[0] /= rayLength;
    this.raycaster.direction[1] /= rayLength;
    this.raycaster.direction[2] /= rayLength;
    const meshes = [],
            hits = []
               a = [0, 0, 0],
               b = [0, 0, 0],
               c = [0, 0, 0],
             sub = (a, b) => a.map((v, i) => v - b[i]),
           cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
            dot  = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    for (const object of objects) {
      if (recursive) this.traverse(object, mesh => { if
        (mesh.geometry && mesh.visible) meshes.push(mesh);
      });
      else if (object.geometry && object.visible) meshes.push(object);
    }
    for (const mesh of meshes) {
      // Test in mesh-local space; compare distances only after returning to shared world space.
      const inverse       = new DOMMatrix(mesh.worldMatrix).inverse();
      const inverseValues = inverse.toFloat64Array();
      if (![...inverseValues].every(Number.isFinite)) {
        throw new Error('Singular 3D transform');
      }
      const localOrigin    = new DOMPoint(...this.raycaster.origin, 1).matrixTransform(inverse);
      const origin         = [
        localOrigin.x / localOrigin.w,
        localOrigin.y / localOrigin.w,
        localOrigin.z / localOrigin.w
      ];
      const localDirection  = new DOMPoint(...this.raycaster.direction, 0).matrixTransform(inverse);
      const direction       = [
        localDirection.x,
        localDirection.y,
        localDirection.z
      ];
      const directionLength = Math.hypot(...direction) || 1;
      direction[0] /= directionLength; direction[1] /= directionLength; direction[2] /= directionLength;
      // AABB slab test reuses the same local ray as the triangle test.
      if (!mesh.geometry.bounds) {
        this._computeBounds(mesh.geometry);
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
          worldPoint[0] - this.raycaster.origin[0],
          worldPoint[1] - this.raycaster.origin[1],
          worldPoint[2] - this.raycaster.origin[2]
        )
      });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  },

  _onTerrainChange() {
    if (!this._map) return;
    for (const area of this._areas.values()) this._releaseArea(area);
    this._areas.clear();
    this._updateArea();
  },

  /** Cover the visible ground bounds and one bordering block, clipped to the archive. */
  _updateArea() {
    if (!this._map || !this.header) return;
    const z = this.header.minZoom;
    const center = this._map.project(this._map.getCenter(), z).divideBy(256).floor();
    const bounds = this._map.getBounds();
    const nw = this._map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const se = this._map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    const archiveNW = this._map.project([this.header.maxLat, this.header.minLon], z).divideBy(256).floor();
    const archiveSE = this._map.project([this.header.minLat, this.header.maxLon], z).divideBy(256).floor();
    const wanted = new Map();
    for (let x = Math.max(0, nw.x - 1, archiveNW.x); x <= Math.min(2 ** z - 1, se.x + 1, archiveSE.x); x++) {
      for (let y = Math.max(0, nw.y - 1, archiveNW.y); y <= Math.min(2 ** z - 1, se.y + 1, archiveSE.y); y++) {
        wanted.set(`${x}/${y}`, { z, x, y });
      }
    }
    for (const [key, area] of this._areas) {
      if (!wanted.has(key)) {
        this._releaseArea(area);
        this._areas.delete(key);
      }
    }
    // Load the nearest new blocks first without rebuilding retained geometry.
    for (const [key, coords] of [...wanted].sort(([, a], [, b]) =>
      Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))) {
      if (!this._areas.has(key)) this._areas.set(key, { coords, request: new AbortController() });
    }
    this._pump();
  },

  /** Start at most two load/build tasks; cancelled tasks still free their slot in finally. */
  _pump() {
    if (!this._map) return;
    for (const area of this._areas.values()) {
      if (this._inflight >= 2) break;
      if (area.started) continue;
      area.started = true;
      this._inflight++;
      (async () => {
        try {
          const coords = area.coords, { z, x, y } = coords;
          const result = await this.getZxy(z, x, y, area.request.signal);
          if (area.request.signal.aborted) return;
          const data = result ? JSON.parse(new TextDecoder().decode(result.data))
            : { type: 'FeatureCollection', features: [] };
          if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
            throw new Error('Invalid GeoJSON response');
          }
          const features = data.features;
          const positions = [], normals = [], colors = [], featureFaces = [];
          let skipped = 0;
          const map = this._map;
          const crs = map.options.crs;
          const origin = crs.project(this.location);
          const metres = Math.cos(this.location.lat * Math.PI / 180);
          const groundOffset = point => point.ground || 0;
          const addTriangle = (a, ah, b, bh, c, ch, nx, ny, nz, color) => {
            const ux = b.x - a.x, uy = bh - ah, uz = a.y - b.y;
            const vx = c.x - a.x, vy = ch - ah, vz = a.y - c.y;
            // Orient the triangle to its intended outward normal after flipping north to -z.
            if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0) {
              const point = b, height = bh;
              b = c; bh = ch; c = point; ch = height;
            }
            positions.push(a.x, ah + groundOffset(a), -a.y,
              b.x, bh + groundOffset(b), -b.y,
              c.x, ch + groundOffset(c), -c.y);
            normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
          };
          let deadline = performance.now() + 8;
          for (const feature of features) {
            if (area.request.signal.aborted) return;
            if (performance.now() >= deadline) {
              await new Promise(requestAnimationFrame);
              if (area.request.signal.aborted) return;
              deadline = performance.now() + 8;
            }
            const geometry = feature.geometry;
            const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
              : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
            if (!polygons) throw new Error('Unsupported GeoJSON geometry');
            const [lon, lat] = polygons[0]?.[0]?.[0] ?? [];
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('Invalid GeoJSON coordinates');
            const anchor = map.project(new L.LatLng(lat, lon), coords.z);
            // Overlapping archive blocks may contain the same polygon; its first vertex owns it.
            if (Math.floor(anchor.x / 256) !== coords.x || Math.floor(anchor.y / 256) !== coords.y) continue;
            const style = this.options.featureStyle(feature);
            if (style === null) {
              skipped++;
              continue;
            }
            if (!style || typeof style !== 'object') throw new Error('featureStyle must return an extrusion style or null');
            const { top, bottom = 0, color = 0xd9b38c } = style;
            if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < 0 || top <= bottom) {
              throw new Error('Invalid extrusion heights: expected top > bottom >= 0');
            }
            const baseColor = this.color(color);
            const vertexStart = positions.length / 3;
            for (const rings of polygons) {
              if (!rings.length) throw new Error('Empty GeoJSON polygon');
              const paths = rings.map(ring => {
                if (ring.length < 4) throw new Error('Invalid GeoJSON polygon ring');
                return ring.slice(0, -1).map(([lng, lat]) => {
                  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('Invalid GeoJSON coordinates');
                  const point = crs.project(new L.LatLng(lat, lng));
                  const elevation = this._map._terrain3D?._getElevation([lat, lng]);
                  return {
                    x: (point.x - origin.x) * metres,
                    y: (point.y - origin.y) * metres,
                    ground: Number.isFinite(elevation) && Number.isFinite(this.root.position[1])
                      ? elevation - this.root.position[1] : 0,
                  };
                });
              });
              const points = paths.flat();
              for (const [a, b, c] of this.triangulate(paths[0], paths.slice(1))) {
                addTriangle(points[a], top, points[b], top, points[c], top, 0, 1, 0, baseColor);
                if (bottom > 0) addTriangle(points[a], bottom, points[b], bottom, points[c], bottom, 0, -1, 0, baseColor);
              }
              paths.forEach((path, index) => {
                // Interior walls face into the courtyard; exterior walls face away from the building.
                const sign = this.isClockWise(path) === (index === 0) ? -1 : 1;
                for (let i = 0; i < path.length; i++) {
                  const a = path[i], b = path[(i + 1) % path.length];
                  const length = Math.hypot(b.x - a.x, b.y - a.y);
                  if (!length) continue;
                  const nx = sign * (b.y - a.y) / length, nz = sign * (b.x - a.x) / length;
                  addTriangle(a, bottom, b, bottom, b, top, nx, 0, nz, baseColor);
                  addTriangle(a, bottom, b, top, a, top, nx, 0, nz, baseColor);
                }
              });
            }
            const vertexEnd = positions.length / 3;
            featureFaces.push({
              id: feature.id ?? feature.properties?.objectid ?? JSON.stringify(geometry),
              properties: feature.properties, baseColor,
              faceStart: vertexStart / 3, faceEnd: vertexEnd / 3, vertexStart, vertexEnd,
            });
          }
          if (!positions.length) {
            Object.assign(area, { mesh: null, buildings: 0, skipped, done: true });
            return;
          }
          Object.assign(area, {
            mesh: {
              position:    [0, 0, 0],
              rotation:    [0, 0, 0],
              scale:       [1, 1, 1],
              worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              children:    [],
              visible:     true,
              gl:          this.renderer.gl,
              geometry:    this._createGeometry(
                this.renderer.gl,
                Object.fromEntries(
                  Object
                    .entries({ position: positions, normal: normals, color: colors })
                    .map(([name, values]) => [name, { size: 3, data: new Float32Array(values) }])
                )
              ),
              program:     this._createProgram({ vertexColors: true, roofTexture: Boolean(this.options.roofTexture) }),
              id:          L.Layer3D._nextId++,
              renderOrder: 0,
              extras:      { featureFaces },
            },
            buildings: featureFaces.length,
            skipped,
            done: true
          });
          this.add(area.mesh);
        } catch (error) {
          if (area.request.signal.aborted) return;
          area.error = error.message;
          this.fire('error', { error });
        }
      })().finally(() => {
        this._inflight--;
        this._pump();
      });
    }
    this._updateStatus();
  },

  /** Cancel pending work and dispose this block's GPU data, including any hover highlight. */
  _releaseArea(area) {
    area.request.abort();
    if (area.mesh) {
      if (this.highlightedFeature?.mesh === area.mesh) {
        this._setHighlight(null);
        this.hoveredFeature = null;
        this._showFeature(null);
      }
      this.remove(area.mesh);
      const geometry = area.mesh.geometry;
      for (const attribute of Object.values(geometry.attributes)) geometry.gl.deleteBuffer(attribute.buffer);
      this._removeProgram(area.mesh.program);
    }
  },

  /** Emit a snapshot for consumers; ready does not wait for all neighborhood tasks. */
  _updateStatus(enabled = true) {
    const progress = { enabled, loaded: 0, skipped: 0, pending: 0, errors: [] };
    for (const area of this._areas.values()) {
      if (area.error) progress.errors.push(area.error);
      else if (!area.done) progress.pending++;
      progress.loaded += area.buildings ?? 0;
      progress.skipped += area.skipped ?? 0;
    }
    this.fire('progress', progress);
  },

  /**
   * Translate a geometry hit into a configured model or batched source feature.
   * Sorted half-open face ranges permit binary search without a feature per triangle.
   * @returns {PickedFeature|null}
   */
  _findFeature(event) {
    if (!this.root || !this.camera) return null;
    for (const hit of this.raycast(event, this.root.children, Boolean(this.model))) {
      if (this.model) {
        let object = hit.object;
        while (object && object !== this.model) object = object.parent;
        if (object === this.model) {
          return {
            id: this.model.id, properties: this.model.extras,
            model: this.model, mesh: hit.object, point: hit.point
          };
        }
      }
      const ranges = hit.object.extras?.featureFaces;
      if (!ranges) continue;
      let low = 0, high = ranges.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const range = ranges[middle];
        if (hit.faceIndex < range.faceStart) high = middle - 1;
        else if (hit.faceIndex >= range.faceEnd) low = middle + 1;
        else return { ...range, mesh: hit.object, point: hit.point };
      }
    }
    return null;
  },

  /** Restore the previous source RGB range before painting another; models are untouched. */
  _setHighlight(feature) {
    if (feature?.model) feature = null;
    if (this.highlightedFeature?.mesh === feature?.mesh &&
      this.highlightedFeature?.vertexStart === feature?.vertexStart) return;
    if (this.highlightedFeature) {
      const { mesh, vertexStart, vertexEnd, baseColor } = this.highlightedFeature;
      this.setVertexColor(mesh, vertexStart, vertexEnd, baseColor);
    }
    this.highlightedFeature = feature;
    if (feature) {
      this.setVertexColor(feature.mesh, feature.vertexStart, feature.vertexEnd,
        this.color(0x48d9ff));
    }
  },

  /** Update tooltip content/position and arbitrate cursor ownership across shared layers. */
  _showFeature(feature, event) {
    const tooltip = this._tooltip;
    if (!tooltip) return;
    if (feature) {
      tooltip.replaceChildren(this.options.tooltipContent(feature));
      tooltip.hidden = false;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      tooltip.style.left = `${x + tooltip.offsetWidth + 16 > rect.width ? x - tooltip.offsetWidth - 12 : x + 12}px`;
      tooltip.style.top = `${y + tooltip.offsetHeight + 16 > rect.height ? y - tooltip.offsetHeight - 12 : y + 12}px`;
    } else {
      tooltip.hidden = true;
    }
    const shared = this._shared;
    if (shared) {
      const visible = [...shared._layers].some(layer => layer._tooltip && !layer._tooltip.hidden);
      if (visible) {
        if (shared._cursor === undefined) shared._cursor = this.container.style.cursor;
        this.container.style.cursor = 'pointer';
      } else if (shared._cursor !== undefined) {
        this.container.style.cursor = shared._cursor;
        delete shared._cursor;
      }
    }
  },

  /** Hover is transient; featurehover also reports misses with feature:null. */
  _onPointerMove(event) {
    this.hoveredFeature = this._findFeature(event);
    this._setHighlight(this.hoveredFeature);
    this._showFeature(this.hoveredFeature, event);
    this.fire('featurehover', { feature: this.hoveredFeature, originalEvent: event });
  },

  /** Emit click without moving the map or pinning the tooltip. */
  _onClick(event) {
    const feature = this._findFeature(event);
    this.hoveredFeature = feature;
    this._setHighlight(feature);
    this._showFeature(feature, event);
    this.fire('featureclick', { feature, originalEvent: event });
  },

  /** Clear hover, highlight and tooltip without retaining a selected feature. */
  _onPointerLeave() {
    this.hoveredFeature = null;
    this._setHighlight(null);
    this._showFeature(null);
    this.fire('featurehover', { feature: null });
  },

  /**
   * Coalesce map events on the owning layer; RAF follows CSS zoom transitions.
   */
  update() {
    const shared = this._shared;
    if (!shared) return this;
    if (shared !== this) {
      shared.update();
      return this;
    }
    if (this._queued) return this;
    this._queued = true;
    queueMicrotask(() => {
      this._queued = false;
      if (this._shared !== this || !this.renderer) return;
      if (this._map._animatingZoom) {
        this._animateZoom();
        return;
      }
      cancelAnimationFrame(this._frame);
      this._render();
    });
    return this;
  },

  /** Rendering owner: ensure at most one pending animation frame. */
  _animateZoom() {
    if (!this._frame) {
      this._frame = requestAnimationFrame(() => this._render());
    }
  },

  /** Find a raster tile's active CSS level to reproduce Leaflet's animated scale/rounding. */
  _getTileLevel() {
    let level;
    this._map.eachLayer(layer => {
      if (!level && layer instanceof L.TileLayer && layer._levels) {
        level = layer._levels[layer._tileZoom];
      }
    });
    return level;
  },

  /** Preserve the outgoing tile level before Leaflet changes its logical zoom. */
  _startZoom() {
    this._zoomLevel = this._getTileLevel();
  },

  /** Stop using the outgoing level after zoomend; the next redraw uses current tiles. */
  _endZoom() {
    for (const animation of this._zoomTransitions?.keys() || []) animation.finish();
    this._zoomTransitions = null;
    this._zoomLevel = null;
    this.update();
  },

  /**
   * Rendering owner: CSS pixels -> scene metres -> perspective camera.
   * Lights and transparent sort centers are converted into the current camera space.
   * Without raster tiles, logical map projection supplies the same static alignment.
   */
  _render() {
    this._frame = null;
    if (this._shared !== this || !this.renderer) return;
    const map = this._map;
    const size = map.getSize();
    if (!size.x || !size.y) return;
    if (map._animatingZoom) {
      this._zoomTransitions ||= new Map();
      const now = performance.now();
      for (const animation of map.getContainer().getAnimations({ subtree: true })) {
        if (!(animation instanceof CSSTransition) || animation.transitionProperty !== 'transform' ||
          !animation.effect.target.classList.contains('leaflet-zoom-animated') ||
          this._zoomTransitions.has(animation)
        ) {
            continue;
        }
        const time = animation.currentTime || 0;
        animation.pause();
        this._zoomTransitions.set(animation, { start: now, time });
      }
      // Freeze CSS between WebGL frames: the compositor must not outrun the canvas.
      for (const [animation, { start, time }] of this._zoomTransitions) {
        animation.currentTime = Math.min(animation.effect.getComputedTiming().endTime, time + now - start);
      }
    }
    if (!this._size || !this._size.equals(size)) {
      this.renderer.width                  = size.x;
      this.renderer.height                 = size.y;
      this.renderer.gl.canvas.width        = Math.round(size.x * this.renderer.dpr);
      this.renderer.gl.canvas.height       = Math.round(size.y * this.renderer.dpr);
      this.renderer.gl.canvas.style.width  = `${size.x}px`;
      this.renderer.gl.canvas.style.height = `${size.y}px`;
      this._size                           = size;
    }

    // Match the map's CSS camera: a perspective distance of 1.5 viewport heights.
    let pixelsPerMeter = map.options.crs.scale(map.getZoom()) / (40075016.68557849 * Math.cos(this._sceneOrigin.lat * Math.PI / 180));
    let origin         = map.project(this._sceneOrigin).subtract(map.getPixelOrigin());
    const level        = this._zoomLevel?.el.isConnected ? this._zoomLevel : this._getTileLevel();
    if (level && map._animatingZoom) {
      this._zoomLevel = level;
    }
    // Leaflet's logical zoom jumps before its tile CSS transition finishes.
    // Use the rendered tile transform, including its rounding, on every animation frame.
    if (level) {
      const transform = new DOMMatrix(map._animatingZoom ? getComputedStyle(level.el).transform : level.el.style.transform);
      const point     = map.project(this._sceneOrigin, level.zoom).subtract(level.origin);
      origin          = new L.Point(point.x * transform.a + transform.e, point.y * transform.d + transform.f);
      pixelsPerMeter *= map.getZoomScale(level.zoom, map.getZoom()) * transform.a;
    }
    const distance = size.y * 1.5 / pixelsPerMeter;
    const center   = map.containerPointToLayerPoint(size.divideBy(2));
    const target   = [
      (center.x - origin.x) / pixelsPerMeter,
      map._terrain3D?._getElevation(map.getCenter()) ?? 0,
      (center.y - origin.y) / pixelsPerMeter
    ];
    const pitch = map.getPitch() * Math.PI / 180;
    const bearing = map.getBearing() * Math.PI / 180;
    const camera = this.camera;
    camera.fov = 2 * Math.atan(1 / 3) * 180 / Math.PI;
    camera.aspect = size.x / size.y;
    camera.near = Math.max(0.1, distance / 10000);
    camera.far = Math.max(10000, distance * 10);
    camera.position[0] = target[0] + Math.sin(bearing) * Math.sin(pitch) * distance;
    camera.position[1] = target[1] + Math.cos(pitch) * distance;
    camera.position[2] = target[2] + Math.cos(bearing) * Math.sin(pitch) * distance;
    camera.up[0] = -Math.sin(bearing) * Math.cos(pitch);
    camera.up[1] = Math.sin(pitch);
    camera.up[2] = -Math.cos(bearing) * Math.cos(pitch);
    camera.target[0] = target[0]; camera.target[1] = target[1]; camera.target[2] = target[2];
    // Refresh the camera view, projection and combined projection-view matrices.
    this._updateCamera(camera);
    const lightPoint = new DOMPoint(-300, 500, 300, 0).matrixTransform(new DOMMatrix(camera.viewMatrix));
    const lightLength = Math.hypot(lightPoint.x, lightPoint.y, lightPoint.z) || 1;
    const light = [lightPoint.x / lightLength, lightPoint.y / lightLength, lightPoint.z / lightLength];
    const skyPoint = new DOMPoint(0, 1, 0, 0).matrixTransform(new DOMMatrix(camera.viewMatrix));
    const skyLength = Math.hypot(skyPoint.x, skyPoint.y, skyPoint.z) || 1;
    const sky = [skyPoint.x / skyLength, skyPoint.y / skyLength, skyPoint.z / skyLength];
    this._updateWorldMatrix(this.scene);
    this.traverse(this.scene, mesh => {
      if (mesh.program?.uniforms.lightDirection) {
        const value = mesh.program.uniforms.lightDirection.value;
        value[0] = light[0]; value[1] = light[1]; value[2] = light[2];
      }
      if (mesh.program?.uniforms.skyDirection) {
        const value = mesh.program.uniforms.skyDirection.value;
        value[0] = sky[0]; value[1] = sky[1]; value[2] = sky[2];
      }
      if (mesh.program?.transparent) {
        if (!mesh.geometry.bounds) this._computeBounds(mesh.geometry);
        const worldPosition = new DOMPoint(...mesh.geometry.bounds.center, 1).matrixTransform(new DOMMatrix(mesh.worldMatrix));
        const screenPosition = worldPosition.matrixTransform(new DOMMatrix(camera.projectionViewMatrix));
        mesh._sortDepth = screenPosition.z / screenPosition.w;
      }
    });
    const renderer = this.renderer;
    if ([...this._layers].some(layer => layer.options.roofTexture)) {
      const gl = renderer.gl;
      const rasters = Object.values(map._layers).filter(layer =>
        L.PMTilesLayer && layer instanceof L.PMTilesLayer && layer._tiles && layer.options.opacity > 0);
      const tiles = rasters.flatMap(layer => Object.values(layer._tiles)
        .filter(tile => tile.el.done && !tile.el.request.signal.aborted && tile.el.isConnected)
        .map(tile => ({ ...tile, layer })));
      const signature = tiles.map(({ el, coords, layer }) =>
        `${L.Util.stamp(el)}:${coords.z}:${coords.x}:${coords.y}:${layer.options.opacity}:${layer.options.zIndex}`).join('|');
      const selection = rasters.map(layer =>
        `${L.Util.stamp(layer)}:${layer.options.opacity}:${layer.options.zIndex}`).join('|');
      // Retain the geographically aligned atlas until a tile batch finishes loading.
      if (!this._roofRaster || this._roofRaster.selection !== selection ||
        (!rasters.some(layer => layer.isLoading()) && this._roofRaster.signature !== signature)) {
        const canvas = this._roofRaster?.texture.image || document.createElement('canvas');
        const zoom = tiles.length ? Math.max(...tiles.map(tile => tile.coords.z)) : map.getZoom();
        const bounds = new L.Bounds();
        for (const { coords, layer } of tiles) {
          const size = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
          bounds.extend(new L.Point(coords.x, coords.y).scaleBy(size));
          bounds.extend(new L.Point(coords.x + 1, coords.y + 1).scaleBy(size));
        }
        const min = bounds.min || map.project(this._sceneOrigin, zoom);
        const size = bounds.isValid() ? bounds.getSize() : new L.Point(1, 1);
        // ponytail: cap at 4096 px; virtual textures if wide views need native detail.
        const limit   = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
        const scale   = Math.min(1, limit / Math.max(size.x, size.y));
        canvas.width  = Math.max(1, Math.ceil(size.x * scale));
        canvas.height = Math.max(1, Math.ceil(size.y * scale));
        const context = canvas.getContext('2d');
        tiles.sort((a, b) => (a.layer.options.zIndex || 0) - (b.layer.options.zIndex || 0) || a.coords.z - b.coords.z);
        for (const { coords, el, layer } of tiles) {
          const tileSize = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
          const offset = new L.Point(coords.x, coords.y).scaleBy(tileSize).subtract(min);
          context.globalAlpha = layer.options.opacity;
          context.drawImage(el, offset.x * canvas.width / size.x, offset.y * canvas.height / size.y,
            tileSize.x * canvas.width / size.x, tileSize.y * canvas.height / size.y);
        }
        const origin = map.project(this._sceneOrigin, zoom);
        const pixels = map.options.crs.scale(zoom) / (40075016.68557849 * Math.cos(this._sceneOrigin.lat * Math.PI / 180));
        const matrix = new DOMMatrix();
        matrix.m11 = pixels / size.x; matrix.m33 = pixels / size.y;
        matrix.m41 = (origin.x - min.x) / size.x; matrix.m43 = (origin.y - min.y) / size.y;
        this._roofRaster = {
          signature, selection, matrix: Array.from(matrix.toFloat64Array()),
          texture: this._roofRaster?.texture || {
            gl, texture: gl.createTexture(), image: canvas, internalFormat: gl.RGBA,
            wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
            minFilter: gl.LINEAR, magFilter: gl.LINEAR, flipY: false,
          },
        };
        this._roofRaster.texture.needsUpdate = true;
      }
    } else if (this._roofRaster) {
      renderer.gl.deleteTexture(this._roofRaster.texture.texture);
      this._roofRaster = null;
    }
    // Visible meshes: opaque first, transparent surfaces back-to-front.
    const meshes = [];
    this.traverse(this.scene, mesh => { if (!mesh.visible) return true; if (mesh.geometry) meshes.push(mesh); });
    meshes.sort((a, b) => Number(a.program.transparent) - Number(b.program.transparent) ||
      (a.program.transparent
        ? (a.renderOrder || 0) - (b.renderOrder || 0) ||
        b._sortDepth - a._sortDepth || a.id - b.id
        : a.id - b.id)
    );
    renderer.gl.viewport(0, 0, renderer.gl.canvas.width, renderer.gl.canvas.height);
    renderer.gl.depthMask(true); renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT | renderer.gl.DEPTH_BUFFER_BIT);
    for (const mesh of meshes) {
      const modelView = Array.from(new DOMMatrix(camera.viewMatrix).multiply(new DOMMatrix(mesh.worldMatrix)).toFloat64Array());
      if (mesh.texture) {
        mesh.program.uniforms.baseTexture.value = mesh.texture;
        mesh.program.uniforms.opacity.value = mesh.opacity;
      }
      if (mesh.program._layerMaterial.roofTexture) {
        Object.assign(mesh.program.uniforms, {
          worldMatrix: { value: mesh.worldMatrix },
          roofMatrix: { value: this._roofRaster.matrix },
          roofTexture: { value: this._roofRaster.texture },
        });
      }
      // The inverse-transpose upper 3x3 preserves normals under nonuniform scaling.
      const inverse = Array.from(new DOMMatrix(modelView).inverse().toFloat64Array());
      if (![...inverse].every(Number.isFinite)) throw new Error('Singular 3D transform');
      Object.assign(mesh.program.uniforms, {
        modelViewMatrix: { value: modelView }, projectionMatrix: { value: camera.projectionMatrix },
        normalMatrix: { value: [inverse[0], inverse[4], inverse[8], inverse[1], inverse[5], inverse[9], inverse[2], inverse[6], inverse[10]] },
      });
      const matrix = new DOMMatrix(mesh.worldMatrix);
      const determinant = matrix.m11 * (matrix.m22 * matrix.m33 - matrix.m23 * matrix.m32) -
        matrix.m21 * (matrix.m12 * matrix.m33 - matrix.m13 * matrix.m32) +
        matrix.m31 * (matrix.m12 * matrix.m23 - matrix.m13 * matrix.m22);
      // Negative scale mirrors winding; flip front-face classification, not vertex data.
      mesh.gl.frontFace(determinant < 0 ? mesh.gl.CW : mesh.gl.CCW);
      const program = mesh.program, gl = mesh.gl;
      const cullFace = program.cullFace;
      // Tower lattice: back faces before front faces, not mixed in index order.
      const faces = program.transparent && program._layerMaterial.doubleSided ? [gl.FRONT, gl.BACK] : [cullFace];
      for (const face of faces) {
        program.cullFace = face;
        this._useProgram(program);
        this._drawGeometry(mesh.geometry, program, gl.TRIANGLES);
      }
      program.cullFace = cullFace;
    }
    if (map._animatingZoom) {
      this._frame = requestAnimationFrame(() => this._render());
    }
  },

  /** Reparent/detach scene data without drawing or disposing GPU resources. */
  setParent(node, parent) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    if (parent) parent.children.push(node);
  },

  /** Depth-first walk; a truthy callback result skips that node's descendants. */
  traverse(node, callback) {
    if (callback(node)) return;
    for (const child of node.children) this.traverse(child, callback);
  },

  /** Compose parent*local matrices; a node.matrix overrides its position/rotation/scale. */
  _updateWorldMatrix(node) {
    let local;
    if (node.matrix) local = node.matrix;
    else {
      const degrees = 180 / Math.PI;
      const matrix = new DOMMatrix().translate(...node.position);
      // Node rotations use YXZ, as did the previous renderer.
      matrix.rotateAxisAngleSelf(0, 1, 0, node.rotation[1] * degrees);
      matrix.rotateAxisAngleSelf(1, 0, 0, node.rotation[0] * degrees);
      matrix.rotateAxisAngleSelf(0, 0, 1, node.rotation[2] * degrees);
      local = matrix.scale(...node.scale).toFloat64Array();
    }
    const world = node.parent
      ? new DOMMatrix(node.parent.worldMatrix).multiply(new DOMMatrix(local)).toFloat64Array()
      : local;
    for (let i = 0; i < 16; i++) node.worldMatrix[i] = world[i];
    for (const child of node.children) this._updateWorldMatrix(child);
  },

  /** Orthonormal view basis plus perspective matrices, refreshed before projecting/drawing. */
  _updateCamera(camera) {
    const z       = camera.position.map((v, i) => v - camera.target[i]);
    const zLength = Math.hypot(...z) || 1;
    const cross   = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    for (let i = 0; i < 3; i++) {
      z[i] /= zLength;
    }
    const x = cross(camera.up, z), xLength = Math.hypot(...x) || 1;
    for (let i = 0; i < 3; i++) {
      x[i] /= xLength;
    }
    const y = cross(z, x);
    const view = new DOMMatrix([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, ...camera.position, 1]).inverse().toFloat64Array();
    if (![...view].every(Number.isFinite)) {
      throw new Error('Singular 3D transform');
    }
    for (let i = 0; i < 16; i++) {
      camera.viewMatrix[i] = view[i];
    }
    const f = 1 / Math.tan(camera.fov * Math.PI / 360),
          n = camera.near,
          r = camera.far;
    const projection = [f / camera.aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (r + n) / (n - r), -1, 0, 0, 2 * r * n / (n - r), 0];
    for (let i = 0; i < 16; i++) {
      camera.projectionMatrix[i] = projection[i];
    }
    const projectionView = new DOMMatrix(camera.projectionMatrix).multiply(new DOMMatrix(camera.viewMatrix)).toFloat64Array();
    for (let i = 0; i < 16; i++) {
      camera.projectionViewMatrix[i] = projectionView[i];
    }
  },

  /** Apply depth/culling/blend state and upload uniforms retained by the shader linker. */
  _useProgram(program) {
    const gl = program.gl;
    gl.useProgram(program.program);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(program.depthWrite);
    if (program.cullFace === null) gl.disable(gl.CULL_FACE);
    else { gl.enable(gl.CULL_FACE); gl.cullFace(program.cullFace); }
    if (program.transparent) { gl.enable(gl.BLEND); gl.blendFuncSeparate(...program.blend); }
    else gl.disable(gl.BLEND);
    let unit = 0;
    for (const [name, { location, type }] of program.locations) {
      const uniform = program.uniforms[name];
      if (!uniform) throw new Error(`Missing Layer3D uniform: ${name}`);
      const value = uniform.value;
      if (type === gl.SAMPLER_2D) {
        const texture = value;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture.texture);
        // Images survive context recreation; upload only changed CPU pixels.
        if (texture.uploaded !== texture.image || texture.needsUpdate) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Boolean(texture.flipY));
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, texture.wrapS);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, texture.wrapT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texture.minFilter);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texture.magFilter);
          gl.texImage2D(gl.TEXTURE_2D, 0, texture.internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, texture.image);
          if (![gl.NEAREST, gl.LINEAR].includes(texture.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
          texture.uploaded = texture.image; texture.needsUpdate = false;
        }
        gl.uniform1i(location, unit++);
      } else if (type === gl.FLOAT_MAT4) {
        gl.uniformMatrix4fv(location, false, value);
      } else if (type === gl.FLOAT_MAT3) {
        gl.uniformMatrix3fv(location, false, value);
      } else if (type === gl.FLOAT_VEC3) {
        gl.uniform3fv(location, value);
      } else {
        gl.uniform1f(location, value);
      }
    }
  },

  _removeProgram(program) {
    for (const shader of program.shaders) program.gl.deleteShader(shader);
    program.gl.deleteProgram(program.program);
  },

  /**
   * Packed CPU attributes and context-bound GPU buffers. Attribute fields:
   * data, size, count, type, target, buffer, normalized and needsUpdate.
   * drawRange.start/count use vertices or indices, not byte offsets.
   * @private
   */
  _createGeometry(gl, attributes) {
    for (const [name, attribute] of Object.entries(attributes)) {
      attribute.size ||= 1;
      attribute.count  = attribute.data.length / attribute.size;
      attribute.type   = attribute.data instanceof Float32Array
        ? gl.FLOAT
        : attribute.data instanceof Uint8Array
          ? gl.UNSIGNED_BYTE
          : attribute.data instanceof Uint16Array
            ? gl.UNSIGNED_SHORT
            : gl.UNSIGNED_INT;
      attribute.target = name === 'index' ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
      attribute.buffer = gl.createBuffer();
      gl.bindBuffer(attribute.target, attribute.buffer);
      gl.bufferData(attribute.target, attribute.data, gl.STATIC_DRAW);
    }
    return {
      gl,
      attributes,
      drawRange: {
        start: 0,
        count: attributes.index?.count || attributes.position.count
      }
    };
  },

  /** Cache local AABB and center for ray picking and transparent mesh sorting. */
  _computeBounds(geometry) {
    const min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity],
          data = geometry.attributes.position.data;
    for (let i = 0; i < data.length; i++) {
      min[i % 3] = Math.min(min[i % 3], data[i]);
      max[i % 3] = Math.max(max[i % 3], data[i]);
    }
    geometry.bounds = { min, max, center: min.map((v, i) => (v + max[i]) / 2) };
  },

  /** Upload changed packed arrays, bind shader attributes and draw triangles. */
  _drawGeometry(geometry, program, mode) {
    const gl = geometry.gl;
    const used = [];
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      gl.bindBuffer(attribute.target, attribute.buffer);
      if (attribute.needsUpdate) {
        gl.bufferSubData(attribute.target, 0, attribute.data); attribute.needsUpdate = false;
        geometry.bounds = null;
      }
      if (name === 'index') continue;
      const location = gl.getAttribLocation(program.program, name);
      if (location < 0) continue;
      gl.enableVertexAttribArray(location); used.push(location);
      gl.vertexAttribPointer(location, attribute.size, attribute.type, Boolean(attribute.normalized), 0, 0);
    }
    const index = geometry.attributes.index;
    if (index) gl.drawElements(mode, geometry.drawRange.count, index.type, geometry.drawRange.start * index.data.BYTES_PER_ELEMENT);
    else gl.drawArrays(mode, geometry.drawRange.start, geometry.drawRange.count);
    for (const location of used) gl.disableVertexAttribArray(location);
  },

});

L.Layer3D._nextId = 0;

/** Renders IGN Float32 DEM tiles and PMTiles raster basemaps in the shared WebGL scene. */
L.TerrainLayer = L.Layer3D.extend({
  initialize(options = {}) {
    const terrainSource = options.source;
    const layerOptions = { ...options };
    delete layerOptions.source;
    L.Layer3D.prototype.initialize.call(this, layerOptions);
    this.terrainSource = terrainSource;
    this._terrainTiles = new Map();
    this._rasterTiles = new Map();
    this._terrainReady = false;
  },

  onAdd(map) {
    if (map._terrain3D && map._terrain3D !== this) throw new Error('Only one TerrainLayer can be active per map');
    map._terrain3D = this;
    L.Layer3D.prototype.onAdd.call(this, map);
    this._terrainPromise = this.root
      ? this._loadTerrain()
      : new Promise(resolve => this.once('ready', () => this._loadTerrain().then(resolve), this));
    map.eachLayer(layer => layer._setTerrain3D?.(this));
    map.fire('terrainchange');
  },

  onRemove(map) {
    this._terrainController?.abort();
    this._terrainLoading = false;
    this._terrainReady = false;
    map.eachLayer(layer => layer._setTerrain3D?.(null));
    for (const tile of this._rasterTiles.keys()) this.removeRasterTile(tile);
    if (map._terrain3D === this) delete map._terrain3D;
    for (const layer of Object.values(map._layers)) layer._setTerrainHeight?.();
    map.fire('terrainchange');
    this._terrainTiles.clear();
    this._terrainOriginElevation = 0;
    this._terrainPromise = null;
    if (this._rasterProgram) this._removeProgram(this._rasterProgram);
    this._rasterProgram = null;
    L.Layer3D.prototype.onRemove.call(this, map);
  },

  async _loadTerrain() {
    if (this._terrainLoading || !this._map) return;
    this._terrainLoading = true;
    this._terrainReady = false;
    const controller = this._terrainController = new AbortController();
    try {
      if (!this.terrainSource || !L.PMTilesLayer) throw new Error('TerrainLayer requires a PMTiles elevation archive');
      const archive = this._terrainArchive = new L.PMTilesLayer(this.terrainSource);
      await archive.ready;
      const header = archive.header;
      if (header.tileType !== 0 || header.minZoom !== header.maxZoom) {
        throw new Error('Expected a single-zoom Float32 PMTiles terrain archive');
      }
      this._terrainZoom = header.maxZoom;
      const map = this._map;
      const northwest = map.project([header.maxLat, header.minLon], this._terrainZoom).divideBy(256).floor();
      const southeast = map.project([header.minLat, header.maxLon], this._terrainZoom).divideBy(256).floor();
      const tiles = [];
      for (let x = northwest.x; x <= southeast.x; x++) {
        for (let y = northwest.y; y <= southeast.y; y++) tiles.push({ z: this._terrainZoom, x, y });
      }
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, tiles.length) }, async () => {
        while (next < tiles.length) {
          controller.signal.throwIfAborted();
          const coords = tiles[next++];
          const result = await archive.getZxy(coords.z, coords.x, coords.y, controller.signal);
          if (!result || result.data.byteLength !== 256 * 256 * 4) {
            throw new Error(`Missing or invalid Float32 terrain tile ${coords.z}/${coords.x}/${coords.y}`);
          }
          this._terrainTiles.set(`${coords.x}/${coords.y}`, new Float32Array(result.data));
        }
      }));
      if (controller.signal.aborted || this._map !== map) return;
      this._terrainReady = true;
      this._terrainOriginElevation = this._getElevation(this.location) ?? 0;
      for (const layer of Object.values(map._layers)) layer._setTerrainHeight?.();
      map.fire('terrainchange');
      this.update();
      this.fire('terrainready');
      return true;
    } catch (error) {
      if (!controller.signal.aborted) this.fire('error', { error });
      return false;
    } finally {
      this._terrainLoading = false;
    }
  },

  _getElevation(location) {
    if (!this._map || !this._terrainReady) return null;
    const point = this._map.project(location, this._terrainZoom);
    const x = point.x - 0.5, y = point.y - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sample = (px, py) => {
      const tileX = Math.floor(px / 256), tileY = Math.floor(py / 256);
      const tile = this._terrainTiles.get(`${tileX}/${tileY}`);
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
  },

  async addRasterTile(layer, coords, tile) {
    const ready = await this._terrainPromise;
    if (!ready || !this._map || this._map._terrain3D !== this || layer._terrain3D !== this ||
      tile.request.signal.aborted || !tile.isConnected || this._rasterTiles.has(tile)) return;
    const divisions = 64, positions = [], normals = [], uvs = [], indices = [];
    const map = this._map, crs = map.options.crs;
    const origin = crs.project(this.location), metres = Math.cos(this.location.lat * Math.PI / 180);
    for (let row = 0; row <= divisions; row++) {
      for (let column = 0; column <= divisions; column++) {
        const latlng = map.unproject(new L.Point(
          (coords.x + column / divisions) * 256,
          (coords.y + row / divisions) * 256), coords.z);
        const point = crs.project(latlng);
        positions.push((point.x - origin.x) * metres,
          (this._getElevation(latlng) ?? this._terrainOriginElevation) - this._terrainOriginElevation,
          -(point.y - origin.y) * metres);
        normals.push(0, 1, 0);
        uvs.push(column / divisions, row / divisions);
        if (row < divisions && column < divisions) {
          const a = row * (divisions + 1) + column;
          const b = a + 1, c = a + divisions + 1, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    const gl = this.renderer.gl;
    const texture = {
      gl, texture: gl.createTexture(), image: tile, internalFormat: gl.RGBA,
      wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.LINEAR, magFilter: gl.LINEAR, flipY: false, needsUpdate: true,
    };
    if (!this._rasterProgram || this._rasterProgram.gl !== gl) {
      this._rasterProgram = this._createProgram({
        baseTexture: texture,
        unlit: true,
        alphaMode: 'BLEND',
      });
    }
    const mesh = {
      position:    [0, 0, 0],
      rotation:    [0, 0, 0],
      scale:       [1, 1, 1],
      worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      children:    [],
      visible:     true,
      gl,
      geometry: this._createGeometry(gl, {
        position: { size: 3, data: new Float32Array(positions) },
        normal:   { size: 3, data: new Float32Array(normals) },
        uv:       { size: 2, data: new Float32Array(uvs) },
        index:    { data: new Uint16Array(indices) },
      }),
      program:      this._rasterProgram,
      texture,
      opacity:      layer.options.opacity ?? 1,
      id:           L.Layer3D._nextId++,
      renderOrder: -1,
    };
    this.add(mesh);
    this._rasterTiles.set(tile, mesh);
    tile._terrainVisibility = tile.style.visibility;
    tile.style.visibility = 'hidden';
  },

  removeRasterTile(tile) {
    tile._terrainRequest?.abort();
    const mesh = this._rasterTiles.get(tile);
    if (!mesh) return;
    this.remove(mesh);
    for (const attribute of Object.values(mesh.geometry.attributes)) mesh.geometry.gl.deleteBuffer(attribute.buffer);
    mesh.gl.deleteTexture(mesh.texture.texture);
    this._rasterTiles.delete(tile);
    tile.style.visibility = tile._terrainVisibility;
    delete tile._terrainVisibility;
  },
});
