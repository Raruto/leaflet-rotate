/**
 * Leaflet control for changing map rotation and selecting a rotation mode.
 * Its modes are:
 * 
 * - Locked: rotation gestures are disabled.
 * - Touch: two-finger rotation is enabled.
 * - Compass: bearing follows device orientation when supported and permitted.
 * 
 * @class L.Control.Rotate
 * 
 * @extends L.Control
 * 
 * @property {string} [position='topleft'] Leaflet control position.
 * @property {boolean} [closeOnZeroBearing=true] Hide the control when bearing is zero.
 */

L.Control.Rotate = L.Control.extend({

    options: {
        position: 'topleft',
        closeOnZeroBearing: true
    },

    /**
     * Create the control element and subscribe to map rotation.
     * 
     * @param {L.Map} map
     * 
     * @returns {HTMLElement} Control container.
     */
    onAdd(map) {
        const container = this._container = L.DomUtil.create('div', 'leaflet-control-rotate leaflet-bar');

        // this.button = L.Control.Zoom.prototype._createButton.call(this, 'R', 'leaflet-control-rotate', 'leaflet-control-rotate', container, this._toggleLock);

        const arrow = this._arrow = L.DomUtil.create('span', 'leaflet-control-rotate-arrow');

        arrow.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,%3Csvg width='29' height='29' viewBox='0 0 29 29' xmlns='http://www.w3.org/2000/svg' fill='%23333'%3E%3Cpath d='M10.5 14l4-8 4 8h-8z'/%3E%3Cpath d='M10.5 16l4 8 4-8h-8z' fill='%23ccc'/%3E%3C/svg%3E")`;
        arrow.style.cursor = 'grab';
        arrow.style.display = 'block';
        arrow.style.width = '100%';
        arrow.style.height = '100%';
        arrow.style.backgroundRepeat = 'no-repeat';
        arrow.style.backgroundPosition = '50%';

        // Copy-pasted from L.Control.Zoom
        const link = this._link = L.DomUtil.create('a', 'leaflet-control-rotate-toggle', container);
        link.appendChild(arrow);
        link.href = '#';
        link.title = 'Rotate map';

        L.DomEvent
            .on(link, 'dblclick', L.DomEvent.stopPropagation)
            .on(link, 'mousedown', this._handleMouseDown, this)
            .on(link, 'click', L.DomEvent.stop)
            .on(link, 'click', this._cycleState, this)
            .on(link, 'click', this._refocusOnMap, this);

        this._restyle();

        map.on('rotate', this._restyle, this);

        // State flag
        this._follow = false;
        this._canFollow = false;

        if (this.options.closeOnZeroBearing && map.getBearing() === 0) {
            container.style.display = 'none';
        }

        return container;
    },
    
    /**
     * Remove the map event listener when the control is detached.
     * 
     * @param {L.Map} map
     */
    onRemove(map) {
        map.off('rotate', this._restyle, this);
    },

    /**
     * Begin dragging the control's bearing indicator.
     * 
     * @param {MouseEvent} e Mouse-down event.
     */
    _handleMouseDown(e) {
        L.DomEvent.stop(e);
        this.dragging = true;
        this.dragstartX = e.pageX;
        this.dragstartY = e.pageY;
        L.DomEvent
            .on(document, 'mousemove', this._handleMouseDrag, this)
            .on(document, 'mouseup', this._handleMouseUp, this);
    },

    /**
     * End bearing-indicator dragging and remove document listeners.
     * 
     * @param {MouseEvent} e Mouse-up event.
     */
    _handleMouseUp(e) {
        L.DomEvent.stop(e);
        this.dragging = false;

        L.DomEvent
            .off(document, 'mousemove', this._handleMouseDrag, this)
            .off(document, 'mouseup', this._handleMouseUp, this);
    },

    /**
     * Set bearing from the horizontal drag distance.
     * 
     * @param {MouseEvent} e Mouse-move event.
     */
    _handleMouseDrag(e) {
        if (!this.dragging) { return; }
        const deltaX = e.clientX - this.dragstartX;
        this._map.setBearing(deltaX);
    },

    /**
     * Cycle through touch, compass, and locked rotation modes.
     * Compass mode may require permission from the browser.
     * 
     * @param {Event} ev Control click event.
     */
    _cycleState(ev) {
        if (!this._map) {
            return;
        }

        const map = this._map;

        // Touch mode
        if (!map.touchRotate.enabled() && !map.compassBearing.enabled()) {
            map.touchRotate.enable();
        }
        
        // Compass mode
        else if (!map.compassBearing.enabled()) {
            map.touchRotate.disable();
            (
                DeviceOrientationEvent && DeviceOrientationEvent.requestPermission
                    ? DeviceOrientationEvent.requestPermission() // iOS compass
                    : Promise.resolve('granted')                 // others
            ).then(state => "granted" === state && map.compassBearing.enable())
        }

        // Locked mode
        else {
            map.compassBearing.disable();
            map.setBearing(0);
            if (this.options.closeOnZeroBearing) {
                map.touchRotate.enable();
            }
        }
        this._restyle();
    },

    /**
     * Update the control icon and visibility to match the current mode.
     * 
     * @listens L.Map#rotate
     */
    _restyle() {
        if (!this._map.options.rotate) {
            this._link.classList.add('leaflet-disabled');
        } else {
            const map = this._map;
            const bearing = map.getBearing();

            this._arrow.style.transform = 'rotate(' + bearing + 'deg)';

            if (bearing && this.options.closeOnZeroBearing) {
                this._container.style.display = 'block';
            }

            // Compass mode
            if (map.compassBearing.enabled()) {
                this._link.style.backgroundColor = 'orange';
            }
            
            // Touch mode
            else if (map.touchRotate.enabled()) {
                this._link.style.backgroundColor = null;
            }

            // Locked mode
            else {
                this._link.style.backgroundColor = 'grey';
                if (0 === bearing && this.options.closeOnZeroBearing) {
                    this._container.style.display = 'none';
                }
            }
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
     */
    rotateControl: true,
});

/**
 * Add the configured rotation control to each newly initialized map.
 */
L.Map.addInitHook(function() {
    if (this.options.rotateControl) {
        const options = typeof this.options.rotateControl === 'object' ? this.options.rotateControl : {};
        this.rotateControl = new L.Control.Rotate(options);
        this.addControl(this.rotateControl);
    }
});
