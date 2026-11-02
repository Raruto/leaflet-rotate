import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

When('I pan the shared WebGPU renderer', async function () {
  const pageErrors = [];
  const onPageError = error => pageErrors.push(error.message);
  this.page.on('pageerror', onPageError);
  try {
    this.webgpuPan = await this.page.evaluate(async () => {
      const modelLayer = layers._layers.find(({ layer }) => layer.modelUrl)?.layer;
      const owner = modelLayer?._shared;
      if (!owner?.renderer?.device) throw new Error('The WebGPU model renderer is not ready');
      owner._render();
      await owner.renderer.device.queue.onSubmittedWorkDone();
      let probe;
      let sortProbe;
      modelLayer.traverse(modelLayer.model, mesh => {
        if (!probe && mesh.geometry && mesh.program.bindings.length && mesh._visibleInFrame) probe = mesh;
        if (!sortProbe && mesh.geometry && mesh.program.transparent && mesh._visibleInFrame) sortProbe = mesh;
      });
      if (!probe) throw new Error('The model has no textured geometry to inspect');
      if (!sortProbe) throw new Error('The scene has no transparent geometry to inspect');
      const sortedPoint = new DOMPoint(...sortProbe.geometry.bounds.center, 1)
        .matrixTransform(new DOMMatrix(sortProbe.worldMatrix))
        .matrixTransform(new DOMMatrix(owner.camera.projectionViewMatrix));
      const sortDepthError = Math.abs(sortProbe._sortDepth - sortedPoint.z / sortedPoint.w);
      const canvas = owner.renderer.canvas;
      const device = owner.renderer.device;
      const renderer = owner.renderer;
      const worldMatrix = probe.worldMatrix;
      const beforeWorldMatrix = Array.from(worldMatrix);
      const bindGroup = probe.bindGroup;
      const uniformData = renderer.uniformData;
      const uniformBuffer = renderer.uniformBuffer;
      const beforeFrame = Array.from(uniformData.subarray(0, 56));
      // The shader composes view × world: slot 0 must hold the camera, one mesh slot the probe's world matrix.
      const measure = () => {
        const camera = owner.camera, data = renderer.uniformData;
        let world = Infinity;
        for (let slot = 1; slot < renderer.uniformSlot; slot++) {
          world = Math.min(world, Math.max(...probe.worldMatrix.map((value, i) => Math.abs(Math.fround(value) - data[slot * 64 + i]))));
        }
        return {
          view: Math.max(...camera.viewMatrix.map((value, i) => Math.abs(Math.fround(value) - data[i]))),
          projection: Math.max(...camera.projectionMatrix.map((value, i) => Math.abs(Math.fround(value) - data[16 + i]))),
          world,
        };
      };
      const firstErrors = measure();
      map.panBy([32, -20], { animate: false });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await renderer.device.queue.onSubmittedWorkDone();
      const secondErrors = measure();
      let meshes = 0, visibleMeshes = 0;
      owner.traverse(owner.scene, mesh => {
        if (!mesh.geometry) return;
        meshes++;
        if (mesh._visibleInFrame) visibleMeshes++;
      });
      const worldMatrixReused = worldMatrix === probe.worldMatrix &&
        beforeWorldMatrix.every((value, i) => value === worldMatrix[i]);
      const originalX = probe.position[0];
      probe.position[0] += 1;
      owner._updateWorldMatrix(owner.scene);
      const transformInvalidated = beforeWorldMatrix.some((value, i) => value !== worldMatrix[i]);
      probe.position[0] = originalX + 1000000;
      owner._render();
      const probeCulled = !probe._visibleInFrame;
      probe.position[0] = originalX;
      owner._updateWorldMatrix(owner.scene);
      return {
        firstErrors, secondErrors, meshes, visibleMeshes, probeCulled, sortDepthError,
        canvasReused: canvas === owner.renderer.canvas,
        deviceReused: device === owner.renderer.device,
        worldMatrixReused, transformInvalidated,
        uniformDataReused: uniformData === renderer.uniformData,
        gpuUniformBufferReused: uniformBuffer === renderer.uniformBuffer,
        uniformValuesChanged: beforeFrame.some((value, i) => value !== uniformData[i]),
        bindGroupReused: bindGroup === probe.bindGroup,
      };
    });
  } finally {
    this.page.off('pageerror', onPageError);
  }
  this.webgpuPan.pageErrors = pageErrors;
});

Then('WebGPU matrices match DOMMatrix and frame resources are reused', function () {
  const result = this.webgpuPan;
  assert.ok(result.visibleMeshes > 0, JSON.stringify(result));
  assert.ok(result.sortDepthError < 1e-6, JSON.stringify(result));
  assert.equal(result.probeCulled, true);
  for (const errors of [result.firstErrors, result.secondErrors]) {
    assert.ok(errors.view === 0 && errors.projection === 0 && errors.world === 0, JSON.stringify(errors));
  }
  assert.equal(result.canvasReused, true);
  assert.equal(result.deviceReused, true);
  assert.equal(result.worldMatrixReused, true);
  assert.equal(result.transformInvalidated, true);
  assert.equal(result.uniformDataReused, true);
  assert.equal(result.gpuUniformBufferReused, true);
  assert.equal(result.uniformValuesChanged, true);
  assert.equal(result.bindGroupReused, true);
  assert.deepEqual(result.pageErrors, []);
});

// Settled scene: terrain meshes exist, the roof atlas was built and no raster layer is still loading.
const waitForWebGPUScene = page => page.waitForFunction(() => {
  const owner = L.Layer.types['3d']._renderers.get(map);
  return owner?.renderer?.device && owner._roofRaster && map._terrain3D?._rasterTiles.size > 0 &&
    !Object.values(map._layers).some(layer => layer.isLoading?.());
}, null, { timeout: 50000 });

When('I drive the shared WebGPU renderer with map events', { timeout: 60000 }, async function () {
  const pageErrors = [];
  const onPageError = error => pageErrors.push(error.message);
  this.page.on('pageerror', onPageError);
  try {
    await waitForWebGPUScene(this.page);
    this.webgpuPacing = await this.page.evaluate(async () => {
      const owner = L.Layer.types['3d']._renderers.get(map);
      const { device } = owner.renderer;
      const frame = () => new Promise(requestAnimationFrame);
      const gpuErrors = [];
      const onGpuError = event => gpuErrors.push(event.error.message);
      device.addEventListener('uncapturederror', onGpuError);
      let renders = 0, uniformWrites = 0, otherWrites = 0, buffers = new Set();
      const render = owner._render;
      owner._render = function () {
        renders++;
        return render.apply(this, arguments);
      };
      const writeBuffer = device.queue.writeBuffer;
      device.queue.writeBuffer = function (buffer) {
        if (buffer === owner.renderer.uniformBuffer) uniformWrites++;
        else if (buffers.has(buffer)) otherWrites++;
        return writeBuffer.apply(this, arguments);
      };
      try {
        await frame();
        // Same-tick map events: one render before the next frame, after Leaflet's synchronous handlers.
        renders = 0;
        map.fire('move');
        map.fire('rotate');
        map.fire('pitch');
        map.fire('move');
        const synchronousRenders = renders;
        await Promise.resolve();
        const sameTickRenders = renders;

        // Content updates from every shared layer coalesce into the owner's next animation frame.
        await frame();
        renders = 0;
        for (let i = 0; i < 5; i++) owner.update();
        for (const layer of owner._layers) layer.update();
        const deferredRenders = renders;
        await frame();
        const frameRenders = renders;

        // Continuous panning: every frame renders immediately (no GPU completion gate) and uploads uniforms once.
        await frame();
        renders = 0;
        uniformWrites = 0;
        const panRenders = [];
        for (let i = 0; i < 20; i++) {
          const before = renders;
          map.panBy([6, -3], { animate: false });
          await Promise.resolve();
          panRenders.push(renders - before);
          await frame();
        }
        const panTotals = { renders, uniformWrites };

        let drawn = 0, sharedBindings = 0, ownBuffers = 0;
        owner.traverse(owner.scene, mesh => {
          if (!mesh.geometry) return;
          if (mesh.uniformBuffer) ownBuffers++;
          if (!mesh._visibleInFrame) return;
          drawn++;
          if (mesh.boundBuffer === owner.renderer.uniformBuffer) sharedBindings++;
        });
        const uniformSlots = owner.renderer.uniformSlot;
        const uniformCapacity = owner.renderer.uniformBuffer.size / 256;

        // Hover highlight is a shader vertex range: no vertex color re-upload.
        const buildings = [...owner._layers].find(layer => layer.group?.children.some(mesh => mesh.extras?.featureFaces?.length));
        const target = buildings.group.children.find(mesh => mesh.extras?.featureFaces?.length);
        const feature = target.extras.featureFaces[0];
        await frame();
        otherWrites = 0;
        buffers = new Set(Object.values(target.geometry.attributes).map(attribute => attribute.buffer));
        buildings._setHighlight({ mesh: target, ...feature });
        await frame();
        const highlight = { range: target.highlight, expected: [feature.vertexStart, feature.vertexEnd] };
        buildings._setHighlight(null);
        await frame();
        highlight.cleared = target.highlight;
        highlight.writes = otherWrites;

        // During zoom animations map events wait for the frame that also advances the CSS transitions.
        await frame();
        const zoomEnd = new Promise(resolve => map.once('zoomend', resolve));
        const zoomAnim = new Promise(resolve => map.once('zoomanim', resolve));
        map.setZoom(map.getZoom() - 1);
        await zoomAnim;
        const animating = map._animatingZoom;
        renders = 0;
        map.fire('move');
        await Promise.resolve();
        const zoomTickRenders = renders;
        await frame();
        const zoomFrameRenders = renders;
        await zoomEnd;
        await frame();
        await device.queue.onSubmittedWorkDone();
        return {
          synchronousRenders, sameTickRenders, deferredRenders, frameRenders, panRenders, panTotals,
          drawn, sharedBindings, ownBuffers, uniformSlots, uniformCapacity, highlight,
          animating, zoomTickRenders, zoomFrameRenders, gpuErrors,
        };
      } finally {
        delete owner._render;
        delete device.queue.writeBuffer;
        device.removeEventListener('uncapturederror', onGpuError);
      }
    });
  } finally {
    this.page.off('pageerror', onPageError);
  }
  this.webgpuPacing.pageErrors = pageErrors;
});

Then('map events render in the same tick, updates share one animation frame and each frame writes uniforms once', function () {
  const result = this.webgpuPacing;
  const details = JSON.stringify(result);
  assert.equal(result.synchronousRenders, 0, details);
  assert.equal(result.sameTickRenders, 1, details);
  assert.equal(result.deferredRenders, 0, details);
  assert.equal(result.frameRenders, 1, details);
  assert.deepEqual(result.panRenders, Array(20).fill(1), details);
  assert.equal(result.panTotals.uniformWrites, result.panTotals.renders, details);
  assert.ok(result.drawn > 1, details);
  assert.equal(result.sharedBindings, result.drawn, details);
  assert.equal(result.ownBuffers, 0, details);
  assert.ok(result.uniformSlots > result.drawn && result.uniformSlots <= result.uniformCapacity, details);
  assert.deepEqual(result.highlight.range, result.highlight.expected, details);
  assert.equal(result.highlight.cleared, null, details);
  assert.equal(result.highlight.writes, 0, details);
  assert.equal(result.animating, true, details);
  assert.equal(result.zoomTickRenders, 0, details);
  assert.equal(result.zoomFrameRenders, 1, details);
  assert.deepEqual(result.gpuErrors, [], details);
  assert.deepEqual(result.pageErrors, [], details);
});

When('I rebuild the WebGPU roof atlas', { timeout: 60000 }, async function () {
  const pageErrors = [];
  const onPageError = error => pageErrors.push(error.message);
  this.page.on('pageerror', onPageError);
  try {
    await waitForWebGPUScene(this.page);
    this.webgpuAtlas = await this.page.evaluate(async () => {
      const owner = L.Layer.types['3d']._renderers.get(map);
      const terrain = map._terrain3D;
      const { device } = owner.renderer;
      const gpuErrors = [];
      const onGpuError = event => gpuErrors.push(event.error.message);
      device.addEventListener('uncapturederror', onGpuError);
      const uploads = [];
      const copyExternal = device.queue.copyExternalImageToTexture;
      device.queue.copyExternalImageToTexture = function (source, destination, size) {
        uploads.push({ type: source.source.constructor.name, width: size[0] ?? size.width, height: size[1] ?? size.height });
        return copyExternal.apply(this, arguments);
      };
      // Readable atlas: the renderer only needs sampling and render-attachment usage.
      const createTexture = device.createTexture;
      device.createTexture = function (descriptor) {
        return createTexture.call(this, { ...descriptor, usage: descriptor.usage | GPUTextureUsage.COPY_SRC });
      };
      try {
        owner._destroyTexture(owner._roofRaster.texture.texture);
        owner._roofRaster = null;
        owner._render();
      } finally {
        delete device.createTexture;
        delete device.queue.copyExternalImageToTexture;
      }
      const atlas = owner._roofRaster.texture;
      const tiles = Object.values(map._layers)
        .filter(layer => layer instanceof L.Layer.types.pmtiles && layer._tiles && layer.options.opacity > 0)
        .flatMap(layer => Object.values(layer._tiles)
          .filter(tile => tile.el.done && !tile.el.request.signal.aborted && tile.el.isConnected)
          .map(tile => ({ ...tile, layer })));
      const zoom = Math.max(...tiles.map(tile => tile.coords.z));
      const bounds = new L.Bounds();
      for (const { coords, layer } of tiles) {
        const size = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
        bounds.extend(new L.Point(coords.x, coords.y).scaleBy(size));
        bounds.extend(new L.Point(coords.x + 1, coords.y + 1).scaleBy(size));
      }
      const size = bounds.getSize();
      const scaleX = atlas.width / size.x, scaleY = atlas.height / size.y;

      // Compare quadrant means: catches flips, offsets and missing tiles at any atlas scale.
      const quadrants = (pixels, width, height, stride, inset) => {
        const sums = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
        for (let y = inset; y < height - inset; y++) {
          for (let x = inset; x < width - inset; x++) {
            const sum = sums[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)];
            const i = y * stride + x * 4;
            sum[0] += pixels[i]; sum[1] += pixels[i + 1]; sum[2] += pixels[i + 2]; sum[3]++;
          }
        }
        return sums.map(([r, g, b, n]) => [r / n, g / n, b / n]);
      };
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let best;
      for (const tile of tiles.filter(tile => tile.coords.z === zoom && tile.layer.options.opacity === 1)) {
        canvas.width = tile.el.naturalWidth;
        canvas.height = tile.el.naturalHeight;
        context.drawImage(tile.el, 0, 0);
        const expected = quadrants(context.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width, canvas.height, canvas.width * 4, 4);
        const contrast = Math.max(...expected.flatMap(a => expected.map(b => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]))));
        if (!best || contrast > best.contrast) best = { tile, expected, contrast };
      }
      const tileSize = best.tile.layer.getTileSize();
      const offset = new L.Point(best.tile.coords.x, best.tile.coords.y).scaleBy(tileSize).subtract(bounds.min);
      const x = Math.ceil(offset.x * scaleX), y = Math.ceil(offset.y * scaleY);
      const width = Math.floor((offset.x + tileSize.x) * scaleX) - x;
      const height = Math.floor((offset.y + tileSize.y) * scaleY) - y;
      const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: atlas.texture, origin: [x, y] }, { buffer, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.destroy();
      const actual = quadrants(pixels, width, height, bytesPerRow, 2);
      let alpha = 255;
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) alpha = Math.min(alpha, pixels[row * bytesPerRow + column * 4 + 3]);
      }
      await device.queue.onSubmittedWorkDone();
      device.removeEventListener('uncapturederror', onGpuError);
      const terrainTiles = tiles.filter(tile => terrain._rasterTiles.has(tile.el));
      return {
        image: atlas.image,
        atlasSize: [atlas.width, atlas.height],
        uploads,
        tiles: tiles.length,
        terrainTiles: terrainTiles.length,
        duplicatedTerrainTiles: terrainTiles.filter(tile => owner._roofTiles.has(tile.el)).length,
        roofTiles: owner._roofTiles.size,
        contrast: best.contrast,
        colorError: Math.max(...actual.flatMap((quadrant, i) => quadrant.map((value, c) => Math.abs(value - best.expected[i][c])))),
        alpha,
        gpuErrors,
      };
    });
  } finally {
    this.page.off('pageerror', onPageError);
  }
  this.webgpuAtlas.pageErrors = pageErrors;
});

Then('the roof atlas matches its raster tiles without uploading a canvas', function () {
  const result = this.webgpuAtlas;
  const details = JSON.stringify(result);
  assert.equal(result.image, null, details);
  assert.ok(result.atlasSize.every(size => size >= 1 && size <= 4096), details);
  assert.ok(result.uploads.every(upload => upload.type !== 'HTMLCanvasElement' && upload.width <= 512 && upload.height <= 512), details);
  assert.ok(result.terrainTiles > 0, details);
  assert.equal(result.duplicatedTerrainTiles, 0, details);
  assert.ok(result.uploads.length <= result.roofTiles, details);
  assert.ok(result.contrast > 10, details);
  assert.ok(result.colorError < 6, details);
  assert.equal(result.alpha, 255, details);
  assert.deepEqual(result.gpuErrors, [], details);
  assert.deepEqual(result.pageErrors, [], details);
});

When('I inspect the WebGPU terrain tiles', { timeout: 60000 }, async function () {
  const pageErrors = [];
  const onPageError = error => pageErrors.push(error.message);
  this.page.on('pageerror', onPageError);
  try {
    await waitForWebGPUScene(this.page);
    this.webgpuTerrain = await this.page.evaluate(async () => {
      const owner = L.Layer.types['3d']._renderers.get(map);
      const terrain = map._terrain3D;
      const { device } = owner.renderer;
      const crs = map.options.crs;
      const coordsByTile = new Map();
      for (const layer of Object.values(map._layers)) {
        for (const tile of Object.values(layer._tiles || {})) coordsByTile.set(tile.el, tile.coords);
      }
      const renderUploads = [];
      const copyExternal = device.queue.copyExternalImageToTexture;
      device.queue.copyExternalImageToTexture = function (source) {
        renderUploads.push(source.source);
        return copyExternal.apply(this, arguments);
      };
      try {
        owner._render();
      } finally {
        delete device.queue.copyExternalImageToTexture;
      }
      const origin = crs.project(terrain.location);
      const metres = Math.cos(terrain.location.lat * Math.PI / 180);
      const base = terrain._terrainOriginElevation;
      // Run the shader's own elevation code on every grid vertex, as the vertex stage does.
      const vertices = [];
      let wrongVertexCount = 0, notUploaded = 0, wrongSize = 0, missingCoords = 0, raisedGrid = 0;
      const grids = new Set(), divisionLevels = new Set();
      for (const [tile, mesh] of terrain._rasterTiles) {
        const coords = coordsByTile.get(tile);
        if (!coords) { missingCoords++; continue; }
        if (mesh.texture.uploaded !== tile) notUploaded++;
        if (mesh.texture.texture.width !== tile.width || mesh.texture.texture.height !== tile.height) wrongSize++;
        const divisions = Math.max(1, Math.min(64, 256 / 2 ** (coords.z - terrain._terrainZoom)));
        const { position, uv } = mesh.geometry.attributes;
        grids.add(mesh.geometry.attributes);
        divisionLevels.add(divisions);
        if (position.count !== (divisions + 1) ** 2) { wrongVertexCount++; continue; }
        for (let i = 0; i < position.count; i++) {
          if (position.data[i * 3 + 1] !== 0) raisedGrid++;
          vertices.push({ mesh, coords, divisions, u: uv.data[i * 2], v: uv.data[i * 2 + 1] });
        }
      }
      const module = device.createShaderModule({ code: `
        @group(0) @binding(0) var dem: texture_2d<f32>;
        @group(0) @binding(1) var<storage, read> terrains: array<vec4<f32>>;
        @group(0) @binding(2) var<storage, read> uvs: array<vec2<f32>>;
        @group(0) @binding(3) var<storage, read_write> heights: array<f32>;
        ${L.Layer.types.terrain.elevationWGSL}
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          if (id.x >= arrayLength(&heights)) { return; }
          let t = terrains[id.x];
          heights[id.x] = elevation(t.xy + uvs[id.x] * t.z, t.w) - t.w;
        }
      ` });
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ] });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: 'main' },
      });
      const storage = data => {
        const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buffer, 0, data);
        return buffer;
      };
      const terrains = storage(new Float32Array(vertices.flatMap(({ mesh }) => mesh.terrain)));
      const uvs = storage(new Float32Array(vertices.flatMap(({ u, v }) => [u, v])));
      const heights = device.createBuffer({ size: vertices.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: vertices.length * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout, entries: [
        { binding: 0, resource: terrain._dem.texture.createView() },
        { binding: 1, resource: { buffer: terrains } },
        { binding: 2, resource: { buffer: uvs } },
        { binding: 3, resource: { buffer: heights } },
      ] }));
      pass.dispatchWorkgroups(Math.ceil(vertices.length / 64));
      pass.end();
      encoder.copyBufferToBuffer(heights, 0, readback, 0, vertices.length * 4);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const gpuHeights = new Float32Array(readback.getMappedRange()).slice();
      for (const buffer of [terrains, uvs, heights, readback]) buffer.destroy();
      // Reference: geographic round trip per vertex, as the grid was built before the linear shortcut.
      let maxError = 0, relief = 0;
      for (const [i, { mesh, coords, divisions, u, v }] of vertices.entries()) {
        const latlng = map.unproject([(coords.x + u) * 256, (coords.y + v) * 256], coords.z);
        const point = crs.project(latlng);
        const elevation = (terrain._getElevation(latlng) ?? base) - base;
        maxError = Math.max(maxError,
          Math.abs(mesh.position[0] + mesh.scale[0] * u - (point.x - origin.x) * metres),
          Math.abs(gpuHeights[i] - elevation),
          Math.abs(mesh.position[2] + mesh.scale[2] * v + (point.y - origin.y) * metres));
        relief = Math.max(relief, Math.abs(elevation));
      }
      await device.queue.onSubmittedWorkDone();
      return {
        meshes: terrain._rasterTiles.size, vertices: vertices.length, maxError, relief,
        missingCoords, wrongVertexCount, notUploaded, wrongSize, raisedGrid,
        grids: grids.size, divisionLevels: divisionLevels.size,
        terrainUploadsDuringRender: renderUploads.filter(source => terrain._rasterTiles.has(source)).length,
      };
    });
  } finally {
    this.page.off('pageerror', onPageError);
  }
  this.webgpuTerrain.pageErrors = pageErrors;
});

Then('terrain tiles are uploaded before rendering and match the projected DEM grid', function () {
  const result = this.webgpuTerrain;
  const details = JSON.stringify(result);
  assert.ok(result.meshes > 0 && result.vertices > 0, details);
  assert.ok(result.relief > 1, details);
  assert.equal(result.missingCoords, 0, details);
  assert.equal(result.wrongVertexCount, 0, details);
  assert.equal(result.notUploaded, 0, details);
  assert.equal(result.wrongSize, 0, details);
  assert.equal(result.terrainUploadsDuringRender, 0, details);
  // Elevation lives in the vertex shader: tiles share one flat grid per subdivision level.
  assert.equal(result.raisedGrid, 0, details);
  assert.equal(result.grids, result.divisionLevels, details);
  // Float32 GPU elevation and DEM pixel coordinates: about 1 mm.
  assert.ok(result.maxError < 0.01, details);
  assert.deepEqual(result.pageErrors, [], details);
});
