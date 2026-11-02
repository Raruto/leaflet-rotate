import { computeBounds } from '../utils/geometry.js';
import { traverse, updateWorldMatrix, updateCamera } from '../utils/scene.js';

/** Scene graph, shared camera and frame rendering. */
/** Content changes: render once on the next animation frame. */
export function update(backend) {
  const shared = backend._shared;
  if (!shared) return backend;
  if (shared !== backend) {
    shared.update();
    return backend;
  }
  backend._frame ||= requestAnimationFrame(() => {
    backend._frame = null;
    if (backend._shared === backend && backend.renderer) backend._render();
  });
  return backend;
}

/** Map movement: render within the frame of Leaflet's CSS transforms, coalescing same-tick events. */
export function onMapChange(backend) {
  if (backend._queued) return;
  backend._queued = true;
  queueMicrotask(() => {
    backend._queued = false;
    if (backend._shared !== backend || !backend.renderer) return;
    if (backend._map._animatingZoom) backend.update();
    else backend._render();
  });
}

/** Find a raster tile's active CSS level to reproduce Leaflet's animated scale/rounding. */
export function getTileLevel(backend) {
  let level;
  backend._map.eachLayer(layer => {
    if (!level && layer instanceof L.TileLayer && layer._levels) {
      level = layer._levels[layer._tileZoom];
    }
  });
  return level;
}

/** Preserve the outgoing tile level before Leaflet changes its logical zoom. */
export function startZoom(backend) {
  backend._zoomLevel = backend._getTileLevel();
}

/** Stop using the outgoing level after zoomend; the next redraw uses current tiles. */
export function endZoom(backend) {
  for (const animation of backend._zoomTransitions?.keys() || []) animation.finish();
  backend._zoomTransitions = null;
  backend._zoomLevel = null;
  backend.update();
}

/**
 * Rendering owner: CSS pixels -> scene metres -> perspective camera.
 * Lights and transparent sort centers are converted into the current camera space.
 * Without raster tiles, logical map projection supplies the same static alignment.
 */
export function render(backend) {
  cancelAnimationFrame(backend._frame);
  backend._frame = null;
  if (backend._shared !== backend || !backend.renderer) return;
  const map = backend._map;
  const size = map.getSize();
  if (!size.x || !size.y) return;
  if (map._animatingZoom) {
    backend._zoomTransitions ||= new Map();
    const now = performance.now();
    for (const animation of map.getContainer().getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSTransition) || animation.transitionProperty !== 'transform' ||
        !animation.effect.target.classList.contains('leaflet-zoom-animated') ||
        backend._zoomTransitions.has(animation)
      ) {
          continue;
      }
      const time = animation.currentTime || 0;
      animation.pause();
      backend._zoomTransitions.set(animation, { start: now, time });
    }
    // Freeze CSS between rendered frames: the compositor must not outrun the canvas.
    for (const [animation, { start, time }] of backend._zoomTransitions) {
      animation.currentTime = Math.min(animation.effect.getComputedTiming().endTime, time + now - start);
    }
  }
  if (!backend._size || !backend._size.equals(size)) {
    backend.renderer.width                  = size.x;
    backend.renderer.height                 = size.y;
    backend.renderer.canvas.width        = Math.round(size.x * backend.renderer.dpr);
    backend.renderer.canvas.height       = Math.round(size.y * backend.renderer.dpr);
    backend.renderer.canvas.style.width  = `${size.x}px`;
    backend.renderer.canvas.style.height = `${size.y}px`;
    if (backend.renderer.depthTexture) backend._destroyTexture(backend.renderer.depthTexture);
    backend.renderer.depthTexture = backend.renderer.device.createTexture({
      size: [backend.renderer.canvas.width, backend.renderer.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    backend._size                           = size;
  }

  // Match the map's CSS camera: a perspective distance of 1.5 viewport heights.
  let pixelsPerMeter = map.options.crs.scale(map.getZoom()) / (40075016.68557849 * Math.cos(backend._sceneOrigin.lat * Math.PI / 180));
  let origin         = map.project(backend._sceneOrigin).subtract(map.getPixelOrigin());
  const level        = backend._zoomLevel?.el.isConnected ? backend._zoomLevel : backend._getTileLevel();
  if (level && map._animatingZoom) {
    backend._zoomLevel = level;
  }
  // Leaflet's logical zoom jumps before its tile CSS transition finishes.
  // Use the rendered tile transform, including its rounding, on every animation frame.
  if (level) {
    const transform = new DOMMatrix(map._animatingZoom ? getComputedStyle(level.el).transform : level.el.style.transform);
    const point     = map.project(backend._sceneOrigin, level.zoom).subtract(level.origin);
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
  const camera = backend.camera;
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
  updateCamera(camera);
  const sunlight = map._sunlight;
  const lightPoint = new DOMPoint(...(sunlight?.direction || [-300, 500, 300]), 0).matrixTransform(new DOMMatrix(camera.viewMatrix));
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
  updateWorldMatrix(backend.scene);
  traverse(backend.scene, mesh => {
    if (!mesh.visible) return true;
    if (mesh.geometry) {
      if (!mesh.geometry.bounds) computeBounds(mesh.geometry);
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
      if (!mesh.geometry.bounds) computeBounds(mesh.geometry);
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
  const renderer = backend.renderer;
  if ([...backend._layers].some(layer => layer.options.roofTexture)) {
    const rasters = Object.values(map._layers).filter(layer =>
      layer instanceof L.Layer.types.pmtiles && layer._tiles && layer.options.opacity > 0);
    const tiles = rasters.flatMap(layer => Object.values(layer._tiles)
      .filter(tile => tile.el.done && !tile.el.request.signal.aborted && tile.el.isConnected)
      .map(tile => ({ ...tile, layer })));
    const signature = tiles.map(({ el, coords, layer }) =>
      `${L.Util.stamp(el)}:${coords.z}:${coords.x}:${coords.y}:${layer.options.opacity}:${layer.options.zIndex}`).join('|');
    const selection = rasters.map(layer =>
      `${L.Util.stamp(layer)}:${layer.options.opacity}:${layer.options.zIndex}`).join('|');
    // Retain the geographically aligned atlas until a tile batch finishes loading.
    if (!backend._roofRaster || backend._roofRaster.selection !== selection ||
      (!rasters.some(layer => layer.isLoading()) && backend._roofRaster.signature !== signature)) {
      const zoom = tiles.length ? Math.max(...tiles.map(tile => tile.coords.z)) : map.getZoom();
      const bounds = new L.Bounds();
      for (const { coords, layer } of tiles) {
        const size = layer.getTileSize().multiplyBy(map.getZoomScale(zoom, coords.z));
        bounds.extend(new L.Point(coords.x, coords.y).scaleBy(size));
        bounds.extend(new L.Point(coords.x + 1, coords.y + 1).scaleBy(size));
      }
      const min = bounds.min || map.project(backend._sceneOrigin, zoom);
      const size = bounds.isValid() ? bounds.getSize() : new L.Point(1, 1);
      // ponytail: cap at 4096 px; virtual textures if wide views need native detail.
      const limit   = 4096;
      const scale   = Math.min(1, limit / Math.max(size.x, size.y));
      const width   = Math.max(1, Math.ceil(size.x * scale));
      const height  = Math.max(1, Math.ceil(size.y * scale));
      const origin = map.project(backend._sceneOrigin, zoom);
      const pixels = map.options.crs.scale(zoom) / (40075016.68557849 * Math.cos(backend._sceneOrigin.lat * Math.PI / 180));
      const matrix = new DOMMatrix();
      matrix.m11 = pixels / size.x; matrix.m33 = pixels / size.y;
      matrix.m41 = (origin.x - min.x) / size.x; matrix.m43 = (origin.y - min.y) / size.y;
      const texture = backend._roofRaster?.texture;
      if (texture && (texture.width !== width || texture.height !== height)) {
        backend._destroyTexture(texture.texture);
        texture.texture = renderer.device.createTexture({
          size: [width, height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        texture.width = width;
        texture.height = height;
      }
      backend._roofRaster = {
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
      const roofTiles = backend._roofTiles ||= new Map();
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
          view: backend._roofRaster.texture.texture.createView(),
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
  } else if (backend._roofRaster) {
    backend._destroyTexture(backend._roofRaster.texture.texture);
    backend._roofRaster = null;
    for (const source of backend._roofTiles?.values() || []) source.texture.destroy();
    backend._roofTiles = null;
  }
  // Visible meshes: opaque first, transparent surfaces back-to-front.
  const meshes = [];
  traverse(backend.scene, mesh => { if (!mesh.visible) return true; if (mesh.geometry && mesh._visibleInFrame) meshes.push(mesh); });
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
  const shadowMeshes = [];
  if (sunlight?.altitude >= 3) {
    for (const layer of backend._layers) {
      if (layer instanceof L.Layer.types.terrain) continue;
      traverse(layer.root, mesh => {
        if (!mesh.visible) return true;
        if (mesh.geometry && !mesh.tile && !mesh.program.nightLight && mesh.program.depthTest !== false) shadowMeshes.push(mesh);
      });
    }
  }
  if (!renderer.uniformBuffer || renderer.uniformBuffer.size < (meshes.length * 2 + shadowMeshes.length + 1) * 256) {
    if (renderer.uniformBuffer) backend._destroyTexture(renderer.uniformBuffer);
    renderer.uniformBuffer = renderer.device.createBuffer({
      size: Math.max(64, meshes.length * 4 + shadowMeshes.length * 2) * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    renderer.uniformData = new Float32Array(renderer.uniformBuffer.size / 4);
  }
  const frameData = renderer.uniformData;
  frameData.set(camera.viewMatrix, 0);
  frameData.set(camera.projectionMatrix, 16);
  frameData.set(backend._roofRaster?.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 32);
  frameData.set(light, 48);
  frameData[51] = sunlight && sunlight.altitude <= 0 ? 0 : 1;
  frameData.set(sky, 52);
  const night = sunlight ? Math.max(0, Math.min(1, (3 - sunlight.altitude) / 9)) : 0;
  frameData[55] = night * night * (3 - 2 * night);
  frameData.set(sunlight?.tint || [1, 1, 1], 56);
  frameData[59] = 0;
  if (night > 0) backend._updatePointLights();
  renderer.uniformSlot = 1;
  backend._renderSunlight(encoder, shadowMeshes, sunlight);
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
  pass.setBindGroup(1, renderer.sunlight.bindGroup);
  for (const mesh of meshes) {
    if (mesh.tile && mesh.tile.style.visibility !== 'hidden') pendingRasterTiles.push(mesh.tile);
    const world = mesh.worldMatrix;
    if (mesh.texture) {
      mesh.program.uniforms.baseTexture.value = mesh.texture;
      mesh.program.uniforms.opacity.value = mesh.opacity;
    }
    const uniforms = mesh.program.uniforms;
    if (uniforms.roofTexture) uniforms.roofTexture.value = backend._roofRaster?.texture || renderer.roofFallbackTexture;
    const determinant = world[0] * (world[5] * world[10] - world[6] * world[9]) -
      world[4] * (world[1] * world[10] - world[2] * world[9]) +
      world[8] * (world[1] * world[6] - world[2] * world[5]);
    if (!Number.isFinite(determinant) || determinant === 0) {
      throw new Error('Singular 3D transform');
    }
    const frontFace = determinant < 0 ? 'cw' : 'ccw';
    const program = mesh.program;
    if (program.transparent && program._layerMaterial.doubleSided) {
      backend._drawGeometry(mesh, pass, 'front', frontFace);
      backend._drawGeometry(mesh, pass, 'back', frontFace);
    } else {
      backend._drawGeometry(mesh, pass, program.cullMode, frontFace);
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
      for (const layer of backend._layers || []) layer.fire('error', { error });
    });
  }
  if (map._animatingZoom) backend.update();
}
