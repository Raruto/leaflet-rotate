/**
 * L.Map
 */
const mapProto = L.extend({}, L.Map.prototype);

L.Map.mergeOptions({ rotate: false, bearing: 0, });

L.Map.include({

    initialize: function(id, options) { // (HTMLElement or String, Object)
        if (options.rotate) {
            this._rotate = true;
            this._bearing = 0;
        }
        mapProto.initialize.call(this, id, options);
        if(this.options.rotate){
          this.setBearing(this.options.bearing);
        }
    },

    // createPane: function(name, container) {
    //     if (!this._rotate || name == 'mapPane') {
    //         return mapProto.createPane.call(this, name, container);
    //     }
    //     // init "rotatePane"
    //     if (!this._rotatePane) {
    //         // this._pivot = this.getSize().divideBy(2);
    //         this._rotatePane = mapProto.createPane.call(this, 'rotatePane', this._mapPane);
    //         L.DomUtil.setPosition(this._rotatePane, new L.Point(0, 0), this._bearing, this._pivot);
    //     }
    //     return mapProto.createPane.call(this, name, container || this._rotatePane);
    // },

    containerPointToLayerPoint: function(point) { // (Point)
        if (!this._rotate) {
            return mapProto.containerPointToLayerPoint.call(this, point);
        }
        return L.point(point)
            .subtract(this._getMapPanePos())
            .rotateFrom(-this._bearing, this._getRotatePanePos())
            .subtract(this._getRotatePanePos());
    },

    getBounds: function() {
        if (!this._rotate) {
            return mapProto.getBounds.call(this);
        }
        var size = this.getSize();
        var topleft = this.layerPointToLatLng(this.containerPointToLayerPoint([0, 0])),
            topright = this.layerPointToLatLng(this.containerPointToLayerPoint([size.x, 0])),
            bottomright = this.layerPointToLatLng(this.containerPointToLayerPoint([size.x, size.y])),
            bottomleft = this.layerPointToLatLng(this.containerPointToLayerPoint([0, size.y]));

        // Use LatLngBounds' build-in constructor that automatically extends the bounds to fit the passed points
        return new L.LatLngBounds([topleft, topright, bottomright, bottomleft]);
    },

    layerPointToContainerPoint: function(point) { // (Point)
        if (!this._rotate) {
            return mapProto.layerPointToContainerPoint.call(this, point);
        }
        return L.point(point)
            .add(this._getRotatePanePos())
            .rotateFrom(this._bearing, this._getRotatePanePos())
            .add(this._getMapPanePos());
    },

    // Rotation methods
    // setBearing will work with just the 'theta' parameter.
    setBearing: function(theta) {
        if (!L.Browser.any3d || !this._rotate) { return; }

        var rotatePanePos = this._getRotatePanePos();
        var halfSize = this.getSize().divideBy(2);
        this._pivot = this._getMapPanePos().clone().multiplyBy(-1).add(halfSize);

        rotatePanePos = rotatePanePos.rotateFrom(-this._bearing, this._pivot);

        this._bearing = theta * L.DomUtil.DEG_TO_RAD; // TODO: mod 360
        this._rotatePanePos = rotatePanePos.rotateFrom(this._bearing, this._pivot);

        L.DomUtil.setPosition(this._rotatePane, rotatePanePos, this._bearing, this._pivot);

        this.fire('rotate');
    },

    getBearing: function() {
        return this._bearing * L.DomUtil.RAD_TO_DEG;
    },

    _initPanes: function() {
        var panes = this._panes = {};
        this._paneRenderers = {};

        // @section
        //
        // Panes are DOM elements used to control the ordering of layers on the map. You
        // can access panes with [`map.getPane`](#map-getpane) or
        // [`map.getPanes`](#map-getpanes) methods. New panes can be created with the
        // [`map.createPane`](#map-createpane) method.
        //
        // Every map has the following default panes that differ only in zIndex.
        //
        // @pane mapPane: HTMLElement = 'auto'
        // Pane that contains all other map panes

        this._mapPane = this.createPane('mapPane', this._container);
        L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));

        if (this._rotate) {
            this._rotatePane = this.createPane('rotatePane', this._mapPane);
            this._norotatePane = this.createPane('norotatePane', this._mapPane);

            // @pane tilePane: HTMLElement = 2
            // Pane for tile layers
            this.createPane('tilePane', this._rotatePane);
            // @pane overlayPane: HTMLElement = 4
            // Pane for overlays like polylines and polygons
            this.createPane('overlayPane', this._rotatePane);

            // @pane shadowPane: HTMLElement = 5
            // Pane for overlay shadows (e.g. marker shadows)
            this.createPane('shadowPane', this._norotatePane);
            // @pane markerPane: HTMLElement = 6
            // Pane for marker icons
            this.createPane('markerPane', this._norotatePane);
            // @pane tooltipPane: HTMLElement = 650
            // Pane for tooltips.
            this.createPane('tooltipPane', this._norotatePane);
            // @pane popupPane: HTMLElement = 700
            // Pane for popups.
            this.createPane('popupPane', this._norotatePane);
        } else {
            // @pane tilePane: HTMLElement = 2
            // Pane for tile layers
            this.createPane('tilePane');
            // @pane overlayPane: HTMLElement = 4
            // Pane for overlays like polylines and polygons
            this.createPane('overlayPane');
            // @pane shadowPane: HTMLElement = 5
            // Pane for overlay shadows (e.g. marker shadows)
            this.createPane('shadowPane');
            // @pane markerPane: HTMLElement = 6
            // Pane for marker icons
            this.createPane('markerPane');
            // @pane tooltipPane: HTMLElement = 650
            // Pane for tooltips.
            this.createPane('tooltipPane');
            // @pane popupPane: HTMLElement = 700
            // Pane for popups.
            this.createPane('popupPane');
        }

        if (!this.options.markerZoomAnimation) {
            L.DomUtil.addClass(panes.markerPane, 'leaflet-zoom-hide');
            L.DomUtil.addClass(panes.shadowPane, 'leaflet-zoom-hide');
        }
    },

    // @method rotatedPointToMapPanePoint(point: Point): Point
    // Converts a coordinate from the rotated pane reference system
    // to the reference system of the not rotated map pane.
    rotatedPointToMapPanePoint: function(point) {
        return L.point(point).rotate(this._bearing)._add(this._getRotatePanePos());
    },

    // @method mapPanePointToRotatedPoint(point: Point): Point
    // Converts a coordinate from the not rotated map pane reference system
    // to the reference system of the rotated pane.
    mapPanePointToRotatedPoint: function(point) {
        return L.point(point)._subtract(this._getRotatePanePos()).rotate(-this._bearing);
    },

    // offset of the specified place to the current center in pixels
    _getCenterOffset: function(latlng) {
        var centerOffset = mapProto._getCenterOffset.call(this, latlng);
        if (this._rotate) {
            centerOffset = centerOffset.rotate(this._bearing);
        }
        return centerOffset;
    },

    _getRotatePanePos: function() {
        return this._rotatePanePos || new L.Point(0, 0);
    },

    _getNewPixelOrigin: function(center, zoom) {
        var viewHalf = this.getSize()._divideBy(2);
        if (!this._rotate) {
            mapProto._getNewPixelOrigin.call(this, center, zoom);
        }
        return this.project(center, zoom)
            .rotate(this._bearing)
            ._subtract(viewHalf)
            ._add(this._getMapPanePos())
            ._add(this._getRotatePanePos())
            .rotate(-this._bearing)
            ._round();
    },

    _handleGeolocationResponse: function(pos) {
        var lat = pos.coords.latitude,
            lng = pos.coords.longitude,
            // TODO: use mapProto._handleGeolocationResponse
            hdg = pos.coords.heading,
            latlng = new L.LatLng(lat, lng),
            bounds = latlng.toBounds(pos.coords.accuracy),
            options = this._locateOptions;

        if (options.setView) {
            var zoom = this.getBoundsZoom(bounds);
            this.setView(latlng, options.maxZoom ? Math.min(zoom, options.maxZoom) : zoom);
        }

        var data = {
            latlng: latlng,
            bounds: bounds,
            timestamp: pos.timestamp,
            // TODO: use mapProto._handleGeolocationResponse
            heading: hdg
        };

        for (var i in pos.coords) {
            if (typeof pos.coords[i] === 'number') {
                data[i] = pos.coords[i];
            }
        }

        // @event locationfound: LocationEvent
        // Fired when geolocation (using the [`locate`](#map-locate) method)
        // went successfully.
        this.fire('locationfound', data);
    },

});
