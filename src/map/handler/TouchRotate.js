/**
 * Rotates the map on two-finger (touch devices).
 * 
 * @typedef L.Map.TouchRotate
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

    addHooks: function() {
        this._map.touchGestures.enable();
        this._map.touchGestures.rotate = true;
    },

    removeHooks: function() {
        this._map.touchGestures.rotate = false;
    },

});

/**
 * Add Touch Rotate handler (disabled unless `touchGestures` is set).
 * 
 * @property {L.Map.TouchGestures} touchGestures
 */
L.Map.addInitHook('addHandler', 'touchRotate', L.Map.TouchRotate);
