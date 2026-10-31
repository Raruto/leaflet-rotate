/**
 * A WebGL (three.js) scene drawn above the map tiles and kept in sync with the map camera
 * (center, zoom, bearing, pitch and zoom animations).
 *
 * three.js is imported from unpkg on demand. Wait for `layer.ready` before using the helpers.
 * All instances on one map share a canvas, scene and camera, with one group per layer.
 *
 * World coordinates are metres relative to `location`: x east, y up, z south.
 *
 * @example
 * const layer = await new L.Layer3D({ center: [48.8582601, 2.29449985] }).addTo(map).ready;
 * layer.add(await layer.loadModel('tower.glb'));
 *
 * @typedef L.Layer3D
 *
 * @since leaflet-rotate (v0.6.0)
 */

L.Layer3D = L.Layer.extend({

    statics: {
        _loaderReady: null,
        _loaderURL: new URL('GLTFLoader.js', document.currentScript.src).href,
        _renderers: new WeakMap(),
    },

    options: {
        // Accessible description of the canvas.
        ariaLabel: '3D scene',
        // CSS z-index of the canvas (above tiles and vectors, below markers).
        zIndex: 450,
        // Upper bound of the canvas resolution, in device pixels per CSS pixel.
        maxPixelRatio: 2,
    },

    /**
     * @param {L.LatLng|number[]|Object} [location] World origin, or options only. Defaults to the map centre on first addition.
     * @param {Object} [options]
     */
    initialize(location, options) {
        if (location && !Array.isArray(location) && typeof location === 'object' && !('lat' in location)) {
            options = location;
            location = null;
        }
        L.Util.setOptions(this, options);
        location = location ?? this.options.center;
        this.location = location == null ? null : location instanceof L.LatLng ? location
            : Array.isArray(location) ? new L.LatLng(location[0], location[1])
            : new L.LatLng(location.lat, location.lng);
        this._areas = new Map();
        this._inflight = 0;
        /** @type {Promise<L.Layer3D>} Resolves when the helpers can be used. */
        this.ready = import('https://unpkg.com/three@0.170.0/build/three.module.js').then(async THREE => {
            this.THREE = THREE;
            L.Layer3D.THREE = THREE;
            this.root = new THREE.Group();
            this.raycaster = new THREE.Raycaster();
            if (this.options.tooltipContent !== undefined && typeof this.options.tooltipContent !== 'function') {
                throw new Error('tooltipContent must be a function');
            }
            if (this.options.source) {
                if (typeof this.options.featureStyle !== 'function') {
                    throw new Error('A GeoJSON source requires featureStyle(feature)');
                }
                this.group = this.root;
                this.archive = await import('https://unpkg.com/pmtiles@4.5.0/dist/esm/index.js?module').then(({ PMTiles }) => new PMTiles(new URL(this.options.source, document.baseURI).href));
                this.header = await this.archive.getHeader();
                const { minZoom, minLon, minLat, maxLon, maxLat } = this.header;
                if (!Number.isInteger(minZoom) || minZoom < 0 || minZoom > 30 ||
                    ![minLon, minLat, maxLon, maxLat].every(Number.isFinite) ||
                    minLon > maxLon || minLat > maxLat) {
                    throw new Error('Expected a GeoJSON PMTiles archive with a valid native zoom and bounds');
                }
            }
            if (this.options.model) {
                this.model = await this._loadModel(new URL(this.options.model, document.baseURI).href);
                if (this.options.rotation) this.model.rotation.set(...this.options.rotation);
                if (this.options.scale) this.model.scale.set(...this.options.scale);
                this.root.add(this.model);
            }
            if (this._map) this._attach(this._map);
            this.fire('ready');
            return this;
        }).catch(error => {
            this.fire('error', { error });
            throw error;
        });
    },

    onAdd(map) {
        if (!this.location) {
            const center = map.getCenter();
            this.location = new L.LatLng(center.lat, center.lng);
        }
        if (this.options.source || this.options.tooltipContent) {
            this.container = map.getContainer();
            if (this.options.tooltipContent) {
                this._featureTooltip = L.DomUtil.create('div', 'leaflet-3d-tooltip', this.container);
                this._featureTooltip.hidden = true;
                this._featureTooltip.setAttribute('role', 'tooltip');
                this._featureTooltip.setAttribute('aria-live', 'polite');
                this._featureTooltip.style.cssText = 'position:absolute;z-index:600;max-width:220px;padding:10px 12px;border:1px solid #6b5140;border-radius:6px;background:#fffaf0;box-shadow:0 3px 12px #0005;color:#30251d;font:13px/1.45 sans-serif;pointer-events:none';
            }
            L.DomEvent.on(this.container, {
                mousemove: this._onPointerMove,
                click: this._onClick,
                mouseleave: this._onPointerLeave,
            }, this);
        }
        if (this.THREE) this._attach(map);
    },

    getEvents() {
        return this.options.source ? { moveend: this._updateArea } : {};
    },

    onRemove(map) {
        if (this.container) {
            this._onPointerLeave();
            L.DomEvent.off(this.container, {
                mousemove: this._onPointerMove,
                click: this._onClick,
                mouseleave: this._onPointerLeave,
            }, this);
            this.container = null;
        }
        for (const area of this._areas.values()) this._releaseArea(area);
        this._areas.clear();
        this._featureTooltip?.remove();
        this._featureTooltip = null;
        if (this.options.source) this._updateStatus(false);
        const shared = this._shared;
        if (!shared) return;
        shared.scene.remove(this.root);
        shared.layers.delete(this);
        this._shared = null;
        this.renderer = this.scene = this.camera = null;
        if (shared.layers.size) shared.update();
        else {
            shared.dispose();
            L.Layer3D._renderers.delete(map);
        }
    },

    _attach(map) {
        let shared = L.Layer3D._renderers.get(map);
        if (!shared) {
            shared = this._createRenderer(map);
            L.Layer3D._renderers.set(map, shared);
        }
        const crs = map.options.crs;
        const origin = crs.project(shared.location);
        const point = crs.project(this.location);
        const metres = Math.cos(shared.location.lat * Math.PI / 180);
        this.root.position.set((point.x - origin.x) * metres, 0, -(point.y - origin.y) * metres);
        // Each group's metres are measured at its own latitude, not the shared camera origin.
        this.root.scale.setScalar(metres / Math.cos(this.location.lat * Math.PI / 180));
        this._shared = shared;
        this.renderer = shared.renderer;
        this.scene = shared.scene;
        this.camera = shared.camera;
        shared.layers.add(this);
        shared.scene.add(this.root);
        shared.update();
        if (this.header) this._updateArea();
    },

    /**
     * Adds a three.js object to the scene and redraws it.
     */
    add(object) {
        this.root.add(object);
        return this.update();
    },

    /**
     * Removes a three.js object from the scene and redraws it.
     */
    remove(object) {
        if (object === undefined) return L.Layer.prototype.remove.call(this);
        this.root.remove(object);
        return this.update();
    },

    /**
     * Loads a glTF / GLB model (GLTFLoader is imported on demand).
     *
     * @returns {Promise<THREE.Group>}
     */
    async loadModel(url) {
        await this.ready;
        return this._loadModel(url);
    },

    async _loadModel(url) {
        if (!L.Layer3D._loaderReady) {
            L.Layer3D._loaderReady = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = L.Layer3D._loaderURL;
                script.onload = () => {
                    script.remove();
                    if (globalThis.leafletGLTFLoader?.GLTFLoader) resolve(globalThis.leafletGLTFLoader);
                    else reject(new Error('GLTFLoader script did not expose its loader'));
                };
                script.onerror = () => {
                    script.remove();
                    reject(new Error(`Unable to load GLTFLoader: ${script.src}`));
                };
                document.head.append(script);
            });
        }
        const { GLTFLoader } = await L.Layer3D._loaderReady;
        return (await new GLTFLoader().loadAsync(url)).scene;
    },

    /**
     * @returns {THREE.Group} An empty group, eg. to add and remove several meshes at once.
     */
    createGroup() {
        return new this.THREE.Group();
    },

    /**
     * Creates a non-indexed mesh from flat `position`, `normal` and `color` arrays (3 items per vertex).
     * The default material is a Lambert material shared by every mesh, using vertex colors.
     *
     * @returns {THREE.Mesh}
     */
    createMesh(attributes, material) {
        const { BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial } = this.THREE;
        const geometry = new BufferGeometry();
        for (const name in attributes) {
            geometry.setAttribute(name, new Float32BufferAttribute(attributes[name], 3));
        }
        material = material || (this._material = this._material || new MeshLambertMaterial({ vertexColors: true }));
        return new Mesh(geometry, material);
    },

    /**
     * @param {number|string|Object} value Any value accepted by `THREE.Color` (eg. `0x48d9ff`, `'#48d9ff'`)
     *                                     or `{h, s, l}` in `0`–`1` (three.js working color space).
     * @returns {THREE.Color} The color in three.js working color space (`r`, `g`, `b` in `0`–`1`).
     */
    color(value) {
        return value && typeof value === 'object' && 'h' in value ? new this.THREE.Color().setHSL(value.h, value.s, value.l) : new this.THREE.Color(value);
    },

    /**
     * Paints the vertices `[start, end)` of a mesh with vertex colors, then redraws.
     */
    setVertexColor(mesh, start, end, color) {
        const attribute = mesh.geometry.getAttribute('color');
        for (let i = start; i < end; i++) attribute.setXYZ(i, color.r, color.g, color.b);
        attribute.needsUpdate = true;
        return this.update();
    },

    /**
     * Triangulates a polygon given as `{x, y}` points.
     *
     * @returns {number[][]} Triangles as indices in `[...contour, ...holes.flat()]`.
     */
    triangulate(contour, holes = []) {
        const toVectors = points => points.map(({ x, y }) => new this.THREE.Vector2(x, y));
        return this.THREE.ShapeUtils.triangulateShape(toVectors(contour), holes.map(toVectors));
    },

    /**
     * @returns {boolean} Whether the `{x, y}` points are in clockwise order.
     */
    isClockWise(points) {
        return this.THREE.ShapeUtils.isClockWise(points);
    },

    /**
     * Finds the objects under a mouse or pointer event, nearest first.
     *
     * @param {MouseEvent} event
     * @param {THREE.Object3D[]} [objects] Defaults to every object of the scene.
     * @param {boolean} [recursive] Also test the descendants of `objects`.
     * @returns {Object[]} three.js intersections (`object`, `point`, `faceIndex`...).
     */
    raycast(event, objects = this.root.children, recursive = true) {
        if (!this.renderer) return [];
        const rect = this._map.getContainer().getBoundingClientRect();
        this.raycaster.setFromCamera(new this.THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        ), this.camera);
        return this.raycaster.intersectObjects(objects, recursive);
    },

    _updateArea() {
        if (!this._map || !this.header) return;
        const z = this.header.minZoom;
        const center = this._map.project(this._map.getCenter(), z).divideBy(256).floor();
        const wanted = new Map();
        // Nine storage blocks and two active loads bound work independently of map zoom.
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const x = center.x + dx, y = center.y + dy;
                if (x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) continue;
                const nw = this._map.unproject([x * 256, y * 256], z);
                const se = this._map.unproject([(x + 1) * 256, (y + 1) * 256], z);
                if (se.lat > this.header.maxLat || nw.lat < this.header.minLat ||
                    se.lng < this.header.minLon || nw.lng > this.header.maxLon) continue;
                wanted.set(`${x}/${y}`, { z, x, y });
            }
        }
        for (const [key, area] of this._areas) {
            if (!wanted.has(key)) {
                this._releaseArea(area);
                this._areas.delete(key);
            }
        }
        for (const [key, coords] of wanted) {
            if (!this._areas.has(key)) this._areas.set(key, { coords, request: new AbortController() });
        }
        this._pump();
    },

    _pump() {
        if (!this._map) return;
        for (const area of this._areas.values()) {
            if (this._inflight >= 2) break;
            if (area.started) continue;
            area.started = true;
            this._inflight++;
            this._loadArea(area).finally(() => {
                this._inflight--;
                this._pump();
            });
        }
        this._updateStatus();
    },

    async _loadArea(area) {
        try {
            const { z, x, y } = area.coords;
            const result = await this.archive.getZxy(z, x, y, area.request.signal);
            if (area.request.signal.aborted) return;
            const data = result ? JSON.parse(new TextDecoder().decode(result.data))
                : { type: 'FeatureCollection', features: [] };
            if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
                throw new Error('Invalid GeoJSON response');
            }
            const content = await this._createMesh(data.features, area);
            if (!content) return;
            Object.assign(area, content, { done: true });
            if (area.mesh) this.add(area.mesh);
        } catch (error) {
            if (area.request.signal.aborted) return;
            area.error = error.message;
            this.fire('error', { error });
        }
    },

    _releaseArea(area) {
        area.request.abort();
        if (area.mesh) {
            if (this.highlightedFeature?.mesh === area.mesh) {
                this._setHighlight(null);
                this.hoveredFeature = null;
                this._showFeature(null);
            }
            this.remove(area.mesh);
            area.mesh.geometry.dispose();
        }
    },

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

    _findFeature(event) {
        if (!this.root || !this.camera) return null;
        for (const hit of this.raycast(event, this.root.children, Boolean(this.model))) {
            if (this.model) {
                let object = hit.object;
                while (object && object !== this.model) object = object.parent;
                if (object === this.model) {
                    return { id: this.model.uuid, properties: this.model.userData,
                        model: this.model, mesh: hit.object };
                }
            }
            const ranges = hit.object.userData.featureFaces;
            if (!ranges) continue;
            let low = 0, high = ranges.length - 1;
            while (low <= high) {
                const middle = (low + high) >> 1;
                const range = ranges[middle];
                if (hit.faceIndex < range.faceStart) high = middle - 1;
                else if (hit.faceIndex >= range.faceEnd) low = middle + 1;
                else return { ...range, mesh: hit.object };
            }
        }
        return null;
    },

    _setHighlight(feature) {
        if (feature?.model) feature = null;
        if (this.highlightedFeature?.mesh === feature?.mesh &&
            this.highlightedFeature?.vertexStart === feature?.vertexStart) return;
        if (this.highlightedFeature) {
            const { mesh, vertexStart, vertexEnd, baseColor } = this.highlightedFeature;
            this.setVertexColor(mesh, vertexStart, vertexEnd, baseColor);
        }
        this.highlightedFeature = feature;
        if (feature) {
            this.setVertexColor(feature.mesh, feature.vertexStart, feature.vertexEnd,
                this.color(this.options.highlightColor ?? 0x48d9ff));
        }
    },

    _showFeature(feature, event) {
        const tooltip = this._featureTooltip;
        if (!tooltip) return;
        if (feature) {
            tooltip.replaceChildren(this.options.tooltipContent(feature));
            tooltip.hidden = false;
            const rect = this.container.getBoundingClientRect();
            const x = event.clientX - rect.left, y = event.clientY - rect.top;
            tooltip.style.left = `${x + tooltip.offsetWidth + 16 > rect.width ? x - tooltip.offsetWidth - 12 : x + 12}px`;
            tooltip.style.top = `${y + tooltip.offsetHeight + 16 > rect.height ? y - tooltip.offsetHeight - 12 : y + 12}px`;
        } else {
            tooltip.hidden = true;
        }
        const shared = this._shared;
        if (shared) {
            const visible = [...shared.layers].some(layer => layer._featureTooltip && !layer._featureTooltip.hidden);
            if (visible) {
                if (shared._cursor === undefined) shared._cursor = this.container.style.cursor;
                this.container.style.cursor = 'pointer';
            } else if (shared._cursor !== undefined) {
                this.container.style.cursor = shared._cursor;
                delete shared._cursor;
            }
        }
    },

    _onPointerMove(event) {
        this.hoveredFeature = this._findFeature(event);
        this._setHighlight(this.hoveredFeature);
        this._showFeature(this.hoveredFeature, event);
        this.fire('featurehover', { feature: this.hoveredFeature, originalEvent: event });
    },

    _onClick(event) {
        const feature = this._findFeature(event);
        this.hoveredFeature = feature;
        this._setHighlight(feature);
        this._showFeature(feature, event);
        this.fire('featureclick', { feature, originalEvent: event });
    },

    _onPointerLeave() {
        this.hoveredFeature = null;
        this._setHighlight(null);
        this._showFeature(null);
        this.fire('featurehover', { feature: null });
    },

    async _createMesh(features, area) {
        const positions = [], normals = [], colors = [], featureFaces = [];
        let skipped = 0;
        const map = this._map;
        const crs = map.options.crs;
        const coords = area.coords;
        const origin = crs.project(this.location);
        const metres = Math.cos(this.location.lat * Math.PI / 180);
        const addTriangle = (a, ah, b, bh, c, ch, nx, ny, nz, color) => {
            const ux = b.x - a.x, uy = bh - ah, uz = a.y - b.y;
            const vx = c.x - a.x, vy = ch - ah, vz = a.y - c.y;
            if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0) {
                const point = b, height = bh;
                b = c; bh = ch; c = point; ch = height;
            }
            positions.push(a.x, ah, -a.y, b.x, bh, -b.y, c.x, ch, -c.y);
            normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
        };
        let deadline = performance.now() + 8;
        for (const feature of features) {
            if (area.request.signal.aborted) return null;
            if (performance.now() >= deadline) {
                await new Promise(requestAnimationFrame);
                if (area.request.signal.aborted) return null;
                deadline = performance.now() + 8;
            }
            const geometry = feature.geometry;
            const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
                : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
            if (!polygons) throw new Error('Unsupported GeoJSON geometry');
            const [lon, lat] = polygons[0]?.[0]?.[0] ?? [];
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
            for (const rings of polygons) {
                if (!rings.length) throw new Error('Empty GeoJSON polygon');
                const paths = rings.map(ring => {
                    if (ring.length < 4) throw new Error('Invalid GeoJSON polygon ring');
                    return ring.slice(0, -1).map(([lng, lat]) => {
                        if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('Invalid GeoJSON coordinates');
                        const point = crs.project(new L.LatLng(lat, lng));
                        return { x: (point.x - origin.x) * metres, y: (point.y - origin.y) * metres };
                    });
                });
                const points = paths.flat();
                for (const [a, b, c] of this.triangulate(paths[0], paths.slice(1))) {
                    addTriangle(points[a], top, points[b], top, points[c], top, 0, 1, 0, baseColor);
                    if (bottom > 0) addTriangle(points[a], bottom, points[b], bottom, points[c], bottom, 0, -1, 0, baseColor);
                }
                paths.forEach((path, index) => {
                    const sign = this.isClockWise(path) === (index === 0) ? -1 : 1;
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
        if (!positions.length) return { mesh: null, buildings: 0, skipped };
        const mesh = this.createMesh({ position: positions, normal: normals, color: colors });
        mesh.userData.featureFaces = featureFaces;
        return { mesh, buildings: featureFaces.length, skipped };
    },

    /**
     * Schedules a redraw (one per burst of map events, still before the next paint).
     */
    update() {
        this._shared?.update();
        return this;
    },

    _createRenderer(map) {
        const THREE = this.THREE;
        const shared = {
            _map: map,
            location: this.location,
            options: this.options,
            THREE,
            layers: new Set(),
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            update: this._updateRenderer,
            dispose: this._disposeRenderer,
            _render: this._render,
            _animateZoom: this._animateZoom,
            _getTileLevel: this._getTileLevel,
            _startZoom: this._startZoom,
            _endZoom: this._endZoom,
        };
        const sunlight = new THREE.DirectionalLight(0xffefd5, 3);
        sunlight.position.set(-300, 500, 300);
        shared.scene.add(new THREE.HemisphereLight(0xffffff, 0x746952, 2), sunlight);
        this._setupRenderer.call(shared, map);
        return shared;
    },

    _disposeRenderer() {
        const map = this._map;
        map.off('move zoom rotate pitch resize viewreset layeradd layerremove', this.update, this);
        map.off('zoomstart', this._startZoom, this);
        map.off('zoomanim', this._animateZoom, this);
        map.off('zoomend', this._endZoom, this);
        cancelAnimationFrame(this._frame);
        this._frame = null;
        this._zoomLevel = null;
        this.renderer.domElement.remove();
        this.renderer.dispose();
        this.renderer = null;
    },

    _updateRenderer() {
        if (!this.renderer || this._queued) return this;
        this._queued = true;
        queueMicrotask(() => {
            this._queued = false;
            if (!this.renderer) return;
            if (this._map._animatingZoom) {
                this._animateZoom();
                return;
            }
            cancelAnimationFrame(this._frame);
            this._render();
        });
        return this;
    },

    _setupRenderer(map) {
        if (this.renderer) return;
        this.renderer = new this.THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.options.maxPixelRatio));
        this.renderer.setClearColor(0x000000, 0);
        this._size = null;
        const canvas = this.renderer.domElement;
        canvas.className = 'leaflet-3d';
        canvas.style.cssText = `position:absolute;top:0;left:0;z-index:${this.options.zIndex};pointer-events:none`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', this.options.ariaLabel);
        map.getContainer().append(canvas);
        map.on('move zoom rotate pitch resize viewreset layeradd layerremove', this.update, this);
        map.on('zoomstart', this._startZoom, this);
        map.on('zoomanim', this._animateZoom, this);
        map.on('zoomend', this._endZoom, this);
        this._render();
    },

    _animateZoom() {
        if (!this._frame) {
            this._frame = requestAnimationFrame(() => this._render());
        }
    },

    _getTileLevel() {
        let level;
        this._map.eachLayer(layer => {
            if (!level && layer instanceof L.TileLayer && layer._levels) {
                level = layer._levels[layer._tileZoom];
            }
        });
        return level;
    },

    _startZoom() {
        this._zoomLevel = this._getTileLevel();
    },

    _endZoom() {
        this._zoomLevel = null;
        this.update();
    },

    _render() {
        this._frame = null;
        const map = this._map;
        const size = map.getSize();
        if (!size.x || !size.y) return;
        if (!this._size || !this._size.equals(size)) {
            this.renderer.setSize(size.x, size.y);
            this._size = size;
        }

        // Match the map's CSS camera: a perspective distance of 1.5 viewport heights.
        let pixelsPerMeter = map.options.crs.scale(map.getZoom()) /
            (40075016.68557849 * Math.cos(this.location.lat * Math.PI / 180));
        let origin = map.project(this.location).subtract(map.getPixelOrigin());
        const level = this._zoomLevel?.el.isConnected ? this._zoomLevel : this._getTileLevel();
        if (level) {
            if (map._animatingZoom) this._zoomLevel = level;
            // Leaflet's logical zoom jumps before its tile CSS transition finishes.
            // Use the rendered tile transform, including its rounding, on every animation frame.
            const transform = new DOMMatrix(map._animatingZoom
                ? getComputedStyle(level.el).transform : level.el.style.transform);
            const point = map.project(this.location, level.zoom).subtract(level.origin);
            origin = new L.Point(point.x * transform.a + transform.e, point.y * transform.d + transform.f);
            pixelsPerMeter *= map.getZoomScale(level.zoom, map.getZoom()) * transform.a;
        }
        const distance = size.y * 1.5 / pixelsPerMeter;
        const center = map.containerPointToLayerPoint(size.divideBy(2));
        const target = new this.THREE.Vector3(
            (center.x - origin.x) / pixelsPerMeter, 0,
            (center.y - origin.y) / pixelsPerMeter
        );
        const pitch = map.getPitch() * Math.PI / 180;
        const bearing = map.getBearing() * Math.PI / 180;
        const camera = this.camera;
        camera.fov = 2 * Math.atan(1 / 3) * 180 / Math.PI;
        camera.aspect = size.x / size.y;
        camera.near = Math.max(0.1, distance / 10000);
        camera.far = Math.max(10000, distance * 10);
        camera.position.set(
            target.x + Math.sin(bearing) * Math.sin(pitch) * distance,
            Math.cos(pitch) * distance,
            target.z + Math.cos(bearing) * Math.sin(pitch) * distance
        );
        camera.up.set(
            -Math.sin(bearing) * Math.cos(pitch),
            Math.sin(pitch),
            -Math.cos(bearing) * Math.cos(pitch)
        );
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        this.renderer.render(this.scene, camera);
        if (map._animatingZoom) {
            this._frame = requestAnimationFrame(() => this._render());
        }
    },

});
