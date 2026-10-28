/**
 * Enables MapLibre-like two-finger pitch (both fingers dragged vertically) through the shared touch-gesture handler.
 * 
 * @typedef L.Map.TouchPitch
 * @property {boolean} [touchPitch=false] Enable two-finger map pitch (vertical drag).
 * 
 * @since leaflet-rotate (0.5.1)
 */

L.Map.mergeOptions({

    /**
     * Whether the map can be pitched by dragging two fingers vertically
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (0.5.1)
     */
    touchPitch: false,

});

L.Map.TouchPitch = L.Handler.extend({

    /**
     * Enable pitch handling in the map's shared touch gesture handler.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    addHooks() {
        this._map.touchGestures.enable();
        this._map.touchGestures.pitch = true;
    },

    /**
     * Disable pitch handling without affecting pinch zoom and rotation.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    removeHooks() {
        this._map.touchGestures.pitch = false;
    },

});

/**
 * Add Touch Pitch handler (disabled unless `touchGestures` is set).
 * 
 * @property {L.Map.TouchGestures} touchGestures
 * 
 * @since leaflet-rotate (0.5.1)
 */
L.Map.addInitHook('addHandler', 'touchPitch', L.Map.TouchPitch);
