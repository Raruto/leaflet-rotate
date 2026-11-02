/**
 * A native WebGPU scene drawn above the map tiles and kept in sync with the map camera
 * (center, zoom, bearing, pitch and zoom animations).
 *
 * No rendering dependencies. Use the `ready` event before using the helpers.
 * All instances on one map share a canvas, scene and camera, with one group per layer.
 *
 * World coordinates are metres relative to `location`: x east, y up, z south.
 * The shared scene instead uses the first attached layer's origin. `root` converts
 * each layer's local metres into that shared space, including latitude scaling.
 *
 * Lifecycle: initialize CPU state -> attach shared GPU device -> load configured
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
 * @property {string} [source] PMTiles URL containing Polygon/MultiPolygon or tree Point GeoJSON.
 * @property {function(Object): (ExtrusionStyle|null)} [featureStyle] Source styling; null skips.
 * @property {function(PickedFeature): (Node|string)} [tooltipContent] No HTML string evaluation.
 * @property {string} [attribution] Standard Leaflet attribution HTML.
 * @property {string} [ariaLabel='3D scene'] Shared canvas accessible name.
 *
 * @typedef {Object} ExtrusionStyle
 * @property {number} top Roof height in metres; must exceed bottom.
 * @property {number} [bottom=0] Nonnegative base height; positive values create an underside.
 * @property {number|string|Object} [color=0xd9b38c] RGB/CSS color, or linear-space {h,s,l}.
 * @property {number} [trunkRadius] Point trees: trunk radius in metres.
 * @property {number} [crownRadius] Point trees: maximum crown radius in metres.
 * @property {number} [crownBottom] Point trees: crown base in metres, between bottom and top.
 * @property {string} [crownShape='round'] Point trees: 'round' or 'cone' schematic crown.
 * @property {number|string|Object} [trunkColor=0x72513a] Point trees: bark color.
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
        if (this._map) await this._attach(this._map);
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
            const device = this.renderer.device;
            // A glTF image may serve both color and data maps: those cannot share a GPU format.
            const key = `${reference.index}:${color}`;
            if (!textures.has(key)) {
              const texture = description.textures[reference.index];
              const sampler = description.samplers?.[texture.sampler] || {};
              const image = images[texture.source];
              const format = color ? 'rgba8unorm-srgb' : 'rgba8unorm';
              textures.set(key, {
                device,
                texture: device.createTexture({
                  size: [image.width, image.height],
                  format,
                  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                }),
                sampler: device.createSampler({
                  addressModeU: sampler.wrapS === 33071 ? 'clamp-to-edge' : sampler.wrapS === 33648 ? 'mirror-repeat' : 'repeat',
                  addressModeV: sampler.wrapT === 33071 ? 'clamp-to-edge' : sampler.wrapT === 33648 ? 'mirror-repeat' : 'repeat',
                  magFilter: sampler.magFilter === 9728 ? 'nearest' : 'linear',
                  minFilter: sampler.minFilter === 9728 || sampler.minFilter === 9984 || sampler.minFilter === 9986 ? 'nearest' : 'linear',
                }),
                samplerOptions: {
                  addressModeU: sampler.wrapS === 33071 ? 'clamp-to-edge' : sampler.wrapS === 33648 ? 'mirror-repeat' : 'repeat',
                  addressModeV: sampler.wrapT === 33071 ? 'clamp-to-edge' : sampler.wrapT === 33648 ? 'mirror-repeat' : 'repeat',
                  magFilter: sampler.magFilter === 9728 ? 'nearest' : 'linear',
                  minFilter: sampler.minFilter === 9728 || sampler.minFilter === 9984 || sampler.minFilter === 9986 ? 'nearest' : 'linear',
                },
                format,
                srgb: color,
                image,
                flipY:          false,
                uploaded: null,
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
                  const device = this.renderer.device;
                  if (attributes.index?.data instanceof Uint8Array) {
                    attributes.index.data = Uint16Array.from(attributes.index.data);
                  }
                  for (const [name, attribute] of Object.entries(attributes)) {
                    attribute.size ||= 1;
                    attribute.count = attribute.data.length / attribute.size;
                    attribute.indexFormat = attribute.data instanceof Uint32Array ? 'uint32' : 'uint16';
                    attribute.buffer = device.createBuffer({
                      size: Math.max(4, attribute.data.byteLength),
                      usage: name === 'index'
                        ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
                        : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                    });
                    device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
                  }
                  const geometry = {
                    device,
                    attributes,
                    drawRange: { start: 0, count: attributes.index?.count || attributes.position.count },
                  };
                  resources.push(geometry);
                  const mesh = {
                    position:    [0, 0, 0],
                    rotation:    [0, 0, 0],
                    scale:       [1, 1, 1],
                    worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    children:    [],
                    visible:     true,
                    device,
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
                  for (const attribute of Object.values(resource.attributes)) attribute.buffer.destroy();
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
    if (this.root) {
      this._attach(map).catch(error => this.fire('error', { error }));
    }
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
      map.off('move zoom rotate pitch resize viewreset layeradd layerremove', this._onMapChange, this);
      map.off('zoomstart', this._startZoom, this);
      map.off('zoomanim', this.update, this);
      map.off('zoomend', this._endZoom, this);
      cancelAnimationFrame(this._frame);
      this._frame = null;
      this._queued = false;
      if (this._layers.size) {
        // Keep the original scene origin and GPU resources when ownership changes.
        const next = this._layers.values().next().value;
        for (const key of ['_layers', '_sceneOrigin', '_size', '_zoomLevel', '_zoomTransitions', '_cursor', '_roofRaster', '_roofTiles']) {
          next[key] = this[key];
          delete this[key];
        }
        for (const layer of next._layers) layer._shared = next;
        L.Layer3D._renderers.set(map, next);
        map.on('move zoom rotate pitch resize viewreset layeradd layerremove', next._onMapChange, next);
        map.on('zoomstart', next._startZoom, next);
        map.on('zoomanim', next.update, next);
        map.on('zoomend', next._endZoom, next);
        next.update();
      } else {
        if (this._roofRaster) this._destroyTexture(this._roofRaster.texture.texture);
        this._roofRaster = null;
        for (const source of this._roofTiles?.values() || []) this._destroyTexture(source.texture);
        this._roofTiles = null;
        for (const animation of this._zoomTransitions?.keys() || []) animation.play();
        this._zoomTransitions = null;
        this.renderer.canvas.remove();
        const renderer = this.renderer;
        const resources = [renderer.depthTexture, renderer.roofFallbackTexture.texture, renderer.uniformBuffer].filter(Boolean);
        renderer.device.queue.onSubmittedWorkDone().then(() => {
          for (const resource of resources) resource.destroy();
          renderer.device.destroy();
        }, error => {
          this.fire('error', { error });
          renderer.device.destroy();
        });
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
  async _attach(map) {
    let shared = L.Layer3D._renderers.get(map);
    if (shared?._rendererReady) {
      await shared._rendererReady.promise;
    }
    if (!shared) {
      const rendererReady = Promise.withResolvers();
      shared = this;
      this._rendererReady = rendererReady;
      rendererReady.promise.catch(() => {});
      L.Layer3D._renderers.set(map, shared);
      const fail = error => {
        rendererReady.reject(error);
        L.Layer3D._renderers.delete(map);
        throw error;
      };
      const canvas = document.createElement('canvas');
      if (!navigator.gpu) fail(new Error('Layer3D requires WebGPU'));
      const adapter = await navigator.gpu.requestAdapter().catch(fail);
      if (!adapter) fail(new Error('Unable to acquire a WebGPU adapter'));
      const device = await adapter.requestDevice().catch(fail);
      device.addEventListener('uncapturederror', event => {
        const owner = L.Layer3D._renderers.get(map);
        for (const layer of owner?._layers || []) layer.fire('error', { error: event.error });
      });
      device.lost.then(info => {
        const owner = L.Layer3D._renderers.get(map);
        if (!owner) return;
        const error = new Error(`WebGPU device lost: ${info.message || info.reason}`);
        for (const layer of owner._layers) layer.fire('error', { error });
      });
      const context = canvas.getContext('webgpu');
      if (!context) {
        device.destroy();
        fail(new Error('Unable to create a WebGPU canvas context'));
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'premultiplied' });
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
      this.renderer = { device, context, format, canvas, dpr: Math.min(window.devicePixelRatio, 2) };
      const emptyImage = document.createElement('canvas');
      emptyImage.width = 1;
      emptyImage.height = 1;
      this.renderer.roofFallbackTexture = {
        device,
        texture: device.createTexture({
          size: [1, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        }),
        sampler: device.createSampler({
          addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
        }),
        image: emptyImage, format: 'rgba8unorm', srgb: false, uploaded: null,
      };
      shared._size = null;
      canvas.className = 'leaflet-3d';
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', this.options.ariaLabel);
      let pane = map.getPane('webgpuPane');
      if (!pane) {
        pane = map.createPane('webgpuPane', map.getContainer());
        pane.style.zIndex = 450;
      }
      pane.append(canvas);
      map.on('move zoom rotate pitch resize viewreset layeradd layerremove', shared._onMapChange, shared);
      map.on('zoomstart', shared._startZoom, shared);
      map.on('zoomanim', shared.update, shared);
      map.on('zoomend', shared._endZoom, shared);
      rendererReady.resolve();
      delete shared._rendererReady;
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
      if (object.geometry && object.geometry.device !== shared.renderer.device) {
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
        const device = shared.renderer.device;
        if (attributes.index?.data instanceof Uint8Array) {
          attributes.index.data = Uint16Array.from(attributes.index.data);
        }
        for (const [name, attribute] of Object.entries(attributes)) {
          attribute.size ||= 1;
          attribute.count = attribute.data.length / attribute.size;
          attribute.indexFormat = attribute.data instanceof Uint32Array ? 'uint32' : 'uint16';
          attribute.buffer = device.createBuffer({
            size: Math.max(4, attribute.data.byteLength),
            usage: name === 'index'
              ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
              : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
        }
        object.geometry = {
          device,
          attributes,
          drawRange: { start: 0, count: attributes.index?.count || attributes.position.count },
        };
        for (const attribute of Object.values(geometry.attributes)) attribute.buffer.destroy();
        object.bindGroup = null;
        object.boundTextures = [];
        for (const key of ['baseTexture', 'metalTexture', 'emissiveTexture', 'occlusionTexture']) {
          const texture = material[key];
          if (!texture || texture.device === device) continue;
          material[key] = {
            ...texture,
            device,
            texture: device.createTexture({
              size: [texture.image.width, texture.image.height],
              format: texture.format,
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            }),
            sampler: device.createSampler(texture.samplerOptions),
            uploaded: null,
          };
        }
        this._removeProgram(object.program);
        object.program = this._createProgram(material);
        object.device = device;
      }
      if (object.texture && object.texture.device !== shared.renderer.device) {
        object.texture = {
          ...object.texture,
          device: shared.renderer.device,
          texture: shared.renderer.device.createTexture({
            size: [object.texture.image.width, object.texture.image.height],
            format: object.texture.format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
          }),
          sampler: shared.renderer.device.createSampler(object.texture.samplerOptions),
          uploaded: null,
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

  _destroyTexture(texture) {
    this.renderer.device.queue.onSubmittedWorkDone().then(() => texture.destroy(), error => {
      this.fire('error', { error });
      texture.destroy();
    });
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

  _createProgram(material = {}) {
    const device = this.renderer.device;
    const hasBase = Boolean(material.baseTexture);
    const hasMetal = Boolean(material.metalTexture);
    const hasEmissive = Boolean(material.emissiveTexture);
    const hasOcclusion = Boolean(material.occlusionTexture);
    const hasRoof = Boolean(material.roofTexture);
    const hasTerrain = Boolean(material.terrain);
    const textured = hasBase || hasMetal || hasEmissive || hasOcclusion;
    const vertex = device.createShaderModule({ code: `
      struct Mesh {
        worldMatrix: mat4x4<f32>,
        baseColor: vec4<f32>,
        material: vec4<f32>,
        emissive: vec4<f32>,
        terrain: vec4<f32>,
        highlight: vec4<f32>,
      };
      struct Frame {
        viewMatrix: mat4x4<f32>,
        projectionMatrix: mat4x4<f32>,
        roofMatrix: mat4x4<f32>,
        lightDirection: vec4<f32>,
        skyDirection: vec4<f32>,
      };
      @group(0) @binding(0) var<uniform> u: Mesh;
      @group(0) @binding(1) var<uniform> frame: Frame;
      ${hasTerrain ? `@group(0) @binding(2) var dem: texture_2d<f32>;${L.TerrainLayer.elevationWGSL}` : ''}
      struct VertexInput {
        @location(0) position: vec3<f32>,
        @location(1) normal: vec3<f32>,
        ${material.vertexColors ? '@location(2) color: vec3<f32>,' : ''}
        ${textured ? '@location(3) uv: vec2<f32>,' : ''}
      };
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) viewPosition: vec3<f32>,
        ${textured ? '@location(3) uv: vec2<f32>,' : ''}
        ${hasRoof ? '@location(4) roofUv: vec2<f32>, @location(5) roof: f32,' : ''}
      };
      @vertex fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var output: VertexOutput;
        var position = input.position;
        ${hasTerrain ? 'position.y = elevation(u.terrain.xy + input.uv * u.terrain.z, u.terrain.w) - u.terrain.w;' : ''}
        let highlighted = f32(vertexIndex) >= u.highlight.x && f32(vertexIndex) < u.highlight.y;
        output.color = ${material.vertexColors
          ? 'select(input.color, vec3<f32>(72.0 / 255.0, 217.0 / 255.0, 1.0), highlighted)'
          : 'u.baseColor.rgb'};
        // Inverse-transpose from cofactors; the camera view matrix is orthonormal.
        let m = mat3x3<f32>(u.worldMatrix[0].xyz, u.worldMatrix[1].xyz, u.worldMatrix[2].xyz);
        let normal = (cross(m[1], m[2]) * input.normal.x + cross(m[2], m[0]) * input.normal.y +
          cross(m[0], m[1]) * input.normal.z) / determinant(m);
        output.normal = (frame.viewMatrix * vec4<f32>(normal, 0.0)).xyz;
        let world = u.worldMatrix * vec4<f32>(position, 1.0);
        let viewPosition = frame.viewMatrix * world;
        output.viewPosition = viewPosition.xyz;
        ${textured ? 'output.uv = input.uv;' : ''}
        ${hasRoof ? `
          output.roofUv = (frame.roofMatrix * world).xz;
          output.roof = select(0.0, 1.0, input.normal.y >= 0.5 && !highlighted);
        ` : ''}
        output.position = frame.projectionMatrix * viewPosition;
        return output;
      }
    ` });
    const bindings = [];
    let binding = 3;
    const textureBinding = (name, enabled) => {
      if (!enabled) return '';
      bindings.push({ name, texture: binding, sampler: binding + 1 });
      const current = binding;
      binding += 2;
      return `@group(0) @binding(${current}) var ${name}: texture_2d<f32>;
        @group(0) @binding(${current + 1}) var ${name}Sampler: sampler;`;
    };
    const baseBinding = textureBinding('baseTexture', hasBase);
    const metalBinding = textureBinding('metalTexture', hasMetal);
    const emissiveBinding = textureBinding('emissiveTexture', hasEmissive);
    const occlusionBinding = textureBinding('occlusionTexture', hasOcclusion);
    const roofBinding = textureBinding('roofTexture', hasRoof);
    const fragment = device.createShaderModule({ code: `
      struct Mesh {
        worldMatrix: mat4x4<f32>,
        baseColor: vec4<f32>,
        material: vec4<f32>,
        emissive: vec4<f32>,
        terrain: vec4<f32>,
        highlight: vec4<f32>,
      };
      struct Frame {
        viewMatrix: mat4x4<f32>,
        projectionMatrix: mat4x4<f32>,
        roofMatrix: mat4x4<f32>,
        lightDirection: vec4<f32>,
        skyDirection: vec4<f32>,
      };
      @group(0) @binding(0) var<uniform> u: Mesh;
      @group(0) @binding(1) var<uniform> frame: Frame;
      ${baseBinding}${metalBinding}${emissiveBinding}${occlusionBinding}${roofBinding}
      struct FragmentInput {
        @location(0) color: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) viewPosition: vec3<f32>,
        ${textured ? '@location(3) uv: vec2<f32>,' : ''}
        ${hasRoof ? '@location(4) roofUv: vec2<f32>, @location(5) roof: f32,' : ''}
      };
      const PI: f32 = 3.14159265;
      fn toLinear(c: vec3<f32>) -> vec3<f32> {
        return select(c / 12.92, pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)),
          c >= vec3<f32>(0.04045));
      }
      fn toSRGB(c: vec3<f32>) -> vec3<f32> {
        return select(c * 12.92, 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055),
          c >= vec3<f32>(0.0031308));
      }
      @fragment fn fragmentMain(input: FragmentInput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
        ${material.unlit ? `
          let rasterTexel = textureSample(baseTexture, baseTextureSampler, input.uv);
          return vec4<f32>(toSRGB(toLinear(rasterTexel.rgb)), ${material.alphaMode === 'BLEND' ? 'u.material.z * rasterTexel.a' : '1.0'});
        ` : `
        var normal = normalize(input.normal) * select(-1.0, 1.0, frontFacing);
        let texel = ${hasBase ? 'textureSample(baseTexture, baseTextureSampler, input.uv)' : 'vec4<f32>(1.0)'};
        let alpha = u.material.z * texel.a;
        ${material.alphaMode === 'MASK' ? 'if (alpha < u.material.w) { discard; }' : ''}
        ${material.alphaMode === 'BLEND' ? 'if (alpha < 0.01) { discard; }' : ''}
        var base = ${material.vertexColors ? 'toLinear(input.color)' : 'input.color'} *
          ${material.baseTexture?.srgb ? 'texel.rgb' : 'toLinear(texel.rgb)'};
        ${hasRoof ? `
          if (input.roof > 0.5 && all(input.roofUv >= vec2<f32>(0.0)) &&
            all(input.roofUv <= vec2<f32>(1.0))) {
            let roof = textureSampleLevel(roofTexture, roofTextureSampler, input.roofUv, 0.0);
            base = mix(base, toLinear(roof.rgb), roof.a);
          }
        ` : ''}
        let mr = ${hasMetal ? 'textureSample(metalTexture, metalTextureSampler, input.uv)' : 'vec4<f32>(1.0)'};
        let metal = clamp(u.material.x * mr.b, 0.0, 1.0);
        let rough = clamp(u.material.y * mr.g, 0.08, 1.0);
        let view = normalize(-input.viewPosition);
        let halfVector = normalize(view + frame.lightDirection.xyz);
        let nl = max(dot(normal, frame.lightDirection.xyz), 0.0);
        let nv = max(dot(normal, view), 0.001);
        let nh = max(dot(normal, halfVector), 0.0);
        let vh = max(dot(view, halfVector), 0.0);
        let a2 = pow(rough, 4.0);
        let d = a2 / max(PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0), 0.0001);
        let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
        let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
        let visibility = 0.5 / max(gv + gl, 0.0001);
        let f0 = mix(vec3<f32>(0.04), base, metal);
        let fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
        let specular = d * visibility * fresnel;
        let diffuse = (1.0 - metal) * base / PI;
        let sky = dot(normal, frame.skyDirection.xyz) * 0.5 + 0.5;
        let ambient = mix(toLinear(vec3<f32>(0.455, 0.412, 0.322)), vec3<f32>(1.0), sky) * (2.0 / PI);
        let ao = ${hasOcclusion ? 'mix(1.0, textureSample(occlusionTexture, occlusionTextureSampler, input.uv).r, u.emissive.w)' : '1.0'};
        let glow = u.emissive.rgb * ${
          hasEmissive
          ? material.emissiveTexture.srgb
            ? 'textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb'
            : 'toLinear(textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb)'
          : 'vec3<f32>(1.0)'
        };
        var color = ambient * base * (1.0 - metal) * ao +
          (diffuse + specular) * nl * toLinear(vec3<f32>(1.0, 0.937, 0.835)) * 3.0 + glow;
        ${material.vertexColors ? 'color = base * (ambient + toLinear(vec3<f32>(1.0, 0.937, 0.835)) * (3.0 / PI) * nl);' : ''}
        return vec4<f32>(toSRGB(color), ${material.alphaMode === 'BLEND' ? 'alpha' : '1.0'});
        `}
      }
    ` });
    Promise.all([vertex.getCompilationInfo(), fragment.getCompilationInfo()]).then(infos => {
      const errors = infos.flatMap(info => info.messages).filter(message => message.type === 'error');
      if (errors.length) {
        this.fire('error', {
          error: new Error(`Unable to compile Layer3D WGSL: ${errors.map(error => error.message).join('\n')}`),
        });
      }
    }).catch(error => this.fire('error', { error }));
    const vertexBuffers = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      material.vertexColors
        ? { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] }
        : null,
      textured
        ? { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x2' }] }
        : null,
    ];
    const bindGroupEntries = [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform', hasDynamicOffset: true },
    }, {
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    }];
    if (hasTerrain) {
      bindGroupEntries.push({
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
      });
    }
    for (const texture of bindings) {
      bindGroupEntries.push({
        binding: texture.texture,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d' },
      });
      bindGroupEntries.push({
        binding: texture.sampler,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      });
    }
    const bindGroupLayout = device.createBindGroupLayout({ entries: bindGroupEntries });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    return {
      device,
      vertex,
      fragment,
      bindings,
      vertexBuffers,
      bindGroupLayout,
      pipelineLayout,
      pipelineCache: new Map(),
      cullMode: material.doubleSided ? 'none' : 'back',
      transparent: material.alphaMode === 'BLEND',
      depthWrite: material.alphaMode !== 'BLEND',
      terrain: material.terrain,
      uniforms: {
        baseColor: { value: material.color || [1, 1, 1] },
        metallic: { value: material.metallic ?? 0 },
        roughness: { value: material.roughness ?? 0.85 },
        opacity: { value: material.opacity ?? 1 },
        alphaCutoff: { value: material.alphaCutoff ?? 0.5 },
        occlusionStrength: { value: material.occlusionStrength ?? 1 },
        emissive: { value: material.emissive || [0, 0, 0] },
        ...(hasBase ? { baseTexture: { value: material.baseTexture } } : {}),
        ...(hasMetal ? { metalTexture: { value: material.metalTexture } } : {}),
        ...(hasEmissive ? { emissiveTexture: { value: material.emissiveTexture } } : {}),
        ...(hasOcclusion ? { occlusionTexture: { value: material.occlusionTexture } } : {}),
        ...(hasRoof ? { roofTexture: { value: null } } : {}),
      },
      _layerMaterial: material,
    };
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
            hits = [],
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

  /** Low-poly tree, sharing the source block's buffers, picking and terrain offset. */
  _treeGeometry(point, style, addTriangle) {
    const { top, bottom = 0, trunkRadius, crownRadius, crownBottom, crownShape = 'round' } = style;
    if (![trunkRadius, crownRadius, crownBottom].every(Number.isFinite) ||
      trunkRadius <= 0 || crownRadius < trunkRadius || crownBottom <= bottom || crownBottom >= top ||
      !['round', 'cone'].includes(crownShape)) throw new Error('Invalid tree dimensions or crown shape');
    const trunk = this.color(style.trunkColor ?? 0x72513a);
    const crown = this.color(style.color ?? 0x4f823b);
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
            const isTree = geometry?.type === 'Point';
            const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
            if (!polygons && !isTree) throw new Error('Unsupported GeoJSON geometry');
            const [lon, lat] = (isTree ? geometry.coordinates : polygons[0]?.[0]?.[0]) ?? [];
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
            if (isTree) {
              const point = crs.project(new L.LatLng(lat, lon));
              const elevation = map._terrain3D?._getElevation([lat, lon]);
              this._treeGeometry({
                x: (point.x - origin.x) * metres, y: (point.y - origin.y) * metres,
                ground: Number.isFinite(elevation) && Number.isFinite(this.root.position[1])
                  ? elevation - this.root.position[1] : 0,
              }, style, addTriangle);
            }
            for (const rings of polygons || []) {
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
          const device = this.renderer.device;
          const attributes = {
            position: { size: 3, data: new Float32Array(positions) },
            normal:   { size: 3, data: new Float32Array(normals) },
            color:    { size: 3, data: new Float32Array(colors) },
          };
          for (const [name, attribute] of Object.entries(attributes)) {
            attribute.count = attribute.data.length / attribute.size;
            attribute.buffer = device.createBuffer({
              size: Math.max(4, attribute.data.byteLength),
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
          }
          const meshGeometry = {
            device,
            attributes,
            drawRange: { start: 0, count: attributes.position.count },
          };
          Object.assign(area, {
            mesh: {
              position:    [0, 0, 0],
              rotation:    [0, 0, 0],
              scale:       [1, 1, 1],
              worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              children:    [],
              visible:     true,
              device,
              geometry:    meshGeometry,
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
      for (const attribute of Object.values(geometry.attributes)) attribute.buffer.destroy();
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

  /** Highlight a source vertex range in the shader; vertex colors stay untouched. */
  _setHighlight(feature) {
    if (feature?.model) feature = null;
    if (this.highlightedFeature?.mesh === feature?.mesh &&
      this.highlightedFeature?.vertexStart === feature?.vertexStart) return;
    if (this.highlightedFeature) this.highlightedFeature.mesh.highlight = null;
    this.highlightedFeature = feature;
    if (feature) feature.mesh.highlight = [feature.vertexStart, feature.vertexEnd];
    this.update();
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

  /** Content changes: render once on the next animation frame. */
  update() {
    const shared = this._shared;
    if (!shared) return this;
    if (shared !== this) {
      shared.update();
      return this;
    }
    this._frame ||= requestAnimationFrame(() => {
      this._frame = null;
      if (this._shared === this && this.renderer) this._render();
    });
    return this;
  },

  /** Map movement: render within the frame of Leaflet's CSS transforms, coalescing same-tick events. */
  _onMapChange() {
    if (this._queued) return;
    this._queued = true;
    queueMicrotask(() => {
      this._queued = false;
      if (this._shared !== this || !this.renderer) return;
      if (this._map._animatingZoom) this.update();
      else this._render();
    });
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
    cancelAnimationFrame(this._frame);
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
      // Freeze CSS between rendered frames: the compositor must not outrun the canvas.
      for (const [animation, { start, time }] of this._zoomTransitions) {
        animation.currentTime = Math.min(animation.effect.getComputedTiming().endTime, time + now - start);
      }
    }
    if (!this._size || !this._size.equals(size)) {
      this.renderer.width                  = size.x;
      this.renderer.height                 = size.y;
      this.renderer.canvas.width        = Math.round(size.x * this.renderer.dpr);
      this.renderer.canvas.height       = Math.round(size.y * this.renderer.dpr);
      this.renderer.canvas.style.width  = `${size.x}px`;
      this.renderer.canvas.style.height = `${size.y}px`;
      if (this.renderer.depthTexture) this._destroyTexture(this.renderer.depthTexture);
      this.renderer.depthTexture = this.renderer.device.createTexture({
        size: [this.renderer.canvas.width, this.renderer.canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
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
    const projection = camera.projectionViewMatrix;
    const frustum = [
      [projection[3] + projection[0], projection[7] + projection[4], projection[11] + projection[8], projection[15] + projection[12]],
      [projection[3] - projection[0], projection[7] - projection[4], projection[11] - projection[8], projection[15] - projection[12]],
      [projection[3] + projection[1], projection[7] + projection[5], projection[11] + projection[9], projection[15] + projection[13]],
      [projection[3] - projection[1], projection[7] - projection[5], projection[11] - projection[9], projection[15] - projection[13]],
      [projection[2], projection[6], projection[10], projection[14]],
      [projection[3] - projection[2], projection[7] - projection[6], projection[11] - projection[10], projection[15] - projection[14]],
    ];
    const frustumLengths = [
      Math.hypot(frustum[0][0], frustum[0][1], frustum[0][2]),
      Math.hypot(frustum[1][0], frustum[1][1], frustum[1][2]),
      Math.hypot(frustum[2][0], frustum[2][1], frustum[2][2]),
      Math.hypot(frustum[3][0], frustum[3][1], frustum[3][2]),
      Math.hypot(frustum[4][0], frustum[4][1], frustum[4][2]),
      Math.hypot(frustum[5][0], frustum[5][1], frustum[5][2]),
    ];
    this._updateWorldMatrix(this.scene);
    this.traverse(this.scene, mesh => {
      if (!mesh.visible) return true;
      if (mesh.geometry) {
        if (!mesh.geometry.bounds) this._computeBounds(mesh.geometry);
        const bounds = mesh.geometry.bounds;
        const world = mesh.worldMatrix;
        const center = bounds.center;
        const x = world[0] * center[0] + world[4] * center[1] + world[8] * center[2] + world[12];
        const y = world[1] * center[0] + world[5] * center[1] + world[9] * center[2] + world[13];
        const z = world[2] * center[0] + world[6] * center[1] + world[10] * center[2] + world[14];
        const radius = bounds.radius * Math.max(
          Math.hypot(world[0], world[1], world[2]),
          Math.hypot(world[4], world[5], world[6]),
          Math.hypot(world[8], world[9], world[10])
        );
        mesh._visibleInFrame =
          frustum[0][0] * x + frustum[0][1] * y + frustum[0][2] * z + frustum[0][3] >= -radius * frustumLengths[0] &&
          frustum[1][0] * x + frustum[1][1] * y + frustum[1][2] * z + frustum[1][3] >= -radius * frustumLengths[1] &&
          frustum[2][0] * x + frustum[2][1] * y + frustum[2][2] * z + frustum[2][3] >= -radius * frustumLengths[2] &&
          frustum[3][0] * x + frustum[3][1] * y + frustum[3][2] * z + frustum[3][3] >= -radius * frustumLengths[3] &&
          frustum[4][0] * x + frustum[4][1] * y + frustum[4][2] * z + frustum[4][3] >= -radius * frustumLengths[4] &&
          frustum[5][0] * x + frustum[5][1] * y + frustum[5][2] * z + frustum[5][3] >= -radius * frustumLengths[5];
        if (!mesh._visibleInFrame) return;
      }
      if (mesh.program?.transparent) {
        if (!mesh.geometry.bounds) this._computeBounds(mesh.geometry);
        const center = mesh.geometry.bounds.center, world = mesh.worldMatrix;
        const x = world[0] * center[0] + world[4] * center[1] + world[8] * center[2] + world[12];
        const y = world[1] * center[0] + world[5] * center[1] + world[9] * center[2] + world[13];
        const z = world[2] * center[0] + world[6] * center[1] + world[10] * center[2] + world[14];
        const projection = camera.projectionViewMatrix;
        const clipZ = projection[2] * x + projection[6] * y + projection[10] * z + projection[14];
        const clipW = projection[3] * x + projection[7] * y + projection[11] * z + projection[15];
        mesh._sortDepth = clipZ / clipW;
      }
    });
    const renderer = this.renderer;
    if ([...this._layers].some(layer => layer.options.roofTexture)) {
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
        const limit   = 4096;
        const scale   = Math.min(1, limit / Math.max(size.x, size.y));
        const width   = Math.max(1, Math.ceil(size.x * scale));
        const height  = Math.max(1, Math.ceil(size.y * scale));
        const origin = map.project(this._sceneOrigin, zoom);
        const pixels = map.options.crs.scale(zoom) / (40075016.68557849 * Math.cos(this._sceneOrigin.lat * Math.PI / 180));
        const matrix = new DOMMatrix();
        matrix.m11 = pixels / size.x; matrix.m33 = pixels / size.y;
        matrix.m41 = (origin.x - min.x) / size.x; matrix.m43 = (origin.y - min.y) / size.y;
        const texture = this._roofRaster?.texture;
        if (texture && (texture.width !== width || texture.height !== height)) {
          this._destroyTexture(texture.texture);
          texture.texture = renderer.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
          });
          texture.width = width;
          texture.height = height;
        }
        this._roofRaster = {
          signature, selection, matrix: Array.from(matrix.toFloat64Array()),
          texture: texture || {
            device: renderer.device,
            texture: renderer.device.createTexture({
              size: [width, height],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            }),
            sampler: renderer.device.createSampler({
              addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
            }),
            samplerOptions: { addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
            image: null, width, height,
            format: 'rgba8unorm', srgb: false, flipY: false, uploaded: null,
          },
        };
        // Compose the atlas on the GPU: re-uploading a large canvas stalls Firefox for hundreds of ms.
        const device = renderer.device;
        if (!renderer.roofBlit) {
          const module = device.createShaderModule({ code: `
            @group(0) @binding(0) var source: texture_2d<f32>;
            @group(0) @binding(1) var sourceSampler: sampler;
            @group(0) @binding(2) var<uniform> opacity: f32;
            struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f };
            @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Varyings {
              let uv = vec2f(f32(index & 1u), f32(index >> 1u));
              return Varyings(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
            }
            @fragment fn fragmentMain(input: Varyings) -> @location(0) vec4f {
              let color = textureSample(source, sourceSampler, input.uv);
              return vec4f(color.rgb, color.a * opacity);
            }
          ` });
          renderer.roofBlit = {
            pipeline: device.createRenderPipeline({
              layout: 'auto',
              vertex: { module, entryPoint: 'vertexMain' },
              fragment: {
                module,
                entryPoint: 'fragmentMain',
                targets: [{
                  format: 'rgba8unorm',
                  blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  },
                }],
              },
              primitive: { topology: 'triangle-strip' },
            }),
            sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
          };
        }
        // Raster tiles keep their GPU copy; terrain meshes already own one for the same image.
        const roofTiles = this._roofTiles ||= new Map();
        for (const [el, source] of roofTiles) {
          if (!tiles.some(tile => tile.el === el) || map._terrain3D?._rasterTiles.has(el)) {
            source.texture.destroy();
            roofTiles.delete(el);
          }
        }
        const opacities = new Float32Array(Math.max(1, tiles.length) * 64);
        const opacityBuffer = device.createBuffer({
          size: opacities.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const encoder = device.createCommandEncoder();
        const atlasPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: this._roofRaster.texture.texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        atlasPass.setPipeline(renderer.roofBlit.pipeline);
        tiles.sort((a, b) => (a.layer.options.zIndex || 0) - (b.layer.options.zIndex || 0) || a.coords.z - b.coords.z);
        for (const [i, { coords, el, layer }] of tiles.entries()) {
          let source = map._terrain3D?._rasterTiles.get(el)?.texture || roofTiles.get(el);
          if (!source) {
            source = {
              texture: device.createTexture({
                size: [el.naturalWidth, el.naturalHeight],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
              }),
              image: el, uploaded: null,
            };
            roofTiles.set(el, source);
          }
          if (source.uploaded !== source.image) {
            device.queue.copyExternalImageToTexture({ source: el }, { texture: source.texture },
              [source.texture.width, source.texture.height]);
            source.uploaded = source.image;
          }
          opacities[i * 64] = layer.options.opacity;
          const tileSize = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
          const offset = new L.Point(coords.x, coords.y).scaleBy(tileSize).subtract(min);
          const x = offset.x * width / size.x, y = offset.y * height / size.y;
          atlasPass.setViewport(x, y, Math.min(tileSize.x * width / size.x, width - x),
            Math.min(tileSize.y * height / size.y, height - y), 0, 1);
          atlasPass.setBindGroup(0, device.createBindGroup({
            layout: renderer.roofBlit.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: source.texture.createView() },
              { binding: 1, resource: renderer.roofBlit.sampler },
              { binding: 2, resource: { buffer: opacityBuffer, offset: i * 256, size: 4 } },
            ],
          }));
          atlasPass.draw(4);
        }
        atlasPass.end();
        device.queue.writeBuffer(opacityBuffer, 0, opacities);
        device.queue.submit([encoder.finish()]);
        opacityBuffer.destroy();
      }
    } else if (this._roofRaster) {
      this._destroyTexture(this._roofRaster.texture.texture);
      this._roofRaster = null;
      for (const source of this._roofTiles?.values() || []) source.texture.destroy();
      this._roofTiles = null;
    }
    // Visible meshes: opaque first, transparent surfaces back-to-front.
    const meshes = [];
    this.traverse(this.scene, mesh => { if (!mesh.visible) return true; if (mesh.geometry && mesh._visibleInFrame) meshes.push(mesh); });
    meshes.sort((a, b) => Number(a.program.transparent) - Number(b.program.transparent) ||
      (a.program.transparent
        ? (a.renderOrder || 0) - (b.renderOrder || 0) ||
        b._sortDepth - a._sortDepth || a.id - b.id
        : a.id - b.id)
    );
    const encoder = renderer.device.createCommandEncoder();
    const pendingRasterTiles = [];
    // One uniform upload per frame: per-mesh writeBuffer calls dominate Firefox's GPU process.
    // Slot 0 holds the camera; 256-byte mesh slots follow (double-sided meshes use two).
    if (!renderer.uniformBuffer || renderer.uniformBuffer.size < (meshes.length * 2 + 1) * 256) {
      if (renderer.uniformBuffer) this._destroyTexture(renderer.uniformBuffer);
      renderer.uniformBuffer = renderer.device.createBuffer({
        size: Math.max(64, meshes.length * 4) * 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      renderer.uniformData = new Float32Array(renderer.uniformBuffer.size / 4);
    }
    const frameData = renderer.uniformData;
    frameData.set(camera.viewMatrix, 0);
    frameData.set(camera.projectionMatrix, 16);
    frameData.set(this._roofRaster?.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 32);
    frameData.set(light, 48);
    frameData[51] = 0;
    frameData.set(sky, 52);
    frameData[55] = 0;
    renderer.uniformSlot = 1;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: renderer.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: renderer.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setViewport(0, 0, renderer.canvas.width, renderer.canvas.height, 0, 1);
    for (const mesh of meshes) {
      if (mesh.tile && mesh.tile.style.visibility !== 'hidden') pendingRasterTiles.push(mesh.tile);
      const world = mesh.worldMatrix;
      if (mesh.texture) {
        mesh.program.uniforms.baseTexture.value = mesh.texture;
        mesh.program.uniforms.opacity.value = mesh.opacity;
      }
      const uniforms = mesh.program.uniforms;
      if (uniforms.roofTexture) uniforms.roofTexture.value = this._roofRaster?.texture || renderer.roofFallbackTexture;
      const determinant = world[0] * (world[5] * world[10] - world[6] * world[9]) -
        world[4] * (world[1] * world[10] - world[2] * world[9]) +
        world[8] * (world[1] * world[6] - world[2] * world[5]);
      if (!Number.isFinite(determinant) || determinant === 0) {
        throw new Error('Singular 3D transform');
      }
      const frontFace = determinant < 0 ? 'cw' : 'ccw';
      const program = mesh.program;
      if (program.transparent && program._layerMaterial.doubleSided) {
        this._drawGeometry(mesh, pass, 'front', frontFace);
        this._drawGeometry(mesh, pass, 'back', frontFace);
      } else {
        this._drawGeometry(mesh, pass, program.cullMode, frontFace);
      }
    }
    pass.end();
    renderer.device.queue.writeBuffer(renderer.uniformBuffer, 0, renderer.uniformData, 0, renderer.uniformSlot * 64);
    renderer.device.queue.submit([encoder.finish()]);
    if (pendingRasterTiles.length) {
      renderer.device.queue.onSubmittedWorkDone().then(() => {
        for (const tile of pendingRasterTiles) {
          if (tile.isConnected && tile._terrainVisibility !== undefined) tile.style.visibility = 'hidden';
        }
      }, error => {
        for (const layer of this._layers || []) layer.fire('error', { error });
      });
    }
    if (map._animatingZoom) this.update();
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
    const parent = node.parent;
    const parentVersion = parent?._worldMatrixVersion || 0;
    const matrixMode = Boolean(node.matrix);
    let changed = node._worldParent !== parent || node._parentWorldVersion !== parentVersion ||
      node._worldMatrixMode !== matrixMode;
    if (node.matrix) {
      const state = node._matrixState ||= new Float64Array(16);
      for (let i = 0; i < 16; i++) {
        if (state[i] !== node.matrix[i]) changed = true;
        state[i] = node.matrix[i];
      }
    } else {
      const state = node._transformState ||= new Float64Array(9);
      for (let i = 0; i < 9; i++) {
        const value = i < 3 ? node.position[i] : i < 6 ? node.rotation[i - 3] : node.scale[i - 6];
        if (state[i] !== value) changed = true;
        state[i] = value;
      }
    }
    if (!changed) {
      for (const child of node.children) this._updateWorldMatrix(child);
      return;
    }
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
    const world = parent
      ? new DOMMatrix(parent.worldMatrix).multiply(new DOMMatrix(local)).toFloat64Array()
      : local;
    for (let i = 0; i < 16; i++) node.worldMatrix[i] = world[i];
    node._worldParent = parent;
    node._parentWorldVersion = parentVersion;
    node._worldMatrixMode = matrixMode;
    node._worldMatrixVersion = (node._worldMatrixVersion || 0) + 1;
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
    const projection = [f / camera.aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, r / (n - r), -1, 0, 0, r * n / (n - r), 0];
    for (let i = 0; i < 16; i++) {
      camera.projectionMatrix[i] = projection[i];
    }
    const projectionView = new DOMMatrix(camera.projectionMatrix).multiply(new DOMMatrix(camera.viewMatrix)).toFloat64Array();
    for (let i = 0; i < 16; i++) {
      camera.projectionViewMatrix[i] = projectionView[i];
    }
  },

  _removeProgram(program) {
    program.pipelineCache.clear();
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
    const center = min.map((v, i) => (v + max[i]) / 2);
    let radius = 0;
    for (let i = 0; i < data.length; i += 3) {
      radius = Math.max(radius, Math.hypot(
        data[i] - center[0], data[i + 1] - center[1], data[i + 2] - center[2]
      ));
    }
    geometry.bounds = { min, max, center, radius };
  },

  /** Upload retained CPU data and draw one mesh in the active WebGPU render pass. */
  _drawGeometry(mesh, pass, cullMode, frontFace) {
    const { geometry, program } = mesh;
    const device = this.renderer.device;
    const pipelineKey = `${cullMode}:${frontFace}`;
    let pipeline = program.pipelineCache.get(pipelineKey);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        layout: program.pipelineLayout,
        vertex: {
          module: program.vertex,
          entryPoint: 'vertexMain',
          buffers: program.vertexBuffers,
        },
        fragment: {
          module: program.fragment,
          entryPoint: 'fragmentMain',
          targets: [{
            format: this.renderer.format,
            blend: program.transparent ? {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            } : undefined,
            writeMask: GPUColorWrite.ALL,
          }],
        },
        primitive: { topology: 'triangle-list', cullMode, frontFace },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: program.depthWrite,
          depthCompare: 'less-equal',
        },
      });
      program.pipelineCache.set(pipelineKey, pipeline);
    }

    const uniforms = program.uniforms;
    const renderer = this.renderer;
    const offset = renderer.uniformSlot++ * 256;
    const data = renderer.uniformData, base = offset / 4;
    data.set(mesh.worldMatrix, base);
    data.set(uniforms.baseColor.value, base + 16);
    data[base + 19] = 1;
    data[base + 20] = uniforms.metallic.value;
    data[base + 21] = uniforms.roughness.value;
    data[base + 22] = uniforms.opacity.value;
    data[base + 23] = uniforms.alphaCutoff.value;
    data.set(uniforms.emissive.value, base + 24);
    data[base + 27] = uniforms.occlusionStrength.value;
    data[base + 28] = mesh.terrain?.[0] ?? 0;
    data[base + 29] = mesh.terrain?.[1] ?? 0;
    data[base + 30] = mesh.terrain?.[2] ?? 0;
    data[base + 31] = mesh.terrain?.[3] ?? 0;
    data[base + 32] = mesh.highlight?.[0] ?? 0;
    data[base + 33] = mesh.highlight?.[1] ?? 0;
    data[base + 34] = 0;
    data[base + 35] = 0;

    const textures = mesh._textures ||= [];
    textures.length = 0;
    for (const binding of program.bindings) {
      const texture = uniforms[binding.name]?.value;
      if (!texture) throw new Error(`Missing Layer3D texture: ${binding.name}`);
      if (texture.uploaded !== texture.image) {
        device.queue.copyExternalImageToTexture(
          { source: texture.image, flipY: Boolean(texture.flipY) },
          { texture: texture.texture },
          [texture.image.width, texture.image.height],
        );
        texture.uploaded = texture.image;
      }
      textures.push(texture);
    }
    let bindingsChanged = !mesh.bindGroup || mesh.boundBuffer !== renderer.uniformBuffer ||
      textures.length !== mesh.boundTextures.length;
    for (let i = 0; !bindingsChanged && i < textures.length; i++) {
      if (textures[i].texture !== mesh.boundTextures[i][0] ||
        textures[i].sampler !== mesh.boundTextures[i][1]) bindingsChanged = true;
    }
    if (bindingsChanged) {
      const entries = [
        { binding: 0, resource: { buffer: renderer.uniformBuffer, size: 144 } },
        { binding: 1, resource: { buffer: renderer.uniformBuffer, size: 224 } },
      ];
      if (program.terrain) entries.push({ binding: 2, resource: program.terrain.texture.createView() });
      mesh.boundBuffer = renderer.uniformBuffer;
      const boundTextures = mesh.boundTextures ||= [];
      boundTextures.length = textures.length;
      for (let i = 0; i < textures.length; i++) {
        const binding = program.bindings[i], texture = textures[i];
        entries.push({ binding: binding.texture, resource: texture.texture.createView() });
        entries.push({ binding: binding.sampler, resource: texture.sampler });
        boundTextures[i] ||= [];
        boundTextures[i][0] = texture.texture;
        boundTextures[i][1] = texture.sampler;
      }
      mesh.bindGroup = device.createBindGroup({
        layout: program.bindGroupLayout,
        entries,
      });
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, mesh.bindGroup, [offset]);
    pass.setVertexBuffer(0, geometry.attributes.position.buffer);
    pass.setVertexBuffer(1, geometry.attributes.normal.buffer);
    if (geometry.attributes.color) pass.setVertexBuffer(2, geometry.attributes.color.buffer);
    if (geometry.attributes.uv) pass.setVertexBuffer(3, geometry.attributes.uv.buffer);
    for (const attribute of Object.values(geometry.attributes)) {
      if (!attribute.needsUpdate) continue;
      device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
      attribute.needsUpdate = false;
      geometry.bounds = null;
    }
    const index = geometry.attributes.index;
    if (index) {
      pass.setIndexBuffer(index.buffer, index.indexFormat);
      pass.drawIndexed(geometry.drawRange.count, 1, geometry.drawRange.start, 0, 0);
    } else {
      pass.draw(geometry.drawRange.count, 1, geometry.drawRange.start, 0);
    }
  },

});

L.Layer3D._nextId = 0;

/** Renders IGN Float32 DEM tiles and PMTiles raster basemaps in the shared WebGPU scene. */
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
    if (this._dem) this._destroyTexture(this._dem.texture);
    this._dem = null;
    for (const grid of this._terrainGrids?.values() || []) {
      for (const attribute of Object.values(grid)) this._destroyTexture(attribute.buffer);
    }
    this._terrainGrids = null;
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
      this._terrainBounds = new L.Bounds(northwest, southeast);
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

  /** @param {L.LatLng|L.Point} location LatLng, or a pixel point at the terrain zoom. */
  _getElevation(location) {
    if (!this._map || !this._terrainReady) return null;
    const point = location instanceof L.Point ? location : this._map.project(location, this._terrainZoom);
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
    const [ready, bitmap] = await Promise.all([this._terrainPromise, createImageBitmap(tile)]);
    if (!ready || !this._map || this._map._terrain3D !== this || layer._terrain3D !== this ||
      tile.request.signal.aborted || !tile.isConnected || this._rasterTiles.has(tile)) {
      bitmap.close();
      return;
    }
    // Match DEM pixel spacing, capped at 64 subdivisions per tile.
    const divisions = Math.max(1, Math.min(64, 256 / 2 ** (coords.z - this._terrainZoom)));
    const map = this._map, crs = map.options.crs;
    const origin = crs.project(this.location), metres = Math.cos(this.location.lat * Math.PI / 180);
    // Tile pixels map linearly to projected metres: one scaled unit grid per tile, elevation in the vertex shader.
    const scale = crs.scale(coords.z), terrainScale = 2 ** (this._terrainZoom - coords.z);
    const corner = crs.transformation.untransform(new L.Point(coords.x * 256, coords.y * 256), scale);
    const opposite = crs.transformation.untransform(new L.Point((coords.x + 1) * 256, (coords.y + 1) * 256), scale);
    const device = this.renderer.device;
    const texture = {
      device,
      texture: device.createTexture({
        size: [tile.width, tile.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      }),
      sampler: device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
      samplerOptions: { addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
      image: tile, format: 'rgba8unorm', srgb: false, flipY: false, uploaded: tile,
    };
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: texture.texture }, [tile.width, tile.height]);
    bitmap.close();
    if (!this._rasterProgram || this._rasterProgram.device !== device) {
      // DEM atlas over the archive's tile grid; invalid or missing samples become -1e9 (the shader's no-data).
      // ponytail: one texture, capped by maxTextureDimension2D (32×32 DEM tiles at 8192 px); split it for larger archives.
      const bounds = this._terrainBounds, columns = bounds.max.x - bounds.min.x + 1, rows = bounds.max.y - bounds.min.y + 1;
      const elevations = new Float32Array(columns * rows * 65536).fill(-1e9);
      let low = Infinity, high = -Infinity;
      for (const [key, values] of this._terrainTiles) {
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
      if (this._dem) this._destroyTexture(this._dem.texture);
      this._dem = {
        texture: device.createTexture({
          size: [columns * 256, rows * 256],
          format: 'r32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }),
        low: Number.isFinite(low) ? low : this._terrainOriginElevation,
        high: Number.isFinite(high) ? high : this._terrainOriginElevation,
      };
      device.queue.writeTexture({ texture: this._dem.texture }, elevations,
        { bytesPerRow: columns * 1024 }, [columns * 256, rows * 256]);
      this._terrainGrids = new Map();
      this._rasterProgram = this._createProgram({
        baseTexture: texture,
        unlit: true,
        alphaMode: 'BLEND',
        terrain: this._dem,
      });
    }
    let attributes = this._terrainGrids.get(divisions);
    if (!attributes) {
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
      attributes = {
        position: { size: 3, data: new Float32Array(positions) },
        normal:   { size: 3, data: new Float32Array(normals) },
        uv:       { size: 2, data: new Float32Array(uvs) },
        index:    { data: new Uint16Array(indices) },
      };
      for (const [name, attribute] of Object.entries(attributes)) {
        attribute.size ||= 1;
        attribute.count = attribute.data.length / attribute.size;
        attribute.indexFormat = 'uint16';
        attribute.buffer = device.createBuffer({
          size: Math.max(4, attribute.data.byteLength),
          usage: name === 'index'
            ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
            : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
      }
      this._terrainGrids.set(divisions, attributes);
    }
    const base = this._terrainOriginElevation;
    const bottom = Math.min(this._dem.low, base) - base, top = Math.max(this._dem.high, base) - base;
    const sizeX = (opposite.x - corner.x) * metres, sizeZ = -(opposite.y - corner.y) * metres;
    // ponytail: ray picking sees the flat unit grid; read the DEM back if terrain must be pickable.
    const geometry = {
      device,
      attributes,
      drawRange: { start: 0, count: attributes.index.count },
      // Local bounds whose radius, scaled by the largest axis, still covers the displaced tile.
      bounds: {
        min: [0, bottom, 0], max: [1, top, 1], center: [0.5, (bottom + top) / 2, 0.5],
        radius: Math.hypot(sizeX, top - bottom, sizeZ) / 2 / Math.max(sizeX, 1, sizeZ),
      },
    };
    const mesh = {
      position:    [(corner.x - origin.x) * metres, 0, -(corner.y - origin.y) * metres],
      rotation:    [0, 0, 0],
      scale:       [sizeX, 1, sizeZ],
      worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      children:    [],
      visible:     true,
      device,
      geometry,
      program:      this._rasterProgram,
      texture,
      // DEM pixel of the tile's corner, DEM pixels per tile, and the elevation at the layer origin.
      terrain:      [
        coords.x * 256 * terrainScale - this._terrainBounds.min.x * 256,
        coords.y * 256 * terrainScale - this._terrainBounds.min.y * 256,
        256 * terrainScale,
        base,
      ],
      tile,
      opacity:      layer.options.opacity ?? 1,
      id:           L.Layer3D._nextId++,
      renderOrder: -1,
    };
    this.add(mesh);
    this._rasterTiles.set(tile, mesh);
    tile._terrainVisibility = tile.style.visibility;
  },

  removeRasterTile(tile) {
    tile._terrainRequest?.abort();
    const mesh = this._rasterTiles.get(tile);
    if (!mesh) return;
    this.remove(mesh);
    this._destroyTexture(mesh.texture.texture);
    this._rasterTiles.delete(tile);
    tile.style.visibility = tile._terrainVisibility;
    delete tile._terrainVisibility;
  },
});

/**
 * WGSL twin of _getElevation for the vertex shader: bilinear DEM pixels, or the first valid
 * neighbour near no-data (stored as -1e9), else `base`. Expects `dem: texture_2d<f32>`.
 */
L.TerrainLayer.elevationWGSL = `
  fn demSample(pixel: vec2<i32>) -> f32 {
    if (any(pixel < vec2<i32>(0)) || any(pixel >= vec2<i32>(textureDimensions(dem)))) { return -1e9; }
    return textureLoad(dem, pixel, 0).r;
  }
  fn elevation(pixel: vec2<f32>, base: f32) -> f32 {
    let p = pixel - vec2<f32>(0.5);
    let f = fract(p);
    let i = vec2<i32>(floor(p));
    let v00 = demSample(i);
    let v10 = demSample(i + vec2<i32>(1, 0));
    let v01 = demSample(i + vec2<i32>(0, 1));
    let v11 = demSample(i + vec2<i32>(1, 1));
    if (v00 > -1000.0 && v10 > -1000.0 && v01 > -1000.0 && v11 > -1000.0) {
      return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
    }
    if (v00 > -1000.0) { return v00; }
    if (v10 > -1000.0) { return v10; }
    if (v01 > -1000.0) { return v01; }
    if (v11 > -1000.0) { return v11; }
    return base;
  }
`;
