/** Scene graph, shared camera and frame rendering. Mixed into L.Layer.types['3d']. */
export default {
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
        layer instanceof L.Layer.types.pmtiles && layer._tiles && layer.options.opacity > 0);
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
    const shadowMeshes = [];
    if (sunlight?.altitude >= 3) {
      for (const layer of this._layers) {
        if (layer instanceof L.Layer.types.terrain) continue;
        this.traverse(layer.root, mesh => {
          if (!mesh.visible) return true;
          if (mesh.geometry && !mesh.tile && !mesh.program.nightLight && mesh.program.depthTest !== false) shadowMeshes.push(mesh);
        });
      }
    }
    if (!renderer.uniformBuffer || renderer.uniformBuffer.size < (meshes.length * 2 + shadowMeshes.length + 1) * 256) {
      if (renderer.uniformBuffer) this._destroyTexture(renderer.uniformBuffer);
      renderer.uniformBuffer = renderer.device.createBuffer({
        size: Math.max(64, meshes.length * 4 + shadowMeshes.length * 2) * 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
};
