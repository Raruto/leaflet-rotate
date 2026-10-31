/**
 * A WebGL (OGL) scene drawn above the map tiles and kept in sync with the map camera
 * (center, zoom, bearing, pitch and zoom animations).
 *
 * OGL is imported from unpkg on demand. Wait for `layer.ready` before using the helpers.
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
        this.ready = Promise.all([
            import('https://unpkg.com/ogl@1.0.11/src/core/Renderer.js'),
            import('https://unpkg.com/ogl@1.0.11/src/core/Geometry.js'),
            import('https://unpkg.com/ogl@1.0.11/src/core/Program.js'),
            import('https://unpkg.com/ogl@1.0.11/src/core/Mesh.js'),
            import('https://unpkg.com/ogl@1.0.11/src/core/Camera.js'),
            import('https://unpkg.com/ogl@1.0.11/src/core/Transform.js'),
            import('https://unpkg.com/ogl@1.0.11/src/math/Vec3.js'),
            import('https://unpkg.com/ogl@1.0.11/src/math/Mat4.js'),
            import('https://unpkg.com/ogl@1.0.11/src/math/Color.js'),
            import('https://unpkg.com/ogl@1.0.11/src/extras/Raycast.js'),
            import('https://unpkg.com/ogl@1.0.11/src/core/Texture.js'),
            import('https://unpkg.com/earcut@3.0.2/src/earcut.js'),
        ]).then(async modules => {
            this.OGL = Object.assign({}, ...modules.slice(0, -1));
            this._earcut = modules.at(-1).default;
            this.root = new this.OGL.Transform();
            this.raycaster = new this.OGL.Raycast();
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
        if (this.OGL) this._attach(map);
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
                object.geometry = new this.OGL.Geometry(shared.renderer.gl, this._attributes(geometry));
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
     * Adds an OGL Transform or Mesh to the scene and redraws it.
     */
    add(object) {
        object.setParent(this.root);
        return this.update();
    },

    /**
     * Removes an OGL object from the scene and redraws it.
     */
    remove(object) {
        if (object === undefined) return L.Layer.prototype.remove.call(this);
        object.setParent(null);
        return this.update();
    },

    /**
     * Loads a glTF / GLB model (GLTFLoader is imported on demand).
     *
     * @returns {Promise<Object>} An OGL Transform containing static model meshes.
     */
    async loadModel(url) {
        await this.ready;
        return this._loadModel(url);
    },

    async _loadModel(url) {
        if (!this.renderer) throw new Error('Add the layer to a map before loading a model');
        const { GLTFLoader } = await import('https://unpkg.com/ogl@1.0.11/src/extras/GLTFLoader.js');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Unable to load model: HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const description = new DataView(data).getUint32(0, true) === 0x46546c67
            ? GLTFLoader.unpackGLB(data) : JSON.parse(new TextDecoder().decode(data));
        if (description.skins?.length || description.animations?.length ||
            description.extensionsRequired?.length || description.meshes?.some(mesh =>
                mesh.primitives.some(primitive => primitive.targets || (primitive.mode !== undefined && primitive.mode !== 4)))) {
            throw new Error('Layer3D supports static triangle glTF models without required extensions');
        }
        // Keep independent transforms rather than OGL's automatic mesh instancing.
        const meshes = description.meshes;
        description.meshes = [];
        for (const node of description.nodes || []) {
            if (node.mesh === undefined) continue;
            description.meshes.push(meshes[node.mesh]);
            node.mesh = description.meshes.length - 1;
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
                textures.set(key, new this.OGL.Texture(gl, {
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
        const loaded = await GLTFLoader.parse(this.renderer.gl, description, directory);
        const resources = loaded.meshes.flatMap(({ primitives }) =>
            primitives.map(({ geometry, program }) => ({ geometry, program })));
        const model = this.createGroup();
        model.id = url;
        model.extras = description.extras || {};
        const scene = loaded.scene || loaded.scenes?.[0];
        if (!scene?.length) throw new Error('Expected a glTF model with a non-empty scene');
        for (const node of scene) node.setParent(model);
        const draw = this.OGL.Mesh.prototype.draw;
        model.traverse(object => {
            if (!object.geometry) return;
            const previous = object.program;
            const material = previous.gltfMaterial;
            const geometry = object.geometry;
            object.geometry = new this.OGL.Geometry(this.renderer.gl, this._attributes(geometry));
            const style = material?.extras?.layerMaterial || { color: [1, 1, 1] };
            if ([style.baseTexture, style.metalTexture, style.emissiveTexture, style.occlusionTexture].some(Boolean) &&
                !object.geometry.attributes.uv) throw new Error('Textured model mesh requires UV coordinates');
            object.program = this._createProgram(style);
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
        for (const { geometry, program } of resources) {
            geometry.remove();
            program.remove();
        }
        for (const view of loaded.bufferViews) {
            if (view.buffer) this.renderer.gl.deleteBuffer(view.buffer);
        }
        return model;
    },

    /**
     * @returns {Object} An empty OGL Transform.
     */
    createGroup() {
        return new this.OGL.Transform();
    },

    /**
     * Creates a non-indexed mesh from flat `position`, `normal` and `color` arrays (3 items per vertex).
     * The default program uses vertex colors and simple directional lighting.
     *
     * @returns {Object} An OGL Mesh.
     */
    createMesh(attributes, material) {
        if (!this.renderer) throw new Error('Add the layer to a map before creating a mesh');
        const data = {};
        for (const name in attributes) {
            data[name] = { size: 3, data: new Float32Array(attributes[name]) };
        }
        const geometry = new this.OGL.Geometry(this.renderer.gl, data);
        const mesh = new this.OGL.Mesh(this.renderer.gl, { geometry,
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
                material[name] = new this.OGL.Texture(this.renderer.gl, {
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
        const program = new this.OGL.Program(this.renderer.gl, { vertex, fragment,
            cullFace: material.doubleSided ? null : this.renderer.gl.BACK,
            transparent: material.alphaMode === 'BLEND',
            depthWrite: material.alphaMode !== 'BLEND',
            uniforms: { baseColor: { value: material.color || [1, 1, 1] },
                lightDirection: { value: new this.OGL.Vec3() }, skyDirection: { value: new this.OGL.Vec3() },
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
     * @param {number|string|Object} value OGL color, or `{h, s, l}` in `0`–`1`.
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
        const color = typeof value === 'number'
            ? new this.OGL.Color((value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255)
            : new this.OGL.Color(value);
        return { r: color.r, g: color.g, b: color.b };
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
        const data = [], indices = [];
        for (const [index, path] of [contour, ...holes].entries()) {
            if (index) indices.push(data.length / 2);
            for (const { x, y } of path) data.push(x, y);
        }
        const triangles = this._earcut(data, indices);
        const result = [];
        for (let i = 0; i < triangles.length; i += 3) result.push(triangles.slice(i, i + 3));
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
        const { Vec3, Mat4 } = this.OGL;
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
        const OGL = this.OGL;
        const shared = {
            _map: map,
            location: this.location,
            options: this.options,
            OGL,
            layers: new Set(),
            scene: new OGL.Transform(),
            camera: new OGL.Camera(),
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
        this.renderer = new this.OGL.Renderer({ alpha: true, antialias: true,
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
        const target = new this.OGL.Vec3(
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
        const light = new this.OGL.Vec3(-300, 500, 300).normalize().transformDirection(camera.viewMatrix);
        const sky = new this.OGL.Vec3(0, 1, 0).transformDirection(camera.viewMatrix);
        this.scene.updateMatrixWorld();
        const position = new this.OGL.Vec3();
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
