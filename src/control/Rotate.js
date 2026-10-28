/**
 * Leaflet control showing the map bearing and pitch, MapLibre-like (`NavigationControl` compass):
 * 
 * - Click: animate back to north (and to zero pitch when `visualizePitch` is enabled).
 * - Drag: horizontal movement changes the bearing, vertical movement changes the pitch.
 * 
 * Touch rotation and compass bearing are configured with the `touchRotate` and `compassBearing`
 * map handlers (eg. `map.compassBearing.enable()`).
 * 
 * @class L.Control.Rotate
 * 
 * @extends L.Control
 * 
 * @property {string} [position='topleft'] Leaflet control position.
 * @property {boolean} [closeOnZeroBearing=true] Hide the control when both bearing and pitch are zero.
 * @property {boolean} [visualizePitch=true] Tilt the icon with the pitch, reset the pitch on click and change it on drag.
 * 
 * @since leaflet-rotate (v0.1.0)
 */

L.Control.Rotate = L.Control.extend({

    options: {
        position: 'topleft',
        closeOnZeroBearing: true,
        visualizePitch: true,
    },

    /**
     * Create the control element and subscribe to map rotation and pitch.
     * 
     * @param {L.Map} map
     * 
     * @returns {HTMLElement} Control container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    onAdd(map) {
        const container = this._container = L.DomUtil.create('div', 'leaflet-control-rotate leaflet-bar');

        const arrow = this._arrow = L.DomUtil.create('span', 'leaflet-control-rotate-arrow');

        arrow.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,%3Csvg width='29' height='29' viewBox='0 0 29 29' xmlns='http://www.w3.org/2000/svg' fill='%23333'%3E%3Cpath d='M10.5 14l4-8 4 8h-8z'/%3E%3Cpath d='M10.5 16l4 8 4-8h-8z' fill='%23ccc'/%3E%3C/svg%3E")`;
        arrow.style.display = 'block';
        arrow.style.width = '100%';
        arrow.style.height = '100%';
        arrow.style.backgroundRepeat = 'no-repeat';
        arrow.style.backgroundPosition = '50%';
        arrow.style.pointerEvents = 'none';

        const link = this._link = L.DomUtil.create('a', 'leaflet-control-rotate-toggle', container);
        link.appendChild(arrow);
        link.href = '#';
        link.title = this.options.visualizePitch ? 'Reset bearing and pitch' : 'Reset bearing to north';
        link.setAttribute('role', 'button');
        link.setAttribute('aria-label', link.title);
        link.style.cursor = 'grab';
        link.style.touchAction = 'none';

        this._onPointerMoveBound = this._onPointerMove.bind(this);
        this._onPointerUpBound = this._onPointerUp.bind(this);

        L.DomEvent
            .on(link, 'dblclick contextmenu', L.DomEvent.stop)
            .on(link, 'click', L.DomEvent.stop)
            .on(link, 'click', this._onClick, this)
            .on(link, 'click', this._refocusOnMap, this);
        link.addEventListener('pointerdown', this._onPointerDown.bind(this));

        map.on('rotate pitch', this._restyle, this);
        this._map = map;
        this._restyle();

        return container;
    },

    /**
     * Remove the map event listener when the control is detached.
     * 
     * @param {L.Map} map
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    onRemove(map) {
        this._onPointerUp();
        map.off('rotate pitch', this._restyle, this);
    },

    /**
     * Reset bearing (and pitch) unless the click ends a drag.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onClick() {
        if (this._moved) {
            this._moved = false;
            return;
        }
        if (!this._map || !this._map._rotate) { return; }
        if (this.options.visualizePitch) {
            this._map.resetNorthPitch();
        } else {
            this._map.resetNorth();
        }
    },

    /**
     * Start dragging the control (mouse, pen or touch).
     * 
     * @param {PointerEvent} e
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerDown(e) {
        if (!this._map || !this._map._rotate || e.button > 0 || this._pointerId != null) { return; }
        e.preventDefault();
        e.stopPropagation();
        this._pointerId = e.pointerId;
        this._startX = this._lastX = e.clientX;
        this._startY = this._lastY = e.clientY;
        this._moved = false;
        this._link.style.cursor = 'grabbing';
        document.addEventListener('pointermove', this._onPointerMoveBound);
        document.addEventListener('pointerup', this._onPointerUpBound);
        document.addEventListener('pointercancel', this._onPointerUpBound);
    },

    /**
     * Horizontal movement changes the bearing, vertical movement the pitch.
     * 
     * @param {PointerEvent} e
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerMove(e) {
        if (e.pointerId !== this._pointerId) { return; }
        e.preventDefault();
        if (!this._moved && Math.hypot(e.clientX - this._startX, e.clientY - this._startY) < 3) { return; }
        if (!this._moved) {
            this._moved = true;
            this._map._stopPitchBearingAnimation();
        }
        const map = this._map,
            pitch = this.options.visualizePitch ? map.getPitch() + (this._lastY - e.clientY) * 0.5 : map.getPitch();
        map._setPitchAndBearing(pitch, map.getBearing() + (e.clientX - this._lastX) * 0.8);
        this._lastX = e.clientX;
        this._lastY = e.clientY;
    },

    /**
     * Stop dragging and remove document listeners.
     * 
     * @param {PointerEvent} [e]
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerUp(e) {
        if (e && e.pointerId !== this._pointerId) { return; }
        document.removeEventListener('pointermove', this._onPointerMoveBound);
        document.removeEventListener('pointerup', this._onPointerUpBound);
        document.removeEventListener('pointercancel', this._onPointerUpBound);
        // a drag ending outside the button produces no click
        if (e && this._moved && !this._link.contains(e.target)) { this._moved = false; }
        delete this._pointerId;
        if (this._link) {
            this._link.style.cursor = 'grab';
            this._restyle();
        }
    },

    /**
     * Update the icon (bearing and pitch) and the control visibility.
     * 
     * @listens L.Map#rotate
     * @listens L.Map#pitch
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _restyle() {
        const map = this._map;
        if (!map) { return; }
        if (!map.options.rotate) {
            this._link.classList.add('leaflet-disabled');
            return;
        }

        const bearing = map.getBearing(),
            pitch = map.getPitch();

        this._arrow.style.transform = this.options.visualizePitch && pitch
            ? `scale(${1 / Math.sqrt(Math.cos(pitch * Math.PI / 180))}) rotateX(${pitch}deg) rotate(${bearing}deg)`
            : `rotate(${bearing}deg)`;

        if (this.options.closeOnZeroBearing) {
            const hidden = !bearing && !(this.options.visualizePitch && pitch) && this._pointerId == null;
            this._container.style.display = hidden ? 'none' : 'block';
        }
    },

});
if (L.control) {
    L.control.rotate = options => new L.Control.Rotate(options);
}

L.Map.mergeOptions({
    /**
     * Add the rotation control automatically. Set to `false` to disable,
     * or pass an options object to configure the control.
     * 
     * @type {boolean|Object}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateControl: true,
});

/**
 * Add the configured rotation control to each newly initialized map.
 * 
 * @since leaflet-rotate (v0.1.0)
 */
L.Map.addInitHook(function() {
    if (this.options.rotateControl) {
        const options = typeof this.options.rotateControl === 'object' ? this.options.rotateControl : {};
        this.rotateControl = new L.Control.Rotate(options);
        this.addControl(this.rotateControl);
    }
});

