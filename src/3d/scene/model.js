import { decodeModel, readAccessor, nodeMatrix, vertexNormals, textureSampler } from '../utils/model.js';
import { emptyNode, setParent } from '../utils/scene.js';

/** glTF/GLB model loading. */
/** Load the configured GLB/glTF (static triangles) under `root`; GPU resources need attachment. */
export async function loadModel(backend) {
  await backend._added.promise;
  const url      = new URL(backend.modelUrl, document.baseURI).href;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load model: HTTP ${response.status}`);
  }
  const data = await response.arrayBuffer();
  const description = decodeModel(data);
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
  await backend._added.promise;
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
    const device = backend.renderer.device;
    // A glTF image may serve both color and data maps: those cannot share a GPU format.
    const key = `${reference.index}:${color}`;
    if (!textures.has(key)) {
      const texture = description.textures[reference.index];
      const sampler = description.samplers?.[texture.sampler] || {};
      const image = images[texture.source];
      const format = color ? 'rgba8unorm-srgb' : 'rgba8unorm';
      const samplerOptions = textureSampler(sampler);
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
      group.matrix = nodeMatrix(spec);
      if (spec.mesh !== undefined) {
        for (const primitive of description.meshes[spec.mesh].primitives) {
          const attributes = {};
          for (const [semantic, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
            if (primitive.attributes[semantic] !== undefined) attributes[name] = readAccessor(description, primitive.attributes[semantic]);
          }
          if (!attributes.position) throw new Error('glTF mesh has no positions');
          const vertexCount = attributes.position.data.length / 3;
          if (attributes.position.size !== 3 || vertexCount < 3 ||
            Object.values(attributes).some(attribute => attribute.data.length / attribute.size !== vertexCount)) throw new Error('Invalid glTF vertex attributes');
          if (primitive.indices !== undefined) {
            const index = readAccessor(description, primitive.indices);
            attributes.index = { size: 1, data: index.indices };
            if (![Uint8Array, Uint16Array, Uint32Array].some(Type => index.indices instanceof Type) ||
              index.size !== 1 || index.indices.length % 3 || [...index.indices].some(i => i >= vertexCount)) throw new Error('Invalid glTF triangle indices');
          }
          if (!attributes.index && vertexCount % 3) throw new Error('Incomplete glTF triangle');
          if (!attributes.normal) {
            const normals = vertexNormals(attributes.position.data, attributes.index?.data);
            attributes.normal = { size: 3, data: normals };
          }
          const style = materials[primitive.material] || { color: [1, 1, 1], metallic: 1 };
          if ([style.baseTexture, style.metalTexture, style.emissiveTexture, style.occlusionTexture].some(Boolean) && !attributes.uv) {
            throw new Error('Textured model mesh requires UV coordinates');
          }
          const program = backend._createProgram(style);
          resources.push(program);
          const device = backend.renderer.device;
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
          setParent(mesh, group);
        }
      }
      for (const child of spec.children || []) setParent(node(child), group);
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
        } else backend._removeProgram(resource);
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
  for (const node of nodes) setParent(node, model);
  backend.model = model;
  if (backend.options.rotation) {
    const [x, y = x, z = x] = backend.options.rotation;
    backend.model.rotation[0] = x; backend.model.rotation[1] = y; backend.model.rotation[2] = z;
  }
  if (backend.options.scale) {
    const [x, y = x, z = x] = backend.options.scale;
    backend.model.scale[0] = x; backend.model.scale[1] = y; backend.model.scale[2] = z;
  }
  setParent(backend.model, backend.root);
}
