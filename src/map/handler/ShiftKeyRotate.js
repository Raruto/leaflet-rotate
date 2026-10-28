
/**
 * Handles Shift+wheel bearing changes and Ctrl+drag / right-drag bearing/pitch changes.
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
     * Whether Ctrl+drag (or right-button drag) changes bearing and pitch.
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
        this._onContextMenuBound = this._onContextMenu.bind(this);
        this._applyBound = this._apply.bind(this);
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
        this._map._container.addEventListener('contextmenu', this._onContextMenuBound, true);
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
        this._map._container.removeEventListener('contextmenu', this._onContextMenuBound, true);
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
     * Start Ctrl+drag (or right-button drag) and capture subsequent movement outside the map.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture start event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseDown(e) {
        if (this._dragging) { return; }
        this._moved = false;
        if (!this._map._rotate || !this._map.options.pitchDrag || !(e.button === 2 || (e.ctrlKey && e.button === 0))) { return; }

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
        this._map._stopPitchBearingAnimation();
        this._dragging = true;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this._pitchDelta = this._bearingDelta = 0;
        document.addEventListener(this._pitchEvents[1], this._onMouseMoveBound);
        for (const event of this._pitchEvents[2].split(' ')) {
            document.addEventListener(event, this._onMouseUpBound);
        }
    },

    /**
     * Accumulate pointer movement as pitch (vertical) and bearing (horizontal).
     * Far from the horizontal center line the bearing follows the pointer angle
     * around the map center.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture movement event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseMove(e) {
        const rect = this._map._container.getBoundingClientRect(),
            cx = rect.left + rect.width / 2,
            cy = rect.top + rect.height / 2,
            x = e.clientX,
            y = e.clientY;

        this._pitchDelta += (this._lastY - y) * 0.5;
        this._bearingDelta += Math.abs(cy - this._lastY) > 100
            ? (Math.atan2(y - cy, x - cx) - Math.atan2(y - cy, this._lastX - cx)) * (180 / Math.PI)
            : (x - this._lastX) * 0.8 * (y < cy ? 1 : -1);
        this._lastX = x;
        this._lastY = y;
        this._moved = true;
        if (!this._frame) {
            this._frame = requestAnimationFrame(this._applyBound);
        }
        e.preventDefault();
    },

    /**
     * Apply accumulated movement once per animation frame.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _apply() {
        this._frame = null;
        if (!this._pitchDelta && !this._bearingDelta) { return; }
        this._map._setPitchAndBearing(this._map.getPitch() + this._pitchDelta, this._map.getBearing() + this._bearingDelta);
        this._pitchDelta = this._bearingDelta = 0;
    },

    /**
     * Suppress the context menu that follows a right-button drag.
     * 
     * @param {MouseEvent} e Context menu event.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onContextMenu(e) {
        if (this._moved) {
            e.preventDefault();
            e.stopPropagation();
        }
    },

    /**
     * End Ctrl+drag, flush pending movement and clear document-level listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseUp() {
        if (!this._pitchEvents || !this._dragging) { return; }
        document.removeEventListener(this._pitchEvents[1], this._onMouseMoveBound);
        for (const event of this._pitchEvents[2].split(' ')) {
            document.removeEventListener(event, this._onMouseUpBound);
        }
        cancelAnimationFrame(this._frame);
        if (this._map._mapPane) { this._apply(); }
        this._frame = null;
        this._dragging = false;
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
