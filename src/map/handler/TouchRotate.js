/**
 * Enables two-finger rotation through the shared touch-gesture handler.
 * 
 * @typedef L.Map.TouchRotate
 * @property {boolean} [touchRotate=false] Enable two-finger map rotation.
 */

L.Map.mergeOptions({

    /**
     * Whether the map can be rotated with a two-finger rotation gesture
     * 
     * @type {Boolean}
     */
    touchRotate: false,

});

L.Map.TouchRotate = L.Handler.extend({

    /**
     * Enable rotation handling in the map's shared touch gesture handler.
     */
    addHooks() {
        this._map.touchGestures.enable();
        this._map.touchGestures.rotate = true;
    },

    /**
     * Disable rotation handling without affecting pinch zoom.
     */
    removeHooks() {
        this._map.touchGestures.rotate = false;
    },

});

/**
 * Add Touch Rotate handler (disabled unless `touchGestures` is set).
 * 
 * @property {L.Map.TouchGestures} touchGestures
 */
L.Map.addInitHook('addHandler', 'touchRotate', L.Map.TouchRotate);
