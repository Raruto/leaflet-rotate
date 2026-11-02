/** Sunlight shadow maps and night point lights. Mixed into L.Layer.types['3d']. */
export default {
  _initSunlight() {
    const device = this.renderer.device;
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ] });
    const buffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sampler = device.createSampler({ compare: 'less-equal', minFilter: 'linear', magFilter: 'linear' });
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
      size: [size, size], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this._bindSunlight();
  },

  _bindSunlight() {
    const sun = this.renderer.sunlight;
    sun.bindGroup = this.renderer.device.createBindGroup({ layout: sun.layout, entries: [
      { binding: 0, resource: { buffer: sun.buffer } },
      { binding: 1, resource: sun.texture.createView() },
      { binding: 2, resource: sun.sampler },
      { binding: 3, resource: { buffer: sun.lights } },
    ] });
  },

  /** A cached spatial grid limits fragment lighting to nearby lamps, without dropping dense cells. */
  _updatePointLights() {
    const { device, sunlight: sun } = this.renderer;
    const meshes = [];
    for (const layer of this._layers) {
      if (!layer.options.nightLight || !layer.root.visible) continue;
      this.traverse(layer.root, mesh => {
        if (!mesh.visible) return true;
        if (mesh.extras?.lights) meshes.push(mesh);
      });
    }
    if (sun.lightMeshes?.length === meshes.length && meshes.every((mesh, i) =>
      sun.lightMeshes[i].mesh === mesh && mesh.worldMatrix.every((v, j) => v === sun.lightMeshes[i].matrix[j]))) return;
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
      const cells = new Map();
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
      if (length * 4 > device.limits.maxStorageBufferBindingSize) throw new Error('Streetlight grid exceeds GPU storage limit');
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
    sun.lightMeshes = meshes.map(mesh => ({ mesh, matrix: [...mesh.worldMatrix] }));
  },

  /** One shared directional depth map. Off-screen but loaded geometry can cast shadows. */
  _renderSunlight(encoder, meshes, sunlight) {
    const renderer = this.renderer, device = renderer.device, sun = renderer.sunlight;
    if (!meshes.length || !sunlight || sunlight.altitude < 3) {
      if (!sun.enabled) return;
      const values = new Float32Array(20);
      values.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      device.queue.writeBuffer(sun.buffer, 0, values);
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
        const point = new DOMPoint(...min.map((_, axis) => (i & (1 << axis)) ? bounds.max[axis] : bounds.min[axis]), 1)
          .matrixTransform(matrix);
        for (let axis = 0; axis < 3; axis++) {
          const value = [point.x, point.y, point.z][axis] / point.w;
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
    }
    // Include ground receivers below/around the loaded buildings and trees.
    min[1] = Math.min(0, min[1]);
    const radius = Math.max(100, Math.hypot(...min.map((v, i) => max[i] - v)));
    const center = min.map((v, i) => (v + max[i]) / 2);
    const lightCamera = {
      position: center.map((v, i) => v + sunlight.direction[i] * radius * 2),
      target: center, up: [0, 0, -1], fov: 45, aspect: 1, near: 1, far: radius * 5,
      viewMatrix: [], projectionMatrix: [], projectionViewMatrix: [],
    };
    this._updateCamera(lightCamera);
    const view = new DOMMatrix(lightCamera.viewMatrix);
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const point = new DOMPoint(...min.map((v, axis) => (i & (1 << axis)) ? max[axis] : v), 1).matrixTransform(view);
      [point.x, point.y, point.z].forEach((value, axis) => {
        low[axis] = Math.min(low[axis], value - 20);
        high[axis] = Math.max(high[axis], value + 20);
      });
    }
    const span = low.map((v, i) => high[i] - v);
    const projection = new DOMMatrix([
      2 / span[0], 0, 0, 0, 0, 2 / span[1], 0, 0, 0, 0, -1 / span[2], 0,
      -(high[0] + low[0]) / span[0], -(high[1] + low[1]) / span[1], high[2] / span[2], 1,
    ]);
    values.set(projection.multiply(view).toFloat32Array());
    values[16] = 1;
    device.queue.writeBuffer(sun.buffer, 0, values);
    if (!sun.pipeline) {
      sun.meshLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true } },
      ] });
      // Do not bind the sampled depth texture while it is a render attachment.
      sun.depthLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ] });
      sun.depthBindGroup = device.createBindGroup({
        layout: sun.depthLayout, entries: [{ binding: 0, resource: { buffer: sun.buffer } }],
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
        vertex: { module: shader, entryPoint: 'main', buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        ] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less',
          depthBias: 2, depthBiasSlopeScale: 2 },
      });
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: sun.texture.createView(), depthClearValue: 1,
        depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setPipeline(sun.pipeline);
    pass.setBindGroup(1, sun.depthBindGroup);
    for (const mesh of meshes) {
      const offset = renderer.uniformSlot++ * 256;
      renderer.uniformData.set(mesh.worldMatrix, offset / 4);
      if (mesh._shadowBuffer !== renderer.uniformBuffer) {
        mesh._shadowBuffer = renderer.uniformBuffer;
        mesh._shadowBindGroup = device.createBindGroup({ layout: sun.meshLayout, entries: [
          { binding: 0, resource: { buffer: renderer.uniformBuffer, size: 64 } },
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
};
