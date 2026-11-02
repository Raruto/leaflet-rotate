var leafletRotate = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __glob = (map) => (path) => {
    var fn = map[path];
    if (fn) return fn();
    throw new Error("Module not found in bundle: " + path);
  };
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/layer/3d/types/3d.js
  var d_exports = {};
  var init_d = __esm({
    "src/layer/3d/types/3d.js"() {
      L.Layer.types["3d"] = L.Layer.extend({
        /**
         * PMTiles v3 range reader.
         * Supports uncompressed/gzip sections. Other compression methods fail explicitly.
         * Specification: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
         */
        /** Read exactly one archive range; reject changed archives rather than mix revisions. */
        async _read(offset, length, signal) {
          signal?.throwIfAborted();
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || !Number.isSafeInteger(offset + length)) {
            throw new Error("Invalid PMTiles byte range");
          }
          const response = await fetch(this.url, {
            headers: { Range: `bytes=${offset}-${offset + length - 1}` },
            signal
          });
          if (!response.ok) throw new Error(`Unable to read PMTiles: HTTP ${response.status}`);
          const etag = response.headers.get("ETag");
          if (this._etag && etag !== this._etag) {
            throw new Error("PMTiles archive changed; recreate the layer");
          }
          if (etag) {
            this._etag = etag;
          }
          let data = await response.arrayBuffer();
          if (response.status === 200) {
            data = data.slice(offset, offset + length);
          } else if (response.status !== 206 || !response.headers.get("Content-Range")?.startsWith(`bytes ${offset}-${offset + length - 1}/`)) {
            throw new Error("Invalid PMTiles range response");
          }
          if (data.byteLength !== length) {
            throw new Error("Truncated PMTiles range");
          }
          return data;
        },
        async _decompress(data, compression) {
          if (compression === 1) return data;
          if (compression !== 2) throw new Error(`Unsupported PMTiles compression: ${compression}`);
          return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        },
        /** Cache header initialization; failures remain visible to all callers. */
        getHeader() {
          return this._header ||= this._read(0, 127).then((data) => {
            const view = new DataView(data);
            const header = {};
            ["rootDirectoryOffset", "rootDirectoryLength", "jsonMetadataOffset", "jsonMetadataLength", "leafDirectoryOffset", "leafDirectoryLength", "tileDataOffset", "tileDataLength", "numAddressedTiles", "numTileEntries", "numTileContents"].forEach((name, i) => {
              header[name] = Number(view.getBigUint64(8 + i * 8, true));
            });
            ["clustered", "internalCompression", "tileCompression", "tileType", "minZoom", "maxZoom"].forEach((name, i) => {
              header[name] = view.getUint8(96 + i);
            });
            ["minLon", "minLat", "maxLon", "maxLat"].forEach((name, i) => {
              header[name] = view.getInt32(102 + i * 4, true) / 1e7;
            });
            header.centerZoom = view.getUint8(118);
            header.centerLon = view.getInt32(119, true) / 1e7;
            header.centerLat = view.getInt32(123, true) / 1e7;
            return header;
          });
        },
        /** Nearest directory entry at/before the Hilbert ID, then follow leaf pointers. */
        async getZxy(z, x, y, signal) {
          if (![z, x, y].every(Number.isInteger) || z < 0 || z > 26 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error("Invalid PMTiles tile coordinates");
          signal?.throwIfAborted();
          let tileId = (4 ** z - 1) / 3;
          const n = 2 ** z;
          for (let s = n / 2; s >= 1; s /= 2) {
            const rx = x & s ? 1 : 0, ry = y & s ? 1 : 0;
            tileId += s * s * (3 * rx ^ ry);
            if (!ry) {
              if (rx) {
                x = n - 1 - x;
                y = n - 1 - y;
              }
              [x, y] = [y, x];
            }
          }
          const header = await this.getHeader();
          signal?.throwIfAborted();
          if (z < header.minZoom || z > header.maxZoom) return;
          let offset = header.rootDirectoryOffset, length = header.rootDirectoryLength;
          const visited = /* @__PURE__ */ new Set();
          for (let depth = 0; depth < 4; depth++) {
            if (visited.has(offset)) {
              throw new Error("Cyclic PMTiles directory");
            }
            visited.add(offset);
            const key = `${offset}:${length}`;
            if (!this._directories.has(key)) {
              if (this._directories.size >= 32) {
                this._directories.delete(this._directories.keys().next().value);
              }
              const pending = this._read(offset, length).then((data) => this._decompress(data, header.internalCompression)).then((data) => {
                const bytes = new Uint8Array(data);
                let cursor = 0;
                const varint = () => {
                  let value = 0;
                  for (let factor = 1; factor <= 2 ** 49; factor *= 128) {
                    if (cursor >= bytes.length) throw new Error("Truncated PMTiles directory");
                    const byte = bytes[cursor++];
                    value += (byte & 127) * factor;
                    if (!Number.isSafeInteger(value)) throw new Error("Invalid PMTiles directory integer");
                    if (byte < 128) return value;
                  }
                  throw new Error("Invalid PMTiles directory integer");
                };
                const count = varint();
                if (count > (bytes.length - cursor) / 4) throw new Error("Invalid PMTiles directory count");
                const entries2 = [];
                let tileId2 = 0;
                for (let i = 0; i < count; i++) {
                  tileId2 += varint();
                  if (!Number.isSafeInteger(tileId2) || i && tileId2 <= entries2[i - 1].tileId) {
                    throw new Error("Invalid PMTiles directory tile IDs");
                  }
                  entries2.push({ tileId: tileId2 });
                }
                for (const entry2 of entries2) entry2.runLength = varint();
                for (const entry2 of entries2) {
                  entry2.length = varint();
                  if (!entry2.length) throw new Error("Invalid PMTiles directory length");
                }
                entries2.forEach((entry2, i) => {
                  const value = varint();
                  if (!value && !i) throw new Error("Invalid PMTiles directory offset");
                  entry2.offset = value ? value - 1 : entries2[i - 1].offset + entries2[i - 1].length;
                });
                if (cursor !== bytes.length) throw new Error("Trailing PMTiles directory data");
                return entries2;
              }).catch((error) => {
                if (this._directories.get(key) === pending) this._directories.delete(key);
                throw error;
              });
              this._directories.set(key, pending);
            }
            const entries = await this._directories.get(key);
            signal?.throwIfAborted();
            let low = 0, high = entries.length - 1;
            while (low <= high) {
              const mid = low + high >> 1;
              if (entries[mid].tileId <= tileId) low = mid + 1;
              else high = mid - 1;
            }
            const entry = entries[high];
            if (!entry) return;
            if (entry.runLength) {
              if (tileId - entry.tileId >= entry.runLength) return;
              if (entry.offset + entry.length > header.tileDataLength) throw new Error("PMTiles tile outside data section");
              const data = await this._decompress(await this._read(header.tileDataOffset + entry.offset, entry.length, signal), header.tileCompression);
              signal?.throwIfAborted();
              return { data };
            }
            if (entry.offset + entry.length > header.leafDirectoryLength) throw new Error("PMTiles directory outside leaf section");
            offset = header.leafDirectoryOffset + entry.offset;
            length = entry.length;
          }
          throw new Error("PMTiles directory depth exceeds four levels");
        },
        statics: {
          /** Rendering owner per map; entries are removed on the last layer removal. */
          _renderers: /* @__PURE__ */ new WeakMap()
        },
        options: {
          // Accessible description of the canvas.
          ariaLabel: "3D scene"
        },
        /**
         * @param {Layer3DOptions} [options] World origin comes from center or the first map centre.
         * Public state: `location` is fixed after first addition; `root` is this layer's
         * transform; `group` aliases root only for sources; `model` is the configured
         * model wrapper. `_shared` references the rendering owner (a '3d' layer);
         * `scene`, `camera` and `renderer` alias its resources while attached.
         *
         */
        initialize(options) {
          L.Util.setOptions(this, options);
          const model = /\.(glb|gltf)(?:[?#]|$)/i.test(this.options.url);
          this.modelUrl = model ? this.options.url : null;
          this.url = this.options.url && !model ? new URL(this.options.url, document.baseURI).href : null;
          this._directories = /* @__PURE__ */ new Map();
          if (this.options.center) {
            this.location = new L.LatLng(this.options.center[0], this.options.center[1]);
          }
          this._areas = /* @__PURE__ */ new Map();
          this._inflight = 0;
          this._added = Promise.withResolvers();
          queueMicrotask(async () => {
            try {
              this.root = {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
                worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                children: [],
                visible: true
              };
              this.raycaster = {
                origin: [0, 0, 0],
                direction: [0, 0, 0]
              };
              if (this.url) {
                this.group = this.root;
                this.header = await this.getHeader();
              }
              if (this._map) await this._attach(this._map);
              if (this.modelUrl) {
                await this._added.promise;
                const url = new URL(this.modelUrl, document.baseURI).href;
                const response = await fetch(url);
                if (!response.ok) {
                  throw new Error(`Unable to load model: HTTP ${response.status}`);
                }
                const data = await response.arrayBuffer();
                const view = new DataView(data), decoder = new TextDecoder();
                let description;
                if (view.getUint32(0, true) === 1179937895) {
                  if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) {
                    throw new Error("Invalid GLB header");
                  }
                  let binary;
                  for (let offset = 12; offset < data.byteLength; ) {
                    if (offset + 8 > data.byteLength) {
                      throw new Error("Truncated GLB chunk");
                    }
                    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
                    offset += 8;
                    if (offset + length > data.byteLength) {
                      throw new Error("Truncated GLB data");
                    }
                    const chunk = data.slice(offset, offset + length);
                    if (type === 1313821514) {
                      description = JSON.parse(decoder.decode(chunk));
                    }
                    if (type === 5130562) {
                      binary = chunk;
                    }
                    offset += length;
                  }
                  if (!description) {
                    throw new Error("Missing GLB JSON");
                  }
                  if (binary) {
                    description.buffers[0].binary = binary;
                  }
                } else {
                  description = JSON.parse(decoder.decode(data));
                }
                if (description.skins?.length || description.animations?.length || description.extensionsRequired?.length || description.meshes?.some((mesh) => mesh.primitives.some((primitive) => primitive.targets || primitive.mode !== void 0 && primitive.mode !== 4))) {
                  throw new Error("Layer3D supports static triangle glTF models without required extensions");
                }
                const directory = new URL(".", url).href;
                await Promise.all((description.buffers || []).map(async (buffer) => {
                  if (buffer.binary) {
                    return;
                  }
                  const response2 = await fetch(new URL(buffer.uri, directory).href);
                  if (!response2.ok) {
                    throw new Error(`Unable to load model buffer: HTTP ${response2.status}`);
                  }
                  buffer.binary = await response2.arrayBuffer();
                }));
                await this._added.promise;
                const images = await Promise.all((description.images || []).map(async (image) => {
                  let blob;
                  if (image.bufferView !== void 0) {
                    const view2 = description.bufferViews[image.bufferView];
                    const buffer = description.buffers[view2.buffer].binary;
                    blob = new Blob(
                      [buffer.slice(view2.byteOffset || 0, (view2.byteOffset || 0) + view2.byteLength)],
                      { type: image.mimeType }
                    );
                  } else {
                    const response2 = await fetch(new URL(image.uri, directory).href);
                    if (!response2.ok) throw new Error(`Unable to load model texture: HTTP ${response2.status}`);
                    blob = await response2.blob();
                  }
                  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
                }));
                const textures = /* @__PURE__ */ new Map();
                const textureFor = (reference, color = false) => {
                  if (!reference) return null;
                  if ((reference.texCoord || 0) !== 0 || reference.extensions) {
                    throw new Error("Model textures currently require untransformed TEXCOORD_0 UVs");
                  }
                  const device = this.renderer.device;
                  const key = `${reference.index}:${color}`;
                  if (!textures.has(key)) {
                    const texture = description.textures[reference.index];
                    const sampler = description.samplers?.[texture.sampler] || {};
                    const image = images[texture.source];
                    const format = color ? "rgba8unorm-srgb" : "rgba8unorm";
                    textures.set(key, {
                      device,
                      texture: device.createTexture({
                        size: [image.width, image.height],
                        format,
                        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                      }),
                      sampler: device.createSampler({
                        addressModeU: sampler.wrapS === 33071 ? "clamp-to-edge" : sampler.wrapS === 33648 ? "mirror-repeat" : "repeat",
                        addressModeV: sampler.wrapT === 33071 ? "clamp-to-edge" : sampler.wrapT === 33648 ? "mirror-repeat" : "repeat",
                        magFilter: sampler.magFilter === 9728 ? "nearest" : "linear",
                        minFilter: sampler.minFilter === 9728 || sampler.minFilter === 9984 || sampler.minFilter === 9986 ? "nearest" : "linear"
                      }),
                      samplerOptions: {
                        addressModeU: sampler.wrapS === 33071 ? "clamp-to-edge" : sampler.wrapS === 33648 ? "mirror-repeat" : "repeat",
                        addressModeV: sampler.wrapT === 33071 ? "clamp-to-edge" : sampler.wrapT === 33648 ? "mirror-repeat" : "repeat",
                        magFilter: sampler.magFilter === 9728 ? "nearest" : "linear",
                        minFilter: sampler.minFilter === 9728 || sampler.minFilter === 9984 || sampler.minFilter === 9986 ? "nearest" : "linear"
                      },
                      format,
                      srgb: color,
                      image,
                      flipY: false,
                      uploaded: null
                    });
                  }
                  return textures.get(key);
                };
                const materials = (description.materials || []).map((material) => {
                  const pbr = material.pbrMetallicRoughness || {};
                  return {
                    color: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3),
                    opacity: pbr.baseColorFactor?.[3] ?? 1,
                    metallic: pbr.metallicFactor ?? 1,
                    roughness: pbr.roughnessFactor ?? 1,
                    baseTexture: textureFor(pbr.baseColorTexture, true),
                    metalTexture: textureFor(pbr.metallicRoughnessTexture),
                    emissiveTexture: textureFor(material.emissiveTexture, true),
                    occlusionTexture: textureFor(material.occlusionTexture),
                    emissive: material.emissiveFactor || [0, 0, 0],
                    occlusionStrength: material.occlusionTexture?.strength ?? 1,
                    alphaMode: material.alphaMode || "OPAQUE",
                    alphaCutoff: material.alphaCutoff ?? 0.5,
                    doubleSided: material.doubleSided
                  };
                });
                let nodes;
                {
                  const types = {
                    5120: Int8Array,
                    5121: Uint8Array,
                    5122: Int16Array,
                    5123: Uint16Array,
                    5125: Uint32Array,
                    5126: Float32Array
                  };
                  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
                  const accessor = (index) => {
                    const spec = description.accessors[index], Type = types[spec.componentType], size = sizes[spec.type];
                    if (!Type || !size || !Number.isInteger(spec.count) || spec.count < 0) {
                      throw new Error("Invalid glTF accessor");
                    }
                    const data2 = new Type(spec.count * size);
                    const read = (viewIndex, offset, count, stride, output) => {
                      const view2 = description.bufferViews[viewIndex], bytes = Type.BYTES_PER_ELEMENT;
                      const buffer = description.buffers[view2.buffer].binary;
                      stride ||= size * bytes;
                      if (!buffer || stride < size * bytes || offset < 0 || (view2.byteOffset || 0) + view2.byteLength > buffer.byteLength || (count - 1) * stride + size * bytes + offset > view2.byteLength) throw new Error("glTF accessor outside buffer view");
                      for (let i = 0; i < count; i++) {
                        const values = new Type(buffer.slice(
                          (view2.byteOffset || 0) + offset + i * stride,
                          (view2.byteOffset || 0) + offset + i * stride + size * bytes
                        ));
                        data2.set(values, output(i) * size);
                      }
                    };
                    if (spec.bufferView !== void 0) {
                      read(
                        spec.bufferView,
                        spec.byteOffset || 0,
                        spec.count,
                        description.bufferViews[spec.bufferView].byteStride,
                        (i) => i
                      );
                    }
                    if (spec.sparse) {
                      const sparse = spec.sparse, Index = types[sparse.indices.componentType];
                      if (![Uint8Array, Uint16Array, Uint32Array].includes(Index)) {
                        throw new Error("Invalid sparse glTF indices");
                      }
                      const view2 = description.bufferViews[sparse.indices.bufferView];
                      const offset = (view2.byteOffset || 0) + (sparse.indices.byteOffset || 0);
                      if (sparse.count > spec.count || (sparse.indices.byteOffset || 0) + sparse.count * Index.BYTES_PER_ELEMENT > view2.byteLength) {
                        throw new Error("Invalid sparse glTF indices");
                      }
                      const indices = new Index(description.buffers[view2.buffer].binary.slice(offset, offset + sparse.count * Index.BYTES_PER_ELEMENT));
                      read(
                        sparse.values.bufferView,
                        sparse.values.byteOffset || 0,
                        sparse.count,
                        0,
                        (i) => {
                          if (indices[i] >= spec.count) throw new Error("Invalid sparse glTF index");
                          return indices[i];
                        }
                      );
                    }
                    if (spec.componentType === 5126) {
                      return { data: data2, size };
                    }
                    const normalized = new Float32Array(data2.length);
                    for (let i = 0; i < data2.length; i++) {
                      normalized[i] = spec.normalized ? Math.max(-1, data2[i] / (Type === Int8Array ? 127 : Type === Int16Array ? 32767 : Type === Uint8Array ? 255 : Type === Uint32Array ? 4294967295 : 65535)) : data2[i];
                    }
                    return { data: normalized, size, indices: data2 };
                  };
                  const active = /* @__PURE__ */ new Set(), resources = [];
                  const node = (index) => {
                    if (active.has(index)) throw new Error("Cyclic glTF nodes");
                    const spec = description.nodes[index];
                    if (!spec) throw new Error("Invalid glTF node");
                    active.add(index);
                    const group = {
                      position: [0, 0, 0],
                      rotation: [0, 0, 0],
                      scale: [1, 1, 1],
                      worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                      children: [],
                      visible: true,
                      name: spec.name
                    };
                    if (spec.matrix) {
                      group.matrix = Array.from(spec.matrix);
                    } else {
                      const [x, y, z, w] = spec.rotation || [0, 0, 0, 1], [sx, sy, sz] = spec.scale || [1, 1, 1];
                      group.matrix = [
                        (1 - 2 * (y * y + z * z)) * sx,
                        2 * (x * y + z * w) * sx,
                        2 * (x * z - y * w) * sx,
                        0,
                        2 * (x * y - z * w) * sy,
                        (1 - 2 * (x * x + z * z)) * sy,
                        2 * (y * z + x * w) * sy,
                        0,
                        2 * (x * z + y * w) * sz,
                        2 * (y * z - x * w) * sz,
                        (1 - 2 * (x * x + y * y)) * sz,
                        0,
                        ...spec.translation || [0, 0, 0],
                        1
                      ];
                    }
                    if (spec.mesh !== void 0) {
                      for (const primitive of description.meshes[spec.mesh].primitives) {
                        const attributes = {};
                        for (const [semantic, name] of [["POSITION", "position"], ["NORMAL", "normal"], ["TEXCOORD_0", "uv"]]) {
                          if (primitive.attributes[semantic] !== void 0) attributes[name] = accessor(primitive.attributes[semantic]);
                        }
                        if (!attributes.position) throw new Error("glTF mesh has no positions");
                        const vertexCount = attributes.position.data.length / 3;
                        if (attributes.position.size !== 3 || vertexCount < 3 || Object.values(attributes).some((attribute) => attribute.data.length / attribute.size !== vertexCount)) throw new Error("Invalid glTF vertex attributes");
                        if (primitive.indices !== void 0) {
                          const index2 = accessor(primitive.indices);
                          attributes.index = { size: 1, data: index2.indices };
                          if (![Uint8Array, Uint16Array, Uint32Array].some((Type) => index2.indices instanceof Type) || index2.size !== 1 || index2.indices.length % 3 || [...index2.indices].some((i) => i >= vertexCount)) throw new Error("Invalid glTF triangle indices");
                        }
                        if (!attributes.index && vertexCount % 3) throw new Error("Incomplete glTF triangle");
                        if (!attributes.normal) {
                          const normals = new Float32Array(attributes.position.data.length), p = attributes.position.data, indices = attributes.index?.data;
                          for (let i = 0; i < (indices?.length || p.length / 3); i += 3) {
                            const a = indices ? indices[i] : i, b = indices ? indices[i + 1] : i + 1, c = indices ? indices[i + 2] : i + 2;
                            const u = [0, 1, 2].map((j) => p[b * 3 + j] - p[a * 3 + j]), v = [0, 1, 2].map((j) => p[c * 3 + j] - p[a * 3 + j]);
                            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
                            for (const index2 of [a, b, c]) {
                              for (let j = 0; j < 3; j++) {
                                normals[index2 * 3 + j] += n[j];
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
                          throw new Error("Textured model mesh requires UV coordinates");
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
                          attribute.indexFormat = attribute.data instanceof Uint32Array ? "uint32" : "uint16";
                          attribute.buffer = device.createBuffer({
                            size: Math.max(4, attribute.data.byteLength),
                            usage: name === "index" ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                          });
                          device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
                        }
                        const geometry = {
                          device,
                          attributes,
                          drawRange: { start: 0, count: attributes.index?.count || attributes.position.count }
                        };
                        resources.push(geometry);
                        const mesh = {
                          position: [0, 0, 0],
                          rotation: [0, 0, 0],
                          scale: [1, 1, 1],
                          worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                          children: [],
                          visible: true,
                          device,
                          geometry,
                          program,
                          id: L.Layer.types["3d"]._nextId++,
                          renderOrder: 0
                        };
                        mesh.name = description.meshes[spec.mesh].name;
                        mesh.extras = spec.extras || {};
                        this.setParent(mesh, group);
                      }
                    }
                    for (const child of spec.children || []) this.setParent(node(child), group);
                    active.delete(index);
                    return group;
                  };
                  const scene = description.scenes?.[description.scene || 0];
                  if (!scene) throw new Error("Missing glTF scene");
                  try {
                    nodes = scene.nodes.map(node);
                  } catch (error) {
                    for (const resource of resources) {
                      if (resource.attributes) {
                        for (const attribute of Object.values(resource.attributes)) attribute.buffer.destroy();
                      } else this._removeProgram(resource);
                    }
                    throw error;
                  }
                }
                const model2 = {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                  worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                  children: [],
                  visible: true,
                  id: url,
                  extras: description.extras || {}
                };
                if (!nodes.length) throw new Error("Expected a glTF model with a non-empty scene");
                for (const node of nodes) this.setParent(node, model2);
                this.model = model2;
                if (this.options.rotation) {
                  const [x, y = x, z = x] = this.options.rotation;
                  this.model.rotation[0] = x;
                  this.model.rotation[1] = y;
                  this.model.rotation[2] = z;
                }
                if (this.options.scale) {
                  const [x, y = x, z = x] = this.options.scale;
                  this.model.scale[0] = x;
                  this.model.scale[1] = y;
                  this.model.scale[2] = z;
                }
                this.setParent(this.model, this.root);
              }
              if (this._shared) this.update();
              this.fire("ready");
            } catch (error) {
              this.fire("error", { error });
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
          if (this.url || this.options.tooltipContent || this.modelUrl) {
            this.container = map.getContainer();
            if (this.options.tooltipContent) {
              this._tooltip = L.DomUtil.create("div", "leaflet-3d-tooltip", this.container);
              this._tooltip.hidden = true;
              this._tooltip.setAttribute("role", "tooltip");
              this._tooltip.setAttribute("aria-live", "polite");
              this._tooltip.style.cssText = "position:absolute;z-index:600;max-width:220px;padding:10px 12px;border:1px solid #6b5140;border-radius:6px;background:#fffaf0;box-shadow:0 3px 12px #0005;color:#30251d;font:13px/1.45 sans-serif;pointer-events:none";
            }
            L.DomEvent.on(this.container, {
              mousemove: this._onPointerMove,
              click: this._onClick,
              mouseleave: this._onPointerLeave
            }, this);
          }
          if (this.root) {
            this._attach(map).catch((error) => this.fire("error", { error }));
          }
        },
        /** Reconcile source coverage when the visible ground footprint changes. */
        getEvents() {
          return this.url ? {
            moveend: this._updateArea,
            zoomend: this._updateArea,
            rotate: this._updateArea,
            pitch: this._updateArea,
            resize: this._updateArea,
            terrainchange: this._onTerrainChange
          } : {};
        },
        /** Release source meshes/UI; retain manually added objects and model CPU data. */
        onRemove(map) {
          this._added = Promise.withResolvers();
          if (this.container) {
            this._onPointerLeave();
            L.DomEvent.off(this.container, {
              mousemove: this._onPointerMove,
              click: this._onClick,
              mouseleave: this._onPointerLeave
            }, this);
            this.container = null;
          }
          for (const area of this._areas.values()) this._releaseArea(area);
          this._areas.clear();
          this._tooltip?.remove();
          this._tooltip = null;
          if (this.url) this._updateStatus(false);
          const shared = this._shared;
          if (!shared) return;
          this.setParent(this.root, null);
          shared._layers.delete(this);
          if (shared === this) {
            map.off("move zoom rotate pitch resize viewreset layeradd layerremove", this._onMapChange, this);
            map.off("zoomstart", this._startZoom, this);
            map.off("zoomanim", this.update, this);
            map.off("zoomend", this._endZoom, this);
            cancelAnimationFrame(this._frame);
            this._frame = null;
            this._queued = false;
            if (this._layers.size) {
              const next = this._layers.values().next().value;
              for (const key of ["_layers", "_sceneOrigin", "_size", "_zoomLevel", "_zoomTransitions", "_cursor", "_roofRaster", "_roofTiles"]) {
                next[key] = this[key];
                delete this[key];
              }
              for (const layer of next._layers) layer._shared = next;
              L.Layer.types["3d"]._renderers.set(map, next);
              map.on("move zoom rotate pitch resize viewreset layeradd layerremove", next._onMapChange, next);
              map.on("zoomstart", next._startZoom, next);
              map.on("zoomanim", next.update, next);
              map.on("zoomend", next._endZoom, next);
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
              const resources = [
                renderer.depthTexture,
                renderer.roofFallbackTexture.texture,
                renderer.uniformBuffer,
                renderer.sunlight?.texture,
                renderer.sunlight?.buffer,
                renderer.sunlight?.lights
              ].filter(Boolean);
              renderer.device.queue.onSubmittedWorkDone().then(() => {
                for (const resource of resources) resource.destroy();
                renderer.device.destroy();
              }, (error) => {
                this.fire("error", { error });
                renderer.device.destroy();
              });
              L.Layer.types["3d"]._renderers.delete(map);
              for (const key of ["_layers", "_sceneOrigin", "_size", "_zoomLevel", "_cursor"]) delete this[key];
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
          let shared = L.Layer.types["3d"]._renderers.get(map);
          if (shared?._rendererReady) {
            await shared._rendererReady.promise;
          }
          if (!shared) {
            const rendererReady = Promise.withResolvers();
            shared = this;
            this._rendererReady = rendererReady;
            rendererReady.promise.catch(() => {
            });
            L.Layer.types["3d"]._renderers.set(map, shared);
            const fail = (error) => {
              rendererReady.reject(error);
              L.Layer.types["3d"]._renderers.delete(map);
              throw error;
            };
            const canvas = document.createElement("canvas");
            if (!navigator.gpu) fail(new Error("Layer3D requires WebGPU"));
            const adapter = await navigator.gpu.requestAdapter().catch(fail);
            if (!adapter) fail(new Error("Unable to acquire a WebGPU adapter"));
            const device = await adapter.requestDevice().catch(fail);
            device.addEventListener("uncapturederror", (event) => {
              const owner = L.Layer.types["3d"]._renderers.get(map);
              for (const layer of owner?._layers || []) layer.fire("error", { error: event.error });
            });
            device.lost.then((info) => {
              const owner = L.Layer.types["3d"]._renderers.get(map);
              if (!owner) return;
              const error = new Error(`WebGPU device lost: ${info.message || info.reason}`);
              for (const layer of owner._layers) layer.fire("error", { error });
            });
            const context = canvas.getContext("webgpu");
            if (!context) {
              device.destroy();
              fail(new Error("Unable to create a WebGPU canvas context"));
            }
            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: "premultiplied" });
            this._shared = this;
            this._layers = /* @__PURE__ */ new Set();
            this._sceneOrigin = this.location;
            this.scene = {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              children: [],
              visible: true
            };
            this.camera = {
              position: [0, 0, 0],
              up: [0, 1, 0],
              target: [0, 0, 0],
              viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              projectionViewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              fov: 45,
              aspect: 1,
              near: 0.1,
              far: 1e4
            };
            this.renderer = { device, context, format, canvas, dpr: Math.min(window.devicePixelRatio, 2) };
            this._initSunlight();
            const emptyImage = document.createElement("canvas");
            emptyImage.width = 1;
            emptyImage.height = 1;
            this.renderer.roofFallbackTexture = {
              device,
              texture: device.createTexture({
                size: [1, 1],
                format: "rgba8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
              }),
              sampler: device.createSampler({
                addressModeU: "clamp-to-edge",
                addressModeV: "clamp-to-edge"
              }),
              image: emptyImage,
              format: "rgba8unorm",
              srgb: false,
              uploaded: null
            };
            shared._size = null;
            canvas.className = "leaflet-3d";
            canvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", this.options.ariaLabel);
            let pane = map.getPane("webgpuPane");
            if (!pane) {
              pane = map.createPane("webgpuPane", map.getContainer());
              pane.style.zIndex = 450;
            }
            pane.append(canvas);
            map.on("move zoom rotate pitch resize viewreset layeradd layerremove", shared._onMapChange, shared);
            map.on("zoomstart", shared._startZoom, shared);
            map.on("zoomanim", shared.update, shared);
            map.on("zoomend", shared._endZoom, shared);
            rendererReady.resolve();
            delete shared._rendererReady;
            shared._render();
            L.Layer.types["3d"]._renderers.set(map, shared);
          }
          const origin = map.options.crs.project(shared._sceneOrigin);
          const point = map.options.crs.project(this.location);
          const metres = Math.cos(shared._sceneOrigin.lat * Math.PI / 180);
          this._terrainBaseY ??= this.root.position[1];
          this.root.position[0] = (point.x - origin.x) * metres;
          this.root.position[1] = this._terrainBaseY;
          this.root.position[2] = -(point.y - origin.y) * metres;
          this._setTerrainHeight();
          this.root.scale.fill(metres / Math.cos(this.location.lat * Math.PI / 180));
          this._shared = shared;
          this.renderer = shared.renderer;
          this.scene = shared.scene;
          this.camera = shared.camera;
          shared._layers.add(this);
          this.setParent(this.root, shared.scene);
          this.traverse(this.root, (object) => {
            if (object.geometry && object.geometry.device !== shared.renderer.device) {
              const geometry = object.geometry;
              const material = object.program._layerMaterial;
              const attributes = {};
              for (const name of ["position", "normal", "color", "uv", "index"]) {
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
                attribute.indexFormat = attribute.data instanceof Uint32Array ? "uint32" : "uint16";
                attribute.buffer = device.createBuffer({
                  size: Math.max(4, attribute.data.byteLength),
                  usage: name === "index" ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
              }
              object.geometry = {
                device,
                attributes,
                drawRange: { start: 0, count: attributes.index?.count || attributes.position.count }
              };
              for (const attribute of Object.values(geometry.attributes)) attribute.buffer.destroy();
              object.bindGroup = null;
              object.boundTextures = [];
              for (const key of ["baseTexture", "metalTexture", "emissiveTexture", "occlusionTexture"]) {
                const texture = material[key];
                if (!texture || texture.device === device) continue;
                material[key] = {
                  ...texture,
                  device,
                  texture: device.createTexture({
                    size: [texture.image.width, texture.image.height],
                    format: texture.format,
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                  }),
                  sampler: device.createSampler(texture.samplerOptions),
                  uploaded: null
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
                  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                }),
                sampler: shared.renderer.device.createSampler(object.texture.samplerOptions),
                uploaded: null
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
         * @returns {L.Layer} This layer.
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
          this.renderer.device.queue.onSubmittedWorkDone().then(() => texture.destroy(), (error) => {
            this.fire("error", { error });
            texture.destroy();
          });
        },
        /**
         * Without an argument, removes this Leaflet layer. With an object, only detaches it:
         * geometry/program resources are not disposed, so it can be added again.
         * @param {Object} [object]
         * @returns {L.Layer}
         */
        remove(object) {
          if (object === void 0) return L.Layer.prototype.remove.call(this);
          this.setParent(object, null);
          return this.update();
        },
        _initSunlight() {
          const device = this.renderer.device;
          const layout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }
          ] });
          const buffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          const sampler = device.createSampler({ compare: "less-equal", minFilter: "linear", magFilter: "linear" });
          const lights = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
          this.renderer.sunlight = { layout, buffer, sampler, lights, size: 0 };
          const values = new Float32Array(20);
          values.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
          device.queue.writeBuffer(buffer, 0, values);
          this._resizeSunlight(1);
        },
        _resizeSunlight(size) {
          const device = this.renderer.device, sun = this.renderer.sunlight;
          if (sun.size === size) return;
          if (sun.texture) this._destroyTexture(sun.texture);
          sun.size = size;
          sun.texture = device.createTexture({
            size: [size, size],
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
          });
          this._bindSunlight();
        },
        _bindSunlight() {
          const sun = this.renderer.sunlight;
          sun.bindGroup = this.renderer.device.createBindGroup({ layout: sun.layout, entries: [
            { binding: 0, resource: { buffer: sun.buffer } },
            { binding: 1, resource: sun.texture.createView() },
            { binding: 2, resource: sun.sampler },
            { binding: 3, resource: { buffer: sun.lights } }
          ] });
        },
        /** A cached spatial grid limits fragment lighting to nearby lamps, without dropping dense cells. */
        _updatePointLights() {
          const { device, sunlight: sun } = this.renderer;
          const meshes = [];
          for (const layer of this._layers) {
            if (!layer.options.nightLight || !layer.root.visible) continue;
            this.traverse(layer.root, (mesh) => {
              if (!mesh.visible) return true;
              if (mesh.extras?.lights) meshes.push(mesh);
            });
          }
          if (sun.lightMeshes?.length === meshes.length && meshes.every((mesh, i) => sun.lightMeshes[i].mesh === mesh && mesh.worldMatrix.every((v, j) => v === sun.lightMeshes[i].matrix[j]))) return;
          const lights = [];
          for (const mesh of meshes) {
            const matrix = new DOMMatrix(mesh.worldMatrix);
            for (const light of mesh.extras.lights) {
              const point = new DOMPoint(...light.position, 1).matrixTransform(matrix);
              lights.push({ ...light, position: [point.x / point.w, point.y / point.w, point.z / point.w] });
            }
          }
          const cellSize = 32;
          let data = new Float32Array(8);
          if (lights.length) {
            const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
            for (const light of lights) for (let axis = 0; axis < 2; axis++) {
              const coordinate = light.position[axis * 2];
              min[axis] = Math.min(min[axis], coordinate - light.radius);
              max[axis] = Math.max(max[axis], coordinate + light.radius);
            }
            const columns = Math.ceil((max[0] - min[0]) / cellSize) + 1;
            const rows = Math.ceil((max[1] - min[1]) / cellSize) + 1;
            const cells = /* @__PURE__ */ new Map();
            for (const light of lights) {
              const [x, , z] = light.position, radius = light.radius;
              for (let y = Math.floor((z - radius - min[1]) / cellSize); y <= Math.floor((z + radius - min[1]) / cellSize); y++) {
                for (let i = Math.floor((x - radius - min[0]) / cellSize); i <= Math.floor((x + radius - min[0]) / cellSize); i++) {
                  const key = y * columns + i;
                  if (!cells.has(key)) cells.set(key, []);
                  cells.get(key).push(light);
                }
              }
            }
            const entries = [...cells.values()].reduce((sum, cell) => sum + cell.length, 0);
            const length = (2 + columns * rows + entries * 2) * 4;
            if (length * 4 > device.limits.maxStorageBufferBindingSize) throw new Error("Streetlight grid exceeds GPU storage limit");
            data = new Float32Array(length);
            data.set([min[0], min[1], cellSize, columns, rows, lights.length, 0, 0]);
            let offset = 2 + columns * rows;
            for (const [key, cell] of cells) {
              data.set([offset, cell.length, 0, 0], (2 + key) * 4);
              for (const light of cell) {
                data.set([...light.position, light.radius, ...light.color, light.flux / (4 * Math.PI) * 0.03], offset * 4);
                offset += 2;
              }
            }
          }
          if (sun.lights.size < data.byteLength) {
            this._destroyTexture(sun.lights);
            sun.lights = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            this._bindSunlight();
          }
          device.queue.writeBuffer(sun.lights, 0, data);
          sun.lightCount = lights.length;
          sun.lightMeshes = meshes.map((mesh) => ({ mesh, matrix: [...mesh.worldMatrix] }));
        },
        /** One shared directional depth map. Off-screen but loaded geometry can cast shadows. */
        _renderSunlight(encoder, meshes, sunlight) {
          const renderer = this.renderer, device = renderer.device, sun = renderer.sunlight;
          if (!meshes.length || !sunlight || sunlight.altitude < 3) {
            if (!sun.enabled) return;
            const values2 = new Float32Array(20);
            values2.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
            device.queue.writeBuffer(sun.buffer, 0, values2);
            sun.enabled = false;
            return;
          }
          const values = new Float32Array(20);
          sun.enabled = true;
          this._resizeSunlight(Math.min(2048, device.limits.maxTextureDimension2D));
          const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
          for (const mesh of meshes) {
            if (!mesh.geometry.bounds) this._computeBounds(mesh.geometry);
            const bounds = mesh.geometry.bounds, matrix = new DOMMatrix(mesh.worldMatrix);
            for (let i = 0; i < 8; i++) {
              const point = new DOMPoint(...min.map((_, axis) => i & 1 << axis ? bounds.max[axis] : bounds.min[axis]), 1).matrixTransform(matrix);
              for (let axis = 0; axis < 3; axis++) {
                const value = [point.x, point.y, point.z][axis] / point.w;
                min[axis] = Math.min(min[axis], value);
                max[axis] = Math.max(max[axis], value);
              }
            }
          }
          min[1] = Math.min(0, min[1]);
          const radius = Math.max(100, Math.hypot(...min.map((v, i) => max[i] - v)));
          const center = min.map((v, i) => (v + max[i]) / 2);
          const lightCamera = {
            position: center.map((v, i) => v + sunlight.direction[i] * radius * 2),
            target: center,
            up: [0, 0, -1],
            fov: 45,
            aspect: 1,
            near: 1,
            far: radius * 5,
            viewMatrix: [],
            projectionMatrix: [],
            projectionViewMatrix: []
          };
          this._updateCamera(lightCamera);
          const view = new DOMMatrix(lightCamera.viewMatrix);
          const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < 8; i++) {
            const point = new DOMPoint(...min.map((v, axis) => i & 1 << axis ? max[axis] : v), 1).matrixTransform(view);
            [point.x, point.y, point.z].forEach((value, axis) => {
              low[axis] = Math.min(low[axis], value - 20);
              high[axis] = Math.max(high[axis], value + 20);
            });
          }
          const span = low.map((v, i) => high[i] - v);
          const projection = new DOMMatrix([
            2 / span[0],
            0,
            0,
            0,
            0,
            2 / span[1],
            0,
            0,
            0,
            0,
            -1 / span[2],
            0,
            -(high[0] + low[0]) / span[0],
            -(high[1] + low[1]) / span[1],
            high[2] / span[2],
            1
          ]);
          values.set(projection.multiply(view).toFloat32Array());
          values[16] = 1;
          device.queue.writeBuffer(sun.buffer, 0, values);
          if (!sun.pipeline) {
            sun.meshLayout = device.createBindGroupLayout({ entries: [
              { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform", hasDynamicOffset: true } }
            ] });
            sun.depthLayout = device.createBindGroupLayout({ entries: [
              { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }
            ] });
            sun.depthBindGroup = device.createBindGroup({
              layout: sun.depthLayout,
              entries: [{ binding: 0, resource: { buffer: sun.buffer } }]
            });
            const shader = device.createShaderModule({ code: `
        struct Mesh { world: mat4x4<f32> };
        @group(0) @binding(0) var<uniform> mesh: Mesh;
        @group(1) @binding(0) var<uniform> matrix: mat4x4<f32>;
        @vertex fn main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
          return matrix * mesh.world * vec4<f32>(position, 1.0);
        }
      ` });
            sun.pipeline = device.createRenderPipeline({
              layout: device.createPipelineLayout({ bindGroupLayouts: [sun.meshLayout, sun.depthLayout] }),
              vertex: { module: shader, entryPoint: "main", buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }
              ] },
              primitive: { topology: "triangle-list", cullMode: "none" },
              depthStencil: {
                format: "depth32float",
                depthWriteEnabled: true,
                depthCompare: "less",
                depthBias: 2,
                depthBiasSlopeScale: 2
              }
            });
          }
          const pass = encoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
              view: sun.texture.createView(),
              depthClearValue: 1,
              depthLoadOp: "clear",
              depthStoreOp: "store"
            }
          });
          pass.setPipeline(sun.pipeline);
          pass.setBindGroup(1, sun.depthBindGroup);
          for (const mesh of meshes) {
            const offset = renderer.uniformSlot++ * 256;
            renderer.uniformData.set(mesh.worldMatrix, offset / 4);
            if (mesh._shadowBuffer !== renderer.uniformBuffer) {
              mesh._shadowBuffer = renderer.uniformBuffer;
              mesh._shadowBindGroup = device.createBindGroup({ layout: sun.meshLayout, entries: [
                { binding: 0, resource: { buffer: renderer.uniformBuffer, size: 64 } }
              ] });
            }
            for (const attribute of Object.values(mesh.geometry.attributes)) {
              if (attribute.needsUpdate) {
                device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
                attribute.needsUpdate = false;
              }
            }
            pass.setBindGroup(0, mesh._shadowBindGroup, [offset]);
            pass.setVertexBuffer(0, mesh.geometry.attributes.position.buffer);
            const index = mesh.geometry.attributes.index, range = mesh.geometry.drawRange;
            if (index) {
              pass.setIndexBuffer(index.buffer, index.indexFormat);
              pass.drawIndexed(range.count, 1, range.start, 0, 0);
            } else pass.draw(range.count, 1, range.start, 0);
          }
          pass.end();
        },
        _createProgram(material = {}) {
          const device = this.renderer.device;
          const hasBase = Boolean(material.baseTexture);
          const hasMetal = Boolean(material.metalTexture);
          const hasEmissive = Boolean(material.emissiveTexture);
          const hasOcclusion = Boolean(material.occlusionTexture);
          const hasRoof = Boolean(material.roofTexture);
          const hasTerrain = Boolean(material.terrain);
          const textured = hasBase || hasMetal || hasEmissive || hasOcclusion || material.nightLight;
          const sparkle = Boolean(this.options.nightSparkle);
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
        atmosphereTint: vec4<f32>,
      };
      @group(0) @binding(0) var<uniform> u: Mesh;
      @group(0) @binding(1) var<uniform> frame: Frame;
      struct Solar { matrix: mat4x4<f32>, params: vec4<f32> };
      @group(1) @binding(0) var<uniform> solar: Solar;
      ${hasTerrain ? `@group(0) @binding(2) var dem: texture_2d<f32>;${L.Layer.types.terrain.elevationWGSL}` : ""}
      struct VertexInput {
        @location(0) position: vec3<f32>,
        @location(1) normal: vec3<f32>,
        ${material.vertexColors ? "@location(2) color: vec3<f32>," : ""}
        ${textured ? "@location(3) uv: vec2<f32>," : ""}
      };
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) viewPosition: vec3<f32>,
        @location(6) shadowPosition: vec4<f32>,
        @location(7) worldPosition: vec3<f32>,
        ${sparkle ? "@location(8) localPosition: vec3<f32>," : ""}
        ${textured ? "@location(3) uv: vec2<f32>," : ""}
        ${hasRoof ? "@location(4) roofUv: vec2<f32>, @location(5) roof: f32," : ""}
      };
      @vertex fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var output: VertexOutput;
        var position = input.position;
        ${hasTerrain ? "position.y = elevation(u.terrain.xy + input.uv * u.terrain.z, u.terrain.w) - u.terrain.w;" : ""}
        let highlighted = f32(vertexIndex) >= u.highlight.x && f32(vertexIndex) < u.highlight.y;
        output.color = ${material.vertexColors ? "select(input.color, vec3<f32>(72.0 / 255.0, 217.0 / 255.0, 1.0), highlighted)" : "u.baseColor.rgb"};
        // Inverse-transpose from cofactors; the camera view matrix is orthonormal.
        let m = mat3x3<f32>(u.worldMatrix[0].xyz, u.worldMatrix[1].xyz, u.worldMatrix[2].xyz);
        let normal = (cross(m[1], m[2]) * input.normal.x + cross(m[2], m[0]) * input.normal.y +
          cross(m[0], m[1]) * input.normal.z) / determinant(m);
        output.normal = (frame.viewMatrix * vec4<f32>(normal, 0.0)).xyz;
        let world = u.worldMatrix * vec4<f32>(position, 1.0);
        output.shadowPosition = solar.matrix * world;
        output.worldPosition = world.xyz / world.w;
        ${sparkle ? "output.localPosition = input.position;" : ""}
        let viewPosition = frame.viewMatrix * world;
        output.viewPosition = viewPosition.xyz;
        ${textured ? "output.uv = input.uv;" : ""}
        ${hasRoof ? `
          output.roofUv = (frame.roofMatrix * world).xz;
          output.roof = select(0.0, 1.0, input.normal.y >= 0.5 && !highlighted);
        ` : ""}
        output.position = frame.projectionMatrix * viewPosition;
        return output;
      }
    ` });
          const bindings = [];
          let binding = 3;
          const textureBinding = (name, enabled) => {
            if (!enabled) return "";
            bindings.push({ name, texture: binding, sampler: binding + 1 });
            const current = binding;
            binding += 2;
            return `@group(0) @binding(${current}) var ${name}: texture_2d<f32>;
        @group(0) @binding(${current + 1}) var ${name}Sampler: sampler;`;
          };
          const baseBinding = textureBinding("baseTexture", hasBase);
          const metalBinding = textureBinding("metalTexture", hasMetal);
          const emissiveBinding = textureBinding("emissiveTexture", hasEmissive);
          const occlusionBinding = textureBinding("occlusionTexture", hasOcclusion);
          const roofBinding = textureBinding("roofTexture", hasRoof);
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
        atmosphereTint: vec4<f32>,
      };
      @group(0) @binding(0) var<uniform> u: Mesh;
      @group(0) @binding(1) var<uniform> frame: Frame;
      struct Solar { matrix: mat4x4<f32>, params: vec4<f32> };
      @group(1) @binding(0) var<uniform> solar: Solar;
      @group(1) @binding(1) var shadowTexture: texture_depth_2d;
      @group(1) @binding(2) var shadowSampler: sampler_comparison;
      @group(1) @binding(3) var<storage, read> lightGrid: array<vec4<f32>>;
      ${baseBinding}${metalBinding}${emissiveBinding}${occlusionBinding}${roofBinding}
      struct FragmentInput {
        @location(0) color: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) viewPosition: vec3<f32>,
        @location(6) shadowPosition: vec4<f32>,
        @location(7) worldPosition: vec3<f32>,
        ${sparkle ? "@location(8) localPosition: vec3<f32>," : ""}
        ${textured ? "@location(3) uv: vec2<f32>," : ""}
        ${hasRoof ? "@location(4) roofUv: vec2<f32>, @location(5) roof: f32," : ""}
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
      fn sunVisibility(position: vec4<f32>) -> f32 {
        let p = position.xyz / position.w;
        let uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
        if (solar.params.x < 0.5 || any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || p.z < 0.0 || p.z > 1.0) {
          return 1.0;
        }
        return textureSampleCompareLevel(shadowTexture, shadowSampler, uv, p.z - 0.0003);
      }
      fn localLighting(position: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
        if (frame.skyDirection.w <= 0.0 || lightGrid[0].w < 1.0) { return vec3<f32>(0.0); }
        let cell = vec2<i32>(floor((position.xz - lightGrid[0].xy) / lightGrid[0].z));
        if (any(cell < vec2<i32>(0)) || cell.x >= i32(lightGrid[0].w) || cell.y >= i32(lightGrid[1].x)) {
          return vec3<f32>(0.0);
        }
        let header = lightGrid[2u + u32(cell.y) * u32(lightGrid[0].w) + u32(cell.x)];
        var light = vec3<f32>(0.0);
        for (var i = 0u; i < u32(header.y); i++) {
          let source = lightGrid[u32(header.x) + i * 2u];
          let colour = lightGrid[u32(header.x) + i * 2u + 1u];
          let delta = source.xyz - position;
          let distance2 = max(dot(delta, delta), 1.0);
          let falloff = max(0.0, 1.0 - distance2 / (source.w * source.w));
          let lambert = max(0.0, dot(normal, delta / sqrt(distance2)));
          light += toLinear(colour.rgb) * colour.w * lambert * falloff * falloff / distance2;
        }
        return light * frame.skyDirection.w;
      }
      @fragment fn fragmentMain(input: FragmentInput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
        ${material.nightLight ? `
          if (input.uv.x <= 2.0) {
          let radial = max(0.0, 1.0 - dot(input.uv, input.uv));
          let alpha = radial * radial * frame.skyDirection.w * 0.65;
          if (alpha < 0.005) { discard; }
          return vec4<f32>(input.color, alpha);
          }
        ` : ""}
        let sunlight = sunVisibility(input.shadowPosition);
        let worldNormal = normalize(transpose(mat3x3<f32>(frame.viewMatrix[0].xyz,
          frame.viewMatrix[1].xyz, frame.viewMatrix[2].xyz)) * normalize(input.normal)) * select(-1.0, 1.0, frontFacing);
        let artificial = localLighting(input.worldPosition, worldNormal);
        ${material.unlit ? `
          let rasterTexel = textureSample(baseTexture, baseTextureSampler, input.uv);
          return vec4<f32>(toSRGB(toLinear(rasterTexel.rgb) * (frame.atmosphereTint.rgb * (0.55 + 0.45 * sunlight) + artificial)), ${material.alphaMode === "BLEND" ? "u.material.z * rasterTexel.a" : "1.0"});
        ` : `
        var normal = normalize(input.normal) * select(-1.0, 1.0, frontFacing);
        let texel = ${hasBase ? "textureSample(baseTexture, baseTextureSampler, input.uv)" : "vec4<f32>(1.0)"};
        let alpha = u.material.z * texel.a;
        ${material.alphaMode === "MASK" ? "if (alpha < u.material.w) { discard; }" : ""}
        ${material.alphaMode === "BLEND" ? "if (alpha < 0.01) { discard; }" : ""}
        var base = ${material.vertexColors ? "toLinear(input.color)" : "input.color"} *
          ${material.baseTexture?.srgb ? "texel.rgb" : "toLinear(texel.rgb)"};
        ${hasRoof ? `
          if (input.roof > 0.5 && all(input.roofUv >= vec2<f32>(0.0)) &&
            all(input.roofUv <= vec2<f32>(1.0))) {
            let roof = textureSampleLevel(roofTexture, roofTextureSampler, input.roofUv, 0.0);
            base = mix(base, toLinear(roof.rgb), roof.a);
          }
        ` : ""}
        let mr = ${hasMetal ? "textureSample(metalTexture, metalTextureSampler, input.uv)" : "vec4<f32>(1.0)"};
        let metal = clamp(u.material.x * mr.b, 0.0, 1.0);
        let rough = clamp(u.material.y * mr.g, 0.08, 1.0);
        let view = normalize(-input.viewPosition);
        let halfVector = normalize(view + frame.lightDirection.xyz);
        let nl = max(dot(normal, frame.lightDirection.xyz), 0.0) * frame.lightDirection.w * sunlight;
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
        let ao = ${hasOcclusion ? "mix(1.0, textureSample(occlusionTexture, occlusionTextureSampler, input.uv).r, u.emissive.w)" : "1.0"};
        ${sparkle ? `
          let lattice = (fract(input.localPosition / 2.5) - 0.5) * 2.5;
          let pointGlow = (1.0 - smoothstep(0.16, 0.42, length(lattice))) * u.highlight.z;
        ` : ""}
        let glow = ${sparkle ? "vec3<f32>(3.0, 2.6, 1.8) * pointGlow +" : ""} u.emissive.rgb * ${hasEmissive ? material.emissiveTexture.srgb ? "textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb" : "toLinear(textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb)" : "vec3<f32>(1.0)"};
        var color = ambient * base * (1.0 - metal) * ao +
          (diffuse + specular) * nl * toLinear(vec3<f32>(1.0, 0.937, 0.835)) * 3.0 + glow;
        ${material.vertexColors ? "color = base * (ambient + toLinear(vec3<f32>(1.0, 0.937, 0.835)) * (3.0 / PI) * nl) + glow;" : ""}
        color = (color - glow) * frame.atmosphereTint.rgb + base * artificial * (1.0 - metal * 0.5) + glow;
        return vec4<f32>(toSRGB(color), ${material.alphaMode === "BLEND" ? "alpha" : "1.0"});
        `}
      }
    ` });
          Promise.all([vertex.getCompilationInfo(), fragment.getCompilationInfo()]).then((infos) => {
            const errors = infos.flatMap((info) => info.messages).filter((message) => message.type === "error");
            if (errors.length) {
              this.fire("error", {
                error: new Error(`Unable to compile Layer3D WGSL: ${errors.map((error) => error.message).join("\n")}`)
              });
            }
          }).catch((error) => this.fire("error", { error }));
          const vertexBuffers = [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
            { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
            material.vertexColors ? { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x3" }] } : null,
            textured ? { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x2" }] } : null
          ];
          const bindGroupEntries = [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform", hasDynamicOffset: true }
          }, {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" }
          }];
          if (hasTerrain) {
            bindGroupEntries.push({
              binding: 2,
              visibility: GPUShaderStage.VERTEX,
              texture: { sampleType: "unfilterable-float", viewDimension: "2d" }
            });
          }
          for (const texture of bindings) {
            bindGroupEntries.push({
              binding: texture.texture,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" }
            });
            bindGroupEntries.push({
              binding: texture.sampler,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: "filtering" }
            });
          }
          const bindGroupLayout = device.createBindGroupLayout({ entries: bindGroupEntries });
          const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout, this.renderer.sunlight.layout] });
          return {
            device,
            vertex,
            fragment,
            bindings,
            vertexBuffers,
            bindGroupLayout,
            pipelineLayout,
            pipelineCache: /* @__PURE__ */ new Map(),
            cullMode: material.doubleSided ? "none" : "back",
            transparent: material.alphaMode === "BLEND",
            depthWrite: material.alphaMode !== "BLEND",
            depthTest: material.depthTest !== false,
            terrain: material.terrain,
            nightLight: Boolean(material.nightLight),
            nightSparkle: sparkle,
            uniforms: {
              baseColor: { value: material.color || [1, 1, 1] },
              metallic: { value: material.metallic ?? 0 },
              roughness: { value: material.roughness ?? 0.85 },
              opacity: { value: material.opacity ?? 1 },
              alphaCutoff: { value: material.alphaCutoff ?? 0.5 },
              occlusionStrength: { value: material.occlusionStrength ?? 1 },
              emissive: { value: material.emissive || [0, 0, 0] },
              ...hasBase ? { baseTexture: { value: material.baseTexture } } : {},
              ...hasMetal ? { metalTexture: { value: material.metalTexture } } : {},
              ...hasEmissive ? { emissiveTexture: { value: material.emissiveTexture } } : {},
              ...hasOcclusion ? { occlusionTexture: { value: material.occlusionTexture } } : {},
              ...hasRoof ? { roofTexture: { value: null } } : {}
            },
            _layerMaterial: material
          };
        },
        /**
         * HSL inputs are linear-space to preserve the original building styling.
         * Numeric/CSS/RGB inputs are already sRGB; CSS alpha is not used for extrusion.
         * @param {number|string|Object} value 0xRRGGBB, CSS color, {r,g,b}, or {h,s,l} in 0..1.
         * @returns {Object} sRGB {r,g,b} components in 0..1.
         */
        color(value) {
          if (value && typeof value === "object" && "h" in value) {
            const { h, s, l } = value;
            const a = s * Math.min(l, 1 - l);
            const channel = (n) => {
              const k = (n + h * 12) % 12;
              return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            };
            const toSRGB = (value2) => value2 <= 31308e-7 ? value2 * 12.92 : 1.055 * value2 ** (1 / 2.4) - 0.055;
            return { r: toSRGB(channel(0)), g: toSRGB(channel(8)), b: toSRGB(channel(4)) };
          }
          if (value && typeof value === "object" && "r" in value) return value;
          if (typeof value === "number") return {
            r: (value >> 16 & 255) / 255,
            g: (value >> 8 & 255) / 255,
            b: (value & 255) / 255
          };
          if (typeof value !== "string" || !CSS.supports("color", value)) throw new Error("Invalid 3D color");
          const context = document.createElement("canvas").getContext("2d");
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
          if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Invalid polygon coordinates");
          const vertices = points.map((p, index) => ({ x: p.x - contour[0].x, y: p.y - contour[0].y, index }));
          const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          const equal = (a, b) => a.x === b.x && a.y === b.y;
          const clean = (ring) => {
            let changed = true;
            while (changed && ring.length > 3) {
              changed = false;
              for (let i = 0; i < ring.length; i++) {
                const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
                if (equal(a, b) || Math.abs(cross(a, b, c)) < 1e-10) {
                  ring.splice(i, 1);
                  changed = true;
                  break;
                }
              }
            }
            if (ring.length < 3) throw new Error("Degenerate polygon ring");
            return ring;
          };
          let offset = 0;
          const rings = [contour, ...holes].map((path, index) => {
            const ring = clean(vertices.slice(offset, offset += path.length));
            if (this.isClockWise(ring) !== Boolean(index)) ring.reverse();
            return ring;
          });
          const inside = (point, ring) => {
            let result2 = false;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
              const a = ring[i], b = ring[j];
              if (a.y > point.y !== b.y > point.y && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result2 = !result2;
            }
            return result2;
          };
          const intersects = (a, b, c, d) => {
            if (equal(a, c) || equal(a, d) || equal(b, c) || equal(b, d)) return false;
            const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
            const on = (p, q, r) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
            return abC * abD < 0 && cdA * cdB < 0 || abC === 0 && on(a, b, c) || abD === 0 && on(a, b, d) || cdA === 0 && on(c, d, a) || cdB === 0 && on(c, d, b);
          };
          let polygon = rings[0].slice();
          for (const hole of rings.slice(1).sort((a, b) => Math.min(...a.map((p) => p.x)) - Math.min(...b.map((p) => p.x)))) {
            let bridge, distance = Infinity;
            for (let h2 = 0; h2 < hole.length; h2++) for (let p2 = 0; p2 < polygon.length; p2++) {
              const a = hole[h2], b = polygon[p2], d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
              if (d >= distance) continue;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              if (!inside(mid, rings[0]) || rings.slice(1).some((r) => inside(mid, r))) continue;
              if ([polygon, ...rings.slice(1)].some((r) => r.some((c, i) => intersects(a, b, c, r[(i + 1) % r.length])))) continue;
              bridge = [h2, p2];
              distance = d;
            }
            if (!bridge) throw new Error("Unable to connect polygon hole");
            const [h, p] = bridge;
            polygon = [
              ...polygon.slice(0, p + 1),
              ...hole.slice(h),
              ...hole.slice(0, h + 1),
              polygon[p],
              ...polygon.slice(p + 1)
            ];
          }
          const result = [];
          while (polygon.length > 3) {
            let clipped = false;
            for (let i = 0; i < polygon.length; i++) {
              const a = polygon[(i + polygon.length - 1) % polygon.length], b = polygon[i], c = polygon[(i + 1) % polygon.length];
              if (cross(a, b, c) <= 1e-10) continue;
              if (polygon.some((p) => !equal(p, a) && !equal(p, b) && !equal(p, c) && cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0)) continue;
              result.push([a.index, b.index, c.index]);
              polygon.splice(i, 1);
              clipped = true;
              break;
            }
            if (!clipped) throw new Error("Unable to triangulate polygon: invalid or self-intersecting rings");
          }
          if (cross(...polygon) > 1e-10) result.push(polygon.map((p) => p.index));
          const area = (ring) => Math.abs(ring.reduce((sum, p, i) => {
            const q = ring[(i + 1) % ring.length];
            return sum + p.x * q.y - q.x * p.y;
          }, 0)) / 2;
          const expected = area(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + area(ring), 0);
          const actual = result.reduce((sum, triangle) => sum + cross(...triangle.map((i) => vertices[i])) / 2, 0);
          if (expected <= 0 || Math.abs(actual - expected) > Math.max(1e-7, expected * 1e-8)) throw new Error("Polygon triangulation area mismatch");
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
          const inverseCamera = new DOMMatrix(this.camera.projectionViewMatrix).inverse();
          const inverseCameraValues = inverseCamera.toFloat64Array();
          if (![...inverseCameraValues].every(Number.isFinite)) {
            throw new Error("Singular 3D transform");
          }
          this.raycaster.origin[0] = this.camera.position[0];
          this.raycaster.origin[1] = this.camera.position[1];
          this.raycaster.origin[2] = this.camera.position[2];
          const unprojected = new DOMPoint(
            (event.clientX - rect.left) / rect.width * 2 - 1,
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
          const meshes = [], hits = [], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], sub = (a2, b2) => a2.map((v, i) => v - b2[i]), cross = (a2, b2) => [a2[1] * b2[2] - a2[2] * b2[1], a2[2] * b2[0] - a2[0] * b2[2], a2[0] * b2[1] - a2[1] * b2[0]], dot = (a2, b2) => a2.reduce((sum, v, i) => sum + v * b2[i], 0);
          for (const object of objects) {
            if (recursive) this.traverse(object, (mesh) => {
              if (mesh.geometry && mesh.visible) meshes.push(mesh);
            });
            else if (object.geometry && object.visible) meshes.push(object);
          }
          for (const mesh of meshes) {
            const inverse = new DOMMatrix(mesh.worldMatrix).inverse();
            const inverseValues = inverse.toFloat64Array();
            if (![...inverseValues].every(Number.isFinite)) {
              throw new Error("Singular 3D transform");
            }
            const localOrigin = new DOMPoint(...this.raycaster.origin, 1).matrixTransform(inverse);
            const origin = [
              localOrigin.x / localOrigin.w,
              localOrigin.y / localOrigin.w,
              localOrigin.z / localOrigin.w
            ];
            const localDirection = new DOMPoint(...this.raycaster.direction, 0).matrixTransform(inverse);
            const direction = [
              localDirection.x,
              localDirection.y,
              localDirection.z
            ];
            const directionLength = Math.hypot(...direction) || 1;
            direction[0] /= directionLength;
            direction[1] /= directionLength;
            direction[2] /= directionLength;
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
                const a2 = (mesh.geometry.bounds.min[i] - origin[i]) / direction[i], b2 = (mesh.geometry.bounds.max[i] - origin[i]) / direction[i];
                near = Math.max(near, Math.min(a2, b2));
                far = Math.min(far, Math.max(a2, b2));
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
              const e = sub(b, a), f = sub(c, a), p = cross(direction, f), det = dot(e, p);
              if (mesh.program.cullFace !== null ? det < 1e-9 : Math.abs(det) < 1e-9) {
                continue;
              }
              const t = sub(origin, a), u = dot(t, p) / det;
              if (u < 0 || u > 1) {
                continue;
              }
              const q = cross(t, e), v = dot(direction, q) / det;
              if (v < 0 || u + v > 1) {
                continue;
              }
              if (mesh.program.nightLight) {
                const uv = mesh.geometry.attributes.uv.data;
                const ids = index ? [index.data[i], index.data[i + 1], index.data[i + 2]] : [i, i + 1, i + 2];
                const x = uv[ids[0] * 2] * (1 - u - v) + uv[ids[1] * 2] * u + uv[ids[2] * 2] * v;
                const y = uv[ids[0] * 2 + 1] * (1 - u - v) + uv[ids[1] * 2 + 1] * u + uv[ids[2] * 2 + 1] * v;
                if (x <= 2 && (!this.renderer.uniformData?.[55] || x * x + y * y > 0.9)) continue;
              }
              const distance = dot(f, q) / det;
              if (distance > 0 && distance < closest) {
                closest = distance;
                faceIndex = i / 3;
              }
            }
            if (faceIndex === void 0) continue;
            const point = new DOMPoint(
              direction[0] * closest + origin[0],
              direction[1] * closest + origin[1],
              direction[2] * closest + origin[2],
              1
            ).matrixTransform(new DOMMatrix(mesh.worldMatrix));
            const worldPoint = [point.x / point.w, point.y / point.w, point.z / point.w];
            hits.push({
              faceIndex,
              object: mesh,
              point: worldPoint,
              distance: Math.hypot(
                worldPoint[0] - this.raycaster.origin[0],
                worldPoint[1] - this.raycaster.origin[1],
                worldPoint[2] - this.raycaster.origin[2]
              )
            });
          }
          return hits.sort((a2, b2) => a2.distance - b2.distance);
        },
        _onTerrainChange() {
          if (!this._map) return;
          for (const area of this._areas.values()) this._releaseArea(area);
          this._areas.clear();
          this._updateArea();
        },
        /** Low-poly tree, sharing the source block's buffers, picking and terrain offset. */
        _treeGeometry(point, style, addTriangle) {
          const { top, bottom = 0, trunkRadius, crownRadius, crownBottom, crownShape = "round" } = style;
          if (![trunkRadius, crownRadius, crownBottom].every(Number.isFinite) || trunkRadius <= 0 || crownRadius < trunkRadius || crownBottom <= bottom || crownBottom >= top || !["round", "cone"].includes(crownShape)) throw new Error("Invalid tree dimensions or crown shape");
          const trunk = this.color(style.trunkColor ?? 7491898);
          const crown = this.color(style.color ?? 5210683);
          const ring = (radius) => Array.from({ length: 8 }, (_, i) => ({
            x: point.x + Math.cos(i * Math.PI / 4) * radius,
            y: point.y + Math.sin(i * Math.PI / 4) * radius,
            ground: point.ground
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
          if (crownShape === "cone") {
            const base = ring(crownRadius);
            for (let i = 0; i < 8; i++) addTriangle(
              point,
              crownBottom,
              base[i],
              crownBottom,
              base[(i + 1) % 8],
              crownBottom,
              0,
              -1,
              0,
              crown
            );
            surface(crownRadius, crownBottom, 0, top, crown);
          } else {
            const profile = [[0, 0], [0.35, 0.8], [0.6, 1], [0.85, 0.7], [1, 0]];
            for (let i = 1; i < profile.length; i++) {
              const [low, lr] = profile[i - 1], [high, hr] = profile[i];
              surface(
                lr * crownRadius,
                crownBottom + low * (top - crownBottom),
                hr * crownRadius,
                crownBottom + high * (top - crownBottom),
                crown
              );
            }
          }
        },
        /** Three crossed emitter discs; illumination itself is evaluated on receiving surfaces. */
        _lightGeometry(point, style, addTriangle) {
          if (!Number.isFinite(style.lightRadius) || style.lightRadius <= 0) throw new Error("Invalid light radius");
          const color = this.color(style.color);
          const quad = (a, b, c, d, height, normal) => {
            addTriangle(a, height, b, height, c, height, ...normal, color);
            addTriangle(a, height, c, height, d, height, ...normal, color);
          };
          const r = 0.65;
          const emitter = (u, v, axis) => ({
            x: point.x + (axis === 2 ? 0 : u * r),
            y: point.y + (axis === 1 ? 0 : axis === 2 ? u * r : v * r),
            ground: point.ground + (axis === 0 ? 0 : v * r),
            uv: [u, v]
          });
          for (let axis = 0; axis < 3; axis++) {
            quad(
              emitter(-1, -1, axis),
              emitter(1, -1, axis),
              emitter(1, 1, axis),
              emitter(-1, 1, axis),
              style.top,
              axis === 0 ? [0, 1, 0] : axis === 1 ? [0, 0, 1] : [1, 0, 0]
            );
          }
        },
        /** Schematic support and lamp head; wall-mounted fixtures do not get an invented pole. */
        _lampPostGeometry(point, style, addTriangle) {
          const color = this.color(5264986), radius = style.poleRadius;
          if (!Number.isFinite(radius) || radius <= 0) throw new Error("Invalid lamp pole radius");
          const ring = (r) => Array.from({ length: 6 }, (_, i) => ({
            x: point.x + Math.cos(i * Math.PI / 3) * r,
            y: point.y + Math.sin(i * Math.PI / 3) * r,
            ground: point.ground,
            uv: [3, 3]
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
          const wanted = /* @__PURE__ */ new Map();
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
          for (const [key, coords] of [...wanted].sort(([, a], [, b]) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))) {
            if (!this._areas.has(key)) this._areas.set(key, { coords, request: new AbortController() });
          }
          this._pump();
        },
        /** Start at most two load/build tasks; cancelled tasks still free their slot in finally. */
        _pump() {
          if (!this._map || !this._shared) return;
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
                const data = result ? JSON.parse(new TextDecoder().decode(result.data)) : { type: "FeatureCollection", features: [] };
                if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
                  throw new Error("Invalid GeoJSON response");
                }
                const features = data.features;
                const positions = [], normals = [], colors = [], uvs = [], featureFaces = [], lights = [];
                const supports = /* @__PURE__ */ new Set();
                let skipped = 0;
                const map = this._map;
                const crs = map.options.crs;
                const origin = crs.project(this.location);
                const metres = Math.cos(this.location.lat * Math.PI / 180);
                const groundOffset = (point) => point.ground || 0;
                const addTriangle = (a, ah, b, bh, c, ch, nx, ny, nz, color) => {
                  const ux = b.x - a.x, uy = bh - ah, uz = a.y - b.y;
                  const vx = c.x - a.x, vy = ch - ah, vz = a.y - c.y;
                  if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0) {
                    const point = b, height = bh;
                    b = c;
                    bh = ch;
                    c = point;
                    ch = height;
                  }
                  positions.push(
                    a.x,
                    ah + groundOffset(a),
                    -a.y,
                    b.x,
                    bh + groundOffset(b),
                    -b.y,
                    c.x,
                    ch + groundOffset(c),
                    -c.y
                  );
                  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
                  colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
                  if (this.options.nightLight) uvs.push(...a.uv, ...b.uv, ...c.uv);
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
                  const isTree = geometry?.type === "Point";
                  if (this.options.nightLight && !isTree) throw new Error("Night lights require Point geometry");
                  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
                  if (!polygons && !isTree) throw new Error("Unsupported GeoJSON geometry");
                  const [lon, lat] = (isTree ? geometry.coordinates : polygons[0]?.[0]?.[0]) ?? [];
                  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error("Invalid GeoJSON coordinates");
                  const anchor = map.project(new L.LatLng(lat, lon), coords.z);
                  if (Math.floor(anchor.x / 256) !== coords.x || Math.floor(anchor.y / 256) !== coords.y) continue;
                  const style = this.options.featureStyle(feature);
                  if (style === null) {
                    skipped++;
                    continue;
                  }
                  if (!style || typeof style !== "object") throw new Error("featureStyle must return an extrusion style or null");
                  const { top, bottom = 0, color = 14267276 } = style;
                  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < 0 || top <= bottom) {
                    throw new Error("Invalid extrusion heights: expected top > bottom >= 0");
                  }
                  const baseColor = this.color(color);
                  const vertexStart = positions.length / 3;
                  if (isTree) {
                    const point = crs.project(new L.LatLng(lat, lon));
                    const elevation = map._terrain3D?._getElevation([lat, lon]);
                    const projected = {
                      x: (point.x - origin.x) * metres,
                      y: (point.y - origin.y) * metres,
                      ground: Number.isFinite(elevation) && Number.isFinite(this.root.position[1]) ? elevation - this.root.position[1] : 0
                    };
                    if (this.options.nightLight) {
                      if (!Number.isFinite(style.lightFlux) || style.lightFlux <= 0) throw new Error("Invalid light flux");
                      const support = feature.properties?.cod_ouvrag || `${lon},${lat}`;
                      if (style.poleRadius > 0 && !supports.has(support)) {
                        this._lampPostGeometry(projected, style, addTriangle);
                        supports.add(support);
                      }
                      this._lightGeometry(projected, style, addTriangle);
                      lights.push({
                        position: [projected.x, projected.ground + top, -projected.y],
                        radius: Math.hypot(top, style.lightRadius),
                        color: [baseColor.r, baseColor.g, baseColor.b],
                        flux: style.lightFlux
                      });
                    } else this._treeGeometry(projected, style, addTriangle);
                  }
                  for (const rings of polygons || []) {
                    if (!rings.length) throw new Error("Empty GeoJSON polygon");
                    const paths = rings.map((ring) => {
                      if (ring.length < 4) throw new Error("Invalid GeoJSON polygon ring");
                      return ring.slice(0, -1).map(([lng, lat2]) => {
                        if (!Number.isFinite(lng) || !Number.isFinite(lat2)) throw new Error("Invalid GeoJSON coordinates");
                        const point = crs.project(new L.LatLng(lat2, lng));
                        const elevation = this._map._terrain3D?._getElevation([lat2, lng]);
                        return {
                          x: (point.x - origin.x) * metres,
                          y: (point.y - origin.y) * metres,
                          ground: Number.isFinite(elevation) && Number.isFinite(this.root.position[1]) ? elevation - this.root.position[1] : 0
                        };
                      });
                    });
                    const points = paths.flat();
                    for (const [a, b, c] of this.triangulate(paths[0], paths.slice(1))) {
                      addTriangle(points[a], top, points[b], top, points[c], top, 0, 1, 0, baseColor);
                      if (bottom > 0) addTriangle(points[a], bottom, points[b], bottom, points[c], bottom, 0, -1, 0, baseColor);
                    }
                    paths.forEach((path, index) => {
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
                    properties: feature.properties,
                    baseColor,
                    faceStart: vertexStart / 3,
                    faceEnd: vertexEnd / 3,
                    vertexStart,
                    vertexEnd
                  });
                }
                if (!positions.length) {
                  Object.assign(area, { mesh: null, buildings: 0, skipped, done: true });
                  return;
                }
                const device = this.renderer.device;
                const attributes = {
                  position: { size: 3, data: new Float32Array(positions) },
                  normal: { size: 3, data: new Float32Array(normals) },
                  color: { size: 3, data: new Float32Array(colors) }
                };
                if (this.options.nightLight) attributes.uv = { size: 2, data: new Float32Array(uvs) };
                for (const [name, attribute] of Object.entries(attributes)) {
                  attribute.count = attribute.data.length / attribute.size;
                  attribute.buffer = device.createBuffer({
                    size: Math.max(4, attribute.data.byteLength),
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                  });
                  device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
                }
                const meshGeometry = {
                  device,
                  attributes,
                  drawRange: { start: 0, count: attributes.position.count }
                };
                Object.assign(area, {
                  mesh: {
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    children: [],
                    visible: true,
                    device,
                    geometry: meshGeometry,
                    program: this._createProgram({
                      vertexColors: true,
                      roofTexture: Boolean(this.options.roofTexture),
                      ...this.options.nightLight ? { nightLight: true, alphaMode: "BLEND", doubleSided: true } : {}
                    }),
                    id: L.Layer.types["3d"]._nextId++,
                    renderOrder: 0,
                    extras: { featureFaces, lights }
                  },
                  buildings: featureFaces.length,
                  skipped,
                  done: true
                });
                this.add(area.mesh);
              } catch (error) {
                if (area.request.signal.aborted) return;
                area.error = error.message;
                this.fire("error", { error });
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
          this.fire("progress", progress);
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
                  id: this.model.id,
                  properties: this.model.extras,
                  model: this.model,
                  mesh: hit.object,
                  point: hit.point
                };
              }
            }
            const ranges = hit.object.extras?.featureFaces;
            if (!ranges) continue;
            let low = 0, high = ranges.length - 1;
            while (low <= high) {
              const middle = low + high >> 1;
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
          if (this.highlightedFeature?.mesh === feature?.mesh && this.highlightedFeature?.vertexStart === feature?.vertexStart) return;
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
            const visible = [...shared._layers].some((layer) => layer._tooltip && !layer._tooltip.hidden);
            if (visible) {
              if (shared._cursor === void 0) shared._cursor = this.container.style.cursor;
              this.container.style.cursor = "pointer";
            } else if (shared._cursor !== void 0) {
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
          this.fire("featurehover", { feature: this.hoveredFeature, originalEvent: event });
        },
        /** Emit click without moving the map or pinning the tooltip. */
        _onClick(event) {
          const feature = this._findFeature(event);
          this.hoveredFeature = feature;
          this._setHighlight(feature);
          this._showFeature(feature, event);
          this.fire("featureclick", { feature, originalEvent: event });
        },
        /** Clear hover, highlight and tooltip without retaining a selected feature. */
        _onPointerLeave() {
          this.hoveredFeature = null;
          this._setHighlight(null);
          this._showFeature(null);
          this.fire("featurehover", { feature: null });
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
          this._map.eachLayer((layer) => {
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
            this._zoomTransitions ||= /* @__PURE__ */ new Map();
            const now = performance.now();
            for (const animation of map.getContainer().getAnimations({ subtree: true })) {
              if (!(animation instanceof CSSTransition) || animation.transitionProperty !== "transform" || !animation.effect.target.classList.contains("leaflet-zoom-animated") || this._zoomTransitions.has(animation)) {
                continue;
              }
              const time = animation.currentTime || 0;
              animation.pause();
              this._zoomTransitions.set(animation, { start: now, time });
            }
            for (const [animation, { start, time }] of this._zoomTransitions) {
              animation.currentTime = Math.min(animation.effect.getComputedTiming().endTime, time + now - start);
            }
          }
          if (!this._size || !this._size.equals(size)) {
            this.renderer.width = size.x;
            this.renderer.height = size.y;
            this.renderer.canvas.width = Math.round(size.x * this.renderer.dpr);
            this.renderer.canvas.height = Math.round(size.y * this.renderer.dpr);
            this.renderer.canvas.style.width = `${size.x}px`;
            this.renderer.canvas.style.height = `${size.y}px`;
            if (this.renderer.depthTexture) this._destroyTexture(this.renderer.depthTexture);
            this.renderer.depthTexture = this.renderer.device.createTexture({
              size: [this.renderer.canvas.width, this.renderer.canvas.height],
              format: "depth24plus",
              usage: GPUTextureUsage.RENDER_ATTACHMENT
            });
            this._size = size;
          }
          let pixelsPerMeter = map.options.crs.scale(map.getZoom()) / (4007501668557849e-8 * Math.cos(this._sceneOrigin.lat * Math.PI / 180));
          let origin = map.project(this._sceneOrigin).subtract(map.getPixelOrigin());
          const level = this._zoomLevel?.el.isConnected ? this._zoomLevel : this._getTileLevel();
          if (level && map._animatingZoom) {
            this._zoomLevel = level;
          }
          if (level) {
            const transform = new DOMMatrix(map._animatingZoom ? getComputedStyle(level.el).transform : level.el.style.transform);
            const point = map.project(this._sceneOrigin, level.zoom).subtract(level.origin);
            origin = new L.Point(point.x * transform.a + transform.e, point.y * transform.d + transform.f);
            pixelsPerMeter *= map.getZoomScale(level.zoom, map.getZoom()) * transform.a;
          }
          const distance = size.y * 1.5 / pixelsPerMeter;
          const center = map.containerPointToLayerPoint(size.divideBy(2));
          const target = [
            (center.x - origin.x) / pixelsPerMeter,
            map._terrain3D?._getElevation(map.getCenter()) ?? 0,
            (center.y - origin.y) / pixelsPerMeter
          ];
          const pitch = map.getPitch() * Math.PI / 180;
          const bearing = map.getBearing() * Math.PI / 180;
          const camera = this.camera;
          camera.fov = 2 * Math.atan(1 / 3) * 180 / Math.PI;
          camera.aspect = size.x / size.y;
          camera.near = Math.max(0.1, distance / 1e4);
          camera.far = Math.max(1e4, distance * 10);
          camera.position[0] = target[0] + Math.sin(bearing) * Math.sin(pitch) * distance;
          camera.position[1] = target[1] + Math.cos(pitch) * distance;
          camera.position[2] = target[2] + Math.cos(bearing) * Math.sin(pitch) * distance;
          camera.up[0] = -Math.sin(bearing) * Math.cos(pitch);
          camera.up[1] = Math.sin(pitch);
          camera.up[2] = -Math.cos(bearing) * Math.cos(pitch);
          camera.target[0] = target[0];
          camera.target[1] = target[1];
          camera.target[2] = target[2];
          this._updateCamera(camera);
          const sunlight = map._sunlight;
          const lightPoint = new DOMPoint(...sunlight?.direction || [-300, 500, 300], 0).matrixTransform(new DOMMatrix(camera.viewMatrix));
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
            [projection[3] - projection[2], projection[7] - projection[6], projection[11] - projection[10], projection[15] - projection[14]]
          ];
          const frustumLengths = [
            Math.hypot(frustum[0][0], frustum[0][1], frustum[0][2]),
            Math.hypot(frustum[1][0], frustum[1][1], frustum[1][2]),
            Math.hypot(frustum[2][0], frustum[2][1], frustum[2][2]),
            Math.hypot(frustum[3][0], frustum[3][1], frustum[3][2]),
            Math.hypot(frustum[4][0], frustum[4][1], frustum[4][2]),
            Math.hypot(frustum[5][0], frustum[5][1], frustum[5][2])
          ];
          this._updateWorldMatrix(this.scene);
          this.traverse(this.scene, (mesh) => {
            if (!mesh.visible) return true;
            if (mesh.geometry) {
              if (!mesh.geometry.bounds) this._computeBounds(mesh.geometry);
              const bounds = mesh.geometry.bounds;
              const world = mesh.worldMatrix;
              const center2 = bounds.center;
              const x = world[0] * center2[0] + world[4] * center2[1] + world[8] * center2[2] + world[12];
              const y = world[1] * center2[0] + world[5] * center2[1] + world[9] * center2[2] + world[13];
              const z = world[2] * center2[0] + world[6] * center2[1] + world[10] * center2[2] + world[14];
              const radius = bounds.radius * Math.max(
                Math.hypot(world[0], world[1], world[2]),
                Math.hypot(world[4], world[5], world[6]),
                Math.hypot(world[8], world[9], world[10])
              );
              mesh._visibleInFrame = frustum[0][0] * x + frustum[0][1] * y + frustum[0][2] * z + frustum[0][3] >= -radius * frustumLengths[0] && frustum[1][0] * x + frustum[1][1] * y + frustum[1][2] * z + frustum[1][3] >= -radius * frustumLengths[1] && frustum[2][0] * x + frustum[2][1] * y + frustum[2][2] * z + frustum[2][3] >= -radius * frustumLengths[2] && frustum[3][0] * x + frustum[3][1] * y + frustum[3][2] * z + frustum[3][3] >= -radius * frustumLengths[3] && frustum[4][0] * x + frustum[4][1] * y + frustum[4][2] * z + frustum[4][3] >= -radius * frustumLengths[4] && frustum[5][0] * x + frustum[5][1] * y + frustum[5][2] * z + frustum[5][3] >= -radius * frustumLengths[5];
              if (!mesh._visibleInFrame) return;
            }
            if (mesh.program?.transparent) {
              if (!mesh.geometry.bounds) this._computeBounds(mesh.geometry);
              const center2 = mesh.geometry.bounds.center, world = mesh.worldMatrix;
              const x = world[0] * center2[0] + world[4] * center2[1] + world[8] * center2[2] + world[12];
              const y = world[1] * center2[0] + world[5] * center2[1] + world[9] * center2[2] + world[13];
              const z = world[2] * center2[0] + world[6] * center2[1] + world[10] * center2[2] + world[14];
              const projection2 = camera.projectionViewMatrix;
              const clipZ = projection2[2] * x + projection2[6] * y + projection2[10] * z + projection2[14];
              const clipW = projection2[3] * x + projection2[7] * y + projection2[11] * z + projection2[15];
              mesh._sortDepth = clipZ / clipW;
            }
          });
          const renderer = this.renderer;
          if ([...this._layers].some((layer) => layer.options.roofTexture)) {
            const rasters = Object.values(map._layers).filter((layer) => layer instanceof L.Layer.types.pmtiles && layer._tiles && layer.options.opacity > 0);
            const tiles = rasters.flatMap((layer) => Object.values(layer._tiles).filter((tile) => tile.el.done && !tile.el.request.signal.aborted && tile.el.isConnected).map((tile) => ({ ...tile, layer })));
            const signature = tiles.map(({ el, coords, layer }) => `${L.Util.stamp(el)}:${coords.z}:${coords.x}:${coords.y}:${layer.options.opacity}:${layer.options.zIndex}`).join("|");
            const selection = rasters.map((layer) => `${L.Util.stamp(layer)}:${layer.options.opacity}:${layer.options.zIndex}`).join("|");
            if (!this._roofRaster || this._roofRaster.selection !== selection || !rasters.some((layer) => layer.isLoading()) && this._roofRaster.signature !== signature) {
              const zoom = tiles.length ? Math.max(...tiles.map((tile) => tile.coords.z)) : map.getZoom();
              const bounds = new L.Bounds();
              for (const { coords, layer } of tiles) {
                const size3 = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
                bounds.extend(new L.Point(coords.x, coords.y).scaleBy(size3));
                bounds.extend(new L.Point(coords.x + 1, coords.y + 1).scaleBy(size3));
              }
              const min = bounds.min || map.project(this._sceneOrigin, zoom);
              const size2 = bounds.isValid() ? bounds.getSize() : new L.Point(1, 1);
              const limit = 4096;
              const scale = Math.min(1, limit / Math.max(size2.x, size2.y));
              const width = Math.max(1, Math.ceil(size2.x * scale));
              const height = Math.max(1, Math.ceil(size2.y * scale));
              const origin2 = map.project(this._sceneOrigin, zoom);
              const pixels = map.options.crs.scale(zoom) / (4007501668557849e-8 * Math.cos(this._sceneOrigin.lat * Math.PI / 180));
              const matrix = new DOMMatrix();
              matrix.m11 = pixels / size2.x;
              matrix.m33 = pixels / size2.y;
              matrix.m41 = (origin2.x - min.x) / size2.x;
              matrix.m43 = (origin2.y - min.y) / size2.y;
              const texture = this._roofRaster?.texture;
              if (texture && (texture.width !== width || texture.height !== height)) {
                this._destroyTexture(texture.texture);
                texture.texture = renderer.device.createTexture({
                  size: [width, height],
                  format: "rgba8unorm",
                  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                });
                texture.width = width;
                texture.height = height;
              }
              this._roofRaster = {
                signature,
                selection,
                matrix: Array.from(matrix.toFloat64Array()),
                texture: texture || {
                  device: renderer.device,
                  texture: renderer.device.createTexture({
                    size: [width, height],
                    format: "rgba8unorm",
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                  }),
                  sampler: renderer.device.createSampler({
                    addressModeU: "clamp-to-edge",
                    addressModeV: "clamp-to-edge"
                  }),
                  samplerOptions: { addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
                  image: null,
                  width,
                  height,
                  format: "rgba8unorm",
                  srgb: false,
                  flipY: false,
                  uploaded: null
                }
              };
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
                    layout: "auto",
                    vertex: { module, entryPoint: "vertexMain" },
                    fragment: {
                      module,
                      entryPoint: "fragmentMain",
                      targets: [{
                        format: "rgba8unorm",
                        blend: {
                          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
                        }
                      }]
                    },
                    primitive: { topology: "triangle-strip" }
                  }),
                  sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" })
                };
              }
              const roofTiles = this._roofTiles ||= /* @__PURE__ */ new Map();
              for (const [el, source] of roofTiles) {
                if (!tiles.some((tile) => tile.el === el) || map._terrain3D?._rasterTiles.has(el)) {
                  source.texture.destroy();
                  roofTiles.delete(el);
                }
              }
              const opacities = new Float32Array(Math.max(1, tiles.length) * 64);
              const opacityBuffer = device.createBuffer({
                size: opacities.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
              });
              const encoder2 = device.createCommandEncoder();
              const atlasPass = encoder2.beginRenderPass({
                colorAttachments: [{
                  view: this._roofRaster.texture.texture.createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  loadOp: "clear",
                  storeOp: "store"
                }]
              });
              atlasPass.setPipeline(renderer.roofBlit.pipeline);
              tiles.sort((a, b) => (a.layer.options.zIndex || 0) - (b.layer.options.zIndex || 0) || a.coords.z - b.coords.z);
              for (const [i, { coords, el, layer }] of tiles.entries()) {
                let source = map._terrain3D?._rasterTiles.get(el)?.texture || roofTiles.get(el);
                if (!source) {
                  source = {
                    texture: device.createTexture({
                      size: [el.naturalWidth, el.naturalHeight],
                      format: "rgba8unorm",
                      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                    }),
                    image: el,
                    uploaded: null
                  };
                  roofTiles.set(el, source);
                }
                if (source.uploaded !== source.image) {
                  device.queue.copyExternalImageToTexture(
                    { source: el },
                    { texture: source.texture },
                    [source.texture.width, source.texture.height]
                  );
                  source.uploaded = source.image;
                }
                opacities[i * 64] = layer.options.opacity;
                const tileSize = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
                const offset = new L.Point(coords.x, coords.y).scaleBy(tileSize).subtract(min);
                const x = offset.x * width / size2.x, y = offset.y * height / size2.y;
                atlasPass.setViewport(
                  x,
                  y,
                  Math.min(tileSize.x * width / size2.x, width - x),
                  Math.min(tileSize.y * height / size2.y, height - y),
                  0,
                  1
                );
                atlasPass.setBindGroup(0, device.createBindGroup({
                  layout: renderer.roofBlit.pipeline.getBindGroupLayout(0),
                  entries: [
                    { binding: 0, resource: source.texture.createView() },
                    { binding: 1, resource: renderer.roofBlit.sampler },
                    { binding: 2, resource: { buffer: opacityBuffer, offset: i * 256, size: 4 } }
                  ]
                }));
                atlasPass.draw(4);
              }
              atlasPass.end();
              device.queue.writeBuffer(opacityBuffer, 0, opacities);
              device.queue.submit([encoder2.finish()]);
              opacityBuffer.destroy();
            }
          } else if (this._roofRaster) {
            this._destroyTexture(this._roofRaster.texture.texture);
            this._roofRaster = null;
            for (const source of this._roofTiles?.values() || []) source.texture.destroy();
            this._roofTiles = null;
          }
          const meshes = [];
          this.traverse(this.scene, (mesh) => {
            if (!mesh.visible) return true;
            if (mesh.geometry && mesh._visibleInFrame) meshes.push(mesh);
          });
          meshes.sort(
            (a, b) => Number(a.program.transparent) - Number(b.program.transparent) || (a.program.transparent ? (a.renderOrder || 0) - (b.renderOrder || 0) || b._sortDepth - a._sortDepth || a.id - b.id : a.id - b.id)
          );
          const encoder = renderer.device.createCommandEncoder();
          const pendingRasterTiles = [];
          const shadowMeshes = [];
          if (sunlight?.altitude >= 3) {
            for (const layer of this._layers) {
              if (layer instanceof L.Layer.types.terrain) continue;
              this.traverse(layer.root, (mesh) => {
                if (!mesh.visible) return true;
                if (mesh.geometry && !mesh.tile && !mesh.program.nightLight && mesh.program.depthTest !== false) shadowMeshes.push(mesh);
              });
            }
          }
          if (!renderer.uniformBuffer || renderer.uniformBuffer.size < (meshes.length * 2 + shadowMeshes.length + 1) * 256) {
            if (renderer.uniformBuffer) this._destroyTexture(renderer.uniformBuffer);
            renderer.uniformBuffer = renderer.device.createBuffer({
              size: Math.max(64, meshes.length * 4 + shadowMeshes.length * 2) * 256,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            renderer.uniformData = new Float32Array(renderer.uniformBuffer.size / 4);
          }
          const frameData = renderer.uniformData;
          frameData.set(camera.viewMatrix, 0);
          frameData.set(camera.projectionMatrix, 16);
          frameData.set(this._roofRaster?.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 32);
          frameData.set(light, 48);
          frameData[51] = sunlight && sunlight.altitude <= 0 ? 0 : 1;
          frameData.set(sky, 52);
          const night = sunlight ? Math.max(0, Math.min(1, (3 - sunlight.altitude) / 9)) : 0;
          frameData[55] = night * night * (3 - 2 * night);
          frameData.set(sunlight?.tint || [1, 1, 1], 56);
          frameData[59] = 0;
          if (night > 0) this._updatePointLights();
          renderer.uniformSlot = 1;
          this._renderSunlight(encoder, shadowMeshes, sunlight);
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: renderer.context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store"
            }],
            depthStencilAttachment: {
              view: renderer.depthTexture.createView(),
              depthClearValue: 1,
              depthLoadOp: "clear",
              depthStoreOp: "store"
            }
          });
          pass.setViewport(0, 0, renderer.canvas.width, renderer.canvas.height, 0, 1);
          pass.setBindGroup(1, renderer.sunlight.bindGroup);
          for (const mesh of meshes) {
            if (mesh.tile && mesh.tile.style.visibility !== "hidden") pendingRasterTiles.push(mesh.tile);
            const world = mesh.worldMatrix;
            if (mesh.texture) {
              mesh.program.uniforms.baseTexture.value = mesh.texture;
              mesh.program.uniforms.opacity.value = mesh.opacity;
            }
            const uniforms = mesh.program.uniforms;
            if (uniforms.roofTexture) uniforms.roofTexture.value = this._roofRaster?.texture || renderer.roofFallbackTexture;
            const determinant = world[0] * (world[5] * world[10] - world[6] * world[9]) - world[4] * (world[1] * world[10] - world[2] * world[9]) + world[8] * (world[1] * world[6] - world[2] * world[5]);
            if (!Number.isFinite(determinant) || determinant === 0) {
              throw new Error("Singular 3D transform");
            }
            const frontFace = determinant < 0 ? "cw" : "ccw";
            const program = mesh.program;
            if (program.transparent && program._layerMaterial.doubleSided) {
              this._drawGeometry(mesh, pass, "front", frontFace);
              this._drawGeometry(mesh, pass, "back", frontFace);
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
                if (tile.isConnected && tile._terrainVisibility !== void 0) tile.style.visibility = "hidden";
              }
            }, (error) => {
              for (const layer of this._layers || []) layer.fire("error", { error });
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
          let changed = node._worldParent !== parent || node._parentWorldVersion !== parentVersion || node._worldMatrixMode !== matrixMode;
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
            matrix.rotateAxisAngleSelf(0, 1, 0, node.rotation[1] * degrees);
            matrix.rotateAxisAngleSelf(1, 0, 0, node.rotation[0] * degrees);
            matrix.rotateAxisAngleSelf(0, 0, 1, node.rotation[2] * degrees);
            local = matrix.scale(...node.scale).toFloat64Array();
          }
          const world = parent ? new DOMMatrix(parent.worldMatrix).multiply(new DOMMatrix(local)).toFloat64Array() : local;
          for (let i = 0; i < 16; i++) node.worldMatrix[i] = world[i];
          node._worldParent = parent;
          node._parentWorldVersion = parentVersion;
          node._worldMatrixMode = matrixMode;
          node._worldMatrixVersion = (node._worldMatrixVersion || 0) + 1;
          for (const child of node.children) this._updateWorldMatrix(child);
        },
        /** Orthonormal view basis plus perspective matrices, refreshed before projecting/drawing. */
        _updateCamera(camera) {
          const z = camera.position.map((v, i) => v - camera.target[i]);
          const zLength = Math.hypot(...z) || 1;
          const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
            throw new Error("Singular 3D transform");
          }
          for (let i = 0; i < 16; i++) {
            camera.viewMatrix[i] = view[i];
          }
          const f = 1 / Math.tan(camera.fov * Math.PI / 360), n = camera.near, r = camera.far;
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
          const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], data = geometry.attributes.position.data;
          for (let i = 0; i < data.length; i++) {
            min[i % 3] = Math.min(min[i % 3], data[i]);
            max[i % 3] = Math.max(max[i % 3], data[i]);
          }
          const center = min.map((v, i) => (v + max[i]) / 2);
          let radius = 0;
          for (let i = 0; i < data.length; i += 3) {
            radius = Math.max(radius, Math.hypot(
              data[i] - center[0],
              data[i + 1] - center[1],
              data[i + 2] - center[2]
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
                entryPoint: "vertexMain",
                buffers: program.vertexBuffers
              },
              fragment: {
                module: program.fragment,
                entryPoint: "fragmentMain",
                targets: [{
                  format: this.renderer.format,
                  blend: program.transparent ? {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
                  } : void 0,
                  writeMask: GPUColorWrite.ALL
                }]
              },
              primitive: { topology: "triangle-list", cullMode, frontFace },
              depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: program.depthWrite,
                depthCompare: program.depthTest === false ? "always" : "less-equal"
              }
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
          data[base + 34] = program.nightSparkle ? data[55] : 0;
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
                [texture.image.width, texture.image.height]
              );
              texture.uploaded = texture.image;
            }
            textures.push(texture);
          }
          let bindingsChanged = !mesh.bindGroup || mesh.boundBuffer !== renderer.uniformBuffer || textures.length !== mesh.boundTextures.length;
          for (let i = 0; !bindingsChanged && i < textures.length; i++) {
            if (textures[i].texture !== mesh.boundTextures[i][0] || textures[i].sampler !== mesh.boundTextures[i][1]) bindingsChanged = true;
          }
          if (bindingsChanged) {
            const entries = [
              { binding: 0, resource: { buffer: renderer.uniformBuffer, size: 144 } },
              { binding: 1, resource: { buffer: renderer.uniformBuffer, size: 240 } }
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
              entries
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
        }
      });
      L.Layer.types["3d"]._nextId = 0;
    }
  });

  // src/layer/3d/utils/seine.js
  function cruisePosition(progress) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error("Invalid cruise progress");
    const travelled = progress * cruiseDistance;
    const end = lengths.findIndex((length, i2) => i2 > 0 && length >= travelled);
    const i = end < 0 ? lengths.length - 1 : end;
    const a = cruiseRoute[i - 1], b = cruiseRoute[i];
    const t = (travelled - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
    return {
      lat: a[0] + (b[0] - a[0]) * t,
      lng: a[1] + (b[1] - a[1]) * t,
      heading: Math.atan2((b[1] - a[1]) * Math.cos(a[0] * radians), b[0] - a[0]) / radians
    };
  }
  function scheduledCruises(date) {
    const time = new Date(date);
    if (!Number.isFinite(time.getTime())) throw new Error("Invalid cruise date");
    const parisClock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const parts = Object.fromEntries(parisClock.formatToParts(time).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
    const minute = parts.hour * 60 + parts.minute + (parts.second + time.getUTCMilliseconds() / 1e3) / 60;
    const summer = parts.month >= 4 && parts.month <= 10;
    const departures = [];
    for (let departure = summer ? 600 : 615; departure <= 1290; departure += summer ? 30 : 45) departures.push(departure);
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    if (parts.month === 10 && weekday === 6) departures.push(1320);
    return departures.filter((departure) => minute >= departure && minute < departure + 60).map((departure) => {
      const progress = (minute - departure) / 60;
      return {
        id: `${parts.year}-${parts.month}-${parts.day}-${departure}`,
        departure: `${String(Math.floor(departure / 60)).padStart(2, "0")}:${String(departure % 60).padStart(2, "0")}`,
        progress,
        ...cruisePosition(progress)
      };
    });
  }
  var upstream, leftBankReturn, downstream, cruiseRoute, radians, lengths, cruiseDistance;
  var init_seine = __esm({
    "src/layer/3d/utils/seine.js"() {
      upstream = [
        [48.86353, 2.30491],
        [48.86357, 2.30714],
        [48.86361, 2.30998],
        [48.86367, 2.31351],
        [48.8638, 2.31663],
        [48.86297, 2.32096],
        [48.86211, 2.32394],
        [48.86123, 2.32681],
        [48.86027, 2.32945],
        [48.85944, 2.3325],
        [48.85879, 2.3354],
        [48.85845, 2.33764],
        [48.85817, 2.34005],
        [48.85776, 2.34209],
        [48.85727, 2.34441],
        [48.85663, 2.34684],
        [48.85593, 2.34921],
        [48.85485, 2.35176],
        [48.85399, 2.3538],
        [48.8532, 2.35613],
        [48.85224, 2.35892],
        [48.85103, 2.36054],
        [48.84936, 2.36056],
        [48.84972, 2.35852]
      ];
      leftBankReturn = [
        [48.85047, 2.35617],
        [48.85139, 2.35351],
        [48.8518, 2.35084],
        [48.85229, 2.34926],
        [48.853, 2.34759],
        [48.85385, 2.34526],
        [48.85487, 2.3429],
        [48.85654, 2.34087],
        [48.85747, 2.33894],
        [48.85815, 2.3373]
      ];
      downstream = [
        [48.86349, 2.30143],
        [48.86284, 2.29846],
        [48.86185, 2.29576],
        [48.86036, 2.29281],
        [48.85877, 2.29052],
        [48.85708, 2.28871],
        [48.85601, 2.28786],
        [48.85575, 2.28735],
        [48.85575, 2.28699],
        [48.85595, 2.28695],
        [48.85617, 2.28734]
      ];
      cruiseRoute = [
        ...upstream,
        ...leftBankReturn,
        ...upstream.slice(0, 11).reverse().map(([lat, lng]) => [lat - 2e-4, lng]),
        ...downstream,
        ...downstream.slice(0, 6).reverse().map(([lat, lng]) => [lat + 25e-5, lng - 25e-5]),
        [48.86365, 2.302],
        [48.86365, 2.3035],
        upstream[0]
      ];
      radians = Math.PI / 180;
      lengths = [0];
      for (let i = 1; i < cruiseRoute.length; i++) {
        const a = cruiseRoute[i - 1], b = cruiseRoute[i];
        const latitude = (b[0] - a[0]) * radians / 2;
        const longitude = (b[1] - a[1]) * radians / 2;
        const haversine = Math.sin(latitude) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(longitude) ** 2;
        lengths.push(lengths[i - 1] + 6371e3 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine))));
      }
      cruiseDistance = lengths.at(-1);
    }
  });

  // src/layer/3d/types/cruises.js
  var cruises_exports = {};
  function installCruiseBoats(layer) {
    const clock = () => {
      let control = {};
      layer._map?.eachLayer((other) => {
        if (other.control?.time) control = other.control;
      });
      return control;
    };
    const L2 = globalThis.L;
    const status = L2.DomUtil.create("small", "cruise-status");
    status.style.display = "block";
    status.title = "Bateaux-Mouches sightseeing timetable, Europe/Paris. Approximate route and 60-minute duration; no holiday extras, cancellations, GPS or river-level changes.";
    let ready = false, timer, route, clockAvailable = true;
    const boats = /* @__PURE__ */ new Map();
    const createMesh = (data, featureFaces = [], material = {}) => {
      const { device } = layer.renderer, attributes = {};
      for (const [name, values] of Object.entries(data)) {
        const array = new Float32Array(values);
        const buffer = device.createBuffer({ size: array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buffer, 0, array);
        attributes[name] = { size: 3, data: array, count: array.length / 3, buffer };
      }
      const mesh = {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        worldMatrix: Array.from(new DOMMatrix().toFloat64Array()),
        children: [],
        visible: true,
        device,
        geometry: { device, attributes, drawRange: { start: 0, count: attributes.position.count } },
        program: layer._createProgram({ vertexColors: true, doubleSided: true, ...material }),
        id: L2.Layer.types["3d"]._nextId++,
        renderOrder: 0,
        extras: { featureFaces }
      };
      layer.add(mesh);
      return mesh;
    };
    const fail = (error) => {
      clearInterval(timer);
      timer = void 0;
      status.textContent = `Cruise error: ${error.message}`;
      status.setAttribute("role", "alert");
      console.error("Seine cruises", error);
    };
    const update = (event) => {
      if (!ready || !layer._map || !layer.renderer) return;
      try {
        if (event?.type === "simulationtimechange") clockAvailable = event.time !== null;
        const valid = clockAvailable && Number.isFinite(clock().time?.getTime());
        if (valid && clock().live && !timer) timer = setInterval(update, 250);
        else if (!valid || !clock().live) {
          clearInterval(timer);
          timer = void 0;
        }
        const trips = valid ? scheduledCruises(clock().live ? /* @__PURE__ */ new Date() : clock().time) : [];
        let changed = false;
        const active = new Set(trips.map((trip) => trip.id));
        for (const [id, mesh] of boats) if (!active.has(id)) {
          dispose(mesh);
          boats.delete(id);
          changed = true;
        }
        const crs = layer._map.options.crs, origin = crs.project(layer.location);
        const metres = Math.cos(layer.location.lat * radians);
        if (!route) {
          const position = [], normal = [], color = [];
          for (let i = 1; i < cruiseRoute.length; i++) {
            const project = ([lat, lng]) => {
              const point = crs.project(new L2.LatLng(lat, lng));
              return [(point.x - origin.x) * metres, -(point.y - origin.y) * metres];
            };
            const a = project(cruiseRoute[i - 1]), b = project(cruiseRoute[i]);
            const dx = b[0] - a[0], dz = b[1] - a[1], length = lengths[i] - lengths[i - 1];
            const width = Math.hypot(dx, dz), x = -dz / width * 2.5, z = dx / width * 2.5;
            for (let distance = Math.floor(lengths[i - 1] / 30) * 30; distance < lengths[i]; distance += 30) {
              const start2 = Math.max(0, (distance - lengths[i - 1]) / length);
              const end = Math.min(1, (distance + 18 - lengths[i - 1]) / length);
              if (end <= start2) continue;
              const p = [a[0] + dx * start2, a[1] + dz * start2], q = [a[0] + dx * end, a[1] + dz * end];
              for (const point of [
                [p[0] - x, p[1] - z],
                [p[0] + x, p[1] + z],
                [q[0] + x, q[1] + z],
                [p[0] - x, p[1] - z],
                [q[0] + x, q[1] + z],
                [q[0] - x, q[1] - z]
              ]) {
                position.push(point[0], 0, point[1]);
                normal.push(0, 1, 0);
                color.push(0.08, 0.7, 0.85);
              }
            }
          }
          route = createMesh({ position, normal, color }, [], { emissive: [0.03, 0.25, 0.3], alphaMode: "BLEND", depthTest: false });
          route.renderOrder = 1e3;
          changed = true;
        }
        const waterSurface = 27.15;
        const surface = waterSurface - layer.root.position[1];
        changed ||= route.position[1] !== surface + 0.03 || !route.visible;
        route.position[1] = surface + 0.03;
        route.visible = true;
        for (const trip of trips) {
          let mesh = boats.get(trip.id);
          if (!mesh) {
            const position2 = [], normal = [], color = [];
            const triangle = (a, b, c, tint) => {
              const u = b.map((v2, i) => v2 - a[i]), v = c.map((value, i) => value - a[i]);
              const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
              const length = Math.hypot(...n);
              for (const point2 of [a, b, c]) {
                position2.push(...point2);
                normal.push(...n.map((value) => value / length));
                color.push(...tint);
              }
            };
            const solid = (ring, bottom, top, tint) => {
              for (let i = 0; i < ring.length; i++) {
                const a = [ring[i][0], bottom, ring[i][1]], b = [ring[(i + 1) % ring.length][0], bottom, ring[(i + 1) % ring.length][1]];
                const c = [b[0], top, b[2]], d = [a[0], top, a[2]];
                triangle(a, b, c, tint);
                triangle(a, c, d, tint);
                triangle([0, top, 0], d, c, tint);
                triangle([0, bottom, 0], b, a, tint);
              }
            };
            solid([[-4.5, 16], [4.5, 16], [4.5, -12], [2, -18], [-2, -18], [-4.5, -12]], 0.1, 1.2, [0.83, 0.87, 0.89]);
            solid([[-3.4, 10], [3.4, 10], [3.4, -10], [-3.4, -10]], 1.2, 2.5, [0.16, 0.35, 0.43]);
            solid([[-3.7, 11], [3.7, 11], [3.7, -11], [-3.7, -11]], 2.5, 2.7, [0.93, 0.94, 0.9]);
            for (const x of [-3.6, 3.6]) solid([[x - 0.15, 13], [x + 0.15, 13], [x + 0.15, -12], [x - 0.15, -12]], 1.2, 1.8, [0.75, 0.15, 0.12]);
            const data = { position: position2, normal, color }, count = position2.length / 3;
            mesh = createMesh(data, [{ id: trip.id, properties: trip, faceStart: 0, faceEnd: count / 3, vertexStart: 0, vertexEnd: count }]);
            boats.set(trip.id, mesh);
            changed = true;
          }
          changed ||= !mesh.visible;
          mesh.visible = true;
          mesh.extras.featureFaces[0].properties = trip;
          const point = crs.project(new L2.LatLng(trip.lat, trip.lng));
          const position = [(point.x - origin.x) * metres, surface, -(point.y - origin.y) * metres];
          const heading = -trip.heading * radians;
          changed ||= mesh.position.some((value, i) => value !== position[i]) || mesh.rotation[1] !== heading;
          mesh.position = position;
          mesh.rotation[1] = heading;
        }
        status.removeAttribute("role");
        status.textContent = !valid ? "Cruises: select a valid simulation date" : trips.length ? `Cruises: ${trips.length} underway \xB7 estimated, not live GPS` : "Cruises: outside published service hours";
        if (changed) layer.update();
      } catch (error) {
        for (const mesh of boats.values()) mesh.visible = false;
        clearInterval(timer);
        timer = void 0;
        layer.update();
        fail(error);
      }
    };
    const dispose = (mesh) => {
      if (layer.highlightedFeature?.mesh === mesh) {
        layer._setHighlight(null);
        layer.hoveredFeature = null;
        layer._showFeature(null);
      }
      layer.remove(mesh);
      for (const attribute of Object.values(mesh.geometry.attributes)) attribute.buffer.destroy();
      layer._removeProgram(mesh.program);
    };
    const start = () => {
      layer._map.off("simulationtimechange terrainchange", update);
      layer._map.on("simulationtimechange terrainchange", update);
      layer._map.getContainer().querySelector(".leaflet-control-layers-list")?.append(status);
      if (!layer.renderer && !timer) timer = setInterval(update, 250);
      update();
    };
    layer.on("error", ({ error }) => fail(error));
    layer.on("ready", () => {
      ready = true;
      if (layer._map) start();
    });
    layer.on("add", () => {
      if (ready) start();
    });
    layer.on("remove", () => {
      clearInterval(timer);
      timer = void 0;
      layer._map.off("simulationtimechange terrainchange", update);
      for (const mesh of boats.values()) dispose(mesh);
      boats.clear();
      if (route) {
        dispose(route);
        route = null;
      }
      status.textContent = "Cruises: layer off";
    });
  }
  var init_cruises = __esm({
    "src/layer/3d/types/cruises.js"() {
      init_d();
      init_seine();
      L.Layer.types.cruises = L.Layer.types["3d"].extend({
        statics: { cruiseDistance, cruisePosition, cruiseRoute, scheduledCruises },
        initialize(options) {
          L.Layer.types["3d"].prototype.initialize.call(this, {
            center: [48.85826, 2.2945],
            tooltipContent({ properties: p }) {
              const content = document.createElement("div");
              content.style.whiteSpace = "pre-line";
              content.textContent = `Bateaux-Mouches \xB7 sightseeing cruise
Departure ${p.departure} Europe/Paris \xB7 approx. 60 min
Estimated position, not live GPS.
Schematic route/model; no holiday extras, cancellations or river-level changes.`;
              return content;
            },
            ...options
          });
          installCruiseBoats(this);
        }
      });
    }
  });

  // src/layer/3d/types/pmtiles.js
  var pmtiles_exports = {};
  var init_pmtiles = __esm({
    "src/layer/3d/types/pmtiles.js"() {
      init_d();
      L.Layer.types.pmtiles = L.TileLayer.extend({
        _read: L.Layer.types["3d"].prototype._read,
        _decompress: L.Layer.types["3d"].prototype._decompress,
        getHeader: L.Layer.types["3d"].prototype.getHeader,
        getZxy: L.Layer.types["3d"].prototype.getZxy,
        initialize(options) {
          L.TileLayer.prototype.initialize.call(this, options.url, options);
          this.url = new URL(options.url, document.baseURI).href;
          this._directories = /* @__PURE__ */ new Map();
          this.on("tileunload", this._releaseTile, this);
          this.on("load tileunload", () => L.Layer.types["3d"]._renderers.get(this._map)?.update());
          this.ready = Promise.resolve(this.options.archive || this).then(async (archive) => {
            const header = await archive.getHeader();
            this.options.archive = archive;
            this.header = header;
            if (this.options.maxNativeZoom === void 0) this.options.maxNativeZoom = header.maxZoom;
            this.fire("ready");
            return this;
          }).catch((error) => {
            this.fire("error", { error });
            throw error;
          });
        },
        onAdd(map) {
          if (this.header) {
            L.TileLayer.prototype.onAdd.call(this, map);
            this._setTerrain3D(map._terrain3D);
          } else {
            this.ready = this.ready.then((layer) => {
              if (this._map === map && map.hasLayer(this) && !this._container) {
                L.TileLayer.prototype.onAdd.call(this, map);
                this._setTerrain3D(map._terrain3D);
              }
              return layer;
            });
          }
        },
        onRemove(map) {
          this._setTerrain3D(null);
          if (this._container) L.TileLayer.prototype.onRemove.call(this, map);
        },
        setOpacity(opacity) {
          L.TileLayer.prototype.setOpacity.call(this, opacity);
          L.Layer.types["3d"]._renderers.get(this._map)?.update();
          return this;
        },
        setZIndex(zIndex) {
          L.TileLayer.prototype.setZIndex.call(this, zIndex);
          L.Layer.types["3d"]._renderers.get(this._map)?.update();
          return this;
        },
        createTile(coords, done) {
          const tile = document.createElement("img");
          tile.alt = "";
          if (this.options.crossOrigin || this.options.crossOrigin === "") {
            tile.crossOrigin = this.options.crossOrigin === true ? "" : this.options.crossOrigin;
          }
          if (typeof this.options.referrerPolicy === "string") tile.referrerPolicy = this.options.referrerPolicy;
          tile.request = new AbortController();
          this.ready.then(() => {
            if (tile.request.signal.aborted) return;
            return this.options.archive.getZxy(coords.z, coords.x, coords.y, tile.request.signal);
          }).then(async (result) => {
            if (tile.request.signal.aborted) return;
            if (!result) throw new Error(`Tile ${coords.z}/${coords.x}/${coords.y} is not in the offline archive`);
            await new Promise((resolve, reject) => {
              const finish = (error) => {
                tile.request.signal.removeEventListener("abort", abort);
                tile.onload = tile.onerror = null;
                this._releaseURL(tile);
                if (error) reject(error);
                else resolve();
              };
              const abort = () => finish();
              tile.request.signal.addEventListener("abort", abort, { once: true });
              tile.objectURL = URL.createObjectURL(new Blob([result.data]));
              tile.onload = () => finish();
              tile.onerror = () => finish(new Error(`Unable to decode tile ${coords.z}/${coords.x}/${coords.y}`));
              tile.src = tile.objectURL;
            });
            if (tile.request.signal.aborted) return;
            tile.done = true;
            this._registerTerrainTile(coords, tile);
            done(null, tile);
          }).catch((error) => {
            if (tile.request.signal.aborted) return;
            tile.error = error.message;
            this._tileOnError(done, tile, error);
          });
          return tile;
        },
        _abortLoading() {
          for (const { coords, el } of Object.values(this._tiles)) {
            if (coords.z !== this._tileZoom) this._releaseTile({ tile: el });
          }
          L.TileLayer.prototype._abortLoading.call(this);
        },
        _setTerrain3D(terrain) {
          if (this._terrain3D === terrain) return;
          for (const { el } of Object.values(this._tiles || {})) this._terrain3D?.removeRasterTile(el);
          this._terrain3D = terrain || null;
          if (this._terrain3D) {
            for (const { coords, el } of Object.values(this._tiles || {})) {
              if (el.done) this._registerTerrainTile(coords, el);
            }
          }
        },
        _registerTerrainTile(coords, tile) {
          if (!this._terrain3D) return;
          const terrain = this._terrain3D;
          terrain.addRasterTile(this, coords, tile).catch((error) => {
            if (this._terrain3D === terrain && tile.isConnected) this.fire("tileerror", { tile, coords, error });
          });
        },
        _releaseURL(tile) {
          if (tile.objectURL) {
            URL.revokeObjectURL(tile.objectURL);
            tile.objectURL = null;
          }
        },
        _releaseTile({ tile }) {
          this._terrain3D?.removeRasterTile(tile);
          tile.request.abort();
          this._releaseURL(tile);
        }
      });
    }
  });

  // src/layer/3d/utils/sun.js
  function solarPosition(date, lat, lng) {
    const time = new Date(date).getTime();
    if (!Number.isFinite(time) || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) throw new Error("Invalid solar date or location");
    const rad = Math.PI / 180, d = time / 864e5 - 10957.5;
    const mean = (357.5291 + 0.98560028 * d) * rad;
    const longitude = mean + (1.9148 * Math.sin(mean) + 0.02 * Math.sin(2 * mean) + 3e-4 * Math.sin(3 * mean) + 102.9372 + 180) * rad;
    const obliquity = 23.4397 * rad;
    const declination = Math.asin(Math.sin(longitude) * Math.sin(obliquity));
    const ascension = Math.atan2(Math.sin(longitude) * Math.cos(obliquity), Math.cos(longitude));
    return horizontalPosition(d, lat, lng, ascension, declination);
  }
  function horizontalPosition(d, lat, lng, ascension, declination) {
    const rad = Math.PI / 180;
    const hourAngle = (280.16 + 360.9856235 * d + lng) * rad - ascension;
    const latitude = lat * rad;
    const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
    const southAzimuth = Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude)
    );
    const azimuth = (southAzimuth / rad + 180 + 360) % 360;
    return {
      altitude: altitude / rad,
      azimuth,
      direction: [
        Math.sin(azimuth * rad) * Math.cos(altitude),
        Math.sin(altitude),
        -Math.cos(azimuth * rad) * Math.cos(altitude)
      ]
    };
  }
  function moonPosition(date, lat, lng) {
    solarPosition(date, lat, lng);
    const rad = Math.PI / 180, d = new Date(date).getTime() / 864e5 - 10957.5;
    const anomaly = (134.963 + 13.064993 * d) * rad;
    const longitude = (218.316 + 13.176396 * d + 6.289 * Math.sin(anomaly)) * rad;
    const latitude = 5.128 * Math.sin((93.272 + 13.22935 * d) * rad) * rad;
    const obliquity = 23.4397 * rad;
    const x = Math.cos(latitude) * Math.cos(longitude);
    const y = Math.cos(latitude) * Math.sin(longitude) * Math.cos(obliquity) - Math.sin(latitude) * Math.sin(obliquity);
    const z = Math.cos(latitude) * Math.sin(longitude) * Math.sin(obliquity) + Math.sin(latitude) * Math.cos(obliquity);
    return horizontalPosition(d, lat, lng, Math.atan2(y, x), Math.asin(z));
  }
  function atmosphere(altitude) {
    if (!Number.isFinite(altitude)) throw new Error("Invalid solar altitude");
    const stops = [
      [-18, [3, 7, 20], [17, 28, 54], [0.025, 0.04, 0.09]],
      [-6, [37, 53, 84], [182, 106, 86], [0.12, 0.1, 0.14]],
      [0, [101, 131, 171], [246, 170, 115], [0.38, 0.24, 0.18]],
      [10, [74, 147, 208], [197, 221, 237], [0.8, 0.75, 0.68]],
      [25, [53, 144, 213], [223, 238, 250], [1, 1, 1]]
    ];
    const upper = stops.findIndex((stop) => stop[0] >= altitude);
    const b = stops[upper < 0 ? stops.length - 1 : upper], a = stops[Math.max(0, upper - 1)];
    const t = a === b || upper < 0 ? 1 : (altitude - a[0]) / (b[0] - a[0]);
    const mix = (index) => a[index].map((value, i) => value + (b[index][i] - value) * t);
    const rgb = (values) => `rgb(${values.map(Math.round).join(", ")})`;
    return { background: `linear-gradient(${rgb(mix(1))}, ${rgb(mix(2))})`, tint: mix(3) };
  }
  var init_sun = __esm({
    "src/layer/3d/utils/sun.js"() {
    }
  });

  // src/layer/3d/types/sunlight.js
  var sunlight_exports = {};
  function installSunlight(map) {
    const L2 = globalThis.L;
    const control = new L2.Control({ position: "bottomright" });
    control.live = true;
    let date, slider, output, status, timer;
    const originalSky = map.getContainer().style.getPropertyValue("--leaflet-sky-background");
    const disc = "position:absolute;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;";
    const sunDisc = L2.DomUtil.create("div", "sunlight-sun");
    const moonDisc = L2.DomUtil.create("div", "sunlight-moon");
    sunDisc.style.cssText = disc + "background:#fff3bd;box-shadow:0 0 18px 7px #ffd27699;";
    moonDisc.style.cssText = disc + "background:#dce5f2;box-shadow:0 0 10px 2px #cbdcff55;";
    sunDisc.setAttribute("role", "img");
    sunDisc.setAttribute("aria-label", "Sun");
    moonDisc.setAttribute("role", "img");
    moonDisc.setAttribute("aria-label", "Moon");
    const updateSky = () => {
      const sun = map._sunlight, sky = map._pitchSky;
      if (sun) map.getContainer().style.setProperty("--leaflet-sky-background", sun.background);
      else if (originalSky) map.getContainer().style.setProperty("--leaflet-sky-background", originalSky);
      else map.getContainer().style.removeProperty("--leaflet-sky-background");
      const size = map.getSize(), pitch = map.getPitch() * Math.PI / 180, bearing = map.getBearing() * Math.PI / 180;
      for (const [disc2, body] of [[sunDisc, sun], [moonDisc, sun?.moon]]) {
        disc2.hidden = true;
        if (!sky || !body || body.altitude <= 0 || !sun) continue;
        if (disc2.parentNode !== sky) sky.append(disc2);
        const [x, y, z] = body.direction;
        const right = x * Math.cos(bearing) - z * Math.sin(bearing);
        const up = -x * Math.sin(bearing) * Math.cos(pitch) + y * Math.sin(pitch) - z * Math.cos(bearing) * Math.cos(pitch);
        const forward = -x * Math.sin(bearing) * Math.sin(pitch) - y * Math.cos(pitch) - z * Math.cos(bearing) * Math.sin(pitch);
        if (forward <= 0) continue;
        const left = size.x / 2 + size.y * 1.5 * right / forward;
        const top = size.y / 2 - size.y * 1.5 * up / forward;
        disc2.hidden = left < 0 || left > size.x || top < 0 || top > sky.clientHeight || sky.style.display === "none";
        disc2.style.left = `${left}px`;
        disc2.style.top = `${top}px`;
      }
    };
    const render = () => L2.Layer.types["3d"]?._renderers.get(map)?.update();
    const update = () => {
      try {
        if (control.live) control.time = /* @__PURE__ */ new Date();
        const time = control.time.toISOString();
        date.value = time.slice(0, 10);
        slider.value = String(control.time.getUTCHours() * 60 + control.time.getUTCMinutes());
        output.textContent = `${time.slice(11, 16)} UTC${control.live ? " \xB7 now" : ""}`;
        const center = map.getCenter();
        const sun = map._sunlight = solarPosition(control.time, center.lat, center.lng);
        Object.assign(sun, atmosphere(sun.altitude));
        sun.moon = moonPosition(control.time, center.lat, center.lng);
        status.textContent = sun.altitude <= 0 ? "Night \xB7 no direct sunlight" : sun.altitude < 3 ? "Low sun \xB7 shadows paused" : `Sun altitude ${sun.altitude.toFixed(1)}\xB0`;
        map.fire("simulationtimechange", { time: new Date(control.time), live: control.live });
        updateSky();
        render();
      } catch (error) {
        delete map._sunlight;
        updateSky();
        render();
        status.textContent = `Error: ${error.message}`;
        console.error("Solar simulation", error);
      }
    };
    const selectTime = () => {
      control.live = false;
      if (!date.value || !date.validity.valid) {
        control.time = /* @__PURE__ */ new Date(NaN);
        map.fire("simulationtimechange", { time: null, live: false });
        delete map._sunlight;
        updateSky();
        render();
        status.textContent = "Error: choose a valid solar date";
        return;
      }
      control.time = /* @__PURE__ */ new Date(`${date.value}T00:00:00Z`);
      control.time.setUTCMinutes(Number(slider.value));
      update();
    };
    control.onAdd = () => {
      const container = L2.DomUtil.create("div", "sunlight-control");
      container.style.cssText = "color:#222;width:min(200px,calc(100vw - 60px));font:12px/1.4 sans-serif;";
      date = document.createElement("input");
      date.type = "date";
      date.style.cssText = "width:100%;box-sizing:border-box;";
      date.setAttribute("aria-label", "Solar date (UTC)");
      slider = document.createElement("input");
      slider.type = "range";
      slider.style.cssText = "width:100%;box-sizing:border-box;margin:10px 0 4px;cursor:pointer;";
      slider.min = "0";
      slider.max = "1439";
      slider.step = "1";
      slider.setAttribute("aria-label", "Time of day (UTC)");
      output = document.createElement("output");
      output.style.cssText = "font-weight:bold;font-variant-numeric:tabular-nums;";
      output.setAttribute("aria-live", "off");
      const now = document.createElement("button");
      now.type = "button";
      now.textContent = "Now";
      now.onclick = () => {
        control.live = true;
        update();
      };
      const timeRow = document.createElement("div");
      timeRow.className = "sunlight-time";
      timeRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
      timeRow.append(output, now);
      status = document.createElement("div");
      status.className = "sunlight-status";
      status.style.marginTop = "5px";
      status.setAttribute("role", "status");
      const note = document.createElement("small");
      note.style.color = "#555";
      note.textContent = "Indicative \xB7 loaded geometry only. Streetlight illumination is estimated, not measured lux.";
      container.append(date, slider, timeRow, status, note);
      slider.oninput = selectTime;
      date.onchange = selectTime;
      L2.DomEvent.disableClickPropagation(container);
      L2.DomEvent.disableScrollPropagation(container);
      update();
      timer = setInterval(() => {
        if (control.live) update();
      }, 6e4);
      map.on("moveend", update);
      map.on("move rotate pitch resize", updateSky);
      return container;
    };
    control.onRemove = () => {
      clearInterval(timer);
      map.fire("simulationtimechange", { time: null, live: false });
      map.off("moveend", update);
      map.off("move rotate pitch resize", updateSky);
      delete map._sunlight;
      updateSky();
      sunDisc.remove();
      moonDisc.remove();
      render();
    };
    return control;
  }
  var init_sunlight = __esm({
    "src/layer/3d/types/sunlight.js"() {
      init_sun();
      L.Layer.types.sunlight = L.Layer.extend({
        onAdd(map) {
          this.control = this.control || installSunlight(map);
          if (!this.control._map) this.control.addTo(map);
          const list = map.getContainer().querySelector(".leaflet-control-layers-list");
          const container = this.control.getContainer();
          if (list) list.append(container);
          container.classList.toggle("leaflet-bar", !list);
          Object.assign(container.style, list ? { background: "", padding: "6px 0 0", marginTop: "6px", borderTop: "1px solid #ddd" } : { background: "#fff", padding: "8px", marginTop: "", borderTop: "" });
        },
        onRemove() {
          this.control.remove();
        }
      });
    }
  });

  // src/layer/3d/types/terrain.js
  var terrain_exports = {};
  var init_terrain = __esm({
    "src/layer/3d/types/terrain.js"() {
      init_d();
      init_pmtiles();
      L.Layer.types.terrain = L.Layer.types["3d"].extend({
        initialize(options = {}) {
          const terrainSource = options.url;
          const layerOptions = { ...options };
          delete layerOptions.url;
          L.Layer.types["3d"].prototype.initialize.call(this, layerOptions);
          this.terrainSource = terrainSource;
          this._terrainTiles = /* @__PURE__ */ new Map();
          this._rasterTiles = /* @__PURE__ */ new Map();
          this._terrainReady = false;
        },
        onAdd(map) {
          if (map._terrain3D && map._terrain3D !== this) throw new Error("Only one terrain layer can be active per map");
          map._terrain3D = this;
          L.Layer.types["3d"].prototype.onAdd.call(this, map);
          this._terrainPromise = this.root ? this._loadTerrain() : new Promise((resolve) => this.once("ready", () => this._loadTerrain().then(resolve), this));
          map.eachLayer((layer) => layer._setTerrain3D?.(this));
          map.fire("terrainchange");
        },
        onRemove(map) {
          this._terrainController?.abort();
          this._terrainLoading = false;
          this._terrainReady = false;
          map.eachLayer((layer) => layer._setTerrain3D?.(null));
          for (const tile of this._rasterTiles.keys()) this.removeRasterTile(tile);
          if (map._terrain3D === this) delete map._terrain3D;
          for (const layer of Object.values(map._layers)) layer._setTerrainHeight?.();
          map.fire("terrainchange");
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
          L.Layer.types["3d"].prototype.onRemove.call(this, map);
        },
        async _loadTerrain() {
          if (this._terrainLoading || !this._map) return;
          this._terrainLoading = true;
          this._terrainReady = false;
          const controller = this._terrainController = new AbortController();
          try {
            if (!this.terrainSource) throw new Error("Terrain layer requires a PMTiles elevation archive");
            const archive = this._terrainArchive = new L.Layer({ source: { type: "pmtiles", url: this.terrainSource } });
            await archive.ready;
            const header = archive.header;
            if (header.tileType !== 0 || header.minZoom !== header.maxZoom) {
              throw new Error("Expected a single-zoom Float32 PMTiles terrain archive");
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
            map.fire("terrainchange");
            this.update();
            this.fire("terrainready");
            return true;
          } catch (error) {
            if (!controller.signal.aborted) this.fire("error", { error });
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
            return Number.isFinite(elevation) && elevation > -1e3 ? elevation : null;
          };
          const values = [sample(x0, y0), sample(x0 + 1, y0), sample(x0, y0 + 1), sample(x0 + 1, y0 + 1)];
          const valid = values.map((value, i) => Number.isFinite(value) ? i : -1).filter((i) => i >= 0);
          if (!valid.length) return null;
          if (valid.length < 4) return values[valid[0]];
          return (values[0] * (1 - fx) + values[1] * fx) * (1 - fy) + (values[2] * (1 - fx) + values[3] * fx) * fy;
        },
        async addRasterTile(layer, coords, tile) {
          const [ready, bitmap] = await Promise.all([this._terrainPromise, createImageBitmap(tile)]);
          if (!ready || !this._map || this._map._terrain3D !== this || layer._terrain3D !== this || tile.request.signal.aborted || !tile.isConnected || this._rasterTiles.has(tile)) {
            bitmap.close();
            return;
          }
          const divisions = Math.max(1, Math.min(64, 256 / 2 ** (coords.z - this._terrainZoom)));
          const map = this._map, crs = map.options.crs;
          const origin = crs.project(this.location), metres = Math.cos(this.location.lat * Math.PI / 180);
          const scale = crs.scale(coords.z), terrainScale = 2 ** (this._terrainZoom - coords.z);
          const corner = crs.transformation.untransform(new L.Point(coords.x * 256, coords.y * 256), scale);
          const opposite = crs.transformation.untransform(new L.Point((coords.x + 1) * 256, (coords.y + 1) * 256), scale);
          const device = this.renderer.device;
          const texture = {
            device,
            texture: device.createTexture({
              size: [tile.width, tile.height],
              format: "rgba8unorm",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            }),
            sampler: device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
            samplerOptions: { addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
            image: tile,
            format: "rgba8unorm",
            srgb: false,
            flipY: false,
            uploaded: tile
          };
          device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: texture.texture }, [tile.width, tile.height]);
          bitmap.close();
          if (!this._rasterProgram || this._rasterProgram.device !== device) {
            const bounds = this._terrainBounds, columns = bounds.max.x - bounds.min.x + 1, rows = bounds.max.y - bounds.min.y + 1;
            const elevations = new Float32Array(columns * rows * 65536).fill(-1e9);
            let low = Infinity, high = -Infinity;
            for (const [key, values] of this._terrainTiles) {
              const [x, y] = key.split("/").map(Number);
              const start = (y - bounds.min.y) * 256 * columns * 256 + (x - bounds.min.x) * 256;
              for (let row = 0; row < 256; row++) {
                for (let column = 0; column < 256; column++) {
                  const value = values[row * 256 + column];
                  if (!Number.isFinite(value) || value <= -1e3) continue;
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
                format: "r32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
              }),
              low: Number.isFinite(low) ? low : this._terrainOriginElevation,
              high: Number.isFinite(high) ? high : this._terrainOriginElevation
            };
            device.queue.writeTexture(
              { texture: this._dem.texture },
              elevations,
              { bytesPerRow: columns * 1024 },
              [columns * 256, rows * 256]
            );
            this._terrainGrids = /* @__PURE__ */ new Map();
            this._rasterProgram = this._createProgram({
              baseTexture: texture,
              unlit: true,
              alphaMode: "BLEND",
              terrain: this._dem
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
              normal: { size: 3, data: new Float32Array(normals) },
              uv: { size: 2, data: new Float32Array(uvs) },
              index: { data: new Uint16Array(indices) }
            };
            for (const [name, attribute] of Object.entries(attributes)) {
              attribute.size ||= 1;
              attribute.count = attribute.data.length / attribute.size;
              attribute.indexFormat = "uint16";
              attribute.buffer = device.createBuffer({
                size: Math.max(4, attribute.data.byteLength),
                usage: name === "index" ? GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
              });
              device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
            }
            this._terrainGrids.set(divisions, attributes);
          }
          const base = this._terrainOriginElevation;
          const bottom = Math.min(this._dem.low, base) - base, top = Math.max(this._dem.high, base) - base;
          const sizeX = (opposite.x - corner.x) * metres, sizeZ = -(opposite.y - corner.y) * metres;
          const geometry = {
            device,
            attributes,
            drawRange: { start: 0, count: attributes.index.count },
            // Local bounds whose radius, scaled by the largest axis, still covers the displaced tile.
            bounds: {
              min: [0, bottom, 0],
              max: [1, top, 1],
              center: [0.5, (bottom + top) / 2, 0.5],
              radius: Math.hypot(sizeX, top - bottom, sizeZ) / 2 / Math.max(sizeX, 1, sizeZ)
            }
          };
          const mesh = {
            position: [(corner.x - origin.x) * metres, 0, -(corner.y - origin.y) * metres],
            rotation: [0, 0, 0],
            scale: [sizeX, 1, sizeZ],
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            children: [],
            visible: true,
            device,
            geometry,
            program: this._rasterProgram,
            texture,
            // DEM pixel of the tile's corner, DEM pixels per tile, and the elevation at the layer origin.
            terrain: [
              coords.x * 256 * terrainScale - this._terrainBounds.min.x * 256,
              coords.y * 256 * terrainScale - this._terrainBounds.min.y * 256,
              256 * terrainScale,
              base
            ],
            tile,
            opacity: layer.options.opacity ?? 1,
            id: L.Layer.types["3d"]._nextId++,
            renderOrder: -1
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
        }
      });
      L.Layer.types.terrain.elevationWGSL = `
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
    }
  });

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    toPoint: () => toPoint
  });

  // src/dom/DomUtil.js
  var domUtilProto = Object.assign({}, L.DomUtil);
  Object.assign(L.DomUtil, {
    /**
     * Resets the 3D CSS transform of `el` so it is translated by `offset` pixels,
     * optionally scaled by `scale`, and rotated around `pivot` when `bearing` is set.
     *
     * @param {HTMLElement} el Element to transform.
     * @param {L.Point} [offset] Translation in pixels; defaults to the origin.
     * @param {number} [scale] Optional scale factor.
     * @param {number} [bearing] Optional rotation in radians.
     * @param {L.Point} [pivot] Point in pixels around which to rotate.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setTransform(el, offset, scale, bearing, pivot) {
      let pos = offset || new L.Point(0, 0);
      if (!bearing) {
        return domUtilProto.setTransform(el, pos._round(), scale);
      }
      pos = pos.rotateFrom(bearing, pivot);
      el.style.transform = "translate3d(" + pos.x + "px," + pos.y + "px,0)" + (scale ? " scale(" + scale + ")" : "") + " rotate(" + bearing + "rad)";
    },
    /**
     * Sets the position of `el` to `point`, using CSS transforms or top/left positioning
     * depending on browser support, and optionally rotating it around `pivot`.
     *
     * @param {HTMLElement} el Element to position.
     * @param {L.Point} point Position in pixels.
     * @param {number} [bearing] Rotation in radians; zero or omitted uses Leaflet positioning.
     * @param {L.Point} [pivot] Point in pixels around which to rotate.
     * @param {number} [scale] Optional scale factor.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setPosition(el, point, bearing, pivot, scale) {
      if (!bearing) {
        return domUtilProto.setPosition(el, point);
      }
      el._leaflet_pos = point;
      L.DomUtil.setTransform(el, point, scale, bearing, pivot);
    },
    /**
     * Returns the position assigned to `el`.
     *
     * @param {HTMLElement} el Element whose Leaflet position is requested.
     * 
     * @returns {L.Point} Stored Leaflet position, or the position measured by Leaflet.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getPosition(el) {
      return el._leaflet_pos || domUtilProto.getPosition(el);
    }
  });

  // src/dom/Draggable.js
  L.Draggable.include({
    /** @TODO */
    // updateMapBearing(mapBearing) {
    //     this._mapBearing = mapBearing;
    // },
  });

  // src/geometry/Point.js
  Object.assign(L.Point.prototype, {
    /**
     * Rotate around (0,0) by applying the 2D rotation matrix:
     * 
     * ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
     * ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
     * 
     * @param {number} theta Rotation angle in radians, counterclockwise.
     * @returns {L.Point} Rotated point (or this point when theta is zero).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotate(theta) {
      return this.rotateFrom(theta, new L.Point(0, 0));
    },
    /**
     * Rotate around (pivot.x, pivot.y) by:
     * 
     * 1. subtract (pivot.x, pivot.y)
     * 2. rotate around (0, 0)
     * 3. add (pivot.x, pivot.y) back
     * 
     * same as `this.subtract(pivot).rotate(theta).add(pivot)`
     * 
     * @param {number} theta Rotation angle in radians, counterclockwise.
     * @param {L.Point} pivot Point to rotate around.
     * 
     * @returns {L.Point}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateFrom(theta, pivot) {
      if (!theta) {
        return this;
      }
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const cx = pivot.x, cy = pivot.y;
      const x = this.x - cx, y = this.y - cy;
      return new L.Point(
        x * cosTheta - y * sinTheta + cx,
        x * sinTheta + y * cosTheta + cy
      );
    }
  });
  function toPoint(point) {
    if (point == null || point instanceof L.Point) {
      return point;
    }
    return Array.isArray(point) ? new L.Point(point[0], point[1]) : new L.Point(point.x, point.y);
  }

  // src/layer/DivOverlay.js
  var divOverlayProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.DivOverlay.prototype));
  L.DivOverlay.include({
    /**
     * Extend overlay event subscriptions to refresh position after map rotation and pitch.
     * 
     * @listens L.Map~rotate
     * @listens L.Map~pitch
     *
     * @returns {Object} Leaflet event map for the overlay.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = Object.assign(divOverlayProto.getEvents.apply(this, arguments), {
        rotate: this._updatePosition,
        pitch: this._updatePitchEvents
      });
      if (this._map && this._map._pitch) {
        events.move = this._updatePosition;
      }
      return events;
    },
    /**
     * Listen to map movement only while pitch is non-zero.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchEvents() {
      if (this._map._pitch) {
        this._map.on("move", this._updatePosition, this);
      } else {
        this._map.off("move", this._updatePosition, this);
      }
    },
    /**
     * Reposition the overlay after map movement, applying rotation/pitch-aware coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updatePosition() {
      if (!this._map) {
        return;
      }
      divOverlayProto._updatePosition.apply(this, arguments);
      if (this._map._rotate && this._zoomAnimated) {
        const anchor = this._getAnchor();
        const pos = L.DomUtil.getPosition(this._container).subtract(anchor);
        L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
      } else if (this._map._rotate) {
        const mapPanePoint = this._map.rotatedPointToMapPanePoint(this._map.latLngToLayerPoint(this._latlng)), offset = toPoint(this.options.offset || [0, 0]), anchor = this._getAnchor();
        this._containerLeft = -Math.round(this._containerWidth / 2) + mapPanePoint.x + offset.x + anchor.x;
        this._containerBottom = -(mapPanePoint.y + offset.y + anchor.y);
        this._container.style.left = this._containerLeft + "px";
        this._container.style.bottom = this._containerBottom + "px";
        this._container.style.top = "";
        L.DomUtil.setPosition(this._container, new L.Point(0, 0));
        this._container.style.transform = "";
      }
    }
  });

  // import("./3d/types/**/*.js") in src/layer/Layer.js
  var globImport_3d_types_js = __glob({
    "./3d/types/3d.js": () => Promise.resolve().then(() => (init_d(), d_exports)),
    "./3d/types/cruises.js": () => Promise.resolve().then(() => (init_cruises(), cruises_exports)),
    "./3d/types/pmtiles.js": () => Promise.resolve().then(() => (init_pmtiles(), pmtiles_exports)),
    "./3d/types/sunlight.js": () => Promise.resolve().then(() => (init_sunlight(), sunlight_exports)),
    "./3d/types/terrain.js": () => Promise.resolve().then(() => (init_terrain(), terrain_exports))
  });

  // src/layer/Layer.js
  var Pending = L.Layer.extend({
    onAdd() {
    },
    onRemove() {
    }
  });
  var loading = Promise.resolve();
  L.Layer.types = {};
  L.Layer.include({
    initialize: /* @__PURE__ */ ((initialize) => function(options) {
      if (Object.getPrototypeOf(this) !== L.Layer.prototype || !options?.source) {
        return initialize?.apply(this, arguments);
      }
      const { source: { type = /\.pmtiles(?:[?#]|$)/i.test(options.source.url) ? "pmtiles" : "3d", ...source }, ...core } = options;
      const settings = { ...source, ...core };
      if (L.Layer.types[type]) {
        const Type = L.Layer.types[type];
        Object.setPrototypeOf(this, Type.prototype);
        this.options = Object.create(Type.prototype.options);
        return Type.prototype.initialize.call(this, settings);
      }
      Object.setPrototypeOf(this, Pending.prototype);
      L.Util.setOptions(this, core);
      loading = loading.catch(() => {
      }).then(() => globImport_3d_types_js(`./3d/types/${type}.js`));
      const pending = this.ready = loading.then(() => {
        const map = this._map;
        map?.removeLayer(this);
        const Type = L.Layer.types[type];
        Object.setPrototypeOf(this, Type.prototype);
        this.options = Object.create(Type.prototype.options);
        Type.prototype.initialize.call(this, settings);
        map?.addLayer(this);
        return this.ready === pending ? this : this.ready;
      });
    })(L.Layer.prototype.initialize)
  });

  // src/layer/Popup.js
  var popupProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Popup.prototype));
  L.Popup.include({
    /**
     * Update the popup position during zoom animation and transform it into map-pane coordinates.
     *
     * @param {Object} e Zoom animation event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoom(e) {
      popupProto._animateZoom.apply(this, arguments);
      if (this._map && this._map._rotate) {
        const anchor = this._getAnchor();
        const pos = L.DomUtil.getPosition(this._container).subtract(anchor);
        L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
      }
    },
    /**
     * Pan the map when a popup with auto-pan enabled would extend beyond the viewport.
     * 
     * @see https://github.com/fnicollet/Leaflet/pull/21
     *
     * @fires L.Map#autopanstart
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _adjustPan() {
      if (!this.options.autoPan || this._map._panAnim && this._map._panAnim._inProgress) {
        return;
      }
      if (this._autopanning) {
        this._autopanning = false;
        return;
      }
      const map = this._map, marginBottom = parseInt(getComputedStyle(this._container).marginBottom, 10) || 0, containerHeight = this._container.offsetHeight + marginBottom, containerWidth = this._containerWidth, layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);
      layerPos._add(L.DomUtil.getPosition(this._container));
      const containerPos = layerPos._add(this._map._getMapPanePos()), padding = toPoint(this.options.autoPanPadding || [0, 0]), paddingTL = toPoint(this.options.autoPanPaddingTopLeft || padding), paddingBR = toPoint(this.options.autoPanPaddingBottomRight || padding), size = map.getSize();
      let dx = 0, dy = 0;
      if (containerPos.x + containerWidth + paddingBR.x > size.x) {
        dx = containerPos.x + containerWidth - size.x + paddingBR.x;
      }
      if (containerPos.x - dx - paddingTL.x < 0) {
        dx = containerPos.x - paddingTL.x;
      }
      if (containerPos.y + containerHeight + paddingBR.y > size.y) {
        dy = containerPos.y + containerHeight - size.y + paddingBR.y;
      }
      if (containerPos.y - dy - paddingTL.y < 0) {
        dy = containerPos.y - paddingTL.y;
      }
      if (dx || dy) {
        if (this.options.keepInView) {
          this._autopanning = true;
        }
        map.fire("autopanstart").panBy([dx, dy]);
      }
    }
  });

  // src/layer/Tooltip.js
  var tooltipProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Tooltip.prototype));
  L.Tooltip.include({
    /**
     * Reposition the tooltip during zoom animation using transformed map coordinates.
     *
     * @param {Object} e Zoom animation event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoom(e) {
      if (!this._map._rotate) {
        return tooltipProto._animateZoom.apply(this, arguments);
      }
      let pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);
      pos = this._map.rotatedPointToMapPanePoint(pos);
      this._setPosition(pos);
    },
    /**
     * Recompute tooltip screen position after map movement.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updatePosition() {
      if (!this._map._rotate) {
        return tooltipProto._updatePosition.apply(this, arguments);
      }
      let pos = this._map.latLngToLayerPoint(this._latlng);
      pos = this._map.rotatedPointToMapPanePoint(pos);
      this._setPosition(pos);
    }
  });

  // src/layer/marker/Icon.js
  var iconProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Icon.prototype));
  L.Icon.include({
    /**
     * Set marker icon dimensions and anchor styles, including the rotation origin.
     * 
     * @param {HTMLImageElement} img Icon or shadow element.
     * @param {string} name Icon style key (`icon` or `shadow`).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _setIconStyles(img, name) {
      const options = this.options;
      let sizeOption = options[name + "Size"];
      if (typeof sizeOption === "number") {
        sizeOption = [sizeOption, sizeOption];
      }
      const size = sizeOption ? new L.Point(...Array.isArray(sizeOption) ? sizeOption : [sizeOption.x, sizeOption.y]) : null, anchorOption = name === "shadow" && options.shadowAnchor || options.iconAnchor || size && size.divideBy(2, true), anchor = anchorOption ? new L.Point(...Array.isArray(anchorOption) ? anchorOption : [anchorOption.x, anchorOption.y]) : null;
      img.className = "leaflet-marker-" + name + " " + (options.className || "");
      if (anchor) {
        img.style.marginLeft = -anchor.x + "px";
        img.style.marginTop = -anchor.y + "px";
        img.style.transformOrigin = anchor.x + "px " + anchor.y + "px 0px";
      }
      if (size) {
        img.style.width = size.x + "px";
        img.style.height = size.y + "px";
      }
    }
  });

  // src/layer/marker/Marker.js
  var markerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Marker.prototype));
  L.Marker.mergeOptions({
    /**
     * Rotation of the marker icon in radians.
     * 
     * @type {Number}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotation: 0,
    /**
     * Rotate the marker icon when the map bearing changes.
     *
     * Combine with `keepUpright: true` to keep the marker readable while
     * preserving its line alignment.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateWithView: false,
    /**
     * Flip the icon when needed to keep it upright while map-aligned.
     *
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    keepUpright: false,
    /**
     * Optional scale of the marker icon and shadow.
     * 
     * @type {Number}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    scale: void 0
  });
  var markerDragProto;
  var canvasImages = {};
  var toPoint2 = (value) => {
    if (value == null) {
      return null;
    }
    if (typeof value === "number") {
      return new L.Point(value, value);
    }
    return Array.isArray(value) ? new L.Point(value[0], value[1]) : new L.Point(value.x, value.y);
  };
  var MarkerCanvas = L.Canvas.extend({
    getEvents() {
      return {
        move: this._refresh,
        zoom: this._refresh,
        rotate: this._refresh,
        pitch: this._refresh,
        resize: this._refresh,
        viewreset: this._refresh,
        zoomanim: this._animateMarkers
      };
    },
    onAdd() {
      this._initContainer();
      this._container.classList.add("leaflet-zoom-animated");
      this._container.style.zIndex = -1e9;
      this.getPane().prepend(this._container);
      this._zoomProbe = L.DomUtil.create("div", "leaflet-zoom-animated", this.getPane());
      this._zoomProbe.style.visibility = "hidden";
      this._zoomProbe.style.pointerEvents = "none";
      this._refresh();
    },
    onRemove() {
      cancelAnimationFrame(this._zoomFrame);
      this._zoomProbe.remove();
      L.Canvas.prototype.onRemove.apply(this, arguments);
    },
    _animateMarkers(e) {
      if (!this._map._animatingZoom) {
        this._viewEvent = e;
        this._refresh();
        return;
      }
      cancelAnimationFrame(this._zoomFrame);
      const map = this._map;
      this._zoomFrom = { zoom: map.getZoom(), origin: map.getPixelOrigin().clone() };
      this._viewEvent = e;
      this._zoomProgress = 0;
      const probe = this._zoomProbe;
      probe.style.transition = "none";
      probe.style.transform = "translate3d(0px,0,0)";
      getComputedStyle(probe).transform;
      probe.style.transition = "";
      probe.style.transform = "translate3d(1px,0,0)";
      const frame = () => {
        if (!this._map || !map._animatingZoom) {
          return;
        }
        this._zoomProgress = new DOMMatrix(getComputedStyle(probe).transform).m41;
        this._refresh();
        this._zoomFrame = requestAnimationFrame(frame);
      };
      this._refresh();
      this._zoomFrame = requestAnimationFrame(frame);
    },
    _refresh(e) {
      const map = this._map, min = map._getMapPanePos().multiplyBy(-1).round(), size = map.getSize(), ratio = window.devicePixelRatio || 1;
      this._bounds = new L.Bounds(min, min.add(size));
      L.DomUtil.setPosition(this._container, min);
      this._container.style.width = size.x + "px";
      this._container.style.height = size.y + "px";
      if (this._container.width !== Math.round(size.x * ratio) || this._container.height !== Math.round(size.y * ratio)) {
        this._container.width = Math.round(size.x * ratio);
        this._container.height = Math.round(size.y * ratio);
      }
      this._ctx.setTransform(ratio, 0, 0, ratio, -min.x * ratio, -min.y * ratio);
      if (!map._animatingZoom && this._zoomFrom) {
        cancelAnimationFrame(this._zoomFrame);
        this._zoomFrom = this._viewEvent = null;
      }
      if (!map._animatingZoom && e) {
        this._viewEvent = null;
      }
      for (const layer of Object.values(this._layers)) {
        layer._project();
      }
      this._redrawBounds = null;
      this._redraw();
    }
  });
  var CanvasIcon = L.CircleMarker.extend({
    initialize(marker) {
      const map = marker._map;
      if (!map._canvasMarkerRenderer) {
        map._canvasMarkerRenderer = new MarkerCanvas({ pane: "markerPane" });
      }
      L.CircleMarker.prototype.initialize.call(this, marker.getLatLng(), {
        radius: 0,
        interactive: marker.options.interactive,
        bubblingMouseEvents: marker.options.bubblingMouseEvents,
        renderer: map._canvasMarkerRenderer
      });
      this._marker = marker;
      this._loadImages();
    },
    _loadImages() {
      const icon = this._marker.options.icon;
      this._images = {};
      for (const name of ["shadow", "icon"]) {
        const url = icon._getIconUrl(name);
        if (!url) {
          continue;
        }
        let img = canvasImages[url];
        if (!img) {
          img = canvasImages[url] = new Image();
          img.src = url;
        }
        if (!img.complete) {
          img.addEventListener("load", () => this._map && this._images[name] === img && this.redraw(), { once: true });
        }
        this._images[name] = img;
      }
    },
    _getPart(name) {
      const img = this._images[name];
      if (!img || !img.complete || !img.naturalWidth) {
        return null;
      }
      const options = this._marker.options.icon.options, size = toPoint2(options[name + "Size"]) || new L.Point(img.naturalWidth, img.naturalHeight), anchor = toPoint2(name === "shadow" && options.shadowAnchor || options.iconAnchor) || size.divideBy(2);
      return { img, size, anchor };
    },
    _getAngle() {
      return this._marker._getIconBearing();
    },
    getLatLng() {
      return this._marker.getLatLng();
    },
    fire(type) {
      if (type === "add" || type === "remove") {
        return L.CircleMarker.prototype.fire.apply(this, arguments);
      }
      this._marker.fire.apply(this._marker, arguments);
      return this;
    },
    listens(type) {
      if (type === "add" || type === "remove") {
        return L.CircleMarker.prototype.listens.apply(this, arguments);
      }
      return this._marker.listens.apply(this._marker, arguments);
    },
    _project() {
      const map = this._map, view = this._renderer._viewEvent, from = this._renderer._zoomFrom;
      let point = view ? map._latLngToNewLayerPoint(this.getLatLng(), view.zoom, view.center) : map.latLngToLayerPoint(this.getLatLng());
      if (from) {
        const start = map.project(this.getLatLng(), from.zoom).subtract(from.origin);
        point = start.add(point.subtract(start).multiplyBy(this._renderer._zoomProgress));
      }
      const matrix = map._pitch && map._pitchTransform;
      this._behindCamera = Boolean(matrix && matrix.m14 * point.x + matrix.m24 * point.y + matrix.m44 <= 0);
      this._point = map._rotate ? map.rotatedPointToMapPanePoint(point) : point;
      this._updateBounds();
      this._marker._syncCanvasAccessibility();
    },
    _updateBounds() {
      const scale = this._marker.options.scale || 1;
      let radius = 0;
      for (const name of ["shadow", "icon"]) {
        const part = this._getPart(name);
        if (!part) {
          continue;
        }
        const { size, anchor } = part;
        radius = Math.max(radius, Math.hypot(Math.max(anchor.x, size.x - anchor.x), Math.max(anchor.y, size.y - anchor.y)) * scale);
      }
      const r = new L.Point(radius, radius);
      this._pxBounds = new L.Bounds(this._point.subtract(r), this._point.add(r));
    },
    _empty() {
      return this._behindCamera || !this._renderer._bounds.intersects(this._pxBounds);
    },
    _updatePath() {
      const renderer = this._renderer;
      if (!renderer._drawing || this._empty()) {
        return;
      }
      const ctx = renderer._ctx, options = this._marker.options, scale = options.scale || 1;
      ctx.save();
      ctx.globalAlpha = options.opacity;
      ctx.translate(this._point.x, this._point.y);
      ctx.rotate(this._getAngle());
      ctx.scale(scale, scale);
      for (const name of ["shadow", "icon"]) {
        const part = this._getPart(name);
        if (part) {
          ctx.drawImage(part.img, -part.anchor.x, -part.anchor.y, part.size.x, part.size.y);
        }
      }
      ctx.restore();
    },
    _containsPoint(p) {
      if (this._behindCamera) {
        return false;
      }
      const part = this._getPart("icon");
      if (!part) {
        return false;
      }
      const point = this._map._rotate ? this._map.rotatedPointToMapPanePoint(p) : p;
      const local = point.subtract(this._point).rotate(-this._getAngle()).divideBy(this._marker.options.scale || 1).add(part.anchor);
      return local.x >= 0 && local.y >= 0 && local.x <= part.size.x && local.y <= part.size.y;
    }
  });
  var CanvasMarkerDrag = L.Handler.extend({
    initialize(marker) {
      this._marker = marker;
    },
    addHooks() {
      this._canvas = this._marker._canvasIcon._renderer._container;
      L.DomEvent.on(this._canvas, "pointerdown", this._onDown, this);
      this._stopClick = (e) => {
        if (this._moved) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      };
      this._canvas.addEventListener("click", this._stopClick, true);
    },
    removeHooks() {
      this._onUp();
      L.DomEvent.off(this._canvas, "pointerdown", this._onDown, this);
      this._canvas.removeEventListener("click", this._stopClick, true);
    },
    moved() {
      return Boolean(this._moved);
    },
    _containerPoint(e) {
      const map = this._marker._map;
      return (map.pointerEventToContainerPoint || map.mouseEventToContainerPoint).call(map, e);
    },
    _onDown(e) {
      if (this._pointerId != null) {
        if (e.pointerId !== this._pointerId) {
          this._onUp();
        }
        return;
      }
      this._moved = false;
      if (e.button !== 0 || !e.isPrimary || e.shiftKey || e.ctrlKey || e.metaKey) {
        return;
      }
      const marker = this._marker, map = marker._map, point = map.containerPointToLayerPoint(this._containerPoint(e)), layer = marker._canvasIcon;
      if (!layer._containsPoint(point)) {
        return;
      }
      for (let order = layer._renderer._drawLast; order; order = order.prev) {
        if (order.layer.options.interactive && order.layer._containsPoint(point)) {
          if (order.layer !== layer) {
            return;
          }
          break;
        }
        if (!order.prev) {
          return;
        }
      }
      L.DomEvent.stop(e);
      this._mapDragging = map.dragging && map.dragging.enabled();
      if (this._mapDragging) {
        map.dragging.disable();
      }
      map._stop();
      this._pointerId = e.pointerId;
      this._startPoint = this._point = this._containerPoint(e);
      this._offset = map.latLngToContainerPoint(marker.getLatLng()).subtract(this._point);
      this._oldLatLng = marker.getLatLng();
      L.DomEvent.on(document, "pointermove", this._onMove, this);
      L.DomEvent.on(document, "pointerup pointercancel", this._onUp, this);
      L.DomEvent.on(window, "blur", this._onUp, this);
    },
    _onMove(e) {
      if (e.pointerId !== this._pointerId) {
        return;
      }
      this._point = this._containerPoint(e);
      if (!this._moved) {
        const delta = this._point.subtract(this._startPoint);
        if (Math.abs(delta.x) + Math.abs(delta.y) < 3) {
          return;
        }
        this._moved = true;
        this._marker.closePopup();
        this._marker.fire("movestart").fire("dragstart");
      }
      if (this._pointerId == null) {
        return;
      }
      L.DomEvent.preventDefault(e);
      this._lastEvent = e;
      this._updatePosition();
      cancelAnimationFrame(this._panRequest);
      if (this._marker.options.autoPan) {
        this._adjustPan();
      }
    },
    _updatePosition() {
      const marker = this._marker, latlng = marker._map.containerPointToLatLng(this._point.add(this._offset)), data = { latlng, oldLatLng: this._oldLatLng, originalEvent: this._lastEvent };
      marker._latlng = latlng;
      marker.update();
      marker.fire("move", data).fire("drag", data);
    },
    _adjustPan() {
      if (this._pointerId == null) {
        return;
      }
      const marker = this._marker, map = marker._map, padding = toPoint2(marker.options.autoPanPadding), max = map.getSize().subtract(padding), point = this._point.add(this._offset), speed = marker.options.autoPanSpeed, movement = new L.Point(
        point.x < padding.x ? -speed : point.x > max.x ? speed : 0,
        point.y < padding.y ? -speed : point.y > max.y ? speed : 0
      );
      if (!movement.x && !movement.y) {
        return;
      }
      map.panBy(movement, { animate: false });
      this._updatePosition();
      this._panRequest = requestAnimationFrame(() => this._adjustPan());
    },
    _onUp(e) {
      if (this._pointerId == null || e && e.pointerId != null && e.pointerId !== this._pointerId) {
        return;
      }
      this._pointerId = null;
      cancelAnimationFrame(this._panRequest);
      L.DomEvent.off(document, "pointermove", this._onMove, this);
      L.DomEvent.off(document, "pointerup pointercancel", this._onUp, this);
      L.DomEvent.off(window, "blur", this._onUp, this);
      if (this._mapDragging) {
        this._marker._map.dragging.enable();
        this._mapDragging = false;
      }
      if (this._moved) {
        this._marker.fire("moveend").fire("dragend", {
          distance: this._point.distanceTo(this._startPoint)
        });
      }
    }
  });
  var MarkerDrag = {
    // _onDragStart() {
    //     if (!this._marker._map._rotate) {
    //         return markerDragProto._onDragStart.apply(this, arguments);
    //     }
    //     this._draggable.updateMapBearing(this._marker._map._bearing);
    // },
    /**
     * Update a dragged marker's geographic position from its transformed icon position.
     * 
     * @param {Object} e Marker drag event with `latlng` and `oldLatLng` fields.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onDrag(e) {
      const marker = this._marker, rotated_marker = marker.options.rotation || marker.options.rotateWithView, shadow = marker._shadow;
      let iconPos = L.DomUtil.getPosition(marker._icon);
      if (!rotated_marker && shadow) {
        L.DomUtil.setPosition(shadow, iconPos);
      }
      if (marker._map._rotate) {
        iconPos = marker._map.mapPanePointToRotatedPoint(iconPos);
      }
      const latlng = marker._map.layerPointToLatLng(iconPos);
      marker._latlng = latlng;
      e.latlng = latlng;
      e.oldLatLng = this._oldLatLng;
      if (rotated_marker) marker.setLatLng(latlng);
      else marker.fire("move", e);
      marker.fire("drag", e);
    },
    /**
     * Reposition the marker after a drag ends, then run Leaflet's drag-end logic.
     * 
     * @param {Object} e Marker drag-end event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onDragEnd(e) {
      if (this._marker._map._rotate) {
        this._marker.update();
      }
      markerDragProto._onDragEnd.apply(this, arguments);
    }
  };
  L.Marker.include({
    /**
     * Extend marker event subscriptions to reposition its icon after bearing or pitch changes.
     * 
     * @listens L.Map~rotate
     * @listens L.Map~pitch
     * 
     * @returns {Object} Leaflet event map for the marker.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = Object.assign(markerProto.getEvents.apply(this, arguments), {
        rotate: this.update,
        pitch: this._updatePitchEvents
      });
      if (this._map && this._map._pitch && !this._canvasIcon) {
        events.move = this.update;
      }
      return events;
    },
    /**
     * Subscribe to map movement while pitch is active to keep the icon aligned.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchEvents() {
      if (this._map._pitch && !this._canvasIcon) {
        this._map.on("move", this.update, this);
      } else {
        this._map.off("move", this.update, this);
      }
    },
    /**
     * Install rotation-aware drag callbacks when marker dragging is enabled.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _initInteraction() {
      const ret = markerProto._initInteraction.apply(this, arguments);
      if (this.dragging && this.dragging.enabled() && this._map && this._map._rotate) {
        markerDragProto = markerDragProto || Object.getPrototypeOf(this.dragging);
        this.dragging.disable();
        Object.assign(this.dragging, {
          // _onDragStart: MarkerDrag._onDragStart.bind(this.dragging),
          _onDrag: MarkerDrag._onDrag.bind(this.dragging),
          _onDragEnd: MarkerDrag._onDragEnd.bind(this.dragging)
        });
        this.dragging.enable();
      }
      return ret;
    },
    /**
     * Position and rotate the marker icon and shadow in map-pane coordinates.
     * 
     * @param {L.Point} pos Marker anchor in layer-point coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _setPos(pos) {
      if (this._map._rotate) {
        pos = this._map.rotatedPointToMapPanePoint(pos);
      }
      const bearing = this._getIconBearing();
      if (this._icon) {
        L.DomUtil.setPosition(this._icon, pos, bearing, pos, this.options.scale);
      }
      if (this._shadow) {
        L.DomUtil.setPosition(this._shadow, pos, bearing, pos, this.options.scale);
      }
      this._zIndex = pos.y + this.options.zIndexOffset;
      this._resetZIndex();
    },
    /**
     * Compute the on-screen icon rotation from `rotation`, `rotateWithView` and `keepUpright`.
     *
     * @returns {number} Angle in radians.
     *
     * @since leaflet-rotate (0.6.0)
     */
    _getIconBearing() {
      let bearing = this.options.rotation || 0;
      if (this.options.rotateWithView) {
        bearing += this._map._bearing;
      }
      if (this.options.keepUpright) {
        bearing = (bearing % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (bearing > Math.PI / 2 && bearing < 3 * Math.PI / 2) {
          bearing += Math.PI;
        }
        bearing %= 2 * Math.PI;
      }
      return bearing;
    },
    /**
     * Create the icon as DOM elements or, with `preferCanvas`, as a Canvas layer.
     *
     * @since leaflet-rotate (0.6.0)
     */
    _initIcon() {
      const draggable = this.dragging ? this.dragging.enabled() : this.options.draggable;
      if (this.dragging) {
        this.dragging.disable();
        delete this.dragging;
      }
      if (!(this._map && this._map.options.preferCanvas && this.options.icon instanceof L.Icon && !(this.options.icon instanceof L.DivIcon) && this.options.icon._getIconUrl("icon"))) {
        this._removeCanvasIcon();
        this.options.draggable = draggable;
        return markerProto._initIcon.apply(this, arguments);
      }
      if (this._icon) {
        markerProto._removeIcon.call(this);
      }
      this._removeShadow();
      if (this._canvasIcon) {
        this._canvasIcon._loadImages();
      } else {
        this._canvasIcon = new CanvasIcon(this);
        this._map.addLayer(this._canvasIcon);
      }
      if (this.options.interactive) {
        this.dragging = new CanvasMarkerDrag(this);
        this._canvasIcon.dragging = this.dragging;
        if (draggable) {
          this.dragging.enable();
        }
      }
      this._removeCanvasAccessibility();
      if (!this.options.keyboard || !this.options.interactive) {
        return;
      }
      const element = this._canvasAccessibleElement = document.createElement("button");
      element.type = "button";
      element.setAttribute("aria-label", this.options.title || this.options.alt || "Marker");
      element.title = this.options.title || "";
      element.style.cssText = "position:absolute;pointer-events:none;opacity:0;background:transparent;border:0;padding:0;box-sizing:border-box;outline:3px solid #005fcc;outline-offset:3px;";
      this.getPane().appendChild(element);
      L.DomEvent.on(element, "click", this._activateCanvasMarker, this);
      L.DomEvent.on(element, "focus", this._focusCanvasMarker, this);
      L.DomEvent.on(element, "blur", this._blurCanvasMarker, this);
      this.on("popupopen popupclose", this._updateCanvasAccessibility, this);
      this._updateCanvasAccessibility();
    },
    _activateCanvasMarker(e) {
      L.DomEvent.stop(e);
      this.fire("click", { originalEvent: e, latlng: this.getLatLng() }, true);
    },
    _focusCanvasMarker() {
      this._positionCanvasAccessibility();
      this._canvasAccessibleElement.style.opacity = "1";
      if (this.options.autoPanOnFocus) {
        markerProto._panOnFocus.call(this);
      }
      if (this.getTooltip()) {
        this.openTooltip();
      }
    },
    _blurCanvasMarker() {
      this._canvasAccessibleElement.style.opacity = "0";
      if (this.getTooltip() && !this.getTooltip().options.permanent) {
        this.closeTooltip();
      }
    },
    /**
     * Per-frame sync: keep N buttons cheap by only toggling visibility and positioning the focused one.
     */
    _syncCanvasAccessibility() {
      const element = this._canvasAccessibleElement, sprite = this._canvasIcon;
      if (!element || !sprite) {
        return;
      }
      if (element.hidden !== sprite._behindCamera) {
        element.hidden = sprite._behindCamera;
      }
      if (element === document.activeElement) {
        this._positionCanvasAccessibility();
      }
    },
    _updateCanvasAccessibility() {
      const element = this._canvasAccessibleElement;
      if (!element) {
        return;
      }
      this._syncCanvasAccessibility();
      if (this.getPopup()) {
        element.setAttribute("aria-expanded", String(this.isPopupOpen()));
        const popup = this.getPopup().getElement();
        if (popup) {
          popup.id = popup.id || `leaflet-marker-popup-${L.Util.stamp(this)}`;
          element.setAttribute("aria-controls", popup.id);
        }
      }
    },
    _positionCanvasAccessibility() {
      const element = this._canvasAccessibleElement, sprite = this._canvasIcon;
      if (!element || !sprite || !sprite._point) {
        return;
      }
      const part = sprite._getPart("icon"), size = part ? part.size : toPoint2(this.options.icon.options.iconSize) || new L.Point(25, 41), anchor = part ? part.anchor : toPoint2(this.options.icon.options.iconAnchor) || size.divideBy(2), scale = this.options.scale ?? 1;
      element.style.width = size.x + "px";
      element.style.height = size.y + "px";
      element.style.marginLeft = -anchor.x + "px";
      element.style.marginTop = -anchor.y + "px";
      element.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
      L.DomUtil.setPosition(element, sprite._point);
      element.style.transform += ` rotate(${this._getIconBearing()}rad) scale(${scale})`;
    },
    _removeCanvasAccessibility() {
      if (!this._canvasAccessibleElement) {
        return;
      }
      L.DomEvent.off(this._canvasAccessibleElement);
      this._canvasAccessibleElement.remove();
      this._canvasAccessibleElement = null;
      this.off("popupopen popupclose", this._updateCanvasAccessibility, this);
    },
    getElement() {
      return this._canvasAccessibleElement || markerProto.getElement.apply(this, arguments);
    },
    /**
     * Remove the DOM icon or the Canvas icon layer.
     *
     * @since leaflet-rotate (0.6.0)
     */
    _removeIcon() {
      this._removeCanvasIcon();
      if (this._icon) {
        markerProto._removeIcon.apply(this, arguments);
      }
    },
    /**
     * @since leaflet-rotate (0.6.0)
     */
    _removeCanvasIcon() {
      this._removeCanvasAccessibility();
      if (this._canvasIcon) {
        this._canvasIcon.remove();
        this._canvasIcon = null;
      }
    },
    /**
     * Reposition the DOM icon or redraw the Canvas icon.
     *
     * @returns {this}
     *
     * @since leaflet-rotate (0.6.0)
     */
    update() {
      if (this._canvasIcon) {
        this._canvasIcon.redraw();
        return this;
      }
      return markerProto.update.apply(this, arguments);
    },
    /**
     * @since leaflet-rotate (0.6.0)
     */
    _updateOpacity() {
      if (this._canvasIcon) {
        this._canvasIcon.redraw();
      }
      return markerProto._updateOpacity.apply(this, arguments);
    },
    // _updateZIndex(offset) {
    //     if (!this._map._rotate) {
    //         return markerProto._updateZIndex.apply(this, arguments);
    //     }
    //     this._icon.style.zIndex = Math.round(this._zIndex + offset);
    // },
    /**
     * Set the marker icon's rotation and redraw it.
     * 
     * @param {number} rotation Angle in radians.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setRotation(rotation) {
      this.options.rotation = rotation;
      this.update();
    }
  });

  // src/layer/tile/GridLayer.js
  var gridLayerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.GridLayer.prototype));
  L.GridLayer.include({
    /**
     * Add a throttled tile refresh after map bearing changes.
     * 
     * @listens L.Map~rotate
     * 
     * @returns {Object} Leaflet event map for the grid layer.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = gridLayerProto.getEvents.apply(this, arguments);
      if (this._map._rotate && !this.options.updateWhenIdle) {
        if (!this._onRotate) {
          this._onRotate = L.Util.throttle(this._onMoveEnd, this.options.updateInterval, this);
        }
        events.rotate = this._onRotateEvent;
      }
      return events;
    },
    _initContainer() {
      gridLayerProto._initContainer.apply(this, arguments);
      if (!this._map._rotate || !this._container) {
        return;
      }
      for (let pane = this._container; pane && pane !== this._map._rotatePane; pane = pane.parentElement) {
        pane.style.transformStyle = "preserve-3d";
      }
    },
    /**
     * Keep tile levels aligned when a bearing/pitch change shifts the pixel origin
     * (eg. when the rotation pivot is not the view center), then refresh tiles (throttled).
     * The first event also synchronizes levels created before any accumulated pans.
     * 
     * @listens L.Map~rotate
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onRotateEvent() {
      const map = this._map;
      if (!map) {
        return;
      }
      const origin = map.getPixelOrigin();
      if ((!this._rotateOrigin || !this._rotateOrigin.equals(origin)) && !map._animatingZoom && this._levels) {
        this._setZoomTransforms(map.getCenter(), map.getZoom());
      }
      this._rotateOrigin = origin;
      this._onRotate();
    },
    /**
     * Return tile pixel bounds that cover the rotated viewport.
     * 
     * @param {L.LatLng} center View center used to calculate bounds.
     * 
     * @returns {L.Bounds} Pixel bounds covered by the layer's tiles.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getTiledPixelBounds(center) {
      if (!this._map._rotate) {
        return gridLayerProto._getTiledPixelBounds.apply(this, arguments);
      }
      return this._map._getNewPixelBounds(center, this._tileZoom);
    }
  });

  // src/layer/vector/Renderer.js
  var rendererProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Renderer.prototype));
  var rendererBase = Object.getPrototypeOf(L.Renderer.prototype);
  var rendererGetEvents = rendererProto.getEvents || rendererBase.getEvents;
  var rendererOnMoveEnd = rendererProto._onMoveEnd || rendererBase._onMoveEnd;
  L.Renderer.include({
    /**
     * Subscribe the renderer to map rotation so its visible bounds are recalculated.
     * 
     * @listens L.Map~rotate
     * 
     * @returns {Object} Leaflet event map for the renderer.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = rendererGetEvents.apply(this, arguments);
      return Object.assign(events, { rotate: this._onRotate });
    },
    /**
     * Refresh renderer bounds after bearing or pitch changes.
     * 
     * Paths are reprojected only when the pixel origin actually changed (eg. fractional centers
     * after an off-center zoom), since reprojection is the main cost with long polylines.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onRotate() {
      if (!this._map._rotate) {
        return;
      }
      const origin = this._map.getPixelOrigin();
      if (!this._rotateOrigin || !this._rotateOrigin.equals(origin)) {
        this._rotateOrigin = origin;
        clearTimeout(this._rotateTimer);
        this._onZoomEnd();
        this._updateAfterRotate();
        return;
      }
      if (this._bounds && this._bounds.contains(this._map._getPaddedPixelBounds(0))) {
        return;
      }
      clearTimeout(this._rotateTimer);
      const wait = (this._lastRotateUpdate || 0) + 100 - performance.now();
      if (wait > 0) {
        this._rotateTimer = setTimeout(() => this._map && this._updateAfterRotate(), wait);
      } else {
        this._updateAfterRotate();
      }
    },
    /**
     * Recalculate renderer bounds and redraw after bearing or pitch changes.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _updateAfterRotate() {
      this._lastRotateUpdate = performance.now();
      if (L.version.startsWith("2.")) {
        this._onMoveEnd();
      } else {
        this._update();
      }
    },
    /**
     * Add the zoom-animation class needed for correct renderer transforms in Leaflet 1.
     *
     * Fixes `map.flyTo()` when `map.options.zoomAnimation` is false.
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    onAdd() {
      rendererProto.onAdd.apply(this, arguments);
      if (L.version <= "1.9.3") {
        this._container.classList.add("leaflet-zoom-animated");
      }
    },
    /**
     * Update the renderer transform during zoom animation, accounting for rotated coordinates.
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * @see https://github.com/Leaflet/Leaflet/pull/8103
     * @see https://github.com/Leaflet/Leaflet/issues/7466
     * 
     * @param {L.LatLng} center Target map center.
     * @param {number} zoom Target zoom level.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updateTransform(center, zoom) {
      const v2 = L.version.startsWith("2.");
      if (!this._map._rotate) {
        return (v2 ? rendererBase : rendererProto)._updateTransform.apply(this, arguments);
      }
      if (!v2 && zoom === this._zoom) {
        return;
      }
      const scale = this._map.getZoomScale(zoom, this._zoom), offset = this._topLeftPoint.multiplyBy(scale).subtract(this._map._getNewPixelOrigin(center, zoom));
      L.DomUtil.setTransform(this._container, offset, scale);
    },
    /**
     * Recalculate bounds and finish renderer updates after movement on Leaflet 2.
     *
     * @param {Object} ev Map movement event.
     * 
     * @since leaflet-rotate (v0.4.0)
     */
    _onMoveEnd(ev) {
      if (!L.version.startsWith("2.") || !this._map._rotate) {
        return rendererOnMoveEnd.apply(this, arguments);
      }
      this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
      this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
      this._center = this._map.getCenter();
      this._zoom = this._map.getZoom();
      this._topLeftPoint = this._map._getNewPixelOrigin(this._center, this._zoom).add(this._bounds.min);
      this._updateTransform(this._center, this._zoom);
      this._resizeContainer();
      this._onSettled(ev);
    },
    /**
     * Resize the renderer container to cover the pitch-aware map bounds.
     * 
     * @since leaflet-rotate (v0.4.0)
     */
    _resizeContainer() {
      if (!L.version.startsWith("2.") || !this._map._rotate || !this._bounds) {
        return rendererBase._resizeContainer.apply(this, arguments);
      }
      const size = this._bounds.getSize();
      this._container.style.width = size.x + "px";
      this._container.style.height = size.y + "px";
      return size;
    },
    // getEvents() {
    //     const events = {
    //         viewreset: this._reset,
    //         zoom: this._onZoom,
    //         moveend: this._update,
    //         zoomend: this._onZoomEnd
    //     };
    //     if (this._zoomAnimated) {
    //         events.zoomanim = this._onAnimZoom;
    //     }
    //     return events;
    // },
    // _onAnimZoom(ev) {
    //     this._updateTransform(ev.center, ev.zoom);
    // },
    // _onZoom() {
    //     this._updateTransform(this._map.getCenter(), this._map.getZoom());
    // },
    // _onZoomEnd() {
    //     for (const id in this._layers) {
    //         this._layers[id]._project();
    //     }
    // },
    // _reset() {
    //     this._update();
    //     this._updateTransform(this._center, this._zoom);
    //     for (const id in this._layers) {
    //         this._layers[id]._reset();
    //     }
    // },
    // _updatePaths() {
    //     for (const id in this._layers) {
    //         this._layers[id]._update();
    //     }
    // },
    /**
     * Recalculate renderer bounds and cached view state.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _update() {
      if (!this._map._rotate) {
        return rendererProto._update.apply(this, arguments);
      }
      this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
      this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
      this._center = this._map.getCenter();
      this._zoom = this._map.getZoom();
      this._topLeftPoint = this._map._getNewPixelOrigin(this._center, this._zoom).add(this._bounds.min);
    }
  });

  // src/map/Map.js
  var mapProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Map.prototype));
  L.Map.mergeOptions({
    /**
     * @type {boolean} Enable bearing and pitch transformations.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotate: false,
    /**
     * @type {number} Initial map bearing in degrees.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bearing: 0,
    /**
     * @type {number} Initial map pitch in degrees, clamped to 0–85.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    pitch: 0,
    /**
     * @type {number} Maximum distance of the pitched map plane from the map center, in multiples
     *                of the map height. Tiles, vectors and `getBounds()` stop there (and always
     *                before the horizon); a `.leaflet-pitch-sky` element fills the area above.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    pitchMaxDistance: 3
  });
  L.Map.include({
    /**
     * Rebuild perspective before Leaflet calculates the origin of a reset view.
     * A reset clears the outer pane translation, unlike a completed pan.
     */
    _resetView() {
      if (this._pitch) {
        delete this._pitchPan;
        L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));
        this._updatePitchTransform();
        arguments[0] = this._limitCenter(arguments[0], arguments[1], this.options.maxBounds);
      }
      return mapProto._resetView.apply(this, arguments);
    },
    /**
     * Apply an immediate animated-zoom frame without waiting for a transition delay.
     *
     * @param {L.LatLng} center Target center.
     * @param {number} zoom Target zoom level.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoomNoDelay(center, zoom) {
      if (!this._mapPane) {
        return;
      }
      this._animatingZoom = true;
      this._animateToCenter = center;
      this._animateToZoom = zoom;
      this._move(center, zoom, void 0, true);
      this._onZoomTransitionEnd();
    },
    /**
     * Initialize the Leaflet map and apply its initial bearing and pitch.
     * 
     * @param {HTMLElement|string} id Map container element or its ID.
     * @param {Object} [options={}] Leaflet map options, including `rotate`, `bearing`, and `pitch`.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(id, options) {
      if (options.rotate) {
        this._rotate = true;
        this._bearing = 0;
        this._pitch = 0;
      }
      mapProto.initialize.apply(this, arguments);
      if (this.options.rotate) {
        this.on("resize", this._updatePitchTransform, this);
        this.on("movestart dragstart", this._startPitchPan, this);
        this.on("move", this._updatePitchPan, this);
        this.on("moveend", this._endPitchPan, this);
        this.on("move", this._updatePitchSky, this);
        this.on("rotate", this._panInsideMaxBounds, this);
        this.setBearing(this.options.bearing);
        this.setPitch(this.options.pitch);
      }
    },
    /**
     * Given a pixel coordinate relative to the map container,
     * returns the corresponding pixel coordinate relative to
     * the [origin pixel](#map-getpixelorigin).
     * 
     * @param {L.Point|number[]} point Pixel coordinate in the map container.
     * 
     * @returns {L.Point} Corresponding layer-point coordinate.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    containerPointToLayerPoint(point) {
      if (!this._rotate) {
        return mapProto.containerPointToLayerPoint.apply(this, arguments);
      }
      if (this._pitch) {
        return this._transformPitchPoint(
          toPoint(point).subtract(this._getMapPanePos()),
          this._pitchInverseTransform
        );
      }
      return toPoint(point).subtract(this._getMapPanePos()).rotateFrom(-this._bearing, this._getRotatePanePos()).subtract(this._getRotatePanePos());
    },
    /**
     * Given a pixel coordinate relative to the [origin pixel](#map-getpixelorigin),
     * returns the corresponding pixel coordinate relative to the map container.
     * 
     * @param {L.Point|number[]} point Pixel coordinate in layer-point space.
     * 
     * @returns {L.Point} Corresponding pixel coordinate in the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    layerPointToContainerPoint(point) {
      if (!this._rotate) {
        return mapProto.layerPointToContainerPoint.apply(this, arguments);
      }
      if (this._pitch) {
        return this._transformPitchPoint(point, this._pitchTransform).add(this._getMapPanePos());
      }
      return toPoint(point).add(this._getRotatePanePos()).rotateFrom(this._bearing, this._getRotatePanePos()).add(this._getMapPanePos());
    },
    /**
     * Converts a coordinate from the rotated pane reference system
     * to the reference system of the not rotated map pane.
     * 
     * (rotatePane) --> (mapPane)
     * (rotatePane) --> (norotatePane)
     * 
     * @param {L.Point|number[]} point Point in the rotated pane.
     * 
     * @returns {L.Point} Corresponding point in map-pane coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotatedPointToMapPanePoint(point) {
      if (this._pitch) {
        return this._transformPitchPoint(point, this._pitchTransform);
      }
      return toPoint(point).rotate(this._bearing)._add(this._getRotatePanePos());
    },
    /**
     * Converts a coordinate from the not rotated map pane reference system
     * to the reference system of the rotated pane.
     * 
     * (mapPane) --> (rotatePane)
     * (norotatePane) --> (rotatePane)
     * 
     * @param {L.Point|number[]} point Point in map-pane coordinates.
     * 
     * @returns {L.Point} Corresponding point in the rotated pane.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    mapPanePointToRotatedPoint(point) {
      if (this._pitch) {
        return this._transformPitchPoint(point, this._pitchInverseTransform);
      }
      return toPoint(point)._subtract(this._getRotatePanePos()).rotate(-this._bearing);
    },
    // latLngToLayerPoint(latlng) {
    //     const projectedPoint = this.project(L.latLng(latlng))._round();
    //     return projectedPoint._subtract(this.getPixelOrigin());
    // },
    // latLngToContainerPoint(latlng) {
    // 	return this.layerPointToContainerPoint(this.latLngToLayerPoint(toLatLng(latlng)));
    // },
    /**
     * Given latlng bounds, returns the bounds in projected pixel
     * relative to the map container.
     * 
     * @see https://github.com/ronikar/Leaflet/blob/5c480ef959b947c3beed7065425a5a36c486262b/src/map/Map.js#L1114-L1135
     * 
     * @param {L.LatLngBounds} bounds Geographic bounds to project.
     * 
     * @returns {L.Bounds} Axis-aligned bounds in container-pixel coordinates.
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    mapBoundsToContainerBounds(bounds) {
      if (!this._rotate && mapProto.mapBoundsToContainerBounds) {
        return mapProto.mapBoundsToContainerBounds.apply(this, arguments);
      }
      const origin = this.getPixelOrigin();
      const nw = this.layerPointToContainerPoint(this.project(bounds.getNorthWest())._subtract(origin)), ne = this.layerPointToContainerPoint(this.project(bounds.getNorthEast())._subtract(origin)), sw = this.layerPointToContainerPoint(this.project(bounds.getSouthWest())._subtract(origin)), se = this.layerPointToContainerPoint(this.project(bounds.getSouthEast())._subtract(origin));
      return new L.Bounds([
        new L.Point(Math.min(nw.x, ne.x, se.x, sw.x), Math.min(nw.y, ne.y, se.y, sw.y)),
        // [ minX, minY ]
        new L.Point(Math.max(nw.x, ne.x, se.x, sw.x), Math.max(nw.y, ne.y, se.y, sw.y))
        // [ maxX, maxY ]
      ]);
    },
    /**
     * Return the geographic bounds of the current viewport, accounting for rotation and pitch.
     * 
     * The result encloses the four corners of the visible ground rectangle. With pitch,
     * the rectangle stops at the configured far plane, excluding the sky.
     * 
     * @returns {L.LatLngBounds} Geographic bounds visible in the map viewport.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getBounds() {
      if (!this._rotate) {
        return mapProto.getBounds.apply(this, arguments);
      }
      const [min, max] = this._getPitchedContainerBounds(0);
      return new L.LatLngBounds([
        this.containerPointToLatLng([min.x, min.y]),
        // topleft
        this.containerPointToLatLng([max.x, min.y]),
        // topright 
        this.containerPointToLatLng([max.x, max.y]),
        // bottomright
        this.containerPointToLatLng([min.x, max.y])
        // bottomleft
      ]);
    },
    /**
     * Return the container rectangle covering the visible map plane, optionally padded by a
     * fraction of the map size. When pitched, its top is cut at the far plane (see `pitchMaxDistance`)
     * so that it never reaches the horizon, where the plane would extend to infinity.
     * 
     * @param {number} padding Padding as a fraction of the map size.
     * 
     * @returns {L.Point[]} Top-left and bottom-right container points.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _getPitchedContainerBounds(padding) {
      const size = this.getSize(), min = size.multiplyBy(-padding), max = size.multiplyBy(1 + padding);
      if (this._pitch) {
        min.y = Math.min(Math.max(min.y, this._getPitchFarY()), max.y);
      }
      return [min, max];
    },
    /**
     * Return the container y coordinate of the far plane: points above it are farther than
     * `pitchMaxDistance` from the map center, or beyond the horizon.
     * 
     * @returns {number} Container y coordinate (`-Infinity` when the whole map is close enough).
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _getPitchFarY() {
      const size = this.getSize(), inverse = this._pitchInverseTransform, panePos = this._getMapPanePos(), x = size.x / 2 - panePos.x, centerY = size.y / 2 - panePos.y, maxDistance = this.options.pitchMaxDistance * size.y, w = (y) => inverse.g * x + inverse.h * y + inverse.i, centerW = w(centerY), center = this._transformPitchPoint([x, centerY], inverse), isNear = (y) => w(y) * centerW > 0 && this._transformPitchPoint([x, y], inverse).distanceTo(center) <= maxDistance;
      let far = -size.y - panePos.y, near = centerY;
      if (isNear(far)) {
        return -Infinity;
      }
      for (let i = 0; i < 20; i++) {
        const mid = (far + near) / 2;
        if (isNear(mid)) {
          near = mid;
        } else {
          far = mid;
        }
      }
      return near + panePos.y;
    },
    /**
     * Returns the bounds of the current map view in projected pixel
     * coordinates (sometimes useful in layer and overlay implementations).
     * 
     * @TODO find out if map bounds calculated by `L.Map::getPixelBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     * 
     * @returns {L.Bounds}
     */
    // getPixelBounds(center, zoom) {
    //     // const topLeftPoint = map.containerPointToLayerPoint(this._getTopLeftPoint());
    //     const topLeftPoint = this._getTopLeftPoint(center, zoom);
    //       return new L.Bounds(topLeftPoint, topLeftPoint.add(this.getSize()));
    // },
    /**
     * Set the map bearing, optionally animating to the new value.
     * 
     * @param {number} theta Target bearing in degrees; normalized to [0, 360).
     * @param {Object} [options] Animation options.
     * @param {boolean} [options.animate=false] Animate the change.
     * @param {number} [options.duration=0.25] Animation duration in seconds.
     * @param {number} [options.easeLinearity=0.5] Easing curve linearity.
     * 
     * @returns {void}
     * 
     * @fires L.Map#rotate
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setBearing(theta, options) {
      if (!this._rotate) {
        return;
      }
      if (options && options.animate) {
        this._animatePitchBearing(this.getPitch(), theta, options);
        return;
      }
      this._stopPitchBearingAnimation();
      this._setBearing(theta);
    },
    /**
     * Animate pitch and bearing together (bearing follows the shortest path).
     * 
     * @param {number} pitch Target pitch in degrees.
     * @param {number} bearing Target bearing in degrees.
     * @param {Object} [options] Animation options.
     * @param {number} [options.duration=0.25] Animation duration in seconds.
     * @param {number} [options.easeLinearity=0.5] Easing curve linearity.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _animatePitchBearing(pitch, bearing, options) {
      this._stopPitchBearingAnimation();
      const animationId = this._bearingAnimationId;
      const startBearing = this.getBearing(), startPitch = this.getPitch(), endBearing = L.Util.wrapNum(bearing, [0, 360]), endPitch = Math.max(0, Math.min(pitch, 85)), delta = (endBearing - startBearing + 540) % 360 - 180, duration = Math.max(0, options.duration == null ? 0.25 : options.duration) * 1e3, easeLinearity = Math.max(options.easeLinearity || 0.5, 0.2), startTime = performance.now();
      const animate = function() {
        if (!this._mapPane || this._bearingAnimationId !== animationId) {
          return;
        }
        const progress = duration ? Math.min((performance.now() - startTime) / duration, 1) : 1, eased = 1 - Math.pow(1 - progress, 1 / easeLinearity);
        if (progress < 1) {
          this._bearingAnimationFrame = requestAnimationFrame(animate.bind(this));
        } else {
          delete this._bearingAnimationFrame;
        }
        this._setPitchAndBearing(
          progress === 1 ? endPitch : startPitch + (endPitch - startPitch) * eased,
          progress === 1 ? endBearing : startBearing + delta * eased
        );
      };
      this._bearingAnimationFrame = requestAnimationFrame(animate.bind(this));
    },
    /**
     * Cancel a running pitch/bearing animation.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _stopPitchBearingAnimation() {
      this._bearingAnimationId = (this._bearingAnimationId || 0) + 1;
      if (this._bearingAnimationFrame) {
        cancelAnimationFrame(this._bearingAnimationFrame);
        delete this._bearingAnimationFrame;
      }
    },
    /**
     * Rotate the map back to north (bearing 0), animated by default.
     * 
     * @param {Object} [options] Animation options (`animate`, `duration`, `easeLinearity`).
     * 
     * @returns {L.Map} This map instance.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    resetNorth(options) {
      options = Object.assign({ animate: true, duration: 0.5 }, options);
      if (options.animate) {
        this._animatePitchBearing(this.getPitch(), 0, options);
      } else {
        this.setBearing(0);
      }
      return this;
    },
    /**
     * Rotate the map back to north and remove the pitch, animated by default.
     * 
     * @param {Object} [options] Animation options (`animate`, `duration`, `easeLinearity`).
     * 
     * @returns {L.Map} This map instance.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    resetNorthPitch(options) {
      options = Object.assign({ animate: true, duration: 0.5 }, options);
      if (options.animate) {
        this._animatePitchBearing(0, 0, options);
      } else {
        this._stopPitchBearingAnimation();
        this._setPitchAndBearing(0, 0);
      }
      return this;
    },
    /**
     * Apply a bearing immediately and update the rotated pane and map coordinates.
     * 
     * @param {number} theta Bearing in degrees.
     * @param {L.LatLng} [mapCenter] Center to preserve while applying the change.
     * 
     * @fires L.Map#rotate
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _setBearing(theta, mapCenter) {
      if (!mapCenter && this._loaded) {
        mapCenter = this.getCenter();
      }
      const bearing = L.Util.wrapNum(theta, [0, 360]) * (Math.PI / 180), center = this._getPixelCenter(), oldPos = this._getRotatePanePos().rotateFrom(-this._bearing, center), newPos = oldPos.rotateFrom(bearing, center);
      this._pivot = center;
      this._bearing = bearing;
      this._rotatePanePos = newPos;
      if (this._pitch) {
        this._rotatePane._leaflet_pos = oldPos;
        this._updatePitchTransform();
      } else {
        L.DomUtil.setPosition(this._rotatePane, oldPos, bearing, center);
      }
      if (mapCenter) {
        this._pixelOrigin = this.project(mapCenter, this._zoom).subtract(this.containerPointToLayerPoint(this.getSize().divideBy(2)));
        delete this._lastCenter;
        this.fire("move");
      }
      this.fire("rotate");
    },
    /**
     * Transform a ground-plane point with a DOMMatrix, or reverse its screen projection.
     * Both branches divide by the homogeneous coordinate after applying the matrix.
     * 
     * @param {L.Point|number[]} point Input pixel coordinate.
     * @param {DOMMatrix|Object} matrix Forward CSS matrix or inverse homography with
     *                                row-major coefficients `a` through `i`.
     * @param {L.Point} [anchor] Keep inverse pan coordinates on this anchor's side of the horizon.
     * 
     * @returns {L.Point} Transformed pixel coordinate.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _transformPitchPoint(point, matrix, anchor) {
      point = toPoint(point);
      if (!(matrix instanceof DOMMatrix)) {
        if (anchor) {
          const anchorW = matrix.g * anchor.x + matrix.h * anchor.y + matrix.i, pointW = matrix.g * point.x + matrix.h * point.y + matrix.i;
          if (pointW * anchorW <= 0) {
            point = anchor.add(point.subtract(anchor).multiplyBy(anchorW / (anchorW - pointW) * (1 - 1e-6)));
          }
        }
        const denominator2 = matrix.g * point.x + matrix.h * point.y + matrix.i;
        return new L.Point(
          (matrix.a * point.x + matrix.b * point.y + matrix.c) / denominator2,
          (matrix.d * point.x + matrix.e * point.y + matrix.f) / denominator2
        );
      }
      const denominator = matrix.m14 * point.x + matrix.m24 * point.y + matrix.m44;
      return new L.Point(
        (matrix.m11 * point.x + matrix.m21 * point.y + matrix.m41) / denominator,
        (matrix.m12 * point.x + matrix.m22 * point.y + matrix.m42) / denominator
      );
    },
    /**
     * Apply the current pitch/bearing CSS transform and cache its forward and inverse matrices.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchTransform() {
      if (!this._pitch || !this._rotatePane) {
        return;
      }
      const pivot = this._getPixelCenter(), size = this.getSize(), perspective = Math.max(1, size.y * 1.5), position = this._rotatePane._leaflet_pos || new L.Point(0, 0), transform = `translate3d(${pivot.x}px,${pivot.y}px,0) perspective(${perspective}px) rotateX(${this.getPitch()}deg) rotateZ(${this.getBearing()}deg) translate3d(${position.x - pivot.x}px,${position.y - pivot.y}px,0)`;
      this._setPitchTransform(transform);
    },
    /**
     * Apply the CSS transform and cache matching forward/inverse point conversions.
     *
     * Ground points have z = 0, so the 4x4 CSS matrix reduces to the homography
     * [a b c; d e f; g h i]. Its inverse maps screen points back onto that plane;
     * inverting the full 4x4 matrix at screen z = 0 would not undo perspective.
     *
     * @param {string} transform CSS transform list, including a serialized DOMMatrix.
     * 
     * @since leaflet-rotate (0.5.2)
     */
    _setPitchTransform(transform) {
      this._rotatePane.style.transformOrigin = "0 0";
      const matrix = this._pitchTransform = new DOMMatrix(transform), a = matrix.m11, b = matrix.m21, c = matrix.m41, d = matrix.m12, e = matrix.m22, f = matrix.m42, g = matrix.m14, h = matrix.m24, i = matrix.m44, determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
      const ground = DOMMatrix.fromMatrix(matrix);
      ground.m13 = ground.m23 = ground.m43 = 0;
      this._rotatePane.style.transform = `matrix3d(${Array.from(ground.toFloat64Array(), (value) => value * 1e3).join(",")})`;
      this._pitchInverseTransform = {
        a: (e * i - f * h) / determinant,
        b: (c * h - b * i) / determinant,
        c: (b * f - c * e) / determinant,
        d: (f * g - d * i) / determinant,
        e: (a * i - c * g) / determinant,
        f: (c * d - a * f) / determinant,
        g: (d * h - e * g) / determinant,
        h: (b * g - a * h) / determinant,
        i: (a * e - b * d) / determinant
      };
      this._updatePitchSky();
    },
    /**
     * Capture a fixed projection baseline for a pitched drag or programmatic pan.
     *
     * `movestart` uses the viewport center; `dragstart` replaces it with the original
     * pointer position. Store both the screen anchor and its ground-plane coordinate
     * so subsequent frames can keep the grabbed geographic point under the pointer.
     * Pane positions are in screen pixels and the baseline matrices stay unchanged.
     *
     * @param {L.Event} e Leaflet `movestart` or `dragstart` event.
     * 
     * @since leaflet-rotate (0.5.2)
     */
    _startPitchPan(e) {
      if (!this._pitch || !this._loaded) {
        return;
      }
      const draggable = this.dragging && this.dragging._draggable, anchor = e.type === "dragstart" && draggable ? (this.pointerEventToContainerPoint || this.mouseEventToContainerPoint).call(this, {
        clientX: draggable._startPoint.x,
        clientY: draggable._startPoint.y
      }) : this.getSize().divideBy(2), panePos = this._getMapPanePos().clone();
      this._pitchPan = {
        anchor,
        panePos,
        lastPanePos: panePos,
        matrix: this._pitchTransform,
        inverse: this._pitchInverseTransform,
        layerAnchor: this.containerPointToLayerPoint(anchor),
        zoom: this._zoom
      };
    },
    /**
     * Translate the ground plane without moving the camera's vanishing point.
     *
     * For pane displacement delta, invert the displaced anchor with the baseline
     * projection to find the required layer-space shift. Compose
     * T(-delta) * baseline * T(shift): the left translation cancels Leaflet's outer
     * pane movement, while the right translation moves geography before perspective.
     * Always derive this from the baseline, not the previous frame, to avoid drift.
     * Zoom frames are handled by Leaflet's zoom/origin updates instead.
     * 
     * @since leaflet-rotate (0.5.2)
     */
    _updatePitchPan() {
      const pan = this._pitchPan;
      if (!this._pitch || !pan || this._animatingZoom || this._zoom !== pan.zoom) {
        return;
      }
      const panePos = this._getMapPanePos();
      if (panePos.equals(pan.lastPanePos)) {
        return;
      }
      const delta = panePos.subtract(pan.panePos), target = this._transformPitchPoint(pan.anchor.add(delta).subtract(pan.panePos), pan.inverse), shift = target.subtract(pan.layerAnchor);
      const matrix = new DOMMatrix().translate(-delta.x, -delta.y).multiply(pan.matrix).translate(shift.x, shift.y);
      this._setPitchTransform(matrix.toString());
      pan.lastPanePos = panePos.clone();
      delete this._lastCenter;
    },
    /**
     * Discard the baseline only at `moveend`, after any drag inertia has completed.
     * Keep the final transform and pixel origin: resetting the view here would
     * reproject layers abruptly and cause a visible jump on release.
     * 
     * @since leaflet-rotate (0.5.2)
     */
    _endPitchPan() {
      delete this._pitchPan;
    },
    /**
     * Fill the area above the far plane (where no tiles are loaded) with a sky gradient.
     * Style it through `.leaflet-pitch-sky` or the `--leaflet-sky-background` CSS property.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _updatePitchSky() {
      const farY = this._pitch && this._pitchInverseTransform ? this._getPitchFarY() : -Infinity;
      if (farY <= 0) {
        if (this._pitchSky) {
          this._pitchSky.style.display = "none";
        }
        return;
      }
      if (!this._pitchSky) {
        this._pitchSky = L.DomUtil.create("div", "leaflet-pitch-sky", this._container);
        Object.assign(this._pitchSky.style, {
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          zIndex: 0,
          pointerEvents: "none",
          background: "var(--leaflet-sky-background, linear-gradient(#9ec5e8, #dfe9f0))"
        });
      }
      this._pitchSky.style.display = "";
      this._pitchSky.style.height = `${Math.ceil(farY) + 1}px`;
    },
    /**
     * Set the map pitch in degrees. Values are clamped to the range 0–85.
     *
     * @param {number} pitch Pitch angle in degrees; clamped to [0, 85].
     * @param {Object} [options] Animation options (`animate`, `duration`, `easeLinearity`).
     * 
     * @returns {L.Map} This map instance.
     * 
     * @fires L.Map#pitch
     * 
     * @since leaflet-rotate (0.5.0)
     */
    setPitch(pitch, options) {
      if (options && options.animate) {
        this._animatePitchBearing(pitch, this.getBearing(), options);
        return this;
      }
      this._stopPitchBearingAnimation();
      this._setPitchAndBearing(pitch, this.getBearing());
      return this;
    },
    /**
     * Update pitch and bearing together, preserving the current map center.
     * Used by the Ctrl+drag handler to avoid applying two separate transforms.
     * 
     * @param {number} pitch Pitch angle in degrees.
     * @param {number} bearing Bearing angle in degrees.
     * 
     * @fires L.Map#pitch
     * @fires L.Map#rotate
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _setPitchAndBearing(pitch, bearing) {
      if (!this._rotate) {
        return;
      }
      const clampedPitch = Math.max(0, Math.min(pitch, 85)) * (Math.PI / 180), clampedBearing = L.Util.wrapNum(bearing, [0, 360]) * (Math.PI / 180), pitchChanged = clampedPitch !== this._pitch;
      if (!pitchChanged && clampedBearing === this._bearing) {
        return;
      }
      const mapCenter = this._loaded ? this.getCenter() : void 0;
      if (pitchChanged) {
        this._pitch = clampedPitch;
        this._rotatePane.style.transformOrigin = L.version.startsWith("2.") ? "0 0" : "";
      }
      this._setBearing(bearing, mapCenter);
      if (pitchChanged) {
        if (!this._pitch) {
          this._updatePitchSky();
        }
        this.fire("pitch");
      }
    },
    /**
     * Get the current map pitch in degrees.
     * 
     * @returns {number} Pitch angle in degrees.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    getPitch() {
      return (this._pitch || 0) * (180 / Math.PI);
    },
    /**
     * Zoom while keeping the given point fixed on screen, also when the map is pitched.
     *
     * Leaflet interpolates in container space, which is not linear under perspective;
     * interpolating in layer space keeps the point under the cursor.
     *
     * @param {L.LatLng|L.Point} latlng Geographic point or container point to keep fixed.
     * @param {number} zoom Target zoom level.
     * @param {Object} [options] Zoom options.
     *
     * @returns {L.Map} This map instance.
     *
     * @since leaflet-rotate (0.5.1)
     */
    setZoomAround(latlng, zoom, options) {
      if (!this._pitch) {
        return mapProto.setZoomAround.apply(this, arguments);
      }
      const scale = this.getZoomScale(zoom), size = this.getSize(), center = this.containerPointToLayerPoint(size.divideBy(2)), containerPoint = latlng instanceof L.Point ? latlng : this.latLngToContainerPoint(latlng), point = this.containerPointToLayerPoint(containerPoint), newCenter = this.layerPointToLatLng(center.add(point.subtract(center).multiplyBy(1 - 1 / scale)));
      options = Object.assign({}, options);
      if (options.animate === void 0 && new L.Bounds(new L.Point(0, 0), size).contains(containerPoint)) {
        options.animate = true;
      }
      return this.setView(newCenter, zoom, { zoom: options });
    },
    /**
     * Get the current map bearing. Enable the `rotate` map option before calling.
     * 
     * @returns {number} Bearing in degrees, normalized to [0, 360).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getBearing() {
      return this._bearing * (180 / Math.PI);
    },
    /**
     * Creates a new [map pane](#map-pane) with the given name if it doesn't
     * exist already, then returns it. The pane is created as a child of
     * `container`, or as a child of the main map pane if not set.
     * 
     * @param {String} name leaflet pane
     * @param {HTMLElement} [container] parent element
     * 
     * @returns {HTMLElement} pane container
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    // createPane(name, container) {
    //     if (!this._rotate || name == 'mapPane') {
    //         return mapProto.createPane.apply(this, arguments);
    //     }
    //     // init "rotatePane"
    //     if (!this._rotatePane) {
    //         // this._pivot = this.getSize().divideBy(2);
    //         this._rotatePane = mapProto.createPane.call(this, 'rotatePane', this._mapPane);
    //         L.DomUtil.setPosition(this._rotatePane, new L.Point(0, 0), this._bearing, this._pivot);
    //     }
    //     return mapProto.createPane.call(this, name, container || this._rotatePane);
    // },
    /**
     * Panes are DOM elements used to control the ordering of layers on
     * the map. You can access panes with [`map.getPane`](#map-getpane)
     * or [`map.getPanes`](#map-getpanes) methods. New panes can be created
     * with the [`map.createPane`](#map-createpane) method.
     * 
     * Every map has the following default panes that differ only in zIndex:
     * 
     * - mapPane     [HTMLElement = 'auto'] - Pane that contains all other map panes
     * - tilePane    [HTMLElement = 2]      - Pane for tile layers
     * - overlayPane [HTMLElement = 4]      - Pane for overlays like polylines and polygons
     * - shadowPane  [HTMLElement = 5]      - Pane for overlay shadows (e.g. marker shadows)
     * - markerPane  [HTMLElement = 6]      - Pane for marker icons
     * - tooltipPane [HTMLElement = 650]    - Pane for tooltips.
     * - popupPane   [HTMLElement = 700]    - Pane for popups.
     */
    /**
     * Create the map's panes, placing tile/vector layers in the transformed pane
     * and markers/overlays in the pane that remains upright.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _initPanes() {
      const panes = this._panes = {};
      this._paneRenderers = {};
      this._mapPane = this.createPane("mapPane", this._container);
      L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));
      if (this._rotate) {
        this._rotatePane = this.createPane("rotatePane", this._mapPane);
        this._mapPane.style.transformStyle = this._rotatePane.style.transformStyle = "preserve-3d";
        this._norotatePane = this.createPane("norotatePane", this._mapPane);
        if (L.version.startsWith("2.")) {
          this._rotatePane.style.transformOrigin = "0 0";
        }
        this.createPane("tilePane", this._rotatePane);
        this.createPane("overlayPane", this._rotatePane);
        this.createPane("shadowPane", this._norotatePane);
        this.createPane("markerPane", this._norotatePane);
        this.createPane("tooltipPane", this._norotatePane);
        this.createPane("popupPane", this._norotatePane);
      } else {
        this.createPane("tilePane");
        this.createPane("overlayPane");
        this.createPane("shadowPane");
        this.createPane("markerPane");
        this.createPane("tooltipPane");
        this.createPane("popupPane");
      }
      if (!this.options.markerZoomAnimation) {
        panes.markerPane.classList.add("leaflet-zoom-hide");
        panes.shadowPane.classList.add("leaflet-zoom-hide");
      }
    },
    /**
     * Pans the map the minimum amount to make the `latlng` visible. Use
     * padding options to fit the display to more restricted bounds.
     * If `latlng` is already within the (optionally padded) display bounds,
     * the map will not be panned.
     * 
     * @see https://github.com/Raruto/leaflet-rotate/issues/18
     * 
     * @param {L.LatLng} latlng Geographic point to keep visible.
     * @param {Object} [options={}] Padding options (`padding`, `paddingTopLeft`, `paddingBottomRight`).
     * 
     * @returns {L.Map} current map instance
     * 
     * @since leaflet-rotate (v0.1.4)
     */
    panInside(latlng, options) {
      if (!this._rotate || !this._pitch && Math.abs(this._bearing).toFixed(1) < 0.1) {
        return mapProto.panInside.apply(this, arguments);
      }
      options = options || {};
      const paddingTL = toPoint(options.paddingTopLeft || options.padding || [0, 0]), paddingBR = toPoint(options.paddingBottomRight || options.padding || [0, 0]), pixelPoint = this.latLngToContainerPoint(latlng), pixelBounds = new L.Bounds([new L.Point(0, 0), this.getSize()]), pixelCenter = pixelBounds.getCenter(), paddedBounds = new L.Bounds([pixelBounds.min.add(paddingTL), pixelBounds.max.subtract(paddingBR)]), paddedSize = paddedBounds.getSize();
      if (!paddedBounds.contains(pixelPoint)) {
        this._enforcingBounds = true;
        const centerOffset = pixelPoint.subtract(paddedBounds.getCenter());
        const offset = paddedBounds.extend(pixelPoint).getSize().subtract(paddedSize);
        pixelCenter.x += centerOffset.x < 0 ? -offset.x : offset.x;
        pixelCenter.y += centerOffset.y < 0 ? -offset.y : offset.y;
        this.panTo(this.containerPointToLatLng(pixelCenter), options);
        this._enforcingBounds = false;
      }
      return this;
    },
    /**
     * Constrain the visible ground footprint, including its asymmetric pitched far side.
     * When it is larger than maxBounds, Leaflet's rebound centers the excess on each axis.
     */
    _limitCenter(center, zoom, bounds) {
      if (!this._rotate || !bounds) {
        return mapProto._limitCenter.apply(this, arguments);
      }
      const centerPoint = this.project(center, zoom), layerCenter = this.containerPointToLayerPoint(this.getSize().divideBy(2)), footprint = this._getPaddedPixelBounds(0, false), viewBounds = new L.Bounds(
        centerPoint.add(footprint.min.subtract(layerCenter)),
        centerPoint.add(footprint.max.subtract(layerCenter))
      ), offset = this._getBoundsOffset(viewBounds, bounds, zoom);
      if (Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1) {
        return center;
      }
      return this.unproject(centerPoint.add(offset), zoom);
    },
    _panInsideMaxBounds() {
      if (this.options.maxBounds) {
        return mapProto._panInsideMaxBounds.apply(this, arguments);
      }
    },
    panInsideBounds(bounds, options) {
      if (this._rotate) {
        bounds = bounds instanceof L.LatLngBounds ? bounds : new L.LatLngBounds(bounds);
        const center = this.getCenter(), limited = this._limitCenter(center, this._zoom, bounds);
        const offset = this._getCenterOffset(limited);
        if (!center.equals(limited) && Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1) {
          this._enforcingBounds = true;
          this.setView(limited, this._zoom, { reset: true });
          this._enforcingBounds = false;
          return this;
        }
      }
      return mapProto.panInsideBounds.apply(this, arguments);
    },
    /**
     * Leaflet supplies inertia offsets in screen pixels, not projected CRS pixels.
     * Keep the drag's moving anchor when inertia continues a pitched pan.
     */
    _limitOffset(offset, bounds) {
      if (!this._rotate || !bounds) {
        return mapProto._limitOffset.apply(this, arguments);
      }
      const pan = this._pitchPan, anchor = pan ? pan.anchor.add(this._getMapPanePos().subtract(pan.panePos)) : this.getSize().divideBy(2), layerAnchor = this.containerPointToLayerPoint(anchor), panePos = this._getMapPanePos(), target = anchor.subtract(offset).subtract(panePos), shift = (this._pitch ? this._transformPitchPoint(target, this._pitchInverseTransform, anchor.subtract(panePos)) : this.containerPointToLayerPoint(anchor.subtract(offset))).subtract(layerAnchor), footprint = this._getPaddedPixelBounds(0, false), origin = this.getPixelOrigin().subtract(shift), correction = this._getBoundsOffset(new L.Bounds(
        footprint.min.add(origin),
        footprint.max.add(origin)
      ), bounds);
      return anchor.subtract(this.layerPointToContainerPoint(layerAnchor.add(shift).subtract(correction)));
    },
    panBy(offset, options) {
      offset = toPoint(offset);
      if (this._rotate && this._loaded && !this.getSize().contains(offset) && !(options && options.animate)) {
        const anchor = this.getSize().divideBy(2), panePos = this._getMapPanePos(), layerAnchor = this.containerPointToLayerPoint(anchor), target = anchor.subtract(offset).subtract(panePos), shift = (this._pitch ? this._transformPitchPoint(target, this._pitchInverseTransform, anchor.subtract(panePos)) : this.containerPointToLayerPoint(anchor.subtract(offset))).subtract(layerAnchor), center = this.unproject(this.project(this.getCenter()).subtract(shift));
        this._resetView(this._limitCenter(center, this._zoom, this.options.maxBounds), this._zoom);
        return this;
      }
      return mapProto.panBy.call(this, offset, options);
    },
    // @method flyToBounds(bounds: LatLngBounds, options?: fitBounds options): this
    // Sets the view of the map with a smooth animation like [`flyTo`](#map-flyto),
    // but takes a bounds parameter like [`fitBounds`](#map-fitbounds).
    // flyToBounds(bounds, options) {
    //     const target = this._getBoundsCenterZoom(bounds, options);
    //     return this.flyTo(target.center, target.zoom, options);
    // },
    // _getBoundsCenterZoom(bounds, options) {
    //
    //     options = options || {};
    //     bounds = bounds.getBounds ? bounds.getBounds() : toLatLngBounds(bounds);
    //
    //     const paddingTL = L.point(options.paddingTopLeft || options.padding || [0, 0]),
    //           paddingBR = L.point(options.paddingBottomRight || options.padding || [0, 0]);
    //
    //     let zoom = this.getBoundsZoom(bounds, false, paddingTL.add(paddingBR));
    //
    //     zoom = (typeof options.maxZoom === 'number') ? Math.min(options.maxZoom, zoom) : zoom;
    //
    //     if (zoom === Infinity) {
    //         return { center: bounds.getCenter(), zoom };
    //     }
    //
    //     return { center, zoom };
    //
    // },
    /**
     * Returns the maximum zoom level on which the given bounds fit to the map
     * view in its entirety. If `inside` (optional) is set to `true`, the method
     * instead returns the minimum zoom level on which the map view fits into
     * the given bounds in its entirety.
     * 
     * @param {L.LatLngBounds} bounds Geographic bounds to fit.
     * @param {boolean} [inside=false] Fit the viewport inside bounds instead of bounds inside the viewport.
     * @param {L.Point|number[]} [padding=[0,0]] Pixel padding around the viewport.
     * 
     * @returns {number} Zoom level satisfying the fit.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getBoundsZoom(bounds, inside, padding) {
      if (!this._rotate || !this._pitch && Math.abs(this._bearing).toFixed(1) < 0.1) {
        return mapProto.getBoundsZoom.apply(this, arguments);
      }
      bounds = bounds instanceof L.LatLngBounds ? bounds : new L.LatLngBounds(bounds);
      padding = toPoint(padding || [0, 0]);
      let zoom = this.getZoom() || 0;
      const min = this.getMinZoom(), max = this.getMaxZoom(), size = this.getSize().subtract(padding), boundsSize = this.mapBoundsToContainerBounds(bounds).getSize(), snap = this.options.zoomSnap, scalex = size.x / boundsSize.x, scaley = size.y / boundsSize.y, scale = inside ? Math.max(scalex, scaley) : Math.min(scalex, scaley);
      zoom = this.getScaleZoom(scale, zoom);
      if (snap) {
        zoom = Math.round(zoom / (snap / 100)) * (snap / 100);
        zoom = inside ? Math.ceil(zoom / snap) * snap : Math.floor(zoom / snap) * snap;
      }
      return Math.max(min, Math.min(max, zoom));
    },
    /**
     * Layer point of the current center
     * 
     * @returns {L.Point} layer center
     */
    // _getCenterLayerPoint() {
    //    return this.containerPointToLayerPoint(this.getSize()._divideBy(2));
    // },
    /**
     * Return the screen-space pan offset needed to center the given geographic point.
     * Under perspective, projecting a negated layer offset is not equivalent to
     * negating its screen projection. Reflect the target about the layer center
     * to match the opposite anchor displacement performed by Leaflet's `panBy`.
     * 
     * @param {L.LatLng} latlng Geographic point.
     * 
     * @returns {L.Point} Offset in container pixels (the map pane is panned in screen space), adjusted for bearing and pitch.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getCenterOffset(latlng) {
      if (!this._rotate) {
        return mapProto._getCenterOffset.apply(this, arguments);
      }
      if (this._pitch) {
        const center = this.getSize().divideBy(2), layerCenter = this.containerPointToLayerPoint(center), opposite = layerCenter.multiplyBy(2).subtract(this.project(latlng).subtract(this._pixelOrigin));
        return center.subtract(this.layerPointToContainerPoint(opposite));
      }
      return this.latLngToContainerPoint(latlng)._subtract(this.getSize()._divideBy(2));
    },
    /**
     * Return the current position of the rotated pane.
     * 
     * @returns {L.Point} Rotated-pane position in map-pane coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getRotatePanePos() {
      return this._rotatePanePos || new L.Point(0, 0);
    },
    // _latLngToNewLayerPoint(latlng, zoom, center) {
    //    const topLeft = this._getNewPixelOrigin(center, zoom);
    //    return this.project(latlng, zoom)._subtract(topLeft);
    //},
    /**
     * Calculate the pixel origin for a target view while preserving bearing-aware alignment.
     * 
     * @param {L.LatLng} center Target center.
     * @param {number} zoom Target zoom level.
     * 
     * @returns {L.Point} New pixel origin.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getNewPixelOrigin(center, zoom) {
      if (!this._rotate) {
        return mapProto._getNewPixelOrigin.apply(this, arguments);
      }
      return this.project(center, zoom)._subtract(this.containerPointToLayerPoint(this.getSize()._divideBy(2)))._round();
    },
    /**
     * Calculate the pixel bounds needed to cover the transformed viewport.
     * 
     * @param {L.LatLng} [center=this.getCenter()] Target center.
     * @param {number} [zoom=this.getZoom()] Target zoom level.
     * 
     * @returns {L.Bounds} Pixel bounds in projected map coordinates.
     * 
     * @since leaflet-rotate (v0.2.0)
     * 
     * @see src\layer\tile\GridLayer::_getTiledPixelBounds()
     */
    _getNewPixelBounds(center, zoom) {
      center = center || this.getCenter();
      zoom = zoom || this.getZoom();
      if (!this._rotate && mapProto._getNewPixelBounds) {
        return mapProto._getNewPixelBounds.apply(this, arguments);
      }
      const mapZoom = this._animatingZoom ? Math.max(this._animateToZoom, this.getZoom()) : this.getZoom(), scale = this.getZoomScale(mapZoom, zoom), pixelCenter = this.project(center, zoom).floor(), [min, max] = this._getPitchedContainerBounds(0), corners = [[min.x, min.y], [max.x, min.y], [min.x, max.y], [max.x, max.y]].map((point) => this.containerPointToLayerPoint(point));
      if (this._pitch) {
        const viewCenter = this.containerPointToLayerPoint(this.getSize()._divideBy(2));
        return new L.Bounds(corners.map((point) => pixelCenter.add(point.subtract(viewCenter).divideBy(scale))));
      }
      const halfSize = new L.Bounds(corners.map((point) => point.floor())).getSize().divideBy(scale * 2);
      return new L.Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize));
    },
    /**
     * Return the viewport center before the outer map-pane translation.
     * Used as the bearing/pitch pivot in map-pane coordinates, not layer coordinates.
     *
     * @since leaflet-rotate (v0.2.0)
     * 
     * @returns {L.Point} Map pivot in map-pane pixels.
     */
    _getPixelCenter() {
      if (!this._rotate && mapProto._getPixelCenter) {
        return mapProto._getPixelCenter.apply(this, arguments);
      }
      return this.getSize()._divideBy(2)._subtract(this._getMapPanePos());
    },
    /**
     * Convert the padded visible ground rectangle to layer bounds for vector renderers.
     * Clip its far edge before reversing perspective to avoid unbounded render areas.
     *
     * @see src\layer\vector\Renderer::_update()
     * 
     * @param {number} padding Bounds padding as a fraction of map size.
     * @param {boolean} [round=true] Round renderer bounds; navigation needs exact ground coordinates.
     * 
     * @returns {L.Bounds} Padded bounds in layer-point coordinates.
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    _getPaddedPixelBounds(padding, round = true) {
      if (!this._rotate && mapProto._getPaddedPixelBounds) {
        return mapProto._getPaddedPixelBounds.apply(this, arguments);
      }
      const [padMin, padMax] = this._getPitchedContainerBounds(padding);
      return new L.Bounds([
        [padMin.x, padMin.y],
        [padMin.x, padMax.y],
        [padMax.x, padMin.y],
        [padMax.x, padMax.y]
      ].map((point) => {
        const projected = this.containerPointToLayerPoint(point);
        return round ? projected.floor() : projected;
      }));
    },
    /**
     * Build and fire Leaflet's location-found event, including the device heading.
     * 
     * @param {GeolocationPosition} pos Browser geolocation result.
     * 
     * @fires L.Map#locationfound
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _handleGeolocationResponse(pos) {
      if (!this._container._leaflet_id) {
        return;
      }
      const lat = pos.coords.latitude, lng = pos.coords.longitude, hdg = pos.coords.heading, latlng = new L.LatLng(lat, lng), bounds = latlng.toBounds(pos.coords.accuracy), options = this._locateOptions;
      if (options.setView) {
        const zoom = this.getBoundsZoom(bounds);
        this.setView(latlng, options.maxZoom ? Math.min(zoom, options.maxZoom) : zoom);
      }
      const data = {
        latlng,
        bounds,
        timestamp: pos.timestamp,
        /** @TODO use mapProto._handleGeolocationResponse */
        heading: hdg
      };
      for (const i in pos.coords) {
        if (typeof pos.coords[i] === "number") {
          data[i] = pos.coords[i];
        }
      }
      this.fire("locationfound", data);
    }
    /**
     * @see https://github.com/ronikar/Leaflet/blob/5c480ef959b947c3beed7065425a5a36c486262b/src/geo/LatLngBounds.js#L253-L264
     * 
     * @param {L.Bounds} points 
     * 
     * @returns {L.Bounds}
     */
    // toCircumscribedBounds(points) {
    //     const minX = points.reduce(function (pv, v) { return Math.min(pv, v.x); }, points[0].x),
    //         maxX = points.reduce(function (pv, v) { return Math.max(pv, v.x); }, points[0].x),
    //         minY = points.reduce(function (pv, v) { return Math.min(pv, v.y); }, points[0].y),
    //         maxY = points.reduce(function (pv, v) { return Math.max(pv, v.y); }, points[0].y);
    //
    //     return L.bounds(L.point(minX, minY), L.point(maxX, maxY));
    // },
  });

  // src/map/handler/CompassBearing.js
  L.Map.CompassBearing = L.Handler.extend({
    /**
     * @param {L.Map} map Map whose bearing follows device orientation.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
      this._map = map;
      if ("ondeviceorientationabsolute" in window) {
        this.__deviceOrientationEvent = "deviceorientationabsolute";
      } else if ("ondeviceorientation" in window) {
        this.__deviceOrientationEvent = "deviceorientation";
      }
      this._throttled = L.Util.throttle(this._onDeviceOrientation, 100, this);
    },
    /**
     * Subscribe to the supported device-orientation event, if available.
     * On iOS, permission is requested first (call `enable()` from a user gesture).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      if (this._map._rotate && this.__deviceOrientationEvent) {
        L.DomEvent.on(window, this.__deviceOrientationEvent, this._throttled, this);
        const DOE = window.DeviceOrientationEvent;
        if (DOE && DOE.requestPermission) {
          DOE.requestPermission().then((state) => "denied" === state && this.enabled() && this.disable()).catch(() => {
          });
        }
      } else {
        this.disable();
      }
    },
    /**
     * Unsubscribe from device orientation when the handler is disabled.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      if (this._map._rotate && this.__deviceOrientationEvent) {
        L.DomEvent.off(window, this.__deviceOrientationEvent, this._throttled, this);
      }
    },
    /**
     * Apply a device orientation reading to the map bearing.
     *
     * `DeviceOrientationEvent.absolute` - Indicates whether the device is providing absolute
     *                                     orientation values (relatives to Magnetic North) or
     *                                     using some arbitrary frame determined by the device.
     * 
     * `DeviceOrientationEvent.alpha`    - Returns the rotation of the device around the Z axis;
     *                                     that is, the number of degrees by which the device is
     *                                     being twisted around the center of the screen.
     * 
     * `window.orientation`              - Returns the screen orientation in degrees (in 90-degree increments)
     *                                     of the viewport relative to the device's natural orientation.
     *                                     Its only possible values are -90, 0, 90, and 180. Positive
     *                                     values are counterclockwise; negative values are clockwise.
     * 
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/absolute
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/alpha
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/orientation
     *
     * @param {DeviceOrientationEvent} e Orientation reading from the browser.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onDeviceOrientation(e) {
      let angle = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.alpha;
      let deviceOrientation = 0;
      if (!Number.isFinite(angle)) {
        return;
      }
      if (!e.absolute && e.webkitCompassHeading) {
        angle = 360 - angle;
      }
      if (!e.absolute && "undefined" !== typeof window.orientation) {
        deviceOrientation = window.orientation;
      }
      this._map.setBearing(angle - deviceOrientation);
    }
  });
  L.Map.addInitHook("addHandler", "compassBearing", L.Map.CompassBearing);

  // src/map/handler/ContainerMutation.js
  L.Map.mergeOptions({
    /**
     * Whether the map uses mutation observers to
     * detect changes in its container and trigger
     * `invalidateSize`. Disabled by default due to
     * support not being available in all web browsers.
     *
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     * 
     * @see https://developer.mozilla.org/docs/Web/API/MutationObserver
     */
    trackContainerMutation: false
  });
  L.Map.ContainerMutation = L.Handler.extend({
    /**
     * Start observing the map container's style attribute.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      if (!this._observer) {
        this._observer = new MutationObserver(L.Util.bind(this._map.invalidateSize, this._map));
      }
      this._observer.observe(this._map.getContainer(), {
        childList: false,
        attributes: true,
        characterData: false,
        subtree: false,
        attributeFilter: ["style"]
      });
    },
    /**
     * Stop observing container mutations.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      this._observer.disconnect();
    }
  });
  L.Map.addInitHook("addHandler", "trackContainerMutation", L.Map.ContainerMutation);

  // src/map/handler/Drag.js
  var dragProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Map.Drag.prototype));
  L.Map.Drag.include({
    _onDragStart() {
      dragProto._onDragStart.apply(this, arguments);
      const map = this._map;
      this._rotateLimit = null;
      if (!map._rotate || !map.options.maxBounds || !map.options.maxBoundsViscosity) {
        return;
      }
      const anchor = (map.pointerEventToContainerPoint || map.mouseEventToContainerPoint).call(map, {
        clientX: this._draggable._startPoint.x,
        clientY: this._draggable._startPoint.y
      }), footprint = map._getPaddedPixelBounds(0, false), origin = map.getPixelOrigin();
      this._rotateLimit = {
        anchor,
        layerAnchor: map.containerPointToLayerPoint(anchor),
        panePos: map._getMapPanePos().clone(),
        footprint: new L.Bounds(footprint.min.add(origin), footprint.max.add(origin)),
        matrix: map._pitch ? map._pitchTransform : null,
        inverse: map._pitchInverseTransform,
        bearing: map._bearing
      };
    },
    _onPreDragLimit() {
      const limit = this._rotateLimit;
      if (!this._map._rotate || !limit) {
        return dragProto._onPreDragLimit.apply(this, arguments);
      }
      const map = this._map, draggable = this._draggable, offset = draggable._newPos.subtract(draggable._startPos), shift = limit.matrix ? map._transformPitchPoint(
        limit.anchor.add(offset).subtract(limit.panePos),
        limit.inverse,
        limit.anchor.subtract(limit.panePos)
      ).subtract(limit.layerAnchor) : offset.rotate(-limit.bearing), correction = map._getBoundsOffset(new L.Bounds(
        limit.footprint.min.subtract(shift),
        limit.footprint.max.subtract(shift)
      ), map.options.maxBounds);
      shift._subtract(correction.multiplyBy(this._viscosity));
      const limitedOffset = limit.matrix ? map._transformPitchPoint(limit.layerAnchor.add(shift), limit.matrix).add(limit.panePos).subtract(limit.anchor) : shift.rotate(limit.bearing);
      draggable._newPos = draggable._startPos.add(limitedOffset);
    }
  });

  // src/map/handler/TouchGestures.js
  function touchToContainerPoint(map, touch) {
    const container = map.getContainer(), rect = container.getBoundingClientRect();
    return new L.Point(
      touch.clientX - rect.left - container.clientLeft,
      touch.clientY - rect.top - container.clientTop
    );
  }
  L.Map.mergeOptions({
    /**
     * Whether pinch zoom may temporarily exceed min/max zoom and bounce back.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bounceAtZoomLimits: true
  });
  L.Map.TouchGestures = L.Handler.extend({
    /**
     * Initialize the shared handler from the map's touch zoom/rotation options.
     * 
     * @param {L.Map} map Map whose touch gestures are handled.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
      this._map = map;
      this.rotate = !!this._map.options.touchRotate;
      this.zoom = !!this._map.options.touchZoom;
      this.pitch = !!this._map.options.touchPitch;
    },
    /**
     * Listen for the start of two-finger gestures on the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      L.DomEvent.on(this._map._container, "touchstart", this._onTouchStart, this);
    },
    /**
     * Remove the touch-start listener.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      L.DomEvent.off(this._map._container, "touchstart", this._onTouchStart, this);
    },
    /**
     * Record initial touch points and start tracking a two-finger gesture.
     * 
     * @param {TouchEvent} e Touch-start event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onTouchStart(e) {
      const map = this._map;
      if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming || this._rotating || this._gesture) {
        return;
      }
      const p1 = touchToContainerPoint(map, e.touches[0]), p2 = touchToContainerPoint(map, e.touches[1]), vector = p1.subtract(p2);
      const canPitch = this.pitch && map._rotate && Math.abs(vector.x) > Math.abs(vector.y);
      if (!canPitch && !this.zoom && !this.rotate) {
        return;
      }
      this._gesture = canPitch ? "pending" : "pinch";
      this._startP1 = p1;
      this._startP2 = p2;
      map._stopPitchBearingAnimation();
      this._centerPoint = map.getSize()._divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      if (this.zoom) {
        if (map.options.touchZoom !== "center") {
          this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
        }
        this._startDist = p1.distanceTo(p2);
        this._startZoom = map.getZoom();
        this._zooming = true;
      } else {
        this._zooming = false;
      }
      if (this.rotate) {
        this._startTheta = Math.atan(vector.x / vector.y);
        this._startBearing = map.getBearing();
        if (vector.y < 0) {
          this._startBearing += 180;
        }
        this._rotating = true;
      } else {
        this._rotating = false;
      }
      this._moved = false;
      map._stop();
      L.DomEvent.on(document, "touchmove", this._onTouchMove, this).on(document, "touchend touchcancel", this._onTouchEnd, this);
      L.DomEvent.preventDefault(e);
    },
    /**
     * Update bearing and/or zoom while the two touch points move.
     * 
     * @param {TouchEvent} e Touch-move event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onTouchMove(e) {
      if (!e.touches || e.touches.length !== 2 || !this._gesture) {
        return;
      }
      const map = this._map, p1 = touchToContainerPoint(map, e.touches[0]), p2 = touchToContainerPoint(map, e.touches[1]), vector = p1.subtract(p2), scale = p1.distanceTo(p2) / this._startDist;
      let delta;
      if (this._gesture === "pending") {
        const d1 = p1.subtract(this._startP1), d2 = p2.subtract(this._startP2);
        if (Math.max(d1.x * d1.x + d1.y * d1.y, d2.x * d2.x + d2.y * d2.y) < 25) {
          L.DomEvent.preventDefault(e);
          return;
        }
        const vertical = (d) => Math.abs(d.y) > Math.abs(d.x);
        if (vertical(d1) && vertical(d2) && Math.sign(d1.y) === Math.sign(d2.y)) {
          this._gesture = "pitch";
          this._lastPitchY = (this._startP1.y + this._startP2.y) / 2;
          this._zooming = this._rotating = false;
        } else {
          this._gesture = "pinch";
        }
      }
      if (this._gesture === "pitch") {
        const y = (p1.y + p2.y) / 2;
        map._setPitchAndBearing(map.getPitch() - (y - this._lastPitchY) * 0.5, map.getBearing());
        this._lastPitchY = y;
        L.DomEvent.preventDefault(e);
        return;
      }
      if (!(this._zooming || this._rotating)) {
        return;
      }
      if (this._rotating) {
        const theta = Math.atan(vector.x / vector.y);
        let bearingDelta = (theta - this._startTheta) * (180 / Math.PI);
        if (vector.y < 0) {
          bearingDelta += 180;
        }
        if (bearingDelta) {
          map.setBearing(this._startBearing - bearingDelta);
        }
      }
      if (this._zooming) {
        this._zoom = map.getScaleZoom(scale, this._startZoom);
        if (!map.options.bounceAtZoomLimits && (this._zoom < map.getMinZoom() && scale < 1 || this._zoom > map.getMaxZoom() && scale > 1)) {
          this._zoom = map._limitZoom(this._zoom);
        }
        if (map.options.touchZoom === "center") {
          this._center = this._startLatLng;
          if (scale === 1) {
            return;
          }
        } else {
          delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
          if (scale === 1 && delta.x === 0 && delta.y === 0) {
            return;
          }
          const mapDelta = map._pitch ? map.containerPointToLayerPoint(this._centerPoint.add(delta)).subtract(map.containerPointToLayerPoint(this._centerPoint)) : delta.rotate(-map.getBearing() * (Math.PI / 180));
          this._center = map.unproject(map.project(this._pinchStartLatLng).subtract(mapDelta));
        }
      }
      if (!this._moved) {
        map._moveStart(true, false);
        this._moved = true;
      }
      const moveFn = map._move.bind(map, this._center, this._zoom, { pinch: true, round: false }, void 0);
      moveFn();
      if (this.zoom) {
        if (map.options.zoomAnimation) {
          map._animateZoomNoDelay(this._center, map._limitZoom(this._zoom));
        } else {
          map._resetView(this._center, map._limitZoom(this._zoom));
        }
      }
      L.DomEvent.preventDefault(e);
    },
    /**
     * Finish the gesture, settle the zoom and remove document listeners.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onTouchEnd() {
      const gesture = this._gesture;
      delete this._gesture;
      if (gesture === "pitch" || gesture === "pending" || !this._moved || !(this._zooming || this._rotating)) {
        this._zooming = false;
        this._rotating = false;
        L.DomEvent.off(document, "touchmove", this._onTouchMove, this).off(document, "touchend touchcancel", this._onTouchEnd, this);
        return;
      }
      this._zooming = false;
      this._rotating = false;
      L.DomEvent.off(document, "touchmove", this._onTouchMove, this).off(document, "touchend touchcancel", this._onTouchEnd, this);
      if (this.zoom) {
        if (this._map.options.zoomAnimation) {
          this._map._animateZoom(this._center, this._map._limitZoom(this._zoom), true, this._map.options.zoomSnap);
        } else {
          this._map._resetView(this._center, this._map._limitZoom(this._zoom));
        }
      }
    }
  });
  L.Map.addInitHook("addHandler", "touchGestures", L.Map.TouchGestures);

  // src/map/handler/TouchRotate.js
  L.Map.mergeOptions({
    /**
     * Whether the map can be rotated with a two-finger rotation gesture
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    touchRotate: false
  });
  L.Map.TouchRotate = L.Handler.extend({
    /**
     * Enable rotation handling in the map's shared touch gesture handler.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      this._map.touchGestures.enable();
      this._map.touchGestures.rotate = true;
    },
    /**
     * Disable rotation handling without affecting pinch zoom.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      this._map.touchGestures.rotate = false;
    }
  });
  L.Map.addInitHook("addHandler", "touchRotate", L.Map.TouchRotate);

  // src/map/handler/TouchPitch.js
  L.Map.mergeOptions({
    /**
     * Whether the map can be pitched by dragging two fingers vertically
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (0.5.1)
     */
    touchPitch: false
  });
  L.Map.TouchPitch = L.Handler.extend({
    /**
     * Enable pitch handling in the map's shared touch gesture handler.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    addHooks() {
      this._map.touchGestures.enable();
      this._map.touchGestures.pitch = true;
    },
    /**
     * Disable pitch handling without affecting pinch zoom and rotation.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    removeHooks() {
      this._map.touchGestures.pitch = false;
    }
  });
  L.Map.addInitHook("addHandler", "touchPitch", L.Map.TouchPitch);

  // src/map/handler/ShiftKeyRotate.js
  L.Map.mergeOptions({
    /**
     * Whether Shift+wheel changes the map bearing.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    shiftKeyRotate: true,
    /**
     * Whether Ctrl+drag (or right-button drag) changes bearing and pitch.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (0.5.0)
     */
    pitchDrag: true
  });
  L.Map.ShiftKeyRotate = L.Handler.extend({
    /**
     * @param {L.Map} map Map controlled by this handler.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
      this._map = map;
      this._onMouseDownBound = this._onMouseDown.bind(this);
      this._onMouseMoveBound = this._onMouseMove.bind(this);
      this._onMouseUpBound = this._onMouseUp.bind(this);
      this._onContextMenuBound = this._onContextMenu.bind(this);
      this._applyBound = this._apply.bind(this);
    },
    /**
     * Attach enabled wheel and pointer/mouse gesture listeners.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      if (this._map.options.shiftKeyRotate) {
        L.DomEvent.on(this._map._container, "wheel", this._handleShiftScroll, this);
      }
      if (this._map.options.pitchDrag) {
        this.addPitchHooks();
      }
    },
    /**
     * Detach gesture listeners and cancel any active drag.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      L.DomEvent.off(this._map._container, "wheel", this._handleShiftScroll, this);
      this.removePitchHooks();
    },
    /**
     * Listen for the start of Ctrl+drag pitch gestures.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    addPitchHooks() {
      if (this._pitchHooksAdded) {
        return;
      }
      this._pitchEvents = L.version.startsWith("2.") ? ["pointerdown", "pointermove", "pointerup pointercancel"] : ["mousedown", "mousemove", "mouseup"];
      this._map._container.addEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
      this._map._container.addEventListener("contextmenu", this._onContextMenuBound, true);
      this._pitchHooksAdded = true;
    },
    /**
     * Stop listening for pitch gestures and remove active document listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    removePitchHooks() {
      if (!this._pitchHooksAdded) {
        return;
      }
      this._map._container.removeEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
      this._map._container.removeEventListener("contextmenu", this._onContextMenuBound, true);
      this._onMouseUp();
      delete this._pitchEvents;
      this._pitchHooksAdded = false;
    },
    /**
     * Rotate the map in fixed increments while Shift is held during wheel input.
     * 
     * @param {WheelEvent} e Wheel event from the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _handleShiftScroll(e) {
      if (e.shiftKey) {
        e.preventDefault();
        this._map.scrollWheelZoom.disable();
        this._map.setBearing(this._map.getBearing() + Math.sign(e.deltaY) * 5);
      } else {
        this._map.scrollWheelZoom.enable();
      }
    },
    /**
     * Start Ctrl+drag (or right-button drag) and capture subsequent movement outside the map.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture start event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseDown(e) {
      if (this._dragging) {
        return;
      }
      this._moved = false;
      if (!this._map._rotate || !this._map.options.pitchDrag || !(e.button === 2 || e.ctrlKey && e.button === 0)) {
        return;
      }
      const scrollWheelZoom = this._map.scrollWheelZoom;
      if (scrollWheelZoom && scrollWheelZoom._timer) {
        clearTimeout(scrollWheelZoom._timer);
        scrollWheelZoom._timer = null;
        scrollWheelZoom._delta = 0;
        scrollWheelZoom._startTime = null;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._map._stopPitchBearingAnimation();
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._pitchDelta = this._bearingDelta = 0;
      document.addEventListener(this._pitchEvents[1], this._onMouseMoveBound);
      for (const event of this._pitchEvents[2].split(" ")) {
        document.addEventListener(event, this._onMouseUpBound);
      }
    },
    /**
     * Accumulate pointer movement as pitch (vertical) and bearing (horizontal).
     * Far from the horizontal center line the bearing follows the pointer angle
     * around the map center.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture movement event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseMove(e) {
      const rect = this._map._container.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, x = e.clientX, y = e.clientY;
      this._pitchDelta += (this._lastY - y) * 0.5;
      this._bearingDelta += Math.abs(cy - this._lastY) > 100 ? (Math.atan2(y - cy, x - cx) - Math.atan2(y - cy, this._lastX - cx)) * (180 / Math.PI) : (x - this._lastX) * 0.8 * (y < cy ? 1 : -1);
      this._lastX = x;
      this._lastY = y;
      this._moved = true;
      if (!this._frame) {
        this._frame = requestAnimationFrame(this._applyBound);
      }
      e.preventDefault();
    },
    /**
     * Apply accumulated movement once per animation frame.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _apply() {
      this._frame = null;
      if (!this._pitchDelta && !this._bearingDelta) {
        return;
      }
      this._map._setPitchAndBearing(this._map.getPitch() + this._pitchDelta, this._map.getBearing() + this._bearingDelta);
      this._pitchDelta = this._bearingDelta = 0;
    },
    /**
     * Suppress the context menu that follows a right-button drag.
     * 
     * @param {MouseEvent} e Context menu event.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onContextMenu(e) {
      if (this._dragging || this._moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    /**
     * End Ctrl+drag, flush pending movement and clear document-level listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseUp() {
      if (!this._pitchEvents || !this._dragging) {
        return;
      }
      document.removeEventListener(this._pitchEvents[1], this._onMouseMoveBound);
      for (const event of this._pitchEvents[2].split(" ")) {
        document.removeEventListener(event, this._onMouseUpBound);
      }
      cancelAnimationFrame(this._frame);
      if (this._map._mapPane) {
        this._apply();
      }
      this._frame = null;
      this._dragging = false;
      delete this._lastX;
      delete this._lastY;
    }
  });
  L.Map.addInitHook(function() {
    if (this.options.shiftKeyRotate) {
      this.shiftKeyRotate = new L.Map.ShiftKeyRotate(this);
      this.shiftKeyRotate.enable();
    } else if (this.options.pitchDrag) {
      this.shiftKeyRotate = new L.Map.ShiftKeyRotate(this);
      this.shiftKeyRotate.addPitchHooks();
      this.on("unload", this.shiftKeyRotate.removePitchHooks, this.shiftKeyRotate);
    }
    if (this.scrollWheelZoom.enabled() && this.options.shiftKeyRotate) {
      this.scrollWheelZoom.disable();
      this.scrollWheelZoom.enable();
    }
  });

  // src/map/handler/TouchZoom.js
  L.Map.mergeOptions({
    /**
     * Whether the map can be zoomed by touch-dragging
     * with two fingers. If passed `'center'`, it will
     * zoom to the center of the view regardless of
     * where the touch events (fingers) were. Enabled
     * for touch-capable web browsers.
     * 
     * @type {(Boolean|String)}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    touchZoom: L.Browser.touch,
    /**
     * @TODO check if this is a duplicate of `L.Map.TouchGestures::bounceAtZoomLimits`
     * 
     * Set it to false if you don't want the map to
     * zoom beyond min/max zoom and then bounce back
     * when pinch-zooming.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bounceAtZoomLimits: false
  });
  L.Map.TouchZoom = L.Handler.extend({
    /**
     * Enable pinch zoom handling and mark the shared touch handler as active.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      this._map._container.classList.add("leaflet-touch-zoom");
      this._map.touchGestures.enable();
      this._map.touchGestures.zoom = true;
    },
    /**
     * Disable pinch zoom handling while preserving touch rotation state.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      this._map._container.classList.remove("leaflet-touch-zoom");
      this._map.touchGestures.zoom = false;
    }
  });
  L.Map.addInitHook("addHandler", "touchZoom", L.Map.TouchZoom);

  // src/control/Rotate.js
  L.Control.Rotate = L.Control.extend({
    options: {
      position: "topleft",
      closeOnZeroBearing: true,
      visualizePitch: true
    },
    /**
     * Create the control element and subscribe to map rotation and pitch.
     * 
     * @param {L.Map} map
     * 
     * @returns {HTMLElement} Control container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    onAdd(map) {
      const container = this._container = L.DomUtil.create("div", "leaflet-control-rotate leaflet-bar");
      const arrow = this._arrow = L.DomUtil.create("span", "leaflet-control-rotate-arrow");
      arrow.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,%3Csvg width='29' height='29' viewBox='0 0 29 29' xmlns='http://www.w3.org/2000/svg' fill='%23333'%3E%3Cpath d='M10.5 14l4-8 4 8h-8z'/%3E%3Cpath d='M10.5 16l4 8 4-8h-8z' fill='%23ccc'/%3E%3C/svg%3E")`;
      arrow.style.display = "block";
      arrow.style.width = "100%";
      arrow.style.height = "100%";
      arrow.style.backgroundRepeat = "no-repeat";
      arrow.style.backgroundPosition = "50%";
      arrow.style.pointerEvents = "none";
      const link = this._link = L.DomUtil.create("a", "leaflet-control-rotate-toggle", container);
      link.appendChild(arrow);
      link.href = "#";
      link.title = this.options.visualizePitch ? "Reset bearing and pitch" : "Reset bearing to north";
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", link.title);
      link.style.cursor = "grab";
      link.style.touchAction = "none";
      this._onPointerMoveBound = this._onPointerMove.bind(this);
      this._onPointerUpBound = this._onPointerUp.bind(this);
      L.DomEvent.on(link, "dblclick contextmenu", L.DomEvent.stop).on(link, "click", L.DomEvent.stop).on(link, "click", this._onClick, this).on(link, "click", this._refocusOnMap, this);
      link.addEventListener("pointerdown", this._onPointerDown.bind(this));
      map.on("rotate pitch", this._restyle, this);
      this._map = map;
      this._restyle();
      return container;
    },
    /**
     * Remove the map event listener when the control is detached.
     * 
     * @param {L.Map} map
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    onRemove(map) {
      this._onPointerUp();
      map.off("rotate pitch", this._restyle, this);
    },
    /**
     * Reset bearing (and pitch) unless the click ends a drag.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onClick() {
      if (this._moved) {
        this._moved = false;
        return;
      }
      if (!this._map || !this._map._rotate) {
        return;
      }
      if (this.options.visualizePitch) {
        this._map.resetNorthPitch();
      } else {
        this._map.resetNorth();
      }
    },
    /**
     * Start dragging the control (mouse, pen or touch).
     * 
     * @param {PointerEvent} e
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerDown(e) {
      if (!this._map || !this._map._rotate || e.button > 0 || this._pointerId != null) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._pointerId = e.pointerId;
      this._startX = this._lastX = e.clientX;
      this._startY = this._lastY = e.clientY;
      this._moved = false;
      this._link.style.cursor = "grabbing";
      document.addEventListener("pointermove", this._onPointerMoveBound);
      document.addEventListener("pointerup", this._onPointerUpBound);
      document.addEventListener("pointercancel", this._onPointerUpBound);
    },
    /**
     * Horizontal movement changes the bearing, vertical movement the pitch.
     * 
     * @param {PointerEvent} e
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerMove(e) {
      if (e.pointerId !== this._pointerId) {
        return;
      }
      e.preventDefault();
      if (!this._moved && Math.hypot(e.clientX - this._startX, e.clientY - this._startY) < 3) {
        return;
      }
      if (!this._moved) {
        this._moved = true;
        this._map._stopPitchBearingAnimation();
      }
      const map = this._map, pitch = this.options.visualizePitch ? map.getPitch() + (this._lastY - e.clientY) * 0.5 : map.getPitch();
      map._setPitchAndBearing(pitch, map.getBearing() + (e.clientX - this._lastX) * 0.8);
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    },
    /**
     * Stop dragging and remove document listeners.
     * 
     * @param {PointerEvent} [e]
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerUp(e) {
      if (e && e.pointerId !== this._pointerId) {
        return;
      }
      document.removeEventListener("pointermove", this._onPointerMoveBound);
      document.removeEventListener("pointerup", this._onPointerUpBound);
      document.removeEventListener("pointercancel", this._onPointerUpBound);
      if (e && this._moved && !this._link.contains(e.target)) {
        this._moved = false;
      }
      delete this._pointerId;
      if (this._link) {
        this._link.style.cursor = "grab";
        this._restyle();
      }
    },
    /**
     * Update the icon (bearing and pitch) and the control visibility.
     * 
     * @listens L.Map#rotate
     * @listens L.Map#pitch
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _restyle() {
      const map = this._map;
      if (!map) {
        return;
      }
      if (!map.options.rotate) {
        this._link.classList.add("leaflet-disabled");
        return;
      }
      const bearing = map.getBearing(), pitch = map.getPitch();
      this._arrow.style.transform = this.options.visualizePitch && pitch ? `scale(${1 / Math.sqrt(Math.cos(pitch * Math.PI / 180))}) rotateX(${pitch}deg) rotate(${bearing}deg)` : `rotate(${bearing}deg)`;
      if (this.options.closeOnZeroBearing) {
        const hidden = !bearing && !(this.options.visualizePitch && pitch) && this._pointerId == null;
        this._container.style.display = hidden ? "none" : "block";
      }
    }
  });
  if (L.control) {
    L.control.rotate = (options) => new L.Control.Rotate(options);
  }
  L.Map.mergeOptions({
    /**
     * Add the rotation control automatically. Set to `false` to disable,
     * or pass an options object to configure the control.
     * 
     * @type {boolean|Object}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateControl: true
  });
  L.Map.addInitHook(function() {
    if (this.options.rotateControl) {
      const options = typeof this.options.rotateControl === "object" ? this.options.rotateControl : {};
      this.rotateControl = new L.Control.Rotate(options);
      this.addControl(this.rotateControl);
    }
  });
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=leaflet-rotate-src.js.map
