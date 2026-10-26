/**
 * Leaflet's `L.Bounds` is not overridden by this plugin. Rotation-aware
 * pixel bounds are calculated by the map and renderer extensions.
 *
 * @since leaflet-rotate (v0.1.0)
 *
 * @external L.Bounds
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/geometry/Bounds.js
 */

/**
 * @TODO find out if should override here some functions in order
 * to always get  correct { min, max } pixel bounds on a rotaded
 * map, for example: at 180° "min" should becomes "max"?
 * 
 * @see L.Map.getPixelBounds()
 */