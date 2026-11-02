/**
 * Router for `new L.Layer({ source: { type, url, ...settings }, pane, attribution })`, loaded by
 * src/layer/Layer.js on the first layer with a source. It imports the type module on demand and turns the
 * layer into it; types receive flat options (`{ ...source, pane, attribution }`), so `layer.options.url` etc.
 *
 * Folder layout:
 * - types/: one module per `source.type`, the only files imported by this router:
 *   - 'pmtiles': raster PMTiles basemap (an L.TileLayer), draped on the terrain when present;
 *   - '3d': shared WebGPU scene with a GLB/glTF model, PMTiles GeoJSON features, or empty;
 *   - 'terrain': Float32 PMTiles DEM that deforms raster tiles, buildings and the camera;
 *   - 'sunlight': simulation clock control, sun/moon lighting and shadows;
 *   - 'traffic': vehicles moving along GeoJSON lanes (measured flow or timetable).
 * - scene/: the parts (mixins) composing the '3d' type: GPU setup, models, PMTiles reader, geometry,
 *   lighting, sources, picking and rendering. Other 3D types extend '3d'.
 * - utils/: pure helpers without DOM or GPU (sun position, traffic scheduling, vehicle models), unit-tested in Node.
 * Dataset-specific code and data (routes, timetables, API loaders) belong to the application, e.g. misc/.
 *
 * When `type` is omitted it is inferred from `source.url`: *.pmtiles -> 'pmtiles', anything else -> '3d'.
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
