/**
 * Adds pinch zoom support through the shared touch-gesture handler.
 * 
 * @see https://github.com/Leaflet/Leaflet/blob/v1.9.3/src/map/handler/Map.TouchZoom.js
 * 
 * @external L.Map.TouchZoom
 * @property {boolean|string} touchZoom Enable pinch zoom on Leaflet 1.9; `'center'` uses the view center.
 * @property {boolean|string} pinchZoom The corresponding option and handler on Leaflet 2.
 * @property {boolean} [bounceAtZoomLimits=false] Allow pinch zoom to exceed zoom limits before settling.
 * 
 * @since leaflet-rotate (v0.1.0)
 */

import { L } from '../../Leaflet.js';

const zoomOption = L.version.startsWith('2.') ? 'pinchZoom' : 'touchZoom';

L.Map.mergeOptions({

    /**
     * Whether the map can be zoomed by touch-dragging
     * with two fingers. If passed `'center'`, it will
     * zoom to the center of the view regardless of
     * where the touch events (fingers) were. Enabled
     * for touch-capable web browsers.
     * 
     * @type {(Boolean|String)}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    [zoomOption]: L.version.startsWith('2.') || L.Browser.touch,

    /**
     * @TODO check if this is a duplicate of `L.Map.TouchGestures::bounceAtZoomLimits`
     * 
     * Set it to false if you don't want the map to
     * zoom beyond min/max zoom and then bounce back
     * when pinch-zooming.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bounceAtZoomLimits: false,

});

L.Map.TouchZoom = class extends L.Handler {};
L.Map.TouchZoom.include({

    /**
     * Enable pinch zoom handling and mark the shared touch handler as active.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
        this._map._container.classList.add('leaflet-touch-zoom');
        this._map.touchGestures.enable();
        this._map.touchGestures.zoom = true;
    },

    /**
     * Disable pinch zoom handling while preserving touch rotation state.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
        this._map._container.classList.remove('leaflet-touch-zoom');
        this._map.touchGestures.zoom = false;
    },

});

/**
 * Replace Leaflet's pinch zoom handler with the shared gesture implementation.
 * 
 * @property {L.Map.TouchGestures} touchGestures
 * 
 * @since leaflet-rotate (v0.1.0)
 */
L.Map.addInitHook(function () {
    // Replace the core handler rather than leaving two pinch implementations enabled.
    const enabled = this[zoomOption].enabled();
    this[zoomOption].disable();
    this.addHandler(zoomOption, L.Map.TouchZoom);
    if (enabled) this[zoomOption].enable();
});
