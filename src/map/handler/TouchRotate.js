/**
 * Enables two-finger rotation through the shared touch-gesture handler.
 * 
 * @typedef L.Map.TouchRotate
 * @property {boolean} [touchRotate=false] Enable two-finger map rotation.
 * 
 * @since leaflet-rotate (v0.1.0)
 */

L.Map.mergeOptions({

    /**
     * Whether the map can be rotated with a two-finger rotation gesture
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    touchRotate: false,

});

L.Map.TouchRotate = L.Handler.extend({

    /**
     * Enable rotation handling in the map's shared touch gesture handler.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
        this._map.touchGestures.enable();
        this._map.touchGestures.rotate = true;
    },

    /**
     * Disable rotation handling without affecting pinch zoom.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
        this._map.touchGestures.rotate = false;
    },

});

/**
 * Add Touch Rotate handler (disabled unless `touchGestures` is set).
 * 
 * @property {L.Map.TouchGestures} touchGestures
 * 
 * @since leaflet-rotate (v0.1.0)
 */
L.Map.addInitHook('addHandler', 'touchRotate', L.Map.TouchRotate);
