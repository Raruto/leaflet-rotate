
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
    pitchDrag: true,

});

L.Map.ShiftKeyRotate = L.Handler.extend({

    initialize(map) {
        this._map = map;
        this._onMouseDownBound = this._onMouseDown.bind(this);
        this._onMouseMoveBound = this._onMouseMove.bind(this);
        this._onMouseUpBound = this._onMouseUp.bind(this);
    },

    addHooks() {
        if (this._map.options.shiftKeyRotate) {
            L.DomEvent.on(this._map._container, "wheel", this._handleShiftScroll, this);
        }
        if (this._map.options.pitchDrag) {
            this.addPitchHooks();
        }
    },

    removeHooks() {
        L.DomEvent.off(this._map._container, "wheel", this._handleShiftScroll, this);
        this.removePitchHooks();
    },

    addPitchHooks() {
        if (this._pitchHooksAdded) { return; }
        this._pitchEvents = L.version.startsWith('2.')
            ? ['pointerdown', 'pointermove', 'pointerup pointercancel']
            : ['mousedown', 'mousemove', 'mouseup'];
        this._map._container.addEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
        this._pitchHooksAdded = true;
    },

    removePitchHooks() {
        if (!this._pitchHooksAdded) { return; }
        this._map._container.removeEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
        this._onMouseUp();
        delete this._pitchEvents;
        this._pitchHooksAdded = false;
    },

    _handleShiftScroll(e) {
        if (e.shiftKey) {
            e.preventDefault();
            this._map.scrollWheelZoom.disable();
            this._map.setBearing(this._map.getBearing() + Math.sign(e.deltaY) * 5);
        } else {
            this._map.scrollWheelZoom.enable();
        }
    },

    _onMouseDown(e) {
        if (!this._map._rotate || !this._map.options.pitchDrag || !e.ctrlKey || e.button !== 0) { return; }

        const scrollWheelZoom = this._map.scrollWheelZoom;
        if (scrollWheelZoom && scrollWheelZoom._timer) {
            clearTimeout(scrollWheelZoom._timer);
            scrollWheelZoom._timer = null;
            scrollWheelZoom._delta = 0;
            scrollWheelZoom._startTime = null;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        document.addEventListener(this._pitchEvents[1], this._onMouseMoveBound);
        for (const event of this._pitchEvents[2].split(' ')) {
            document.addEventListener(event, this._onMouseUpBound);
        }
    },

    _onMouseMove(e) {
        this._map._setPitchAndBearing(
            this._map.getPitch() + (this._lastY - e.clientY) * 0.5,
            this._map.getBearing() + (e.clientX - this._lastX) * 0.8
        );
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        e.preventDefault();
    },

    _onMouseUp() {
        if (!this._pitchEvents) { return; }
        document.removeEventListener(this._pitchEvents[1], this._onMouseMoveBound);
        for (const event of this._pitchEvents[2].split(' ')) {
            document.removeEventListener(event, this._onMouseUpBound);
        }
        delete this._lastX;
        delete this._lastY;
    },

});

L.Map.addInitHook(function() {
    if (this.options.shiftKeyRotate) {
        this.shiftKeyRotate = new L.Map.ShiftKeyRotate(this);
        this.shiftKeyRotate.enable();
    } else if (this.options.pitchDrag) {
        this.shiftKeyRotate = new L.Map.ShiftKeyRotate(this);
        this.shiftKeyRotate.addPitchHooks();
        this.on('unload', this.shiftKeyRotate.removePitchHooks, this.shiftKeyRotate);
    }
    if (this.scrollWheelZoom.enabled() && this.options.shiftKeyRotate) {
        this.scrollWheelZoom.disable();
        this.scrollWheelZoom.enable();
    }
});
