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

#### Standalone 3D layers (OGL)

Load [misc/3DLayer.js](misc/3DLayer.js) with a standard script tag after Leaflet and leaflet-rotate. It registers `L.Layer3D` globally, independently of the main plugin bundle. The required OGL modules (1.0.11) and earcut (3.0.2, polygon triangulation) are dynamically imported from unpkg; no module scripts or import map are needed in your page. All instances on the same map automatically share one WebGL canvas, scene and camera for correct occlusion, with a separate group and geographic origin per layer. Different maps use separate renderers. There is no three.js dependency or locally generated model loader.

Renderer creation, camera synchronization and cleanup are managed directly by `Layer3D`, with shared state per map and no separate renderer class.

```html
<script src="./misc/3DLayer.js"></script>
<script>
(async function () {
const tower = await new L.Layer3D({ center: [48.8582601, 2.29449985], ariaLabel: '3D landmarks' }).addTo(map).ready;
tower.add(await tower.loadModel('eiffel-tower.glb'));
const buildings = await new L.Layer3D().addTo(map).ready;
// tower.renderer === buildings.renderer
})().catch(console.error);
</script>
```

World coordinates are metres from each layer's `location`: x east, y up, z south. Use `new L.Layer3D({ center: [lat, lng], ... })` to specify that origin. Without `center`, the layer takes the map centre on first addition. That origin stays fixed when moving the map or re-adding the layer. The positional `new L.Layer3D(location, options)` form remains supported and takes precedence over `center`. Georeferenced GeoJSON sources do not need an explicit origin; models generally need an explicit location to place them geographically. The first attached layer sets the shared canvas options and camera origin until the last layer is removed. Removing a layer detaches only its group; removing the last disposes the renderer. Re-adding layers preserves their objects and recreates the canvas as needed. Await `ready` to handle initialization failures (also emitted as an `error` event).

| Option / method | Description |
| --- | --- |
| `center` | Geographic origin (`[lat, lng]` or `L.LatLng`); defaults to the map centre on first addition. |
| `ariaLabel` | Accessible name of the canvas (default `'3D scene'`). |
| `zIndex` | Canvas z-index (default `450`: above tiles and vectors, below markers). |
| `maxPixelRatio` | Upper bound of the canvas device pixel ratio (default `2`). |
| `zoomOnClick` | Default `false`. When enabled, clicking a visible 3D object centers the map on its ground position and zooms in one level, capped at the map's maximum zoom. Works with models and polygon sources, with or without tooltips; only the nearest 3D surface triggers zoom when layers overlap. |
| `model` | Optional glTF/GLB URL, resolved relative to the page. Loaded and added automatically before `ready` resolves. |
| `modelAlphaMode` | Optional override (`OPAQUE`, `MASK`, `BLEND`, `COVERAGE`); otherwise respects glTF materials, including the tower's original `BLEND` transparency. `COVERAGE` uses multisample alpha-to-coverage with depth writes, but can lose fine texture details; it falls back to `MASK` without antialiasing. |
| `rotation`, `scale` | Optional model `[x, y, z]` rotation in radians and scale factors. |
| `attribution` | Standard Leaflet attribution, added/removed automatically with the layer. |
| `layer.ready` | Promise resolved once OGL and configured data/model are loaded (`ready` event). A configured model must be added to a map before awaiting readiness, because its GPU resources need that map's WebGL context. |
| `add(object)` / `remove(object)` | Adds or removes an object in this layer's group and redraws. `remove()` without arguments removes the Leaflet layer. |
| `update()` | Schedules a redraw after changing objects. |
| `loadModel(url)` | Loads a static glTF/GLB model after adding the layer to a map. OGL's GLTFLoader is dynamically imported from unpkg. |
| `createGroup()` / `createMesh({ position, normal, color }, program?)` | Creates an OGL Transform or a non-indexed Mesh from flat arrays. Mesh creation requires the layer on a map; the default program uses vertex colors with simple directional/ambient lighting. |
| `color(value)` / `setVertexColor(mesh, start, end, color)` | Creates an sRGB color (`0x48d9ff`, `'#48d9ff'`) and paints a vertex range. HSL inputs use linear-space components, matching the former three.js styling, then encode to sRGB for storage. |
| `triangulate(contour, holes?)` / `isClockWise(points)` | Polygon helpers for `{ x, y }` points. |
| `raycast(event, objects?, recursive?)` | Intersections under a mouse event, nearest first (`object`, `point`, `faceIndex`, `distance`). |
| `OGL`, `scene`, `camera`, `renderer`, `root` | The imported OGL classes and underlying objects, for advanced use. The canvas/context are `renderer.gl.canvas` / `renderer.gl`; mesh attributes are `geometry.attributes`, with typed arrays in `.data`. |

For polygon volumes, configure `Layer3D` directly instead of defining a subclass:

```js
const volumes = new L.Layer3D({
    source: 'data/volumes.pmtiles',
    featureStyle: feature => ({
        top: feature.properties.height,
        bottom: feature.properties.baseHeight || 0,
        color: 0xd9b38c
    })
}).on('error', ({ error }) => console.error(error)).addTo(map);
await volumes.ready;
```

`source` is a PMTiles archive containing polygon/multipolygon GeoJSON feature collections; its reader is imported directly by `Layer3D`. `featureStyle(feature)` returns `{ top, bottom?, color? }` in metres, or `null` to skip a feature. Invalid heights report errors. The layer handles polygon holes, elevated undersides, batched vertex-colored meshes, deduplication between archive blocks, cancellation and geometry disposal. Styling and tooltip content are the only dataset-specific logic.

Hover highlighting is built in. `highlightColor` defaults to `0x48d9ff`. Supply only `tooltipContent(feature)` returning a DOM node or text to enable a tooltip. The layer creates and styles its own `.leaflet-3d-tooltip` element inside the map, sets accessible tooltip/live-region attributes, positions and hides it, and removes it when disabled. Re-enabling the layer recreates it. No tooltip markup is needed in the page. The map cursor becomes `pointer` while a tooltip is visible and restores its previous style when hidden. Clicking does not pin the tooltip or highlight: moving off a feature or leaving the map clears both. `featurehover` and `featureclick` events expose `{ feature, originalEvent }`. Features contain `id` and `properties`. `progress` exposes `{ enabled, loaded, skipped, pending, errors }` for page-specific status messages.

The renderer supports static glTF/GLB triangle meshes, node transforms, base-color textures, metallic/roughness factors and textures, emissive and occlusion maps, double-sided materials and glTF alpha modes (OPAQUE, MASK, BLEND). A compact metallic/roughness shader combines a warm directional light, sky/ground ambient lighting, specular reflections and linear-space color processing. Color textures use hardware sRGB decoding/filtering in WebGL 2, with shader decoding as a WebGL 1 fallback; glTF color factors remain linear. Polygon buildings use Lambert shading; hemisphere and directional light strengths match the former three.js renderer. No tone mapping is applied, matching the original renderer's output. The Eiffel Tower uses its original embedded textures. This is not a full PBR engine: normal maps, environment maps, cast shadows and material extensions are not implemented. Transparent meshes are sorted back-to-front using transformed geometry centers, not shared node origins; double-sided transparent models draw back faces before front faces. Sorting remains per mesh rather than per triangle. Texture references currently require untransformed TEXCOORD_0 UVs. Models with animations, skins, morph targets, non-triangle primitives or required extensions report an error. Ordinary static models with repeated mesh nodes keep independent transforms. The last layer's removal releases the WebGL context; re-adding a layer recreates GPU geometry, programs and textures from retained CPU data/images.

`tooltipContent` also works with configured GLB/glTF models. The callback receives `{ id, properties, model, mesh }`: `id` is the model URL, `properties` is its glTF `extras`, `model` is the loaded root and `mesh` is the intersected mesh. Nested meshes are picked recursively. Model programs remain unchanged on hover; the tooltip, pointer cursor and hover/click events behave like polygon tooltips, without click-to-pin.

Picked model and polygon features also expose `point`, the intersection in shared scene coordinates (metres from the shared renderer's origin). Enable `zoomOnClick: true` to zoom onto the clicked object, as in the Eiffel Tower example; this does not pin the tooltip.

PMTiles remains separate: load [misc/PMTilesLayer.js](misc/PMTilesLayer.js) with a standard script tag to register `L.PMTilesLayer`, based on `L.TileLayer` and dedicated to raster tiles. It dynamically imports the archive reader from unpkg, including its fflate dependency. The layer owns requests, cancellation on tile unload or zoom changes, image decoding and object URL cleanup. Missing or invalid raster tiles report errors through Leaflet's `tileerror` event. `tile.done` and `tile.error` expose load state. GeoJSON volumes belong in `Layer3D`, not this raster layer.

The buildings in [leaflet-rotate-3d-layer.html](examples/leaflet-rotate-3d-layer.html) are instead a true `L.Layer3D`, reading PMTiles directly as a data source. They retain at most nine archive blocks around the map centre (roughly a 1.2 km-wide neighbourhood for the supplied Paris archive), at the archive's native zoom regardless of map zoom. Only moving into another block changes the working set; zoom, bearing and pitch reuse the same geometry. Two loads run concurrently, mesh construction yields between features after an 8 ms work slice, and leaving a block cancels its work and disposes its geometry. Blocks share the WebGL depth buffer with the tower; no tile elements, GridLayer lifecycle or minimum map zoom are involved. This deliberately renders a local neighbourhood rather than all buildings visible in a city-wide view.

Create raster layers with `new L.PMTilesLayer('data/map.pmtiles', options)`: the class resolves the URL, opens the archive and reads its header. `layer.ready` resolves with the layer; `layer.header` exposes the metadata and `maxNativeZoom` defaults to the archive's maximum zoom (an explicit option takes precedence). Tile requests wait for initialization, including when added before `ready`. Initialization errors reject `ready` and emit `error`; no guessed zoom fallback is used. An existing reader can still be supplied through `options.archive`.

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
