import './3d.js';
import './pmtiles.js';

/** Renders IGN Float32 DEM tiles and PMTiles raster basemaps in the shared WebGPU scene. */
L.Layer.types.terrain = L.Layer.types['3d'].extend({
  initialize(options = {}) {
    const terrainSource = options.url;
    const layerOptions = { ...options };
    delete layerOptions.url;
    L.Layer.types['3d'].prototype.initialize.call(this, layerOptions);
    this.terrainSource = terrainSource;
    this._terrainTiles = new Map();
    this._rasterTiles = new Map();
    this._terrainReady = false;
  },

  onAdd(map) {
    if (map._terrain3D && map._terrain3D !== this) throw new Error('Only one terrain layer can be active per map');
    map._terrain3D = this;
    L.Layer.types['3d'].prototype.onAdd.call(this, map);
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
    L.Layer.types['3d'].prototype.onRemove.call(this, map);
  },

  async _loadTerrain() {
    if (this._terrainLoading || !this._map) return;
    this._terrainLoading = true;
    this._terrainReady = false;
    const controller = this._terrainController = new AbortController();
    try {
      if (!this.terrainSource) throw new Error('Terrain layer requires a PMTiles elevation archive');
      const archive = this._terrainArchive = new L.Layer({ source: { type: 'pmtiles', url: this.terrainSource } });
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
      id:           L.Layer.types['3d']._nextId++,
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
