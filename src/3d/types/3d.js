/**
 * The '3d' layer type, loaded on demand by src/3d/index.js.
 *
 * A native WebGPU scene drawn above the map tiles and kept in sync with the map camera
 * (center, zoom, bearing, pitch and zoom animations).
 *
 * No rendering dependencies. Use the `ready` event before using the helpers.
 * All instances on one map share a canvas, scene and camera, with one group per layer.
 *
 * World coordinates are metres relative to `location`: x east, y up, z south.
 * The shared scene instead uses the first attached layer's origin. `root` converts
 * each layer's local metres into that shared space, including latitude scaling.
 *
 * Lifecycle: initialize CPU state -> attach shared GPU device -> load configured
 * data/model -> ready. Removal cancels source work and detaches this layer only;
 * the last removal destroys the context. Model CPU arrays/images survive for re-add.
 *
 * This file holds the Leaflet lifecycle and explicit delegates to scene/ operations.
 * Stateless computations live in utils/; scene/ owns loading, GPU resources and interaction.
 * PMTiles v3 reading is implemented directly by this layer. Models are static triangles, without
 * animation, skinning, morph targets, normal maps or required extensions.
 *
 * Events: ready; error {error}; progress {enabled, loaded, skipped, pending, errors};
 * featurehover/featureclick {feature, originalEvent}. A feature may be null on a miss.
 * Picking tests geometry, not texture alpha: a transparent texel can still be hit.
 *
 * @example
 * new L.Layer({ source: { url: 'tower.glb', center: [48.8582601, 2.29449985] } }).addTo(map);
 * new L.Layer({ source: { type: '3d', url: 'buildings.pmtiles', featureStyle }, attribution }).addTo(map);
 * new L.Layer({ source: { type: 'terrain', url: 'terrain.pmtiles' } }).addTo(map);
 * new L.Layer({ source: { url: 'orthophotos.pmtiles', maxZoom: 24 } }).addTo(map);
 *
 * @typedef {Object} Layer3DOptions The `source` object; `pane`/`attribution` stay standard L.Layer options.
 * @property {string} [type] 'pmtiles' (raster tiles), '3d' (WebGPU scene) or 'terrain'; see L.Layer.types.
 * @property {number[]} [center] Local origin [lat,lng]; defaults to the first map center.
 * @property {number[]} [rotation] Model Euler rotation [x,y,z] in radians, YXZ order.
 * @property {number[]} [scale] Model scale [x,y,z]; independent of geographic scaling.
 * @property {string} [url] GLB/glTF model URL (loaded before ready), or PMTiles URL containing
 * Polygon/MultiPolygon or tree/light Point GeoJSON ('3d'), raster tiles ('pmtiles') or Float32 DEM ('terrain').
 * @property {function(Object): (ExtrusionStyle|null)} [featureStyle] Source styling; null skips.
 * @property {function(PickedFeature): (Node|string)} [tooltipContent] No HTML string evaluation.
 * @property {string} [ariaLabel='3D scene'] Shared canvas accessible name.
 * @property {boolean} [nightLight=false] Point sources: emissive bulbs and local illumination.
 * @property {boolean} [nightSparkle=false] Model: sparse luminous points at night.
 *
 * @typedef {Object} ExtrusionStyle
 * @property {number} top Roof height in metres; must exceed bottom.
 * @property {number} [bottom=0] Nonnegative base height; positive values create an underside.
 * @property {number|string|Object} [color=0xd9b38c] RGB/CSS color, or linear-space {h,s,l}.
 * @property {number} [trunkRadius] Point trees: trunk radius in metres.
 * @property {number} [crownRadius] Point trees: maximum crown radius in metres.
 * @property {number} [crownBottom] Point trees: crown base in metres, between bottom and top.
 * @property {string} [crownShape='round'] Point trees: 'round' or 'cone' schematic crown.
 * @property {number|string|Object} [trunkColor=0x72513a] Point trees: bark color.
 * @property {number} [lightRadius] Point lights: estimated ground reach in metres; top is emitter height.
 * @property {number} [lightFlux] Point lights: luminous flux in lumens.
 *
 * @typedef {Object} PickedFeature
 * @property {string|number} id Source feature id or configured model URL.
 * @property {Object} properties GeoJSON properties or model-level glTF extras.
 * @property {Object} mesh Intersected mesh.
 * @property {number[]} point Intersection [x,y,z] in shared scene metres, not layer-local metres.
 * @property {Object} [model] Configured model root; absent for source polygons.
 * @property {number} [vertexStart] First polygon vertex in the batched mesh.
 * @property {number} [vertexEnd] Exclusive end of the polygon's vertex range.
 *
 * @typedef {Object} SourceArea
 * @property {Object} coords Archive block {z,x,y}; z is header.minZoom, not display zoom.
 * @property {AbortController} request Cancellation also prevents attaching obsolete results.
 * @property {boolean} [started] Enqueued work has consumed a concurrency slot.
 * @property {boolean} [done] Geometry built successfully, including empty blocks.
 * @property {Object|null} [mesh] One batched GPU mesh per non-empty block.
 * @property {number} [buildings] Emitted feature count, not number of triangles.
 * @property {number} [skipped] Features intentionally skipped by featureStyle.
 * @property {string} [error] Failed load/build message; reported through error and progress.
 *
 * @since leaflet-rotate (v0.6.0)
 */

import * as shapes from '../utils/geometry.js';
import * as gpu from '../scene/gpu.js';
import * as lighting from '../scene/lighting.js';
import * as model from '../scene/model.js';
import * as picking from '../scene/picking.js';
import * as pmtiles from '../scene/pmtiles.js';
import * as archive from '../utils/pmtiles.js';
import * as render from '../scene/render.js';
import * as graph from '../utils/scene.js';
import * as sources from '../scene/sources.js';

L.Layer.types['3d'] = L.Layer.extend({
  color(value) { return shapes.parseColor(value); },
  _setVertexColor(mesh, start, end, color) { shapes.setVertexColor(mesh, start, end, color); return this.update(); },
  _triangulate(contour, holes) { return shapes.triangulate(contour, holes); },
  _isClockWise(points) { return shapes.isClockWise(points); },
  _treeGeometry(point, style, addTriangle) { return shapes.treeGeometry(point, style, addTriangle); },
  _lightGeometry(point, style, addTriangle) { return shapes.lightGeometry(point, style, addTriangle); },
  _lampPostGeometry(point, style, addTriangle) { return shapes.lampPostGeometry(point, style, addTriangle); },
  _attach(map) { return gpu.attach(this, map); },
  _destroyTexture(texture) { return gpu.destroyTexture(this, texture); },
  _createProgram(material) { return gpu.createProgram(this, material); },
  _removeProgram(program) { return gpu.removeProgram(program); },
  _createMesh(data, material, usage) { return gpu.createMesh(this, data, material, usage); },
  _disposeMesh(mesh) { return gpu.disposeMesh(this, mesh); },
  _computeBounds(geometry) { return shapes.computeBounds(geometry); },
  _drawGeometry(mesh, pass, cullMode, frontFace) { return gpu.drawGeometry(this, mesh, pass, cullMode, frontFace); },
  _initSunlight() { return lighting.initSunlight(this); },
  _resizeSunlight(size) { return lighting.resizeSunlight(this, size); },
  _bindSunlight() { return lighting.bindSunlight(this); },
  _updatePointLights() { return lighting.updatePointLights(this); },
  _renderSunlight(encoder, meshes, sunlight) { return lighting.renderSunlight(this, encoder, meshes, sunlight); },
  _loadModel() { return model.loadModel(this); },
  raycast(event, objects, recursive) { return picking.raycast(this, event, objects, recursive); },
  _findFeature(event) { return picking.findFeature(this, event); },
  _setHighlight(feature) { return picking.setHighlight(this, feature); },
  _showFeature(feature, event) { return picking.showFeature(this, feature, event); },
  _onPointerMove(event) { return picking.onPointerMove(this, event); },
  _onClick(event) { return picking.onClick(this, event); },
  _onPointerLeave() { return picking.onPointerLeave(this); },
  _read(offset, length, signal) { return pmtiles.read(this, offset, length, signal); },
  _decompress(data, compression) { return archive.decompress(data, compression); },
  getHeader() { return pmtiles.getHeader(this); },
  getZxy(z, x, y, signal) { return pmtiles.getZxy(this, z, x, y, signal); },
  update() { return render.update(this); },
  _onMapChange() { return render.onMapChange(this); },
  _getTileLevel() { return render.getTileLevel(this); },
  _startZoom() { return render.startZoom(this); },
  _endZoom() { return render.endZoom(this); },
  _render() { return render.render(this); },
  setParent(node, parent) { return graph.setParent(node, parent); },
  traverse(node, callback) { return graph.traverse(node, callback); },
  _updateWorldMatrix(node) { return graph.updateWorldMatrix(node); },
  _updateCamera(camera) { return graph.updateCamera(camera); },
  _onTerrainChange() { return sources.onTerrainChange(this); },
  _updateArea() { return sources.updateArea(this); },
  _pump() { return sources.pump(this); },
  _releaseArea(area) { return sources.releaseArea(this, area); },
  _updateStatus(enabled) { return sources.updateStatus(this, enabled); },

  statics: {
    /** Rendering owner per map; entries are removed on the last layer removal. */
    _renderers: new WeakMap(),
  },

  options: {
    // Accessible description of the canvas.
    ariaLabel: '3D scene',
  },

  /**
   * @param {Layer3DOptions} [options] World origin comes from center or the first map centre.
   * Public state: `location` is fixed after first addition; `root` is this layer's
   * transform; `group` aliases root only for sources; `model` is the configured
   * model wrapper. `_shared` references the rendering owner (a '3d' layer);
   * `scene`, `camera` and `renderer` alias its resources while attached.
   *
   */
  initialize(options) {
    L.Util.setOptions(this, options);
    // ponytail: models are recognised by extension; extensionless model URLs need a .glb/.gltf suffix or query.
    const model = /\.(glb|gltf)(?:[?#]|$)/i.test(this.options.url);
    this.modelUrl = model ? this.options.url : null;
    this.url = this.options.url && !model ? new URL(this.options.url, document.baseURI).href : null;
    this._directories = new Map();
    if (this.options.center) {
      this.location = new L.LatLng(this.options.center[0], this.options.center[1]);
    }
    /** @type {Map<string, SourceArea>} Keys are archive x/y, not screen tiles. */
    this._areas = new Map();
    // Counts pending archive/build tasks, including ones cancelled after a pan.
    this._inflight = 0;
    // Gate GPU work on attachment; replaced on removal to support delayed loads.
    this._added = Promise.withResolvers();
    // Defer initialization so callers can subscribe to ready/error after construction.
    queueMicrotask(async () => {
      try {
        this.root = graph.emptyNode();
        this.raycaster = {
          origin:    [0, 0, 0],
          direction: [0, 0, 0]
        };
        if (this.url) {
          this.group = this.root;
          this.header = await this.getHeader();
        }
        if (this._map) await this._attach(this._map);
        if (this.modelUrl) await this._loadModel();
        if (this._shared) this.update();
        this.fire('ready');
      } catch (error) {
        this.fire('error', { error });
      }
    });
  },

  /** Attach interaction immediately; initialization may finish before or after onAdd. */
  onAdd(map) {
    this._added.resolve();
    if (!this.location) {
      const center = map.getCenter();
      this.location = new L.LatLng(center.lat, center.lng);
    }
    if (this.url || this.options.tooltipContent || this.modelUrl) {
      this.container = map.getContainer();
      if (this.options.tooltipContent) {
        this._tooltip = L.DomUtil.create('div', 'leaflet-3d-tooltip', this.container);
        this._tooltip.hidden = true;
        this._tooltip.setAttribute('role', 'tooltip');
        this._tooltip.setAttribute('aria-live', 'polite');
        this._tooltip.style.cssText = 'position:absolute;z-index:600;max-width:220px;padding:10px 12px;border:1px solid #6b5140;border-radius:6px;background:#fffaf0;box-shadow:0 3px 12px #0005;color:#30251d;font:13px/1.45 sans-serif;pointer-events:none';
      }
      L.DomEvent.on(this.container, {
        mousemove: this._onPointerMove,
        click: this._onClick,
        mouseleave: this._onPointerLeave,
      }, this);
    }
    if (this.root) {
      this._attach(map).catch(error => this.fire('error', { error }));
    }
  },

  /** Reconcile source coverage when the visible ground footprint changes. */
  getEvents() {
    return this.url ? {
      moveend:       this._updateArea,
      zoomend:       this._updateArea,
      rotate:        this._updateArea,
      pitch:         this._updateArea,
      resize:        this._updateArea,
      terrainchange: this._onTerrainChange,
    } : {};
  },

  /** Release source meshes/UI; retain manually added objects and model CPU data. */
  onRemove(map) {
    this._added = Promise.withResolvers();
    if (this.container) {
      this._onPointerLeave();
      L.DomEvent.off(this.container, {
        mousemove:  this._onPointerMove,
        click:      this._onClick,
        mouseleave: this._onPointerLeave,
      }, this);
      this.container = null;
    }
    for (const area of this._areas.values()) this._releaseArea(area);
    this._areas.clear();
    this._tooltip?.remove();
    this._tooltip = null;
    if (this.url) this._updateStatus(false);
    const shared = this._shared;
    if (!shared) return;
    this.setParent(this.root, null);
    shared._layers.delete(this);
    if (shared === this) {
      map.off('move zoom rotate pitch resize viewreset layeradd layerremove', this._onMapChange, this);
      map.off('zoomstart', this._startZoom, this);
      map.off('zoomanim', this.update, this);
      map.off('zoomend', this._endZoom, this);
      cancelAnimationFrame(this._frame);
      this._frame = null;
      this._queued = false;
      if (this._layers.size) {
        // Keep the original scene origin and GPU resources when ownership changes.
        const next = this._layers.values().next().value;
        for (const key of ['_layers', '_sceneOrigin', '_size', '_zoomLevel', '_zoomTransitions', '_cursor', '_roofRaster', '_roofTiles']) {
          next[key] = this[key];
          delete this[key];
        }
        for (const layer of next._layers) layer._shared = next;
        L.Layer.types['3d']._renderers.set(map, next);
        map.on('move zoom rotate pitch resize viewreset layeradd layerremove', next._onMapChange, next);
        map.on('zoomstart', next._startZoom, next);
        map.on('zoomanim', next.update, next);
        map.on('zoomend', next._endZoom, next);
        next.update();
      } else {
        if (this._roofRaster) this._destroyTexture(this._roofRaster.texture.texture);
        this._roofRaster = null;
        for (const source of this._roofTiles?.values() || []) this._destroyTexture(source.texture);
        this._roofTiles = null;
        for (const animation of this._zoomTransitions?.keys() || []) animation.play();
        this._zoomTransitions = null;
        this.renderer.canvas.remove();
        const renderer = this.renderer;
        const resources = [renderer.depthTexture, renderer.roofFallbackTexture.texture, renderer.uniformBuffer,
          renderer.sunlight?.texture, renderer.sunlight?.buffer, renderer.sunlight?.lights].filter(Boolean);
        renderer.device.queue.onSubmittedWorkDone().then(() => {
          for (const resource of resources) resource.destroy();
          renderer.device.destroy();
        }, error => {
          this.fire('error', { error });
          renderer.device.destroy();
        });
        L.Layer.types['3d']._renderers.delete(map);
        for (const key of ['_layers', '_sceneOrigin', '_size', '_zoomLevel', '_cursor']) delete this[key];
      }
    } else shared.update();
    this._shared = null;
    this.renderer = this.scene = this.camera = null;
  },

  /**
   * Adds a scene node or mesh in layer-local coordinates and schedules a redraw.
   * Requires initialization and a compatible scene node.
   * @param {Object} object
   * @returns {L.Layer} This layer.
   */
  add(object) {
    this.setParent(object, this.root);
    return this.update();
  },

  _setTerrainHeight() {
    if (!this.root || !this.location) return;
    this._terrainBaseY ??= this.root.position[1];
    this.root.position[1] = this._terrainBaseY + (this._map?._terrain3D?._getElevation(this.location) ?? 0);
  },

  /**
   * Without an argument, removes this Leaflet layer. With an object, only detaches it:
   * geometry/program resources are not disposed, so it can be added again.
   * @param {Object} [object]
   * @returns {L.Layer}
   */
  remove(object) {
    if (object === undefined) return L.Layer.prototype.remove.call(this);
    this.setParent(object, null);
    return this.update();
  },
});

L.Layer.types['3d']._nextId = 0;
