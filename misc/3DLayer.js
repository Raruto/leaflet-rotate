/**
 * A native WebGL scene drawn above the map tiles and kept in sync with the map camera
 * (center, zoom, bearing, pitch and zoom animations).
 *
 * No rendering dependencies. Wait for `layer.ready` before using the helpers.
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
        _renderers: new WeakMap(),
    },

    options: {
        // Accessible description of the canvas.
        ariaLabel: '3D scene',
        // CSS z-index of the canvas (above tiles and vectors, below markers).
        zIndex: 450,
        // Upper bound of the canvas resolution, in device pixels per CSS pixel.
        maxPixelRatio: 2,
        zoomOnClick: false,
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
        this._added = new Promise(resolve => { this._resolveAdded = resolve; });
        /** @type {Promise<L.Layer3D>} Model readiness requires adding the layer to a map. */
        this.ready = Promise.resolve().then(async () => {
            this.Native = L.Layer3D.Native;
            this.root = new this.Native.Transform();
            this.raycaster = new this.Native.Raycast();
            if (this.options.tooltipContent !== undefined && typeof this.options.tooltipContent !== 'function') {
                throw new Error('tooltipContent must be a function');
            }
            if (this.options.modelAlphaMode !== undefined && !['OPAQUE', 'MASK', 'BLEND', 'COVERAGE'].includes(this.options.modelAlphaMode)) {
                throw new Error('modelAlphaMode must be OPAQUE, MASK, BLEND or COVERAGE');
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
            if (this._map) this._attach(this._map);
            if (this.options.model) {
                await this._added;
                this.model = await this._loadModel(new URL(this.options.model, document.baseURI).href);
                if (this.options.rotation) this.model.rotation.set(...this.options.rotation);
                if (this.options.scale) this.model.scale.set(...this.options.scale);
                this.model.setParent(this.root);
            }
            if (this._shared) this.update();
            this.fire('ready');
            return this;
        }).catch(error => {
            this.fire('error', { error });
            throw error;
        });


    },

    onAdd(map) {
        this._resolveAdded();
        if (!this.location) {
            const center = map.getCenter();
            this.location = new L.LatLng(center.lat, center.lng);
        }
        if (this.options.source || this.options.tooltipContent || this.options.zoomOnClick) {
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
        if (this.Native) this._attach(map);
    },

    getEvents() {
        return this.options.source ? { moveend: this._updateArea } : {};
    },

    onRemove(map) {
        this._added = new Promise(resolve => { this._resolveAdded = resolve; });
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
        this.root.setParent(null);
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
        this.root.scale.set(metres / Math.cos(this.location.lat * Math.PI / 180));
        this._shared = shared;
        this.renderer = shared.renderer;
        this.scene = shared.scene;
        this.camera = shared.camera;
        shared.layers.add(this);
        this.root.setParent(shared.scene);
        this.root.traverse(object => {
            if (object.geometry && object.geometry.gl !== shared.renderer.gl) {
                const geometry = object.geometry;
                const material = object.program._layerMaterial;
                object.geometry = new this.Native.Geometry(shared.renderer.gl, this._attributes(geometry));
                geometry.remove();
                object.program.remove();
                object.program = this._createProgram(material);
                object.gl = shared.renderer.gl;
            }
        });
        shared.update();
        if (this.header) this._updateArea();
    },

    /**
     * Adds an Native Transform or Mesh to the scene and redraws it.
     */
    add(object) {
        object.setParent(this.root);
        return this.update();
    },

    /**
     * Removes an Native object from the scene and redraws it.
     */
    remove(object) {
        if (object === undefined) return L.Layer.prototype.remove.call(this);
        object.setParent(null);
        return this.update();
    },

    /**
     * Loads a static glTF / GLB model without external loaders.
     *
     * @returns {Promise<Object>} An Native Transform containing static model meshes.
     */
    async loadModel(url) {
        await this.ready;
        return this._loadModel(url);
    },

    async _loadModel(url) {
        if (!this.renderer) throw new Error('Add the layer to a map before loading a model');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Unable to load model: HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const description = new DataView(data).getUint32(0, true) === 0x46546c67
            ? this.Native.unpackGLB(data) : JSON.parse(new TextDecoder().decode(data));
        if (description.skins?.length || description.animations?.length ||
            description.extensionsRequired?.length || description.meshes?.some(mesh =>
                mesh.primitives.some(primitive => primitive.targets || (primitive.mode !== undefined && primitive.mode !== 4)))) {
            throw new Error('Layer3D supports static triangle glTF models without required extensions');
        }
        const directory = new URL('.', url).href;
        await Promise.all((description.buffers || []).map(async buffer => {
            if (buffer.binary) return;
            const response = await fetch(new URL(buffer.uri, directory).href);
            if (!response.ok) throw new Error(`Unable to load model buffer: HTTP ${response.status}`);
            buffer.binary = await response.arrayBuffer();
        }));
        await this._added;
        const images = await Promise.all((description.images || []).map(async image => {
            let blob;
            if (image.bufferView !== undefined) {
                const view = description.bufferViews[image.bufferView];
                const buffer = description.buffers[view.buffer].binary;
                blob = new Blob([buffer.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)],
                    { type: image.mimeType });
            } else {
                const response = await fetch(new URL(image.uri, directory).href);
                if (!response.ok) throw new Error(`Unable to load model texture: HTTP ${response.status}`);
                blob = await response.blob();
            }
            return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        }));
        const textures = new Map();
        const textureFor = (reference, color = false) => {
            if (!reference) return null;
            if ((reference.texCoord || 0) !== 0 || reference.extensions) {
                throw new Error('Model textures currently require untransformed TEXCOORD_0 UVs');
            }
            const gl = this.renderer.gl;
            const internalFormat = color && gl.SRGB8_ALPHA8 || gl.RGBA;
            const key = `${reference.index}:${internalFormat}`;
            if (!textures.has(key)) {
                const texture = description.textures[reference.index];
                const sampler = description.samplers?.[texture.sampler] || {};
                textures.set(key, new this.Native.Texture(gl, {
                    image: images[texture.source], flipY: false, internalFormat,
                    wrapS: sampler.wrapS || gl.REPEAT, wrapT: sampler.wrapT || gl.REPEAT,
                    minFilter: sampler.minFilter || gl.LINEAR_MIPMAP_LINEAR,
                    magFilter: sampler.magFilter || gl.LINEAR,
                }));
            }
            return textures.get(key);
        };
        description.materials = (description.materials || []).map(material => {
            const pbr = material.pbrMetallicRoughness || {};
            return { extras: { layerMaterial: {
                color: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3),
                opacity: pbr.baseColorFactor?.[3] ?? 1,
                metallic: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1,
                baseTexture: textureFor(pbr.baseColorTexture, true),
                metalTexture: textureFor(pbr.metallicRoughnessTexture),
                emissiveTexture: textureFor(material.emissiveTexture, true),
                occlusionTexture: textureFor(material.occlusionTexture),
                emissive: material.emissiveFactor || [0, 0, 0],
                occlusionStrength: material.occlusionTexture?.strength ?? 1,
                alphaMode: this.options.modelAlphaMode || material.alphaMode || 'OPAQUE',
                alphaCutoff: material.alphaCutoff ?? 0.5,
                doubleSided: material.doubleSided,
            } } };
        });
        description.images = [];
        description.textures = [];
        const loaded = this.Native.parse(this, description);
        const model = this.createGroup();
        model.id = url;
        model.extras = description.extras || {};
        const scene = loaded.scene || loaded.scenes?.[0];
        if (!scene?.length) throw new Error('Expected a glTF model with a non-empty scene');
        for (const node of scene) node.setParent(model);
        const draw = this.Native.Mesh.prototype.draw;
        model.traverse(object => {
            if (!object.geometry) return;
            const style = object.program._layerMaterial;
            if ([style.baseTexture, style.metalTexture, style.emissiveTexture, style.occlusionTexture].some(Boolean) &&
                !object.geometry.attributes.uv) throw new Error('Textured model mesh requires UV coordinates');
            object.onBeforeRender(({ mesh }) => {
                if (mesh.program._alphaCoverage) mesh.gl.enable(mesh.gl.SAMPLE_ALPHA_TO_COVERAGE);
            });
            object.onAfterRender(({ mesh }) => {
                if (mesh.program._alphaCoverage) mesh.gl.disable(mesh.gl.SAMPLE_ALPHA_TO_COVERAGE);
            });
            object.draw = function (options) {
                const program = this.program;
                if (program.transparent && program._layerMaterial.doubleSided) {
                    program.cullFace = this.gl.FRONT;
                    draw.call(this, options);
                    program.cullFace = this.gl.BACK;
                    draw.call(this, options);
                    program.cullFace = null;
                } else draw.call(this, options);
            };
        });
        return model;
    },

    /**
     * @returns {Object} An empty Native Transform.
     */
    createGroup() {
        return new this.Native.Transform();
    },

    /**
     * Creates a non-indexed mesh from flat `position`, `normal` and `color` arrays (3 items per vertex).
     * The default program uses vertex colors and simple directional lighting.
     *
     * @returns {Object} An Native Mesh.
     */
    createMesh(attributes, material) {
        if (!this.renderer) throw new Error('Add the layer to a map before creating a mesh');
        const data = {};
        for (const name in attributes) {
            data[name] = { size: 3, data: new Float32Array(attributes[name]) };
        }
        const geometry = new this.Native.Geometry(this.renderer.gl, data);
        const mesh = new this.Native.Mesh(this.renderer.gl, { geometry,
            program: material || this._createProgram({ vertexColors: true }) });
        mesh.extras = {};
        return mesh;
    },

    _attributes(geometry) {
        const result = {};
        for (const name of ['position', 'normal', 'color', 'uv', 'index']) {
            const attribute = geometry.attributes[name];
            if (!attribute) continue;
            const { data, size, count, normalized } = attribute;
            const packed = data.slice(0, count * size);
            result[name] = { data: packed, size, normalized };
        }
        return result;
    },

    _createProgram(material = {}) {
        for (const name of ['baseTexture', 'metalTexture', 'emissiveTexture', 'occlusionTexture']) {
            const texture = material[name];
            if (texture && texture.gl !== this.renderer.gl) {
                material[name] = new this.Native.Texture(this.renderer.gl, {
                    image: texture.image, flipY: false, wrapS: texture.wrapS, wrapT: texture.wrapT,
                    minFilter: texture.minFilter, magFilter: texture.magFilter,
                    internalFormat: texture.internalFormat,
                });
            }
        }
        const textured = Boolean(material.baseTexture || material.metalTexture ||
            material.emissiveTexture || material.occlusionTexture);
        const coverage = material.alphaMode === 'COVERAGE' && this.renderer.gl.getContextAttributes().antialias;
        const vertex = `
            attribute vec3 position;
            attribute vec3 normal;
            ${material.vertexColors ? 'attribute vec3 color;' : ''}
            ${textured ? 'attribute vec2 uv; varying vec2 vUv;' : ''}
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            uniform mat3 normalMatrix;
            uniform vec3 baseColor;
            varying vec3 vColor;
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vColor = ${material.vertexColors ? 'color' : 'baseColor'};
                vNormal = normalMatrix * normal;
                vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
                ${textured ? 'vUv = uv;' : ''}
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`;
        const fragment = `
            precision highp float;
            uniform vec3 lightDirection;
            uniform vec3 skyDirection;
            uniform float metallic;
            uniform float roughness;
            uniform float opacity;
            uniform float alphaCutoff;
            uniform float occlusionStrength;
            uniform vec3 emissive;
            ${textured ? 'varying vec2 vUv;' : ''}
            ${material.baseTexture ? 'uniform sampler2D baseTexture;' : ''}
            ${material.metalTexture ? 'uniform sampler2D metalTexture;' : ''}
            ${material.emissiveTexture ? 'uniform sampler2D emissiveTexture;' : ''}
            ${material.occlusionTexture ? 'uniform sampler2D occlusionTexture;' : ''}
            varying vec3 vColor;
            varying vec3 vNormal;
            varying vec3 vPosition;
            const float PI = 3.14159265;
            vec3 toLinear(vec3 c) {
                return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
            }
            vec3 toSRGB(vec3 c) {
                return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
            }
            void main() {
                vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
                vec4 texel = ${material.baseTexture ? 'texture2D(baseTexture, vUv)' : 'vec4(1.0)'};
                float alpha = opacity * texel.a;
                ${material.alphaMode === 'MASK' ? 'if (alpha < alphaCutoff) discard;' : ''}
                ${material.alphaMode === 'COVERAGE' ? coverage
                    ? 'if (alpha < 0.01) discard;'
                    : 'if (alpha < alphaCutoff) discard;' : ''}
                ${material.alphaMode === 'BLEND' ? 'if (alpha < 0.01) discard;' : ''}
                vec3 base = ${material.vertexColors ? 'toLinear(vColor)' : 'vColor'} *
                    ${material.baseTexture?.internalFormat === this.renderer.gl.SRGB8_ALPHA8 ? 'texel.rgb' : 'toLinear(texel.rgb)'};
                vec4 mr = ${material.metalTexture ? 'texture2D(metalTexture, vUv)' : 'vec4(1.0)'};
                float metal = clamp(metallic * mr.b, 0.0, 1.0);
                float rough = clamp(roughness * mr.g, 0.08, 1.0);
                vec3 view = normalize(-vPosition);
                vec3 halfVector = normalize(view + lightDirection);
                float nl = max(dot(normal, lightDirection), 0.0);
                float nv = max(dot(normal, view), 0.001);
                float nh = max(dot(normal, halfVector), 0.0);
                float vh = max(dot(view, halfVector), 0.0);
                float a2 = pow(rough, 4.0);
                float d = a2 / max(PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0), 0.0001);
                float gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
                float gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
                float visibility = 0.5 / max(gv + gl, 0.0001);
                vec3 f0 = mix(vec3(0.04), base, metal);
                vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
                vec3 specular = d * visibility * fresnel;
                vec3 diffuse = (1.0 - metal) * base / PI;
                float sky = dot(normal, skyDirection) * 0.5 + 0.5;
                vec3 ambient = mix(toLinear(vec3(0.455, 0.412, 0.322)), vec3(1.0), sky) * (2.0 / PI);
                float ao = ${material.occlusionTexture ? 'mix(1.0, texture2D(occlusionTexture, vUv).r, occlusionStrength)' : '1.0'};
                vec3 glow = emissive * ${material.emissiveTexture
                    ? material.emissiveTexture.internalFormat === this.renderer.gl.SRGB8_ALPHA8
                        ? 'texture2D(emissiveTexture, vUv).rgb' : 'toLinear(texture2D(emissiveTexture, vUv).rgb)' : 'vec3(1.0)'};
                vec3 color = ambient * base * (1.0 - metal) * ao +
                    (diffuse + specular) * nl * toLinear(vec3(1.0, 0.937, 0.835)) * 3.0 + glow;
                ${material.vertexColors
                    ? 'color = base * (ambient + toLinear(vec3(1.0, 0.937, 0.835)) * (3.0 / PI) * nl);'
                    : ''}
                gl_FragColor = vec4(toSRGB(color), ${material.alphaMode === 'BLEND' || coverage ? 'alpha' : '1.0'});
            }`;
        const program = new this.Native.Program(this.renderer.gl, { vertex, fragment,
            cullFace: material.doubleSided ? null : this.renderer.gl.BACK,
            transparent: material.alphaMode === 'BLEND',
            depthWrite: material.alphaMode !== 'BLEND',
            uniforms: { baseColor: { value: material.color || [1, 1, 1] },
                lightDirection: { value: new this.Native.Vec3() }, skyDirection: { value: new this.Native.Vec3() },
                metallic: { value: material.metallic ?? 0 }, roughness: { value: material.roughness ?? 0.85 },
                opacity: { value: material.opacity ?? 1 }, alphaCutoff: { value: material.alphaCutoff ?? 0.5 },
                occlusionStrength: { value: material.occlusionStrength ?? 1 },
                emissive: { value: material.emissive || [0, 0, 0] },
                ...Object.fromEntries(['baseTexture', 'metalTexture', 'emissiveTexture', 'occlusionTexture']
                    .filter(name => material[name]).map(name => [name, { value: material[name] }])),
            } });
        if (!this.renderer.gl.getProgramParameter(program.program, this.renderer.gl.LINK_STATUS)) {
            const error = this.renderer.gl.getProgramInfoLog(program.program);
            program.remove();
            throw new Error(`Unable to compile Layer3D material: ${error}`);
        }
        if (material.alphaMode === 'BLEND') {
            program.setBlendFunc(this.renderer.gl.SRC_ALPHA, this.renderer.gl.ONE_MINUS_SRC_ALPHA,
                this.renderer.gl.ONE, this.renderer.gl.ONE_MINUS_SRC_ALPHA);
        }
        program._layerMaterial = material;
        program._alphaCoverage = coverage;
        return program;
    },

    /**
     * @param {number|string|Object} value Native color, or `{h, s, l}` in `0`–`1`.
     * @returns {Object} RGB components in `0`–`1`.
     */
    color(value) {
        if (value && typeof value === 'object' && 'h' in value) {
            const { h, s, l } = value;
            const a = s * Math.min(l, 1 - l);
            const channel = n => {
                const k = (n + h * 12) % 12;
                return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            };
            const toSRGB = value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
            return { r: toSRGB(channel(0)), g: toSRGB(channel(8)), b: toSRGB(channel(4)) };
        }
        if (value && typeof value === 'object' && 'r' in value) return value;
        if (typeof value === 'number') return {
            r: (value >> 16 & 255) / 255, g: (value >> 8 & 255) / 255, b: (value & 255) / 255,
        };
        if (typeof value !== 'string' || !CSS.supports('color', value)) throw new Error('Invalid 3D color');
        const context = document.createElement('canvas').getContext('2d');
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return { r: r / 255, g: g / 255, b: b / 255 };
    },

    /**
     * Paints the vertices `[start, end)` of a mesh with vertex colors, then redraws.
     */
    setVertexColor(mesh, start, end, color) {
        const attribute = mesh.geometry.attributes.color;
        for (let i = start; i < end; i++) attribute.data.set([color.r, color.g, color.b], i * 3);
        attribute.needsUpdate = true;
        return this.update();
    },

    /**
     * Triangulates a polygon given as `{x, y}` points.
     *
     * @returns {number[][]} Triangles as indices in `[...contour, ...holes.flat()]`.
     */
    triangulate(contour, holes = []) {
        const points = [contour, ...holes].flat();
        if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid polygon coordinates');
        // Translate near the origin to avoid cancellation with geographic coordinates.
        const vertices = points.map((p, index) => ({ x: p.x - contour[0].x, y: p.y - contour[0].y, index }));
        const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const equal = (a, b) => a.x === b.x && a.y === b.y;
        const clean = ring => {
            let changed = true;
            while (changed && ring.length > 3) {
                changed = false;
                for (let i = 0; i < ring.length; i++) {
                    const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
                    if (equal(a, b) || Math.abs(cross(a, b, c)) < 1e-10) {
                        ring.splice(i, 1); changed = true; break;
                    }
                }
            }
            if (ring.length < 3) throw new Error('Degenerate polygon ring');
            return ring;
        };
        let offset = 0;
        const rings = [contour, ...holes].map((path, index) => {
            const ring = clean(vertices.slice(offset, offset += path.length));
            if (this.isClockWise(ring) !== Boolean(index)) ring.reverse();
            return ring;
        });
        const inside = (point, ring) => {
            let result = false;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const a = ring[i], b = ring[j];
                if ((a.y > point.y) !== (b.y > point.y) &&
                    point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
            }
            return result;
        };
        const intersects = (a, b, c, d) => {
            if (equal(a, c) || equal(a, d) || equal(b, c) || equal(b, d)) return false;
            const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
            const on = (p, q, r) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) &&
                Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
            return abC * abD < 0 && cdA * cdB < 0 ||
                abC === 0 && on(a, b, c) || abD === 0 && on(a, b, d) ||
                cdA === 0 && on(c, d, a) || cdB === 0 && on(c, d, b);
        };
        let polygon = rings[0].slice();
        // ponytail: quadratic ear clipping for building footprints; use spatial indexing for large rings.
        for (const hole of rings.slice(1).sort((a, b) => Math.min(...a.map(p => p.x)) - Math.min(...b.map(p => p.x)))) {
            let bridge, distance = Infinity;
            for (let h = 0; h < hole.length; h++) for (let p = 0; p < polygon.length; p++) {
                const a = hole[h], b = polygon[p], d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
                if (d >= distance) continue;
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                if (!inside(mid, rings[0]) || rings.slice(1).some(r => inside(mid, r))) continue;
                if ([polygon, ...rings.slice(1)].some(r => r.some((c, i) => intersects(a, b, c, r[(i + 1) % r.length])))) continue;
                bridge = [h, p]; distance = d;
            }
            if (!bridge) throw new Error('Unable to connect polygon hole');
            const [h, p] = bridge;
            polygon = [...polygon.slice(0, p + 1), ...hole.slice(h), ...hole.slice(0, h + 1),
                polygon[p], ...polygon.slice(p + 1)];
        }
        const result = [];
        while (polygon.length > 3) {
            let clipped = false;
            for (let i = 0; i < polygon.length; i++) {
                const a = polygon[(i + polygon.length - 1) % polygon.length], b = polygon[i], c = polygon[(i + 1) % polygon.length];
                if (cross(a, b, c) <= 1e-10) continue;
                if (polygon.some(p => !equal(p, a) && !equal(p, b) && !equal(p, c) &&
                    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0)) continue;
                result.push([a.index, b.index, c.index]); polygon.splice(i, 1); clipped = true; break;
            }
            if (!clipped) throw new Error('Unable to triangulate polygon: invalid or self-intersecting rings');
        }
        if (cross(...polygon) > 1e-10) result.push(polygon.map(p => p.index));
        const area = ring => Math.abs(ring.reduce((sum, p, i) => {
            const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - q.x * p.y;
        }, 0)) / 2;
        const expected = area(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + area(ring), 0);
        const actual = result.reduce((sum, triangle) => sum + cross(...triangle.map(i => vertices[i])) / 2, 0);
        if (expected <= 0 || Math.abs(actual - expected) > Math.max(1e-7, expected * 1e-8)) throw new Error('Polygon triangulation area mismatch');
        return result;
    },

    /**
     * @returns {boolean} Whether the `{x, y}` points are in clockwise order.
     */
    isClockWise(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            area += a.x * b.y - b.x * a.y;
        }
        return area < 0;
    },

    /**
     * Finds the objects under a mouse or pointer event, nearest first.
     *
     * @param {MouseEvent} event
     * @param {Object[]} [objects] Defaults to every object of the scene.
     * @param {boolean} [recursive] Also test the descendants of `objects`.
     * @returns {Object[]} Intersections (`object`, `point`, `faceIndex`, `distance`).
     */
    raycast(event, objects = this.root.children, recursive = true) {
        if (!this.renderer) return [];
        const rect = this._map.getContainer().getBoundingClientRect();
        this.scene.updateMatrixWorld(true);
        this.camera.updateMatrixWorld();
        this.raycaster.castMouse(this.camera, [
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ]);
        const meshes = [];
        for (const object of objects) {
            if (recursive) object.traverse(mesh => { if (mesh.geometry && mesh.visible) meshes.push(mesh); });
            else if (object.geometry && object.visible) meshes.push(object);
        }
        const hits = [];
        const { Vec3, Mat4 } = this.Native;
        const a = new Vec3(), b = new Vec3(), c = new Vec3();
        for (const mesh of this.raycaster.intersectBounds(meshes)) {
            const inverse = new Mat4().inverse(mesh.worldMatrix);
            const origin = new Vec3().copy(this.raycaster.origin).applyMatrix4(inverse);
            const direction = new Vec3().copy(this.raycaster.direction).transformDirection(inverse);
            const { position, index } = mesh.geometry.attributes;
            let closest = Infinity, faceIndex;
            for (let i = 0; i < (index?.count || position.count); i += 3) {
                a.fromArray(position.data, (index ? index.data[i] : i) * position.size);
                b.fromArray(position.data, (index ? index.data[i + 1] : i + 1) * position.size);
                c.fromArray(position.data, (index ? index.data[i + 2] : i + 2) * position.size);
                const distance = this.raycaster.intersectTriangle(a, b, c, mesh.program.cullFace !== null, origin, direction);
                if (distance && distance < closest) { closest = distance; faceIndex = i / 3; }
            }
            if (faceIndex === undefined) continue;
            const point = new Vec3().copy(direction).multiply(closest).add(origin).applyMatrix4(mesh.worldMatrix);
            hits.push({ object: mesh, point, faceIndex, distance: point.distance(this.raycaster.origin) });
        }
        return hits.sort((a, b) => a.distance - b.distance);
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
            area.mesh.geometry.remove();
            area.mesh.program.remove();
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
                    return { id: this.model.id, properties: this.model.extras,
                        model: this.model, mesh: hit.object, point: hit.point };
                }
            }
            const ranges = hit.object.extras?.featureFaces;
            if (!ranges) continue;
            let low = 0, high = ranges.length - 1;
            while (low <= high) {
                const middle = (low + high) >> 1;
                const range = ranges[middle];
                if (hit.faceIndex < range.faceStart) high = middle - 1;
                else if (hit.faceIndex >= range.faceEnd) low = middle + 1;
                else return { ...range, mesh: hit.object, point: hit.point };
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
        if (this.options.zoomOnClick && feature &&
            this.raycast(event, this.scene.children, true)[0]?.object === feature.mesh) {
            const map = this._map;
            const crs = map.options.crs;
            const origin = crs.project(this._shared.location);
            const metres = Math.cos(this._shared.location.lat * Math.PI / 180);
            const center = crs.unproject(new L.Point(
                origin.x + feature.point.x / metres, origin.y - feature.point.z / metres));
            map.setView(center, Math.min(map.getZoom() + 1, map.getMaxZoom()));
        }
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
        mesh.extras.featureFaces = featureFaces;
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
        const Native = this.Native;
        const shared = {
            _map: map,
            location: this.location,
            options: this.options,
            Native,
            layers: new Set(),
            scene: new Native.Transform(),
            camera: new Native.Camera(),
            update: this._updateRenderer,
            dispose: this._disposeRenderer,
            _render: this._render,
            _animateZoom: this._animateZoom,
            _getTileLevel: this._getTileLevel,
            _startZoom: this._startZoom,
            _endZoom: this._endZoom,
        };
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
        this.renderer.gl.canvas.remove();
        this.renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
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
        this.renderer = this.Native.createRenderer({
            dpr: Math.min(window.devicePixelRatio, this.options.maxPixelRatio) });
        if (!this.renderer.gl) throw new Error('Unable to create a WebGL context');
        // Sort model surfaces by their geometry, not their shared glTF node origin.
        this.renderer.sortTransparent = (a, b) =>
            a.renderOrder - b.renderOrder ||
            (b._sortDepth ?? b.zDepth) - (a._sortDepth ?? a.zDepth) || a.id - b.id;
        this.renderer.gl.clearColor(0, 0, 0, 0);
        this._size = null;
        const canvas = this.renderer.gl.canvas;
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
        const target = new this.Native.Vec3(
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
        camera.updateMatrixWorld();
        const light = new this.Native.Vec3(-300, 500, 300).normalize().transformDirection(camera.viewMatrix);
        const sky = new this.Native.Vec3(0, 1, 0).transformDirection(camera.viewMatrix);
        this.scene.updateMatrixWorld();
        const position = new this.Native.Vec3();
        this.scene.traverse(mesh => {
            if (mesh.program?.uniforms.lightDirection) mesh.program.uniforms.lightDirection.value.copy(light);
            if (mesh.program?.uniforms.skyDirection) mesh.program.uniforms.skyDirection.value.copy(sky);
            if (mesh.program?.transparent) {
                if (!mesh.geometry.bounds) mesh.geometry.computeBoundingSphere();
                position.copy(mesh.geometry.bounds.center).applyMatrix4(mesh.worldMatrix);
                camera.project(position);
                mesh._sortDepth = position.z;
            }
        });
        this.renderer.render({ scene: this.scene, camera, update: false });
        if (map._animatingZoom) {
            this._frame = requestAnimationFrame(() => this._render());
        }
    },

});


L.Layer3D.Native = {
    nextId: 0,

    Vec3: class extends Array {
        constructor(x = 0, y = x, z = x) { super(3); this.set(x, y, z); }
        get x() { return this[0]; } set x(v) { this[0] = v; }
        get y() { return this[1]; } set y(v) { this[1] = v; }
        get z() { return this[2]; } set z(v) { this[2] = v; }
        set(x, y = x, z = x) { this[0] = x; this[1] = y; this[2] = z; return this; }
        copy(v) { return this.set(...v); }
        fromArray(v, offset = 0) { return this.set(v[offset], v[offset + 1], v[offset + 2]); }
        toArray() { return [...this]; }
        add(v) { return this.set(this.x + v[0], this.y + v[1], this.z + v[2]); }
        multiply(v) { return this.set(this.x * v, this.y * v, this.z * v); }
        normalize() { return this.multiply(1 / (Math.hypot(...this) || 1)); }
        distance(v) { return Math.hypot(this.x - v[0], this.y - v[1], this.z - v[2]); }
        applyMatrix4(m) {
            const [x, y, z] = this;
            const w = m[3] * x + m[7] * y + m[11] * z + m[15];
            return this.set((m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
                (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
                (m[2] * x + m[6] * y + m[10] * z + m[14]) / w);
        }
        transformDirection(m) {
            const [x, y, z] = this;
            return this.set(m[0] * x + m[4] * y + m[8] * z,
                m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z).normalize();
        }
    },

    Mat4: class extends Array {
        constructor() { super(16); this.copy(new DOMMatrix().toFloat64Array()); }
        copy(v) { for (let i = 0; i < 16; i++) this[i] = v[i]; return this; }
        multiply(a, b) {
            if (!b) { b = a; a = this; }
            return this.copy(new DOMMatrix(a).multiply(new DOMMatrix(b)).toFloat64Array());
        }
        inverse(m = this) {
            const inverse = new DOMMatrix(m).inverse().toFloat64Array();
            if (![...inverse].every(Number.isFinite)) throw new Error('Singular 3D transform');
            return this.copy(inverse);
        }
    },

    Transform: class {
        constructor() {
            const { Vec3, Mat4 } = L.Layer3D.Native;
            this.position = new Vec3();
            this.rotation = new Vec3();
            this.scale = new Vec3(1);
            this.worldMatrix = new Mat4();
            this.children = [];
            this.visible = true;
        }
        setParent(parent) {
            if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
            this.parent = parent;
            if (parent) parent.children.push(this);
        }
        traverse(callback) {
            if (callback(this)) return;
            for (const child of this.children) child.traverse(callback);
        }
        updateMatrixWorld() {
            let local;
            if (this.matrix) local = this.matrix;
            else {
                const degrees = 180 / Math.PI;
                const matrix = new DOMMatrix().translate(...this.position);
                // Node rotations use YXZ, as did the previous renderer.
                matrix.rotateAxisAngleSelf(0, 1, 0, this.rotation.y * degrees);
                matrix.rotateAxisAngleSelf(1, 0, 0, this.rotation.x * degrees);
                matrix.rotateAxisAngleSelf(0, 0, 1, this.rotation.z * degrees);
                local = matrix.scale(...this.scale).toFloat64Array();
            }
            if (this.parent) this.worldMatrix.multiply(this.parent.worldMatrix, local);
            else this.worldMatrix.copy(local);
            for (const child of this.children) child.updateMatrixWorld();
        }
    },

    Camera: class {
        constructor() {
            const { Vec3, Mat4 } = L.Layer3D.Native;
            this.position = new Vec3();
            this.up = new Vec3(0, 1, 0);
            this.target = new Vec3();
            this.viewMatrix = new Mat4();
            this.projectionMatrix = new Mat4();
            this.projectionViewMatrix = new Mat4();
            this.fov = 45; this.aspect = 1; this.near = 0.1; this.far = 10000;
        }
        lookAt(target) { this.target.copy(target); }
        updateProjectionMatrix() {
            const f = 1 / Math.tan(this.fov * Math.PI / 360);
            const n = this.near, r = this.far;
            this.projectionMatrix.copy([f / this.aspect, 0, 0, 0, 0, f, 0, 0,
                0, 0, (r + n) / (n - r), -1, 0, 0, 2 * r * n / (n - r), 0]);
        }
        updateMatrixWorld() {
            const { Vec3 } = L.Layer3D.Native;
            const z = new Vec3(...this.position.map((v, i) => v - this.target[i])).normalize();
            const cross = (a, b) => new Vec3(a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
            const x = cross(this.up, z).normalize(), y = cross(z, x);
            this.viewMatrix.inverse([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0,
                z[0], z[1], z[2], 0, ...this.position, 1]);
            this.updateProjectionMatrix();
            this.projectionViewMatrix.multiply(this.projectionMatrix, this.viewMatrix);
        }
        project(point) { return point.applyMatrix4(this.projectionViewMatrix); }
    },

    Texture: class {
        constructor(gl, options) {
            Object.assign(this, { gl, texture: gl.createTexture(), internalFormat: gl.RGBA,
                wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
                minFilter: gl.LINEAR_MIPMAP_LINEAR, magFilter: gl.LINEAR }, options);
        }
        update(unit) {
            const gl = this.gl;
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            if (this.uploaded === this.image && !this.needsUpdate) return;
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Boolean(this.flipY));
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrapS);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrapT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.minFilter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.magFilter);
            gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
            if (![gl.NEAREST, gl.LINEAR].includes(this.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
            this.uploaded = this.image; this.needsUpdate = false;
        }
    },

    Program: class {
        constructor(gl, options) {
            Object.assign(this, { gl, id: L.Layer3D.Native.nextId++, depthWrite: true,
                depthTest: true, cullFace: gl.BACK, uniforms: {} }, options);
            this.program = gl.createProgram();
            this.shaders = [];
            for (const [type, source] of [[gl.VERTEX_SHADER, options.vertex], [gl.FRAGMENT_SHADER, options.fragment]]) {
                const shader = gl.createShader(type);
                gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    const error = gl.getShaderInfoLog(shader);
                    gl.deleteShader(shader); this.remove();
                    throw new Error(`Unable to compile Layer3D shader: ${error}`);
                }
                this.shaders.push(shader); gl.attachShader(this.program, shader);
            }
            gl.linkProgram(this.program);
            this.locations = new Map();
            for (let i = 0; i < gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS); i++) {
                const info = gl.getActiveUniform(this.program, i);
                this.locations.set(info.name, { location: gl.getUniformLocation(this.program, info.name), type: info.type });
            }
        }
        setBlendFunc(src, dst, srcAlpha = src, dstAlpha = dst) { this.blend = [src, dst, srcAlpha, dstAlpha]; }
        use() {
            const gl = this.gl;
            gl.useProgram(this.program);
            gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(this.depthWrite);
            if (this.cullFace === null) gl.disable(gl.CULL_FACE);
            else { gl.enable(gl.CULL_FACE); gl.cullFace(this.cullFace); }
            if (this.transparent) { gl.enable(gl.BLEND); gl.blendFuncSeparate(...this.blend); }
            else gl.disable(gl.BLEND);
            let unit = 0;
            for (const [name, { location, type }] of this.locations) {
                const uniform = this.uniforms[name];
                if (!uniform) throw new Error(`Missing Layer3D uniform: ${name}`);
                const value = uniform.value;
                if (type === gl.SAMPLER_2D) { value.update(unit); gl.uniform1i(location, unit++); }
                else if (type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(location, false, value);
                else if (type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(location, false, value);
                else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, value);
                else gl.uniform1f(location, value);
            }
        }
        remove() {
            for (const shader of this.shaders) this.gl.deleteShader(shader);
            this.gl.deleteProgram(this.program);
        }
    },

    Geometry: class {
        constructor(gl, attributes) {
            this.gl = gl; this.attributes = attributes;
            for (const [name, attribute] of Object.entries(attributes)) {
                attribute.size ||= 1;
                attribute.count = attribute.data.length / attribute.size;
                attribute.type = attribute.data instanceof Float32Array ? gl.FLOAT
                    : attribute.data instanceof Uint8Array ? gl.UNSIGNED_BYTE
                    : attribute.data instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
                attribute.target = name === 'index' ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
                attribute.buffer = gl.createBuffer();
                gl.bindBuffer(attribute.target, attribute.buffer);
                gl.bufferData(attribute.target, attribute.data, gl.STATIC_DRAW);
            }
            this.drawRange = { start: 0, count: attributes.index?.count || attributes.position.count };
        }
        computeBoundingSphere() {
            const { Vec3 } = L.Layer3D.Native;
            const min = new Vec3(Infinity), max = new Vec3(-Infinity), data = this.attributes.position.data;
            for (let i = 0; i < data.length; i++) {
                min[i % 3] = Math.min(min[i % 3], data[i]);
                max[i % 3] = Math.max(max[i % 3], data[i]);
            }
            const center = new Vec3(...min.map((v, i) => (v + max[i]) / 2));
            let radius = 0;
            for (let i = 0; i < data.length; i += 3) radius = Math.max(radius, new Vec3().fromArray(data, i).distance(center));
            this.bounds = { min, max, center, radius };
        }
        draw(program, mode) {
            const gl = this.gl;
            const used = [];
            for (const [name, attribute] of Object.entries(this.attributes)) {
                gl.bindBuffer(attribute.target, attribute.buffer);
                if (attribute.needsUpdate) {
                    gl.bufferSubData(attribute.target, 0, attribute.data); attribute.needsUpdate = false;
                    this.bounds = null;
                }
                if (name === 'index') continue;
                const location = gl.getAttribLocation(program.program, name);
                if (location < 0) continue;
                gl.enableVertexAttribArray(location); used.push(location);
                gl.vertexAttribPointer(location, attribute.size, attribute.type, Boolean(attribute.normalized), 0, 0);
            }
            const index = this.attributes.index;
            if (index) gl.drawElements(mode, this.drawRange.count, index.type, this.drawRange.start * index.data.BYTES_PER_ELEMENT);
            else gl.drawArrays(mode, this.drawRange.start, this.drawRange.count);
            for (const location of used) gl.disableVertexAttribArray(location);
        }
        remove() { for (const attribute of Object.values(this.attributes)) this.gl.deleteBuffer(attribute.buffer); }
    },

    Raycast: class {
        constructor() {
            this.origin = new L.Layer3D.Native.Vec3();
            this.direction = new L.Layer3D.Native.Vec3();
        }
        castMouse(camera, [x, y]) {
            const inverse = new L.Layer3D.Native.Mat4().inverse(camera.projectionViewMatrix);
            this.origin.copy(camera.position);
            const end = new L.Layer3D.Native.Vec3(x, y, 0).applyMatrix4(inverse);
            this.direction.set(...end.map((v, i) => v - this.origin[i])).normalize();
        }
        intersectBounds(meshes) {
            return meshes.filter(mesh => {
                if (!mesh.geometry.bounds) mesh.geometry.computeBoundingSphere();
                const inverse = new L.Layer3D.Native.Mat4().inverse(mesh.worldMatrix);
                const origin = new L.Layer3D.Native.Vec3().copy(this.origin).applyMatrix4(inverse);
                const direction = new L.Layer3D.Native.Vec3().copy(this.direction).transformDirection(inverse);
                const { min, max } = mesh.geometry.bounds;
                let near = 0, far = Infinity;
                for (let i = 0; i < 3; i++) {
                    if (Math.abs(direction[i]) < 1e-12) {
                        if (origin[i] < min[i] || origin[i] > max[i]) return false;
                    } else {
                        const a = (min[i] - origin[i]) / direction[i], b = (max[i] - origin[i]) / direction[i];
                        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
                    }
                }
                return far >= near;
            });
        }
        intersectTriangle(a, b, c, cull, origin, direction) {
            const sub = (a, b) => a.map((v, i) => v - b[i]);
            const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
            const e = sub(b, a), f = sub(c, a), p = cross(direction, f), det = dot(e, p);
            if (cull ? det < 1e-9 : Math.abs(det) < 1e-9) return null;
            const t = sub(origin, a), u = dot(t, p) / det;
            if (u < 0 || u > 1) return null;
            const q = cross(t, e), v = dot(direction, q) / det;
            if (v < 0 || u + v > 1) return null;
            const distance = dot(f, q) / det;
            return distance > 0 ? distance : null;
        }
    },

    unpackGLB(data) {
        const view = new DataView(data);
        if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) throw new Error('Invalid GLB header');
        let description, binary;
        for (let offset = 12; offset < data.byteLength;) {
            if (offset + 8 > data.byteLength) throw new Error('Truncated GLB chunk');
            const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
            offset += 8;
            if (offset + length > data.byteLength) throw new Error('Truncated GLB data');
            const chunk = data.slice(offset, offset + length);
            if (type === 0x4e4f534a) description = JSON.parse(new TextDecoder().decode(chunk));
            if (type === 0x004e4942) binary = chunk;
            offset += length;
        }
        if (!description) throw new Error('Missing GLB JSON');
        if (binary) description.buffers[0].binary = binary;
        return description;
    },

    parse(layer, description) {
        const { Geometry, Mesh, Mat4 } = this;
        const types = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
            5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
        const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
        const accessor = index => {
            const spec = description.accessors[index], Type = types[spec.componentType], size = sizes[spec.type];
            if (!Type || !size || !Number.isInteger(spec.count) || spec.count < 0) throw new Error('Invalid glTF accessor');
            const data = new Type(spec.count * size);
            const read = (viewIndex, offset, count, stride, output) => {
                const view = description.bufferViews[viewIndex], bytes = Type.BYTES_PER_ELEMENT;
                const buffer = description.buffers[view.buffer].binary;
                stride ||= size * bytes;
                if (!buffer || stride < size * bytes || offset < 0 ||
                    (view.byteOffset || 0) + view.byteLength > buffer.byteLength ||
                    (count - 1) * stride + size * bytes + offset > view.byteLength) throw new Error('glTF accessor outside buffer view');
                for (let i = 0; i < count; i++) {
                    const values = new Type(buffer.slice((view.byteOffset || 0) + offset + i * stride,
                        (view.byteOffset || 0) + offset + i * stride + size * bytes));
                    data.set(values, output(i) * size);
                }
            };
            if (spec.bufferView !== undefined) read(spec.bufferView, spec.byteOffset || 0, spec.count,
                description.bufferViews[spec.bufferView].byteStride, i => i);
            if (spec.sparse) {
                const sparse = spec.sparse, Index = types[sparse.indices.componentType];
                if (![Uint8Array, Uint16Array, Uint32Array].includes(Index)) throw new Error('Invalid sparse glTF indices');
                const view = description.bufferViews[sparse.indices.bufferView];
                const offset = (view.byteOffset || 0) + (sparse.indices.byteOffset || 0);
                if (sparse.count > spec.count || (sparse.indices.byteOffset || 0) + sparse.count * Index.BYTES_PER_ELEMENT > view.byteLength) throw new Error('Invalid sparse glTF indices');
                const indices = new Index(description.buffers[view.buffer].binary.slice(offset, offset + sparse.count * Index.BYTES_PER_ELEMENT));
                read(sparse.values.bufferView, sparse.values.byteOffset || 0, sparse.count, 0, i => {
                    if (indices[i] >= spec.count) throw new Error('Invalid sparse glTF index');
                    return indices[i];
                });
            }
            if (spec.componentType === 5126) return { data, size };
            const normalized = new Float32Array(data.length);
            for (let i = 0; i < data.length; i++) normalized[i] = spec.normalized
                ? Math.max(-1, data[i] / (Type === Int8Array ? 127 : Type === Int16Array ? 32767 : Type === Uint8Array ? 255 : Type === Uint32Array ? 4294967295 : 65535))
                : data[i];
            return { data: normalized, size, indices: data };
        };
        const active = new Set(), resources = [];
        const node = index => {
            if (active.has(index)) throw new Error('Cyclic glTF nodes');
            const spec = description.nodes[index];
            if (!spec) throw new Error('Invalid glTF node');
            active.add(index);
            const group = layer.createGroup();
            group.name = spec.name;
            if (spec.matrix) group.matrix = new Mat4().copy(spec.matrix);
            else {
                const [x, y, z, w] = spec.rotation || [0, 0, 0, 1], [sx, sy, sz] = spec.scale || [1, 1, 1];
                group.matrix = new Mat4().copy([
                    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
                    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
                    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
                    ...(spec.translation || [0, 0, 0]), 1,
                ]);
            }
            if (spec.mesh !== undefined) {
                for (const primitive of description.meshes[spec.mesh].primitives) {
                    const attributes = {};
                    for (const [semantic, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
                        if (primitive.attributes[semantic] !== undefined) attributes[name] = accessor(primitive.attributes[semantic]);
                    }
                    if (!attributes.position) throw new Error('glTF mesh has no positions');
                    const vertexCount = attributes.position.data.length / 3;
                    if (attributes.position.size !== 3 || vertexCount < 3 ||
                        Object.values(attributes).some(attribute => attribute.data.length / attribute.size !== vertexCount)) throw new Error('Invalid glTF vertex attributes');
                    if (primitive.indices !== undefined) {
                        const index = accessor(primitive.indices);
                        attributes.index = { size: 1, data: index.indices };
                        if (![Uint8Array, Uint16Array, Uint32Array].some(Type => index.indices instanceof Type) ||
                            index.size !== 1 || index.indices.length % 3 || [...index.indices].some(i => i >= vertexCount)) throw new Error('Invalid glTF triangle indices');
                    }
                    if (!attributes.index && vertexCount % 3) throw new Error('Incomplete glTF triangle');
                    if (!attributes.normal) {
                        const normals = new Float32Array(attributes.position.data.length), p = attributes.position.data, indices = attributes.index?.data;
                        for (let i = 0; i < (indices?.length || p.length / 3); i += 3) {
                            const a = indices ? indices[i] : i, b = indices ? indices[i + 1] : i + 1, c = indices ? indices[i + 2] : i + 2;
                            const u = [0, 1, 2].map(j => p[b * 3 + j] - p[a * 3 + j]), v = [0, 1, 2].map(j => p[c * 3 + j] - p[a * 3 + j]);
                            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
                            for (const index of [a, b, c]) for (let j = 0; j < 3; j++) normals[index * 3 + j] += n[j];
                        }
                        for (let i = 0; i < normals.length; i += 3) {
                            const length = Math.hypot(...normals.subarray(i, i + 3)) || 1;
                            for (let j = 0; j < 3; j++) normals[i + j] /= length;
                        }
                        attributes.normal = { size: 3, data: normals };
                    }
                    const style = description.materials[primitive.material]?.extras.layerMaterial || { color: [1, 1, 1], metallic: 1 };
                    const program = layer._createProgram(style);
                    resources.push(program);
                    const geometry = new Geometry(layer.renderer.gl, attributes);
                    resources.push(geometry);
                    const mesh = new Mesh(layer.renderer.gl, { geometry, program });
                    mesh.name = description.meshes[spec.mesh].name; mesh.extras = spec.extras || {};
                    mesh.setParent(group);
                }
            }
            for (const child of spec.children || []) node(child).setParent(group);
            active.delete(index);
            return group;
        };
        const scene = description.scenes?.[description.scene || 0];
        if (!scene) throw new Error('Missing glTF scene');
        try {
            return { scene: scene.nodes.map(node) };
        } catch (error) {
            for (const resource of resources) resource.remove();
            throw error;
        }
    },
};

L.Layer3D.Native.Mesh = class extends L.Layer3D.Native.Transform {
    constructor(gl, { geometry, program }) {
        super(); Object.assign(this, { gl, geometry, program, id: L.Layer3D.Native.nextId++, renderOrder: 0 });
        this.beforeRenderCallbacks = []; this.afterRenderCallbacks = [];
    }
    onBeforeRender(callback) { this.beforeRenderCallbacks.push(callback); }
    onAfterRender(callback) { this.afterRenderCallbacks.push(callback); }
    draw({ camera }) {
        const { Mat4 } = L.Layer3D.Native;
        const modelView = new Mat4().multiply(camera.viewMatrix, this.worldMatrix);
        const inverse = new Mat4().inverse(modelView);
        Object.assign(this.program.uniforms, {
            modelViewMatrix: { value: modelView }, projectionMatrix: { value: camera.projectionMatrix },
            normalMatrix: { value: [inverse[0], inverse[4], inverse[8], inverse[1], inverse[5], inverse[9], inverse[2], inverse[6], inverse[10]] },
        });
        for (const callback of this.beforeRenderCallbacks) callback({ mesh: this, camera });
        this.program.use();
        const matrix = new DOMMatrix(this.worldMatrix);
        const determinant = matrix.m11 * (matrix.m22 * matrix.m33 - matrix.m23 * matrix.m32) -
            matrix.m21 * (matrix.m12 * matrix.m33 - matrix.m13 * matrix.m32) +
            matrix.m31 * (matrix.m12 * matrix.m23 - matrix.m13 * matrix.m22);
        this.gl.frontFace(determinant < 0 ? this.gl.CW : this.gl.CCW);
        this.geometry.draw(this.program, this.gl.TRIANGLES);
        for (const callback of this.afterRenderCallbacks) callback({ mesh: this, camera });
    }
};

L.Layer3D.Native.createRenderer = function ({ dpr = 1 }) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('Layer3D requires WebGL 2');
    return {
        gl, dpr,
        setSize(width, height) {
            this.width = width; this.height = height;
            canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
        },
        getRenderList({ scene, camera, sort = true }) {
            const meshes = [];
            scene.traverse(mesh => { if (!mesh.visible) return true; if (mesh.geometry) meshes.push(mesh); });
            if (sort) meshes.sort((a, b) => Number(a.program.transparent) - Number(b.program.transparent) ||
                (a.program.transparent ? this.sortTransparent(a, b) : a.id - b.id));
            return meshes;
        },
        render({ scene, camera, update = true }) {
            if (update) scene.updateMatrixWorld();
            camera.updateMatrixWorld();
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            for (const mesh of this.getRenderList({ scene, camera })) mesh.draw({ camera });
        },
        sortTransparent(a, b) { return b._sortDepth - a._sortDepth || a.id - b.id; },
    };
};
