import { emptyNode } from './empty-node.js';

/** PMTiles GeoJSON source areas: loading, building and releasing. Mixed into L.Layer.types['3d']. */
export default {
  _onTerrainChange() {
    if (!this._map) return;
    for (const area of this._areas.values()) this._releaseArea(area);
    this._areas.clear();
    this._updateArea();
  },

  /** Cover the visible ground bounds and one bordering block, clipped to the archive. */
  _updateArea() {
    if (!this._map || !this.header) return;
    const z = this.header.minZoom;
    const center = this._map.project(this._map.getCenter(), z).divideBy(256).floor();
    const bounds = this._map.getBounds();
    const nw = this._map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const se = this._map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    const archiveNW = this._map.project([this.header.maxLat, this.header.minLon], z).divideBy(256).floor();
    const archiveSE = this._map.project([this.header.minLat, this.header.maxLon], z).divideBy(256).floor();
    const wanted = new Map();
    for (let x = Math.max(0, nw.x - 1, archiveNW.x); x <= Math.min(2 ** z - 1, se.x + 1, archiveSE.x); x++) {
      for (let y = Math.max(0, nw.y - 1, archiveNW.y); y <= Math.min(2 ** z - 1, se.y + 1, archiveSE.y); y++) {
        wanted.set(`${x}/${y}`, { z, x, y });
      }
    }
    for (const [key, area] of this._areas) {
      if (!wanted.has(key)) {
        this._releaseArea(area);
        this._areas.delete(key);
      }
    }
    // Load the nearest new blocks first without rebuilding retained geometry.
    for (const [key, coords] of [...wanted].sort(([, a], [, b]) =>
      Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))) {
      if (!this._areas.has(key)) this._areas.set(key, { coords, request: new AbortController() });
    }
    this._pump();
  },

  /** Start at most two load/build tasks; cancelled tasks still free their slot in finally. */
  _pump() {
    // Meshes need the shared renderer; _attach() re-runs _updateArea() once it exists.
    if (!this._map || !this._shared) return;
    for (const area of this._areas.values()) {
      if (this._inflight >= 2) break;
      if (area.started) continue;
      area.started = true;
      this._inflight++;
      (async () => {
        try {
          const coords = area.coords, { z, x, y } = coords;
          const result = await this.getZxy(z, x, y, area.request.signal);
          if (area.request.signal.aborted) return;
          const data = result ? JSON.parse(new TextDecoder().decode(result.data))
            : { type: 'FeatureCollection', features: [] };
          if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
            throw new Error('Invalid GeoJSON response');
          }
          const features = data.features;
          const positions = [], normals = [], colors = [], uvs = [], featureFaces = [], lights = [];
          const supports = new Set();
          let skipped = 0;
          const map = this._map;
          const crs = map.options.crs;
          const origin = crs.project(this.location);
          const metres = Math.cos(this.location.lat * Math.PI / 180);
          const groundOffset = point => point.ground || 0;
          const addTriangle = (a, ah, b, bh, c, ch, nx, ny, nz, color) => {
            const ux = b.x - a.x, uy = bh - ah, uz = a.y - b.y;
            const vx = c.x - a.x, vy = ch - ah, vz = a.y - c.y;
            // Orient the triangle to its intended outward normal after flipping north to -z.
            if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0) {
              const point = b, height = bh;
              b = c; bh = ch; c = point; ch = height;
            }
            positions.push(a.x, ah + groundOffset(a), -a.y,
              b.x, bh + groundOffset(b), -b.y,
              c.x, ch + groundOffset(c), -c.y);
            normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
            if (this.options.nightLight) uvs.push(...a.uv, ...b.uv, ...c.uv);
          };
          let deadline = performance.now() + 8;
          for (const feature of features) {
            if (area.request.signal.aborted) return;
            if (performance.now() >= deadline) {
              await new Promise(requestAnimationFrame);
              if (area.request.signal.aborted) return;
              deadline = performance.now() + 8;
            }
            const geometry = feature.geometry;
            const isTree = geometry?.type === 'Point';
            if (this.options.nightLight && !isTree) throw new Error('Night lights require Point geometry');
            const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
            if (!polygons && !isTree) throw new Error('Unsupported GeoJSON geometry');
            const [lon, lat] = (isTree ? geometry.coordinates : polygons[0]?.[0]?.[0]) ?? [];
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('Invalid GeoJSON coordinates');
            const anchor = map.project(new L.LatLng(lat, lon), coords.z);
            // Overlapping archive blocks may contain the same polygon; its first vertex owns it.
            if (Math.floor(anchor.x / 256) !== coords.x || Math.floor(anchor.y / 256) !== coords.y) continue;
            const style = this.options.featureStyle(feature);
            if (style === null) {
              skipped++;
              continue;
            }
            if (!style || typeof style !== 'object') throw new Error('featureStyle must return an extrusion style or null');
            const { top, bottom = 0, color = 0xd9b38c } = style;
            if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < 0 || top <= bottom) {
              throw new Error('Invalid extrusion heights: expected top > bottom >= 0');
            }
            const baseColor = this.color(color);
            const vertexStart = positions.length / 3;
            if (isTree) {
              const point = crs.project(new L.LatLng(lat, lon));
              const elevation = map._terrain3D?._getElevation([lat, lon]);
              const projected = {
                x: (point.x - origin.x) * metres, y: (point.y - origin.y) * metres,
                ground: Number.isFinite(elevation) && Number.isFinite(this.root.position[1])
                  ? elevation - this.root.position[1] : 0,
              };
              if (this.options.nightLight) {
                if (!Number.isFinite(style.lightFlux) || style.lightFlux <= 0) throw new Error('Invalid light flux');
                const support = feature.properties?.cod_ouvrag || `${lon},${lat}`;
                if (style.poleRadius > 0 && !supports.has(support)) {
                  this._lampPostGeometry(projected, style, addTriangle);
                  supports.add(support);
                }
                this._lightGeometry(projected, style, addTriangle);
                lights.push({
                  position: [projected.x, projected.ground + top, -projected.y],
                  radius: Math.hypot(top, style.lightRadius), color: [baseColor.r, baseColor.g, baseColor.b],
                  flux: style.lightFlux,
                });
              } else this._treeGeometry(projected, style, addTriangle);
            }
            for (const rings of polygons || []) {
              if (!rings.length) throw new Error('Empty GeoJSON polygon');
              const paths = rings.map(ring => {
                if (ring.length < 4) throw new Error('Invalid GeoJSON polygon ring');
                return ring.slice(0, -1).map(([lng, lat]) => {
                  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('Invalid GeoJSON coordinates');
                  const point = crs.project(new L.LatLng(lat, lng));
                  const elevation = this._map._terrain3D?._getElevation([lat, lng]);
                  return {
                    x: (point.x - origin.x) * metres,
                    y: (point.y - origin.y) * metres,
                    ground: Number.isFinite(elevation) && Number.isFinite(this.root.position[1])
                      ? elevation - this.root.position[1] : 0,
                  };
                });
              });
              const points = paths.flat();
              for (const [a, b, c] of this._triangulate(paths[0], paths.slice(1))) {
                addTriangle(points[a], top, points[b], top, points[c], top, 0, 1, 0, baseColor);
                if (bottom > 0) addTriangle(points[a], bottom, points[b], bottom, points[c], bottom, 0, -1, 0, baseColor);
              }
              paths.forEach((path, index) => {
                // Interior walls face into the courtyard; exterior walls face away from the building.
                const sign = this._isClockWise(path) === (index === 0) ? -1 : 1;
                for (let i = 0; i < path.length; i++) {
                  const a = path[i], b = path[(i + 1) % path.length];
                  const length = Math.hypot(b.x - a.x, b.y - a.y);
                  if (!length) continue;
                  const nx = sign * (b.y - a.y) / length, nz = sign * (b.x - a.x) / length;
                  addTriangle(a, bottom, b, bottom, b, top, nx, 0, nz, baseColor);
                  addTriangle(a, bottom, b, top, a, top, nx, 0, nz, baseColor);
                }
              });
            }
            const vertexEnd = positions.length / 3;
            featureFaces.push({
              id: feature.id ?? feature.properties?.objectid ?? JSON.stringify(geometry),
              properties: feature.properties, baseColor,
              faceStart: vertexStart / 3, faceEnd: vertexEnd / 3, vertexStart, vertexEnd,
            });
          }
          if (!positions.length) {
            Object.assign(area, { mesh: null, buildings: 0, skipped, done: true });
            return;
          }
          const device = this.renderer.device;
          const attributes = {
            position: { size: 3, data: new Float32Array(positions) },
            normal:   { size: 3, data: new Float32Array(normals) },
            color:    { size: 3, data: new Float32Array(colors) },
          };
          if (this.options.nightLight) attributes.uv = { size: 2, data: new Float32Array(uvs) };
          for (const [name, attribute] of Object.entries(attributes)) {
            attribute.count = attribute.data.length / attribute.size;
            attribute.buffer = device.createBuffer({
              size: Math.max(4, attribute.data.byteLength),
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(attribute.buffer, 0, attribute.data);
          }
          const meshGeometry = {
            device,
            attributes,
            drawRange: { start: 0, count: attributes.position.count },
          };
          Object.assign(area, {
            mesh: {
              ...emptyNode(),
              device,
              geometry:    meshGeometry,
              program:     this._createProgram({ vertexColors: true, roofTexture: Boolean(this.options.roofTexture),
                ...(this.options.nightLight ? { nightLight: true, alphaMode: 'BLEND', doubleSided: true } : {}) }),
              id:          L.Layer.types['3d']._nextId++,
              renderOrder: 0,
              extras:      { featureFaces, lights },
            },
            buildings: featureFaces.length,
            skipped,
            done: true
          });
          this.add(area.mesh);
        } catch (error) {
          if (area.request.signal.aborted) return;
          area.error = error.message;
          this.fire('error', { error });
        }
      })().finally(() => {
        this._inflight--;
        this._pump();
      });
    }
    this._updateStatus();
  },

  /** Cancel pending work and dispose this block's GPU data, including any hover highlight. */
  _releaseArea(area) {
    area.request.abort();
    if (area.mesh) {
      if (this.highlightedFeature?.mesh === area.mesh) {
        this._setHighlight(null);
        this.hoveredFeature = null;
        this._showFeature(null);
      }
      this.remove(area.mesh);
      const geometry = area.mesh.geometry;
      for (const attribute of Object.values(geometry.attributes)) attribute.buffer.destroy();
      this._removeProgram(area.mesh.program);
    }
  },

  /** Emit a snapshot for consumers; ready does not wait for all neighborhood tasks. */
  _updateStatus(enabled = true) {
    const progress = { enabled, loaded: 0, skipped: 0, pending: 0, errors: [] };
    for (const area of this._areas.values()) {
      if (area.error) progress.errors.push(area.error);
      else if (!area.done) progress.pending++;
      progress.loaded += area.buildings ?? 0;
      progress.skipped += area.skipped ?? 0;
    }
    this.fire('progress', progress);
  },
};
