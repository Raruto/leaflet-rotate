import { bridgeElevation, terrainElevation, terrainGrid, terrainAtlas } from '../utils/terrain.js';
import { triangulate } from '../utils/geometry.js';
import './3d.js';
import './pmtiles.js';

/**
 * Renders IGN Float32 DEM tiles and PMTiles raster basemaps in the shared WebGPU scene.
 * Source options: `url` (single-zoom Float32 PMTiles DEM); `bridges` (optional GeoJSON deck polygons with Z, see _addBridges).
 */
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
    this._bridges = null;
    this._disposeMesh(this._bridgeMesh);
    this._bridgeMesh = null;
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
      const bridges = this.options.bridges && await fetch(this.options.bridges, { signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error(`Bridges: HTTP ${response.status}`); return response.json(); });
      if (controller.signal.aborted || this._map !== map) return;
      this._terrainReady = true;
      this._terrainOriginElevation = this._getElevation(this.location) ?? 0;
      for (const layer of Object.values(map._layers)) layer._setTerrainHeight?.();
      if (bridges) this._addBridges(bridges);
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
    return bridgeElevation(point, this._bridges) ?? terrainElevation(point, this._terrainTiles);
  },

  /**
   * Bare-earth DEMs drop bridges: `_getElevation` returns the deck height inside these polygons (GeoJSON
   * Polygon/MultiPolygon with Z, e.g. IGN BD TOPO), and one mesh draws the 1.2 m thick decks.
   * ponytail: anything under a deck (quays, boats asking `_getElevation`) also gets the deck height.
   */
  _addBridges(geojson) {
    const map = this._map, crs = map.options.crs, zoom = this._terrainZoom;
    const origin = crs.project(this.location), metres = Math.cos(this.location.lat * Math.PI / 180);
    const base = this.root.position[1], position = [], normal = [], color = [];
    const local = ([lng, lat, z]) => {
      const p = crs.project(new L.LatLng(lat, lng));
      return [(p.x - origin.x) * metres, z - base, -(p.y - origin.y) * metres];
    };
    const push = (p, n) => { position.push(...p); normal.push(...n); color.push(0.6, 0.58, 0.54); };
    this._bridges = new Map();
    for (const { geometry } of geojson.features) {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      for (const polygon of polygons) {
        const rings = polygon.map(ring => ring.slice(0, -1)).filter(ring => ring.length >= 3);
        if (!rings.length) continue;
        const pixels = rings.flat().map(([lng, lat, z]) => { const p = map.project([lat, lng], zoom); return [p.x, p.y, z]; });
        const points = rings.flat().map(local);
        let triangles;
        try {
          const starts = rings.map((ring, r) => rings.slice(0, r).reduce((sum, previous) => sum + previous.length, 0));
          const [contour, ...holes] = rings.map((ring, r) => ring.map((c, i) => ({ x: pixels[starts[r] + i][0], y: pixels[starts[r] + i][1] })));
          triangles = triangulate(contour, holes);
        } catch { continue; }
        const bridge = {
          triangles: triangles.map(t => t.map(i => pixels[i])),
          min: [Math.min(...pixels.map(p => p[0])), Math.min(...pixels.map(p => p[1]))],
          max: [Math.max(...pixels.map(p => p[0])), Math.max(...pixels.map(p => p[1]))],
        };
        for (let x = Math.floor(bridge.min[0] / 64); x <= Math.floor(bridge.max[0] / 64); x++) {
          for (let y = Math.floor(bridge.min[1] / 64); y <= Math.floor(bridge.max[1] / 64); y++) {
            const key = `${x}/${y}`;
            this._bridges.set(key, [...this._bridges.get(key) || [], bridge]);
          }
        }
        const below = p => [p[0], p[1] - 1.2, p[2]];
        for (let [a, b, c] of triangles) {
          // Counter-clockwise seen from above, so double-sided shading keeps the top lit.
          const [pa, pb, pc] = [points[a], points[b], points[c]];
          if ((pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]) < 0) [b, c] = [c, b];
          for (const i of [a, b, c]) push(points[i], [0, 1, 0]);
          for (const i of [a, c, b]) push(below(points[i]), [0, -1, 0]);
        }
        let start = 0;
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i++) {
            const p = points[start + i], q = points[start + (i + 1) % ring.length];
            const length = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1, n = [(q[2] - p[2]) / length, 0, -(q[0] - p[0]) / length];
            for (const corner of [p, q, below(q), p, below(q), below(p)]) push(corner, n);
          }
          start += ring.length;
        }
      }
    }
    if (position.length) this._bridgeMesh = this._createMesh({ position, normal, color });
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
      const { elevations, low, high } = terrainAtlas(this._terrainTiles, bounds);
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
      attributes = terrainGrid(divisions);
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
