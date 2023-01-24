/**
 * L.Map
 */
const mapProto = L.extend({}, L.Map.prototype);

L.Map.mergeOptions({ rotate: false, bearing: 0, });

/**
 * @TODO rechek this changes from leaflet@v1.9.3
 * 
 * @see https://github.com/Leaflet/Leaflet/compare/v1.7.0...v1.9.3
 */
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

    // @method containerPointToLayerPoint(point: Point): Point
    // Given a pixel coordinate relative to the map container, returns the corresponding
    // pixel coordinate relative to the [origin pixel](#map-getpixelorigin).
    containerPointToLayerPoint: function(point) { // (Point)
        if (!this._rotate) {
            return mapProto.containerPointToLayerPoint.call(this, point);
        }
        return L.point(point)
            .subtract(this._getMapPanePos())
            .rotateFrom(-this._bearing, this._getRotatePanePos())
            .subtract(this._getRotatePanePos());
    },

    // @method layerPointToContainerPoint(point: Point): Point
    // Given a pixel coordinate relative to the [origin pixel](#map-getpixelorigin),
    // returns the corresponding pixel coordinate relative to the map container.
    layerPointToContainerPoint: function(point) { // (Point)
        if (!this._rotate) {
            return mapProto.layerPointToContainerPoint.call(this, point);
        }
        return L.point(point)
            .add(this._getRotatePanePos())
            .rotateFrom(this._bearing, this._getRotatePanePos())
            .add(this._getMapPanePos());
    },

    /**
     * @TODO find out  if map bounds calculated by `L.Map::getBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     */

    // @method getBounds(): LatLngBounds
    // Returns the geographical bounds visible in the current map view
    getBounds: function() {
        if (!this._rotate) {
            return mapProto.getBounds.call(this);
        }

        // SEE: https://github.com/fnicollet/Leaflet/pull/22
        //
        // var bounds = this.getPixelBounds(),
        // sw = this.unproject(bounds.getBottomLeft()),
        // ne = this.unproject(bounds.getTopRight());
        // return new LatLngBounds(sw, ne);
        //

        var size = this.getSize();
        var topleft = this.layerPointToLatLng(this.containerPointToLayerPoint([0, 0])),
            topright = this.layerPointToLatLng(this.containerPointToLayerPoint([size.x, 0])),
            bottomright = this.layerPointToLatLng(this.containerPointToLayerPoint([size.x, size.y])),
            bottomleft = this.layerPointToLatLng(this.containerPointToLayerPoint([0, size.y]));

        // Use LatLngBounds' build-in constructor that automatically extends the bounds to fit the passed points
        return new L.LatLngBounds([topleft, topright, bottomright, bottomleft]);
    },

    /**
     * @TODO find out if map bounds calculated by `L.Map::getPixelBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     */

    // @method getPixelBounds(): Bounds
    // Returns the bounds of the current map view in projected pixel
    // coordinates (sometimes useful in layer and overlay implementations).
    // getPixelBounds(center, zoom) {
    //     // const topLeftPoint = map.containerPointToLayerPoint(this._getTopLeftPoint());
    //     const topLeftPoint = this._getTopLeftPoint(center, zoom);
    //       return new L.Bounds(topLeftPoint, topLeftPoint.add(this.getSize()));
    // },

    // Rotation methods
    // setBearing will work with just the 'theta' parameter.
    setBearing: function(theta) {
        if (!L.Browser.any3d || !this._rotate) { return; }

        var rotatePanePos = this._getRotatePanePos();
        var halfSize = this.getSize().divideBy(2);
        this._pivot = this._getMapPanePos().clone().multiplyBy(-1).add(halfSize);

        rotatePanePos = rotatePanePos.rotateFrom(-this._bearing, this._pivot);

        this._bearing = L.Util.wrapNum(theta, [0, 360]) * L.DomUtil.DEG_TO_RAD;
        this._rotatePanePos = rotatePanePos.rotateFrom(this._bearing, this._pivot);

        L.DomUtil.setPosition(this._rotatePane, rotatePanePos, this._bearing, this._pivot);

        this.fire('rotate');
    },

    getBearing: function() {
        return this._bearing * L.DomUtil.RAD_TO_DEG;
    },

    // @section Other Methods
    // @method createPane(name: String, container?: HTMLElement): HTMLElement
    // Creates a new [map pane](#map-pane) with the given name if it doesn't exist already,
    // then returns it. The pane is created as a child of `container`, or
    // as a child of the main map pane if not set.
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

    /**
     * @TODO rewrite `L.Map::panInside()` function in order
     * to restore support for `L.Marker::autoPanOnFocus` option
     * 
     * @see https://github.com/Raruto/leaflet-rotate/issues/18
     */

    // @method panInside(latlng: LatLng, options?: padding options): this
    // Pans the map the minimum amount to make the `latlng` visible. Use
    // padding options to fit the display to more restricted bounds.
    // If `latlng` is already within the (optionally padded) display bounds,
    // the map will not be panned.
    // panInside(latlng, options) {
    //     options = options || {};

    //     // if (!this.getBounds().contains(latlng)) {
    //     //     console.log('panning');
    //     //     this.panTo(latlng, options);
    //     // }

    //     const paddingTL = L.point(options.paddingTopLeft || options.padding || [0, 0]),
    //     paddingBR = L.point(options.paddingBottomRight || options.padding || [0, 0]),
    //     pixelCenter = this.project(this.getCenter()),
    //     pixelPoint = this.project(latlng),
    //     pixelBounds = this.getPixelBounds(),
    //     paddedBounds = L.bounds([pixelBounds.min.add(paddingTL), pixelBounds.max.subtract(paddingBR)]),
    //     paddedSize = paddedBounds.getSize();

    //     if (!paddedBounds.contains(pixelPoint)) {
    //         this._enforcingBounds = true;
    //         const centerOffset = pixelPoint.subtract(paddedBounds.getCenter());
    //         const offset = paddedBounds.extend(pixelPoint).getSize().subtract(paddedSize);
    //         pixelCenter.x += centerOffset.x < 0 ? -offset.x : offset.x;
    //         pixelCenter.y += centerOffset.y < 0 ? -offset.y : offset.y;
    //         this.panTo(this.unproject(pixelCenter), options);
    //         this._enforcingBounds = false;
    //     }
    //     return this;
    // },

    /**
     * @TODO check if map bounds calculated by `L.Map::panInsideBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     */

    // @method panInsideBounds(bounds: LatLngBounds, options?: Pan options): this
    // Pans the map to the closest view that would lie inside the given bounds (if it's not already), controlling the animation using the options specific, if any.
    // panInsideBounds: function (bounds, options) {
    //     this._enforcingBounds = true;
    //     var center = this.getCenter(),
    //         newCenter = this._limitCenter(center, this._zoom, L.latLngBounds(bounds));

    //     if (!center.equals(newCenter)) {
    //         this.panTo(newCenter, options);
    //     }

    //     this._enforcingBounds = false;
    //     return this;
    // },

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
        // return L.DomUtil.getPosition(this._rotatePane) || new L.Point(0, 0);
    },

    _getNewPixelOrigin: function(center, zoom) {
        var viewHalf = this.getSize()._divideBy(2);
        if (!this._rotate) {
            return mapProto._getNewPixelOrigin.call(this, center, zoom);
        }
        return this.project(center, zoom)
            .rotate(this._bearing)
            ._subtract(viewHalf)
            ._add(this._getMapPanePos())
            ._add(this._getRotatePanePos())
            .rotate(-this._bearing)
            ._round();
    },

    /**
     * @since leaflet-rotate (v0.2)
     * 
     * @see src\layer\tile\GridLayer::_getTiledPixelBounds()
     */
    _getNewPixelBounds: function(center, zoom) {
        center = center || this.getCenter();
        zoom = zoom || this.getZoom();
        if (!this._rotate && mapProto._getNewPixelBounds) {
            return mapProto._getNewPixelBounds.apply(this, arguments);
        }
        var mapZoom = this._animatingZoom ? Math.max(this._animateToZoom, this.getZoom()) : this.getZoom(),
            scale = this.getZoomScale(mapZoom, zoom),
            pixelCenter = this.project(center, zoom).floor(),
            size = this.getSize(),
            halfSize = new L.Bounds([
                this.containerPointToLayerPoint([0, 0]).floor(),
                this.containerPointToLayerPoint([size.x, 0]).floor(),
                this.containerPointToLayerPoint([0, size.y]).floor(),
                this.containerPointToLayerPoint([size.x, size.y]).floor()
            ]).getSize().divideBy(scale * 2);

        return new L.Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize));
    },

    /**
     * @since leaflet-rotate (v0.2)
     * 
     * @see src\layer\vector\Renderer::_update()
     */
    _getPaddedPixelBounds: function(padding) {
        if (!this._rotate && mapProto._getPaddedPixelBounds) {
            return mapProto._getPaddedPixelBounds.apply(this, arguments);
        }
        var p = padding,
            size = this.getSize(),
            padMin = size.multiplyBy(-p),
            padMax = size.multiplyBy(1 + p);
            //min = this.containerPointToLayerPoint(size.multiplyBy(-p)).round();

        return new L.Bounds([
            this.containerPointToLayerPoint([padMin.x, padMin.y]).floor(),
            this.containerPointToLayerPoint([padMin.x, padMax.y]).floor(),
            this.containerPointToLayerPoint([padMax.x, padMin.y]).floor(),
            this.containerPointToLayerPoint([padMax.x, padMax.y]).floor()
        ]);
    },

    _handleGeolocationResponse: function(pos) {
        if (!this._container._leaflet_id) { return; }

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
