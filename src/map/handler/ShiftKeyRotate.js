
/**
 * Rotates the map on shift key + mousewheel scrolling (desktop).
 * 
 * @typedef L.Map.ShiftKeyRotate
 */

L.Map.mergeOptions({

    /**
     * Whether the map can be rotated with shift + wheel scroll
     * @type {Boolean}
     */
    shiftKeyRotate: true,

});

L.Map.ShiftKeyRotate = L.Handler.extend({

    addHooks() {
        L.DomEvent.on(this._map._container, "wheel", this._handleShiftScroll, this);
        // this._map.shiftKeyRotate.enable();
        this._map.shiftKeyRotate.rotate = true;
    },

    removeHooks() {
        L.DomEvent.off(this._map._container, "wheel", this._handleShiftScroll, this);
        this._map.shiftKeyRotate.rotate = false;
    },

    _handleShiftScroll(e) {
        if (e.shiftKey) {
            e.preventDefault();
            this._map.scrollWheelZoom.disable();
            this._map.setBearing((this._map._bearing * (180 / Math.PI)) + Math.sign(e.deltaY) * 5);
        } else {
            this._map.scrollWheelZoom.enable();
        }
    },

});

/**
 * Add ShiftKey handler to L.Map (enabled unless `shiftKeyRotate` is unset).
 * 
 * @property {L.Map.ShiftKeyRotate} shiftKeyRotate
 */
L.Map.addInitHook('addHandler', 'shiftKeyRotate', L.Map.ShiftKeyRotate);

// decrease `scrollWheelZoom` handler priority over `shiftKeyRotate` handler
L.Map.addInitHook(function() {
    if (this.scrollWheelZoom.enabled() && this.shiftKeyRotate.enabled()) {
        this.scrollWheelZoom.disable();
        this.scrollWheelZoom.enable();
    }
});
