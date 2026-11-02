# leaflet-rotate

[![NPM version](https://img.shields.io/npm/v/leaflet-rotate.svg?color=red)](https://www.npmjs.com/package/leaflet-rotate)
[![License](https://img.shields.io/badge/license-GPL%203-blue.svg?style=flat)](LICENSE)

A Leaflet plugin that allows to add rotation functionality to map tiles

_For a working example see the following [demo](https://raruto.github.io/leaflet-rotate/examples/leaflet-rotate.html)_

<p align="center">
    <a href="https://raruto.github.io/leaflet-rotate/examples/leaflet-rotate.html"><img src="https://raruto.github.io/img/leaflet-rotate.png" alt="Leaflet rotate viewer" /></a>
</p>

---

<blockquote>
    <p align="center">
        <em>Initially based on the <a href="https://github.com/Leaflet/Leaflet/tree/rotate">work</a> of <strong>Iván Sánchez Ortega</strong> (see: <a href="https://github.com/Leaflet/Leaflet/issues/268">#268</a>)</em>
    </p>
</blockquote>

### How to use

Load Leaflet first, then the plugin. For example, using the published CDN build:

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-rotate@0.5.2/dist/leaflet-rotate.js"></script>
```

Or if you want to test it with [`2.0.0-alpha.1`](https://github.com/Leaflet/Leaflet/releases/tag/v2.0.0-alpha.1):

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet-global-src.js"></script>
<script>globalThis.L = globalThis.leaflet;</script>
<script src="https://unpkg.com/leaflet-rotate@0.5.2/dist/leaflet-rotate.js"></script>
```

Now, you can enable rotation in the map options. Bearing and pitch values are in degrees:

```js
const map = L.map('map', {
    rotate: true,
    bearing: 30,
    pitch: 20,
    rotateControl: true,
});

map.setBearing(90);
map.setPitch(35);
console.log(map.getBearing(), map.getPitch());
```

#### Map options

| Option | Default | Description |
| --- | --- | --- |
| `rotate` | `false` | Enables map rotation and pitch. |
| `bearing` | `0` | Initial map bearing, in degrees. |
| `pitch` | `0` | Initial map pitch, in degrees (clamped to `0`–`85`). |
| `pitchMaxDistance` | `3` | Far plane for pitched maps, in multiples of the map height: farther areas (and anything beyond the horizon) are not loaded and are covered by the `.leaflet-pitch-sky` element. Lower values load fewer tiles. |
| `rotateControl` | `true` | Adds the rotation control. Set to `false` to hide it, or pass options such as `{ closeOnZeroBearing: false }`. |
| `shiftKeyRotate` | `true` | Enables bearing changes with Shift + mouse wheel. |
| `pitchDrag` | `true` | Enables bearing and pitch changes with Ctrl + mouse drag or right-button drag. |
| `touchRotate` | `false` | Enables rotation with a two-finger touch gesture. |
| `touchPitch` | `false` | Enables pitch changes by dragging two fingers vertically. |
| `compassBearing` | `false` | Makes the bearing follow the device compass. On iOS, enable it from a user gesture (e.g. `map.compassBearing.enable()` in a button click) so that the orientation permission can be requested. |

#### Map methods and events

| API | Description |
| --- | --- |
| `map.setBearing(degrees, options?)` | Sets the bearing. Use `{ animate: true, duration: 0.5 }` for an animated change; `duration` is in seconds. |
| `map.getBearing()` | Returns the current bearing in degrees. |
| `map.setPitch(degrees, options?)` | Sets the pitch, clamped to `0`–`85` degrees. Accepts the same animation options as `setBearing`. |
| `map.getPitch()` | Returns the current pitch in degrees. |
| `map.resetNorth(options?)` | Animates the bearing back to `0` (pass `{ animate: false }` to skip the animation). |
| `map.resetNorthPitch(options?)` | Animates both bearing and pitch back to `0`. |
| `rotate` event | Fired when the bearing changes. |
| `pitch` event | Fired when the pitch changes. |

Pitched pans retain their final ground transform. When `setView` resets the map pane (including non-animated zooms), perspective is rebuilt before calculating the new pixel origin, preserving the camera and horizon.

#### Rotation control

The control is available as `L.Control.Rotate` or `L.control.rotate(options)`. Click it to reset bearing and pitch (`map.resetNorthPitch()`), drag it horizontally to rotate and vertically to change the pitch. The map option `rotateControl` adds it automatically.

| Option | Default | Description |
| --- | --- | --- |
| `position` | `'topleft'` | Leaflet control position. |
| `closeOnZeroBearing` | `true` | Hides the control when both bearing and pitch are zero. |
| `visualizePitch` | `true` | Tilts the icon with the pitch; when `false`, clicking only resets the bearing and dragging only rotates. |

#### Marker options

| Option / method | Description |
| --- | --- |
| `rotation` | Marker icon rotation in radians. |
| `rotateWithView` | Rotates the icon with the map bearing. |
| `keepUpright` | With `rotateWithView: true`, flips the icon as needed to keep it readable while preserving line alignment. |
| `scale` | Optional scale applied to the marker icon. |
| `marker.setRotation(radians)` | Updates the marker's icon rotation. |

With `preferCanvas: true` on the map, markers using an image `L.Icon` are drawn (with their shadow) on a dedicated screen-space Canvas instead of `<img>` elements. Icons remain upright and keep their pixel dimensions when the map is rotated or pitched, just like DOM markers; their geographic anchors still follow the map. Marker rotation options also apply. Popups, tooltips, pointer events and dragging (mouse, touch or pen) keep working, including `marker.dragging.enable()` / `disable()`, drag events and `autoPan`. `DivIcon` markers still use the DOM. Canvas markers use the dedicated marker renderer rather than a vector `renderer` option.

With `keyboard: true` (the Leaflet default) and `interactive: true`, each Canvas marker has a lightweight DOM button returned by `getElement()`. Its accessible name uses `title`, then `alt`, then “Marker”; provide a meaningful name such as `{ title: 'London station' }`. Tab focuses the marker with a visible outline; Enter or Space triggers its normal click/popup behavior. Focus opens its tooltip and respects `autoPanOnFocus`. Markers behind the camera are hidden from assistive technology. `keyboard: false` or `interactive: false` omits this button. Rendering remains on Canvas, but keyboard accessibility adds one DOM element per marker (only the focused one is repositioned during pan/zoom/rotation, so per-frame cost stays constant); pointer dragging does not provide keyboard repositioning.

Canvas marker positions follow Leaflet's zoom-transition timing without scaling the icons. At high pitch, markers behind the camera are excluded from drawing and hit testing.

#### Standalone 3D layers (native WebGL)

Rotation-enabled maps preserve the CSS 3D context through the map and raster-layer panes, but keep each tile level flat. The context remains enabled at pitch zero: removing it during the compass reset makes loaded tiles disappear in Firefox. The CSS ground projection retains perspective but emits zero depth, so markers and tooltips stay above the terrain. Run the camera regression in Firefox with `$env:TEST_BROWSER='firefox'; node build/test.js --name 'Pitched raster surfaces'` (PowerShell); Chromium is the default.

Ground depth is flattened in an invertible CSS matrix, with uniformly scaled homogeneous coefficients to preserve perspective precision. Pitch regressions check rendered coordinates rather than requiring a particular CSS transform string.

Leaflet's `minZoom` also applies to rotated and pitched maps, including wheel and pinch zoom. `maxBounds` constrains the visible ground footprint, accounting for bearing, pitch and the pitch far plane. `maxBoundsViscosity: 1` prevents crossing these bounds during dragging; fractional values allow elastic overshoot in projected ground coordinates. If the visible footprint is larger than the bounds on an axis, Leaflet centers its excess instead of increasing the zoom automatically.

The Paris example restricts navigation to the local archive extent with `maxBounds`, `maxBoundsViscosity: 1` and a minimum zoom of 14. These restrictions belong to the example, not to `Layer3D` or `PMTilesLayer`; they do not repair missing tiles inside an archive. Run the navigation BDD regressions on both supported Leaflet versions with `node build/test.js --tags "@navigation-bounds"`.

Generate archives with `npm run pmtiles`. Every tile in the requested bounding box and zoom range is required: HTTP 404, transient failures and empty responses are retried up to five times, then fail the build rather than leave holes. Empty building blocks are stored as valid empty GeoJSON collections. Before publishing, the builder verifies all expected tile IDs and byte lengths; a failed build leaves the previous archive unchanged. Existing incomplete archives must be regenerated. Run the builder checks with `node --test test/pmtiles-builder.test.js`.

Load [misc/3DLayer.js](misc/3DLayer.js) with a standard script tag after Leaflet and leaflet-rotate. It registers `L.Layer3D` globally, independently of the main plugin bundle. Rendering, static model loading, vector/matrix operations and polygon triangulation are implemented internally using WebGL 2 and browser APIs: no OGL, three.js, earcut, module scripts or import map are needed. WebGL 2 and `Promise.withResolvers()` are required; initialization failures are reported through the `error` event. All instances on the same map automatically share one WebGL canvas, scene and camera for correct occlusion, with a separate group and geographic origin per layer. Different maps use separate renderers. Polygon sources use the native PMTiles reader included in [misc/3DLayer.js](misc/3DLayer.js); no extra script is needed.

Renderer creation, camera synchronization and cleanup are managed directly by the first attached `Layer3D` instance, without a separate shared-state object or renderer class. If that instance is removed, a remaining layer takes ownership of the existing resources and map events, preserving the scene's original geographic origin.

The canvas uses a fixed z-index of `450` and caps its pixel ratio at `2`. While 3D layers are attached, zoom transform transitions advance on the same frames as WebGL through the Web Animations API; raster tiles cannot animate independently ahead of a slow 3D frame. Removing the last 3D layer restores independent CSS playback. Models retain their glTF `OPAQUE`, `MASK` or `BLEND` alpha mode, without a layer-level override.

```html
<script src="./misc/3DLayer.js"></script>
<script>
const tower = new L.Layer3D({
    center: [48.8582601, 2.29449985], model: 'eiffel-tower.glb', ariaLabel: '3D landmarks'
}).on('error', ({ error }) => console.error(error)).addTo(map);
const buildings = new L.Layer3D().on('ready', () => {
    // tower.renderer === buildings.renderer
}).on('error', ({ error }) => console.error(error)).addTo(map);
</script>
```

World coordinates are metres from each layer's `location`: x east, y up, z south. The constructor accepts a single options object: `new L.Layer3D({ center: [lat, lng], ... })`. `center` accepts only a `[lat, lng]` array. Without `center`, the layer takes the map centre on first addition. That origin stays fixed when moving the map or re-adding the layer. Georeferenced GeoJSON sources do not need an explicit origin; models generally need an explicit center to place them geographically. The first attached layer sets the shared canvas options and camera origin until the last layer is removed. Removing a layer detaches only its group; removing the last disposes the renderer. Re-adding layers preserves their objects and recreates the canvas as needed. Subscribe to `ready` before using loaded objects and to `error` to handle initialization failures. Initialization is deferred so listeners can be registered immediately after construction; `ready` fires only once, not on re-addition.

| Option / method | Description |
| --- | --- |
| `center` | Geographic origin as `[lat, lng]`; defaults to the map centre on first addition. |
| `ariaLabel` | Accessible name of the canvas (default `'3D scene'`). |
| `model` | Optional glTF/GLB URL, resolved relative to the page. Loaded and added automatically before the `ready` event. Supports indexed/interleaved attributes, sparse accessors, node matrices/quaternions and independent repeated mesh nodes. |
| `rotation`, `scale` | Optional model `[x, y, z]` rotation in radians and scale factors. |
| `attribution` | Standard Leaflet attribution, added/removed automatically with the layer. |
| `ready` / `error` events | Subscribe with `.on('ready', ...)` and `.on('error', ({ error }) => ...)` before adding the layer. `ready` fires once initialization and configured loading finish; there is no `layer.ready` promise. A configured model needs the layer added to a map before loading can finish. |
| `add(object)` / `remove(object)` | Adds or removes an object in this layer's group and redraws. `remove()` without arguments removes the Leaflet layer. |
| `update()` | Schedules a redraw after changing objects. |
| `setParent(node, parent)` / `traverse(node, callback)` | Layer-owned scene operations: reparent/detach (`parent = null`), or walk descendants depth-first. A truthy callback return skips that node's descendants. Call `update()` after changing attached data. |
| `color(value)` / `setVertexColor(mesh, start, end, color)` | Creates an sRGB color (`0x48d9ff`, `'#48d9ff'`) and paints a vertex range. HSL inputs use linear-space components, matching the former three.js styling, then encode to sRGB for storage. |
| `triangulate(contour, holes?)` / `isClockWise(points)` | Polygon helpers for `{ x, y }` points. |
| `raycast(event, objects?, recursive?)` | Intersections under a mouse event, nearest first (`object`, `point`, `faceIndex`, `distance`). `point` is an ordinary `[x, y, z]` array in shared-world metres. |
| `scene`, `camera`, `renderer`, `root` | Plain data managed procedurally by `Layer3D`: no engine classes, method tables, custom prototypes or `Native` namespace. Use layer helpers, not methods on these objects. The canvas/context are `renderer.gl.canvas` / `renderer.gl`; mesh attributes are `geometry.attributes`, with typed arrays in `.data`. |

For polygon volumes, configure `Layer3D` directly instead of defining a subclass:

`featureStyle` and `tooltipContent`, when supplied, must be functions; their types are not checked during initialization.

```js
const volumes = new L.Layer3D({
    source: 'data/volumes.pmtiles',
    featureStyle: feature => ({
        top: feature.properties.height,
        bottom: feature.properties.baseHeight || 0,
        color: 0xd9b38c
    })
}).on('ready', () => console.log('Archive loaded'))
  .on('error', ({ error }) => console.error(error)).addTo(map);
```

`source` is a PMTiles archive containing polygon/multipolygon GeoJSON feature collections; `Layer3D` reads it directly. `featureStyle(feature)` returns `{ top, bottom?, color? }` in metres, or `null` to skip a feature. Invalid heights report errors. The layer handles polygon holes, elevated undersides, batched vertex-colored meshes, deduplication between archive blocks, cancellation and geometry disposal. Styling and tooltip content are the only dataset-specific logic.

Set `roofTexture: true` on a polygon `Layer3D` to project the active `PMTilesLayer` imagery onto roofs, leaving walls and elevated undersides styled normally. The Paris example enables it: orthophotos show the photographed roofs; switching to Plan IGN uses that map instead, and Empty restores solid colors. Loaded imagery is reused without extra downloads, with geographic alignment across tile boundaries and with or without 3D terrain. Missing/unloaded imagery retains the configured building color; hover highlighting overrides the texture. A shared texture atlas is limited to 4096 pixels (or the GPU limit, if smaller), so wide views may reduce roof-image resolution. Orthophotos can contain photographic displacement and do not provide facade textures.

Hover highlighting is built in, using `0x48d9ff`. Supply only `tooltipContent(feature)` returning a DOM node or text to enable a tooltip. The layer creates and styles its own `.leaflet-3d-tooltip` element inside the map, sets accessible tooltip/live-region attributes, positions and hides it, and removes it when disabled. Re-enabling the layer recreates it. No tooltip markup is needed in the page. The map cursor becomes `pointer` while a tooltip is visible and restores its previous style when hidden. Clicking does not pin the tooltip or highlight: moving off a feature or leaving the map clears both. `featurehover` and `featureclick` events expose `{ feature, originalEvent }`. Features contain `id` and `properties`. `progress` exposes `{ enabled, loaded, skipped, pending, errors }` for page-specific status messages.

The renderer supports static glTF/GLB triangle meshes, node transforms, base-color textures, metallic/roughness factors and textures, emissive and occlusion maps, double-sided materials and glTF alpha modes (OPAQUE, MASK, BLEND). A compact metallic/roughness shader combines a warm directional light, sky/ground ambient lighting, specular reflections and linear-space color processing. Color textures use hardware sRGB decoding/filtering; glTF color factors remain linear. Polygon buildings use Lambert shading; hemisphere and directional light strengths match the former three.js renderer. No tone mapping is applied, matching the original renderer's output. The Eiffel Tower uses its original embedded textures. This is not a full PBR engine: normal maps, environment maps, cast shadows and material extensions are not implemented. Transparent meshes are sorted back-to-front using transformed geometry centers, not shared node origins; double-sided transparent models draw back faces before front faces. Sorting remains per mesh rather than per triangle. Texture references currently require untransformed TEXCOORD_0 UVs. Models with animations, skins, morph targets, non-triangle primitives or required extensions report an error. Ordinary static models with repeated mesh nodes keep independent transforms. The last layer's removal releases the WebGL context; re-adding a layer recreates GPU geometry, programs and textures from retained CPU data/images.

Polygon roofs use internal ear clipping with visibility-tested hole bridges and an area consistency check. It handles concave outlines, multiple holes, reversed winding, duplicate and collinear vertices; invalid/self-intersecting rings report errors. The algorithm targets individual building footprints, not very large polygon datasets in a single ring.

`tooltipContent` also works with configured GLB/glTF models. The callback receives `{ id, properties, model, mesh }`: `id` is the model URL, `properties` is its glTF `extras`, `model` is the loaded root and `mesh` is the intersected mesh. Nested meshes are picked recursively. Model programs remain unchanged on hover; the tooltip, pointer cursor and hover/click events behave like polygon tooltips, without click-to-pin.

Picked model and polygon features also expose `point`, the intersection in shared scene coordinates (metres from the shared renderer's origin). Clicking emits `featureclick` without moving the map, changing zoom, or pinning the tooltip.

Run the renderer/example BDD scenarios on both supported Leaflet versions with `node build/test.js --tags '@3d-layer'`. Playwright's default headless Chromium may not expose a WebGPU adapter, so those scenarios are skipped; use an installed GPU-enabled browser in headed mode instead (PowerShell: `$env:TEST_BROWSER='firefox'; node build/test.js --tags '@3d-layer'`, or set it to `chrome` or `msedge`). To also print Chromium/V8 coverage of named JavaScript functions in `misc/3DLayer.js`, set `COVERAGE_3D=1` before running the same command (PowerShell: `$env:COVERAGE_3D='1'`). Coverage is aggregated across scenarios; it measures function execution, not line/branch coverage or GLSL shader coverage. Unexecuted named functions are listed with source line numbers. Coverage collection is disabled by default.

PMTiles code lives directly in the layer files that use it: load [misc/PMTilesLayer.js](misc/PMTilesLayer.js) for raster tiles and [misc/3DLayer.js](misc/3DLayer.js) for polygon sources, with standard script tags after Leaflet. Each layer reads PMTiles v3 headers, Hilbert tile IDs, root/leaf directories, run-length entries and HTTP byte ranges without exposing a separate reader class. It caches at most 32 directories per archive and shares their requests; tile requests support `AbortSignal`. Uncompressed and gzip archives are supported through `DecompressionStream`, up to zoom 26 (safe integer tile IDs). Brotli/zstd, older archive versions, malformed ranges and changed ETags report explicit errors; recreate the layer if the archive changes. Servers should support HTTP Range and expose `Content-Range` and `ETag` for cross-origin use. A server returning the whole archive (`200`) is supported but downloads it for each read.

The raster layer owns requests, cancellation on tile unload or zoom changes, image decoding and object URL cleanup. Missing or invalid raster tiles report errors through Leaflet's `tileerror` event. `tile.done` and `tile.error` expose load state. GeoJSON volumes belong in `Layer3D`, not this raster layer.

The Paris example's optional `L.TerrainLayer({ source: 'data/paris-terrain.pmtiles' })` reads locally generated IGN elevations (`node build/pmtiles.js --only=terrain`). Active `PMTilesLayer` imagery is replaced by textured elevation meshes, including tiles loaded before terrain activation. Polygon vertices and model origins follow ground elevation; the camera retains its pitch and height above the terrain at the map center. Disabling terrain restores the flat imagery and object elevations. Elevations describe the ground/water surface, not bridge decks or building roofs; native Leaflet markers and vectors are not terrain meshes.

The buildings in [leaflet-rotate-3d-layer.html](examples/leaflet-rotate-3d-layer.html) are instead a true `L.Layer3D`, reading PMTiles directly as a data source. They cover the visible ground bounds plus one bordering archive block, clipped to the archive's geographic extent, at its native zoom regardless of map zoom. Movement, zoom, bearing, pitch and resize update coverage; overlapping blocks reuse their geometry. The map's pitch far plane excludes the sky. Two loads run concurrently, starting with nearby new blocks; mesh construction yields between features after an 8 ms work slice, and leaving a block cancels its work and disposes its geometry. Blocks share the WebGL depth buffer with the tower; no tile elements, GridLayer lifecycle or minimum map zoom are involved. Wider views load more blocks and therefore use more memory.

Create raster layers with `new L.PMTilesLayer('data/map.pmtiles', options)`: the class resolves the URL, opens the archive and reads its header. `layer.ready` resolves with the layer; `layer.header` exposes the metadata and `maxNativeZoom` defaults to the archive's maximum zoom (an explicit option takes precedence). Tile requests wait for initialization, including when added before `ready`. Initialization errors reject `ready` and emit `error`; no guessed zoom fallback is used. A compatible archive object can still be supplied through `options.archive`.

---

### Build Guide

Within your local development environment:

```shell
git clone git@github.com:Raruto/leaflet-rotate.git
cd ./leaflet-rotate

npm i         # install dependencies
npm run dev   # start dev server at: http://localhost:8080
npm run build # generate "dist" files (once)
npm run test  # build and run browser tests
```

After that you can start developing inside the `src` and `test` folders (eg. open "http://localhost:8080/test" in your browser to preview changes).

---

**Side notes:**

Be aware that this library overrides notable parts of leaflet core via the [L.Class.include()](https://leafletjs.com/examples/extending/extending-1-classes.html) function in order to make the rotate feature usable as a standalone plug-in.

Initial changes to this project have been apported by comparing the following branches: [https://github.com/Leaflet/Leaflet/compare/main...fnicollet:rotate-master](https://github.com/Leaflet/Leaflet/compare/main...fnicollet:rotate-master) (ref: [bac6c7d](https://github.com/fnicollet/Leaflet/tree/4ab6342f74516e7087dcd2ae786c721f36addf9e))

---

**Compatibile with:**
[![Leaflet 1.9.4 compatible!](https://img.shields.io/badge/Leaflet-1.9.4-1EB300.svg?style=flat)](http://leafletjs.com/reference.html) [![Leaflet 2.x compatible!](https://img.shields.io/badge/Leaflet-2.0.0--alpha.1-1EB300.svg?style=flat)](http://leafletjs.com/reference.html)

**Contributors:** [IvanSanchez](https://github.com/IvanSanchez), [Fnicollet](https://github.com/fnicollet/Leaflet/tree/rotate-master), [Hyperknot](https://github.com/hyperknot), [Raruto](https://github.com/Raruto/leaflet-rotate)
