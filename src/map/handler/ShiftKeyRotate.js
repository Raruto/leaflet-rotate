
/**
 * Handles Shift+wheel bearing changes and Ctrl+drag bearing/pitch changes.
 * 
 * @typedef L.Map.ShiftKeyRotate
 * @property {boolean} [shiftKeyRotate=true] Enable Shift+wheel bearing rotation.
 * 
 * @since leaflet-rotate (v0.1.0)
 */

L.Map.mergeOptions({

    /**
     * Whether Shift+wheel changes the map bearing.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    shiftKeyRotate: true,

    /**
     * Whether Ctrl+drag changes bearing and pitch.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (0.5.0)
     */
    pitchDrag: true,

});

L.Map.ShiftKeyRotate = L.Handler.extend({

    /**
     * @param {L.Map} map Map controlled by this handler.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
        this._map = map;
        this._onMouseDownBound = this._onMouseDown.bind(this);
        this._onMouseMoveBound = this._onMouseMove.bind(this);
        this._onMouseUpBound = this._onMouseUp.bind(this);
    },

    /**
     * Attach enabled wheel and pointer/mouse gesture listeners.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
        if (this._map.options.shiftKeyRotate) {
            L.DomEvent.on(this._map._container, "wheel", this._handleShiftScroll, this);
        }
        if (this._map.options.pitchDrag) {
            this.addPitchHooks();
        }
    },

    /**
     * Detach gesture listeners and cancel any active drag.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
        L.DomEvent.off(this._map._container, "wheel", this._handleShiftScroll, this);
        this.removePitchHooks();
    },

    /**
     * Listen for the start of Ctrl+drag pitch gestures.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    addPitchHooks() {
        if (this._pitchHooksAdded) { return; }
        this._pitchEvents = L.version.startsWith('2.')
            ? ['pointerdown', 'pointermove', 'pointerup pointercancel']
            : ['mousedown', 'mousemove', 'mouseup'];
        this._map._container.addEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
        this._pitchHooksAdded = true;
    },

    /**
     * Stop listening for pitch gestures and remove active document listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    removePitchHooks() {
        if (!this._pitchHooksAdded) { return; }
        this._map._container.removeEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
        this._onMouseUp();
        delete this._pitchEvents;
        this._pitchHooksAdded = false;
    },

    /**
     * Rotate the map in fixed increments while Shift is held during wheel input.
     * 
     * @param {WheelEvent} e Wheel event from the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _handleShiftScroll(e) {
        if (e.shiftKey) {
            e.preventDefault();
            this._map.scrollWheelZoom.disable();
            this._map.setBearing(this._map.getBearing() + Math.sign(e.deltaY) * 5);
        } else {
            this._map.scrollWheelZoom.enable();
        }
    },

    /**
     * Start Ctrl+drag and capture subsequent movement outside the map.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture start event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
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

    /**
     * Apply pointer movement to pitch (vertical) and bearing (horizontal).
     * 
     * @param {MouseEvent|PointerEvent} e Gesture movement event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseMove(e) {
        this._map._setPitchAndBearing(
            this._map.getPitch() + (this._lastY - e.clientY) * 0.5,
            this._map.getBearing() + (e.clientX - this._lastX) * 0.8
        );
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        e.preventDefault();
    },

    /**
     * End Ctrl+drag and clear document-level listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
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

/**
 * Create the handler when either desktop rotation gesture is enabled.
 * 
 * @since leaflet-rotate (v0.1.0)
 */
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
