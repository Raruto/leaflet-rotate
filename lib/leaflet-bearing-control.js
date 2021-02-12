// A tri-state control for map rotation. States are:
// Locked (default)
// Unlocked (user can pinch-rotate)
// Follow (rotation follows device orientation, if available)

L.Control.Bearing = L.Control.extend({

    options: {
        position: 'topleft',
        closeOnZeroBearing: true
    },

    onAdd: function(map) {
        this._onDeviceOrientation = L.Util.throttle(this._unthrottledOnDeviceOrientation, 100, this);

        var container = this._container = L.DomUtil.create('div', 'leaflet-control-rotate leaflet-bar');

        // 			this.button = L.Control.Zoom.prototype._createButton.call(this, 'R', 'leaflet-control-rotate', 'leaflet-control-rotate', container, this._toggleLock);

        var glyphs = this._glyphs = L.DomUtil.create('div', 'leaflet-control-rotate-glyphs');
        var north = this._north = L.DomUtil.create('div', 'leaflet-control-rotate-north');
        north.innerHTML = 'N';

        var arrow = this._arrow = L.DomUtil.create('div', 'leaflet-control-rotate-arrow');
        arrow.innerHTML = '&uarr;';


        // Copy-pasted from L.Control.Zoom
        var link = this._link = L.DomUtil.create('a', 'leaflet-control-rotate-toggle', container);
        glyphs.appendChild(north);
        glyphs.appendChild(arrow);
        link.appendChild(glyphs);
        link.href = '#';
        link.title = 'leaflet-control-rotate-toggle';


        L.DomEvent
            .on(link, 'mousedown dblclick', L.DomEvent.stopPropagation)
            .on(link, 'click', L.DomEvent.stop)
            .on(link, 'click', this._cycleState, this)
            .on(link, 'click', this._refocusOnMap, this);

        if (!L.Browser.any3d) {
            L.DomUtil.addClass(link, 'leaflet-disabled');
        }

        this._restyle();

        map.on('rotate', this._restyle.bind(this));

        // State flag
        this._follow = false;
        this._canFollow = false;

        if (this.options.closeOnZeroBearing && map.getBearing() === 0) {
            container.style.display = 'none';
        }

        return container;
    },

    _cycleState: function(ev) {
        var map = this._map;

        if (!map) { return; }

        if (!map.touchRotate.enabled() && !map.compassBearing.enabled()) {
            // Go from disabled to touch
            map.touchRotate.enable();

            // 				console.log('state is now: touch rotate');
        } else {

            if (!map.compassBearing.enabled()) {
                // Go from touch to compass
                map.touchRotate.disable();
                map.compassBearing.enable();

                // 					console.log('state is now: compass');

                // It is possible that compass is not supported. If so,
                // the hangler will automatically go from compass to disabled.
            } else {
                // Go from compass to disabled
                map.compassBearing.disable();

                // 					console.log('state is now: locked');

                map.setBearing(0);
                if (this.options.closeOnZeroBearing) {
                    map.touchRotate.enable();
                }
            }
        }
        this._restyle();
    },

    _restyle: function() {
        if (this._map.options.rotate) {
            var bearing = this._map.getBearing();
            this._link.style.color = 'inherit';
            if (this.options.closeOnZeroBearing && bearing) {
                this._container.style.display = 'block';
            }

            var cssTransform = 'rotate(' + bearing + 'deg)';
            this._glyphs.style.transform = cssTransform;

            if (map.compassBearing.enabled()) {
                this._glyphs.style.color = 'orange';
            } else if (map.touchRotate.enabled()) {
                this._glyphs.style.color = 'inherit';
            } else {
                this._glyphs.style.color = 'grey';
                if (this.options.closeOnZeroBearing && map.getBearing() === 0) {
                    this._container.style.display = 'none';
                }
            }
        } else {
            L.DomUtil.addClass(link, 'leaflet-disabled');
        }
    }
});

L.control.bearing = function(options) {
    return new L.Control.Bearing(options);
};
