import { emptyNode } from './empty-node.js';

/** glTF/GLB model loading. Mixed into L.Layer.types['3d']. */
export default {
  /** Load the configured GLB/glTF (static triangles) under `root`; GPU resources need attachment. */
  async _loadModel() {
    await this._added.promise;
    const url      = new URL(this.modelUrl, document.baseURI).href;
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
        const samplerOptions = {
          addressModeU: sampler.wrapS === 33071 ? 'clamp-to-edge' : sampler.wrapS === 33648 ? 'mirror-repeat' : 'repeat',
          addressModeV: sampler.wrapT === 33071 ? 'clamp-to-edge' : sampler.wrapT === 33648 ? 'mirror-repeat' : 'repeat',
          magFilter: sampler.magFilter === 9728 ? 'nearest' : 'linear',
          minFilter: sampler.minFilter === 9728 || sampler.minFilter === 9984 || sampler.minFilter === 9986 ? 'nearest' : 'linear',
        };
        textures.set(key, {
          device,
          texture: device.createTexture({
            size: [image.width, image.height],
            format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
          }),
          sampler: device.createSampler(samplerOptions),
          samplerOptions,
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
          ...emptyNode(),
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
              ...emptyNode(),
              device,
              geometry,
              program,
              id: L.Layer.types['3d']._nextId++,
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
      ...emptyNode(),
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
  },
};
