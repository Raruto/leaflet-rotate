import { materialShaders } from '../utils/shaders.js';
import { emptyNode, setParent, traverse } from '../utils/scene.js';

/** WebGPU device attachment, materials/pipelines and draw calls. */
/**
 * Join/create this map's shared scene and rebuild GPU objects if its context changed.
 * Buffer/program handles belong to one context; typed arrays and decoded images do not.
 * @private
 */
export async function attach(backend, map) {
  let shared = L.Layer.types['3d']._renderers.get(map);
  if (shared?._rendererReady) {
    await shared._rendererReady.promise;
  }
  if (!shared) {
    const rendererReady = Promise.withResolvers();
    shared = backend;
    backend._rendererReady = rendererReady;
    rendererReady.promise.catch(() => {});
    L.Layer.types['3d']._renderers.set(map, shared);
    const fail = error => {
      rendererReady.reject(error);
      L.Layer.types['3d']._renderers.delete(map);
      throw error;
    };
    const canvas = document.createElement('canvas');
    if (!navigator.gpu) fail(new Error('Layer3D requires WebGPU'));
    const adapter = await navigator.gpu.requestAdapter().catch(fail);
    if (!adapter) fail(new Error('Unable to acquire a WebGPU adapter'));
    const device = await adapter.requestDevice().catch(fail);
    device.addEventListener('uncapturederror', event => {
      const owner = L.Layer.types['3d']._renderers.get(map);
      for (const layer of owner?._layers || []) layer.fire('error', { error: event.error });
    });
    device.lost.then(info => {
      const owner = L.Layer.types['3d']._renderers.get(map);
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
    backend._shared = backend;
    backend._layers = new Set();
    backend._sceneOrigin = backend.location;
    backend.scene = emptyNode();
    // Perspective camera state: fov in degrees, near/far in scene metres.
    backend.camera = {
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
    backend.renderer = { device, context, format, canvas, dpr: Math.min(window.devicePixelRatio, 2) };
    backend._initSunlight();
    const emptyImage = document.createElement('canvas');
    emptyImage.width = 1;
    emptyImage.height = 1;
    backend.renderer.roofFallbackTexture = {
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
    canvas.setAttribute('aria-label', backend.options.ariaLabel);
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
    L.Layer.types['3d']._renderers.set(map, shared);
  }
  const origin = map.options.crs.project(shared._sceneOrigin);
  const point  = map.options.crs.project(backend.location);
  const metres = Math.cos(shared._sceneOrigin.lat * Math.PI / 180);
  backend._terrainBaseY ??= backend.root.position[1];
  backend.root.position[0] = (point.x - origin.x) * metres;
  backend.root.position[1] = backend._terrainBaseY;
  backend.root.position[2] = -(point.y - origin.y) * metres;
  backend._setTerrainHeight();
  // Each group's metres are measured at its own latitude, not the shared camera origin.
  backend.root.scale.fill(metres / Math.cos(backend.location.lat * Math.PI / 180));
  backend._shared = shared;
  backend.renderer = shared.renderer;
  backend.scene = shared.scene;
  backend.camera = shared.camera;
  shared._layers.add(backend);
  setParent(backend.root, shared.scene);
  traverse(backend.root, object => {
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
      backend._removeProgram(object.program);
      object.program = backend._createProgram(material);
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
  if (backend.header) backend._updateArea();
}

export function destroyTexture(backend, texture) {
  backend.renderer.device.queue.onSubmittedWorkDone().then(() => texture.destroy(), error => {
    backend.fire('error', { error });
    texture.destroy();
  });
}

export function createProgram(backend, material = {}) {
  const device = backend.renderer.device;
  const sparkle = Boolean(backend.options.nightSparkle);
  const shaders = materialShaders(material, sparkle, material.terrain ? L.Layer.types.terrain.elevationWGSL : '');
  const { bindings, textured, hasTerrain } = shaders;
  const vertex = device.createShaderModule({ code: shaders.vertex });
  const fragment = device.createShaderModule({ code: shaders.fragment });
  Promise.all([vertex.getCompilationInfo(), fragment.getCompilationInfo()]).then(infos => {
    const errors = infos.flatMap(info => info.messages).filter(message => message.type === 'error');
    if (errors.length) {
      backend.fire('error', {
        error: new Error(`Unable to compile Layer3D WGSL: ${errors.map(error => error.message).join('\n')}`),
      });
    }
  }).catch(error => backend.fire('error', { error }));
  const vertexBuffers = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
    material.vertexColors ? { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] } : null,
    textured              ? { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x2' }] }  : null,
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
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout, backend.renderer.sunlight.layout] });
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
      ...(material.baseTexture ? { baseTexture: { value: material.baseTexture } } : {}),
      ...(material.metalTexture ? { metalTexture: { value: material.metalTexture } } : {}),
      ...(material.emissiveTexture ? { emissiveTexture: { value: material.emissiveTexture } } : {}),
      ...(material.occlusionTexture ? { occlusionTexture: { value: material.occlusionTexture } } : {}),
      ...(material.roofTexture ? { roofTexture: { value: null } } : {}),
    },
    _layerMaterial: material,
  };
}

export function removeProgram(program) {
  program.pipelineCache.clear();
}

/**
 * Add a non-indexed, vertex-coloured mesh from flat vec3 arrays `{ position, normal, color }` in layer-local metres.
 * `usage` adds GPUBufferUsage flags to the vertex buffers (e.g. STORAGE for compute passes).
 */
export function createMesh(backend, data, material = {}, usage = 0) {
  const { device } = backend.renderer, attributes = {};
  for (const [name, values] of Object.entries(data)) {
    const array = new Float32Array(values);
    const buffer = device.createBuffer({ size: Math.max(4, array.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | usage });
    device.queue.writeBuffer(buffer, 0, array);
    attributes[name] = { size: 3, data: array, count: array.length / 3, buffer };
  }
  const mesh = {
    ...emptyNode(),
    device,
    geometry: { device, attributes, drawRange: { start: 0, count: attributes.position.count } },
    program: backend._createProgram({ vertexColors: true, doubleSided: true, ...material }),
    id: L.Layer.types['3d']._nextId++, renderOrder: 0, extras: {},
  };
  backend.add(mesh);
  return mesh;
}

export function disposeMesh(backend, mesh) {
  if (!mesh) return;
  backend.remove(mesh);
  for (const attribute of Object.values(mesh.geometry.attributes)) attribute.buffer.destroy();
  backend._removeProgram(mesh.program);
}

/** Upload retained CPU data and draw one mesh in the active WebGPU render pass. */
export function drawGeometry(backend, mesh, pass, cullMode, frontFace) {
  const { geometry, program } = mesh;
  const device = backend.renderer.device;
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
          format: backend.renderer.format,
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
        depthCompare: program.depthTest === false ? 'always' : 'less-equal',
      },
    });
    program.pipelineCache.set(pipelineKey, pipeline);
  }

  const uniforms = program.uniforms;
  const renderer = backend.renderer;
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
      { binding: 1, resource: { buffer: renderer.uniformBuffer, size: 240 } },
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
}
