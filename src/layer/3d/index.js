/**
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
 * File layout: Leaflet lifecycle and public helpers; GLB/material loading; polygon
 * triangulation and picking; PMTiles extrusion; shared camera; procedural math/GPU operations.
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

/**
 * Router for `new L.Layer({ source: { type, url, ...settings }, pane, attribution })`, loaded by
 * src/layer/Layer.js on the first layer with a source.
 * Types, inferred from `source.url` when omitted (*.pmtiles -> 'pmtiles', anything else -> '3d'):
 * - 'pmtiles': raster PMTiles basemap (an L.TileLayer), draped on the terrain when present;
 * - '3d': shared WebGPU scene with a GLB/glTF model, PMTiles GeoJSON features, or empty;
 * - 'terrain': Float32 PMTiles DEM that deforms raster tiles, buildings and the camera.
 * Types receive flat options (`{ ...source, pane, attribution }`), so `layer.options.url` etc.
 */

// Stand-in while the type module loads: remembers the map, renders nothing.
const Pending = L.Layer.extend({
  onAdd() {},
  onRemove() {},
});

// One chain for every pending layer: they become real layers in creation order, whatever the import timing.
let loading = Promise.resolve();

function become(layer, type, settings) {
  const Type = L.Layer.types[type];
  Object.setPrototypeOf(layer, Type.prototype);
  layer.options = Object.create(Type.prototype.options);
  return Type.prototype.initialize.call(layer, settings);
}

export function route(layer, options) {
  const { source: { type = /\.pmtiles(?:[?#]|$)/i.test(options.source.url) ? 'pmtiles' : '3d', ...source }, ...core } = options;
  const settings = { ...source, ...core };
  // A stand-in created by Layer.js before this module loaded may already be on a map.
  const map = layer._map;
  map?.removeLayer(layer);
  delete layer.onAdd;
  delete layer.onRemove;
  if (L.Layer.types[type]) {
    become(layer, type, settings);
    map?.addLayer(layer);
    return;
  }
  Object.setPrototypeOf(layer, Pending.prototype);
  L.Util.setOptions(layer, core);
  map?.addLayer(layer);
  // ponytail: type methods (setOpacity, add, ...) exist only once `ready` resolves.
  loading = loading.catch(() => {}).then(() => import(`./types/${type}.js`));
  const pending = layer.ready = loading.then(() => {
    const map = layer._map;
    map?.removeLayer(layer);
    become(layer, type, settings);
    map?.addLayer(layer);
    return layer.ready === pending ? layer : layer.ready;
  });
}
