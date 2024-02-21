/**
 * A tri-state control for map rotation, states are:
 * 
 * - Locked (default)
 * - Unlocked (user can pinch-rotate)
 * - Follow (rotation follows device orientation, if available)
 * 
 * @typedef L.Control.Rotate
 */

L.Control.Rotate = L.Control.extend({

    options: {
        position: 'topleft',
        closeOnZeroBearing: true
    },

    onAdd: function(map) {
        var container = this._container = L.DomUtil.create('div', 'leaflet-control-rotate leaflet-bar');

        // this.button = L.Control.Zoom.prototype._createButton.call(this, 'R', 'leaflet-control-rotate', 'leaflet-control-rotate', container, this._toggleLock);

        var arrow = this._arrow = L.DomUtil.create('span', 'leaflet-control-rotate-arrow');

        arrow.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,%3Csvg width='29' height='29' viewBox='0 0 29 29' xmlns='http://www.w3.org/2000/svg' fill='%23333'%3E%3Cpath d='M10.5 14l4-8 4 8h-8z'/%3E%3Cpath d='M10.5 16l4 8 4-8h-8z' fill='%23ccc'/%3E%3C/svg%3E")`;
        arrow.style.cursor = 'grab';
        arrow.style.display = 'block';
        arrow.style.width = '100%';
        arrow.style.height = '100%';
        arrow.style.backgroundRepeat = 'no-repeat';
        arrow.style.backgroundPosition = '50%';

        // Copy-pasted from L.Control.Zoom
        var link = this._link = L.DomUtil.create('a', 'leaflet-control-rotate-toggle', container);
        link.appendChild(arrow);
        link.href = '#';
        link.title = 'Rotate map';

        L.DomEvent
            .on(link, 'dblclick', L.DomEvent.stopPropagation)
            .on(link, 'mousedown', this._handleMouseDown, this)
            .on(link, 'click', L.DomEvent.stop)
            .on(link, 'click', this._cycleState, this)
            .on(link, 'click', this._refocusOnMap, this);

        if (!L.Browser.any3d) {
            L.DomUtil.addClass(link, 'leaflet-disabled');
        }

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
    
    onRemove: function(map) {
        map.off('rotate', this._restyle, this);
    },

    _handleMouseDown: function(e) {
        L.DomEvent.stop(e);
        this.dragging = true;
        this.dragstartX = e.pageX;
        this.dragstartY = e.pageY;
        L.DomEvent
            .on(document, 'mousemove', this._handleMouseDrag, this)
            .on(document, 'mouseup', this._handleMouseUp, this);
    },

    _handleMouseUp: function(e) {
        L.DomEvent.stop(e);
        this.dragging = false;

        L.DomEvent
            .off(document, 'mousemove', this._handleMouseDrag, this)
            .off(document, 'mouseup', this._handleMouseUp, this);
    },

    _handleMouseDrag: function(e) {
        if (!this.dragging) { return; }
        var deltaX = e.clientX - this.dragstartX;
        this._map.setBearing(deltaX);
    },

    _cycleState: function(ev) {
        if (!this._map) {
            return;
        }

        var map = this._map;

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

    _restyle: function() {
        if (!this._map.options.rotate) {
            L.DomUtil.addClass(this._link, 'leaflet-disabled');
        } else {
            var map = this._map;
            var bearing = map.getBearing();

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

L.control.rotate = function(options) {
    return new L.Control.Rotate(options);
};

L.Map.mergeOptions({
    rotateControl: true,
});

L.Map.addInitHook(function() {
    if (this.options.rotateControl) {
        var options = typeof this.options.rotateControl === 'object' ? this.options.rotateControl : {};
        this.rotateControl = L.control.rotate(options);
        this.addControl(this.rotateControl);
    }
});
