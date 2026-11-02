import { emptyNode } from './empty-node.js';

/** WebGPU device attachment, materials/pipelines and draw calls. Mixed into L.Layer.types['3d']. */
export default {
  /**
   * Join/create this map's shared scene and rebuild GPU objects if its context changed.
   * Buffer/program handles belong to one context; typed arrays and decoded images do not.
   * @private
   */
  async _attach(map) {
    let shared = L.Layer.types['3d']._renderers.get(map);
    if (shared?._rendererReady) {
      await shared._rendererReady.promise;
    }
    if (!shared) {
      const rendererReady = Promise.withResolvers();
      shared = this;
      this._rendererReady = rendererReady;
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
      this._shared = this;
      this._layers = new Set();
      this._sceneOrigin = this.location;
      this.scene = emptyNode();
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
      this._initSunlight();
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
      L.Layer.types['3d']._renderers.set(map, shared);
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

  _destroyTexture(texture) {
    this.renderer.device.queue.onSubmittedWorkDone().then(() => texture.destroy(), error => {
      this.fire('error', { error });
      texture.destroy();
    });
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
      ${hasTerrain ? `@group(0) @binding(2) var dem: texture_2d<f32>;${L.Layer.types.terrain.elevationWGSL}` : ''}
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
        @location(6) shadowPosition: vec4<f32>,
        @location(7) worldPosition: vec3<f32>,
        ${sparkle ? '@location(8) localPosition: vec3<f32>,' : ''}
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
        output.shadowPosition = solar.matrix * world;
        output.worldPosition = world.xyz / world.w;
        ${sparkle ? 'output.localPosition = input.position;' : ''}
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
        ${sparkle ? '@location(8) localPosition: vec3<f32>,' : ''}
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
        ` : ''}
        let sunlight = sunVisibility(input.shadowPosition);
        let worldNormal = normalize(transpose(mat3x3<f32>(frame.viewMatrix[0].xyz,
          frame.viewMatrix[1].xyz, frame.viewMatrix[2].xyz)) * normalize(input.normal)) * select(-1.0, 1.0, frontFacing);
        let artificial = localLighting(input.worldPosition, worldNormal);
        ${material.unlit ? `
          let rasterTexel = textureSample(baseTexture, baseTextureSampler, input.uv);
          return vec4<f32>(toSRGB(toLinear(rasterTexel.rgb) * (frame.atmosphereTint.rgb * (0.55 + 0.45 * sunlight) + artificial)), ${material.alphaMode === 'BLEND' ? 'u.material.z * rasterTexel.a' : '1.0'});
        ` : `
        var normal = normalize(input.normal) * select(-1.0, 1.0, frontFacing);
        let texel = ${hasBase ? 'textureSample(baseTexture, baseTextureSampler, input.uv)' : 'vec4<f32>(1.0)'};
        let alpha = u.material.z * texel.a;
        ${material.alphaMode === 'MASK' ? 'if (alpha < u.material.w) { discard; }' : ''}
        ${material.alphaMode === 'BLEND' ? 'if (alpha < 0.01) { discard; }' : ''}
        var base = ${material.vertexColors ? 'toLinear(min(input.color, vec3<f32>(1.0)))' : 'input.color'} *
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
        let ao = ${hasOcclusion ? 'mix(1.0, textureSample(occlusionTexture, occlusionTextureSampler, input.uv).r, u.emissive.w)' : '1.0'};
        ${sparkle ? `
          let lattice = (fract(input.localPosition / 2.5) - 0.5) * 2.5;
          let pointGlow = (1.0 - smoothstep(0.16, 0.42, length(lattice))) * u.highlight.z;
        ` : ''}
        // Vertex colour components above 1 are self-lit (e.g. vehicle lamps): dim by day, bright at night.
        let glow = ${sparkle ? 'vec3<f32>(3.0, 2.6, 1.8) * pointGlow +' : ''}${material.vertexColors
          ? ' max(input.color - vec3<f32>(1.0), vec3<f32>(0.0)) * (0.3 + 5.0 * frame.skyDirection.w) +' : ''} u.emissive.rgb * ${
          hasEmissive
          ? material.emissiveTexture.srgb
            ? 'textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb'
            : 'toLinear(textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb)'
          : 'vec3<f32>(1.0)'
        };
        var color = ambient * base * (1.0 - metal) * ao +
          (diffuse + specular) * nl * toLinear(vec3<f32>(1.0, 0.937, 0.835)) * 3.0 + glow;
        ${material.vertexColors ? 'color = base * (ambient + toLinear(vec3<f32>(1.0, 0.937, 0.835)) * (3.0 / PI) * nl) + glow;' : ''}
        color = (color - glow) * frame.atmosphereTint.rgb + base * artificial * (1.0 - metal * 0.5) + glow;
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
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout, this.renderer.sunlight.layout] });
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
        ...(hasBase ? { baseTexture: { value: material.baseTexture } } : {}),
        ...(hasMetal ? { metalTexture: { value: material.metalTexture } } : {}),
        ...(hasEmissive ? { emissiveTexture: { value: material.emissiveTexture } } : {}),
        ...(hasOcclusion ? { occlusionTexture: { value: material.occlusionTexture } } : {}),
        ...(hasRoof ? { roofTexture: { value: null } } : {}),
      },
      _layerMaterial: material,
    };
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
          depthCompare: program.depthTest === false ? 'always' : 'less-equal',
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
  },
};
