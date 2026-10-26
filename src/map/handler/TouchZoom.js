/**
 * Adds pinch zoom support through the shared touch-gesture handler.
 * 
 * @see https://github.com/Leaflet/Leaflet/blob/v1.9.3/src/map/handler/Map.TouchZoom.js
 * 
 * @external L.Map.TouchZoom
 * @property {boolean|string} [touchZoom=L.Browser.touch] Enable pinch zoom; `'center'` zooms around the view center.
 * @property {boolean} [bounceAtZoomLimits=false] Allow pinch zoom to exceed zoom limits before settling.
 */

L.Map.mergeOptions({

    /**
     * Whether the map can be zoomed by touch-dragging
     * with two fingers. If passed `'center'`, it will
     * zoom to the center of the view regardless of
     * where the touch events (fingers) were. Enabled
     * for touch-capable web browsers.
     * 
     * @type {(Boolean|String)}
     */
    touchZoom: L.Browser.touch,

    /**
     * @TODO check if this is a duplicate of `L.Map.TouchGestures::bounceAtZoomLimits`
     * 
     * Set it to false if you don't want the map to
     * zoom beyond min/max zoom and then bounce back
     * when pinch-zooming.
     * 
     * @type {Boolean}
     */
    bounceAtZoomLimits: false,

});

L.Map.TouchZoom = L.Handler.extend({

    /**
     * Enable pinch zoom handling and mark the shared touch handler as active.
     */
    addHooks() {
        this._map._container.classList.add('leaflet-touch-zoom');
        this._map.touchGestures.enable();
        this._map.touchGestures.zoom = true;
    },

    /**
     * Disable pinch zoom handling while preserving touch rotation state.
     */
    removeHooks() {
        this._map._container.classList.remove('leaflet-touch-zoom');
        this._map.touchGestures.zoom = false;
    },

});

/**
 * Add Touch Zoom handler (disabled unless `L.Browser.touch` is set).
 * 
 * @property {L.Map.TouchGestures} touchGestures
 */
L.Map.addInitHook('addHandler', 'touchZoom', L.Map.TouchZoom);
