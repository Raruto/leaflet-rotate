/**
 * Leaflet's `L.LatLngBounds` is not overridden by this plugin. Map methods
 * such as `getBounds()` return standard Leaflet bounds containing the viewport.
 *
 * @since leaflet-rotate (v0.1.0)
 *
 * @external L.LatLngBounds
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/geo/LatLngBounds.js
 */

/**
 * @TODO find out if should override here some functions in order
 * to always get  correct { _southWest, _northEast } bounds on a rotaded
 * map, for example: at 180° "_southWest" should becomes "_northEast"?
 * 
 * @see L.Map.getBounds()
 */