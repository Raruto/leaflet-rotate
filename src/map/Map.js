/**
 * @external L.Map
 * 
 * @see https://github.com/Leaflet/Leaflet/blob/v1.9.3/src/map/Map.js
 */

const mapProto = L.extend({}, L.Map.prototype);

L.Map.mergeOptions({ rotate: false, bearing: 0, });

L.Map.include({

    /**
     * @param {(HTMLElement|String)} id html selector
     * @param {Object} [options={}] leaflet map options
     */
    initialize: function(id, options) {
        if (options.rotate) {
            this._rotate = true;
            this._bearing = 0;
        }
        mapProto.initialize.apply(this, arguments);
        if(this.options.rotate){
          this.setBearing(this.options.bearing);
        }
    },

    /**
     * Given a pixel coordinate relative to the map container,
     * returns the corresponding pixel coordinate relative to
     * the [origin pixel](#map-getpixelorigin).
     * 
     * @param {L.Point} point pixel screen coordinates
     * @returns {L.Point} transformed pixel point
     */
    containerPointToLayerPoint: function(point) {
        if (!this._rotate) {
            return mapProto.containerPointToLayerPoint.apply(this, arguments);
        }
        return L.point(point)
            .subtract(this._getMapPanePos())
            .rotateFrom(-this._bearing, this._getRotatePanePos())
            .subtract(this._getRotatePanePos());
    },

    /**
     * Given a pixel coordinate relative to the [origin pixel](#map-getpixelorigin),
     * returns the corresponding pixel coordinate relative to the map container.
     * 
     * @param {L.Point} point pixel screen coordinates
     * @returns {L.Point} transformed pixel point
     */
    layerPointToContainerPoint: function(point) {
        if (!this._rotate) {
            return mapProto.layerPointToContainerPoint.apply(this, arguments);
        }
        return L.point(point)
            .add(this._getRotatePanePos())
            .rotateFrom(this._bearing, this._getRotatePanePos())
            .add(this._getMapPanePos());
    },

    /**
     * Converts a coordinate from the rotated pane reference system
     * to the reference system of the not rotated map pane.
     * 
     * (rotatePane) --> (mapPane)
     * (rotatePane) --> (norotatePane)
     * 
     * @param {L.Point} point pixel screen coordinates
     * @returns {L.Point}
     * 
     * @since leaflet-rotate (v0.1)
     */
    rotatedPointToMapPanePoint: function(point) {
        return L.point(point)
            .rotate(this._bearing)
            ._add(this._getRotatePanePos());
    },

    /**
     * Converts a coordinate from the not rotated map pane reference system
     * to the reference system of the rotated pane.
     * 
     * (mapPane) --> (rotatePane)
     * (norotatePane) --> (rotatePane)
     * 
     * @param {L.Point} point pixel screen coordinates
     * 
     * @since leaflet-rotate (v0.1)
     */
    mapPanePointToRotatedPoint: function(point) {
        return L.point(point)
            ._subtract(this._getRotatePanePos())
            .rotate(-this._bearing);
    },

    // latLngToLayerPoint: function (latlng) {
    //     var projectedPoint = this.project(L.latLng(latlng))._round();
    //     return projectedPoint._subtract(this.getPixelOrigin());
    // },

    // latLngToContainerPoint: function (latlng) {
	// 	return this.layerPointToContainerPoint(this.latLngToLayerPoint(toLatLng(latlng)));
	// },

    /**
     * Given latlng bounds, returns the bounds in projected pixel
     * relative to the map container.
     * 
     * @see https://github.com/ronikar/Leaflet/blob/5c480ef959b947c3beed7065425a5a36c486262b/src/map/Map.js#L1114-L1135
     * 
     * @param {L.LatLngBounds} bounds 
     * @returns {L.Bounds}
     * 
     * @since leaflet-rotate (v0.2)
     */
    mapBoundsToContainerBounds: function (bounds) {
        if (!this._rotate && mapProto.mapBoundsToContainerBounds) {
            return mapProto.mapBoundsToContainerBounds.apply(this, arguments);
        }

        // const nw = this.latLngToContainerPoint(bounds.getNorthWest()),
        //       ne = this.latLngToContainerPoint(bounds.getNorthEast()),
        //       sw = this.latLngToContainerPoint(bounds.getSouthWest()),
        //       se = this.latLngToContainerPoint(bounds.getSouthEast());

        // same as `this.latLngToContainerPoint(latlng)` but with floating point precision
        const origin = this.getPixelOrigin();
        const nw = this.layerPointToContainerPoint(this.project(bounds.getNorthWest())._subtract(origin)),
              ne = this.layerPointToContainerPoint(this.project(bounds.getNorthEast())._subtract(origin)),
              sw = this.layerPointToContainerPoint(this.project(bounds.getSouthWest())._subtract(origin)),
              se = this.layerPointToContainerPoint(this.project(bounds.getSouthEast())._subtract(origin));

        return L.bounds([
            L.point(Math.min(nw.x, ne.x, se.x, sw.x), Math.min(nw.y, ne.y, se.y, sw.y)), // [ minX, minY ]
            L.point(Math.max(nw.x, ne.x, se.x, sw.x), Math.max(nw.y, ne.y, se.y, sw.y))  // [ maxX, maxY ]
        ]);
    },

    /**
     * Returns geographical bounds visible in the current map view
     * 
     * @TODO find out  if map bounds calculated by `L.Map::getBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     * 
     * @see https://github.com/fnicollet/Leaflet/issues/7
     * 
     * @returns {L.LatLngBounds}
     */
    getBounds: function() {
        if (!this._rotate) {
            return mapProto.getBounds.apply(this, arguments);
        }

        // SEE: https://github.com/fnicollet/Leaflet/pull/22
        //
        // var bounds = this.getPixelBounds(),
        // sw = this.unproject(bounds.getBottomLeft()),
        // ne = this.unproject(bounds.getTopRight());
        // return new LatLngBounds(sw, ne);
        //

        // LatLngBounds' constructor automatically
        // extends the bounds to fit the passed points
        var size = this.getSize();
        return new L.LatLngBounds([
            this.containerPointToLatLng([0, 0]),           // topleft
            this.containerPointToLatLng([size.x, 0]),      // topright 
            this.containerPointToLatLng([size.x, size.y]), // bottomright
            this.containerPointToLatLng([0, size.y]),      // bottomleft
        ]);
    },

    /**
     * Returns the bounds of the current map view in projected pixel
     * coordinates (sometimes useful in layer and overlay implementations).
     * 
     * @TODO find out if map bounds calculated by `L.Map::getPixelBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     * 
     * @returns {L.Bounds}
     */
    // getPixelBounds(center, zoom) {
    //     // const topLeftPoint = map.containerPointToLayerPoint(this._getTopLeftPoint());
    //     const topLeftPoint = this._getTopLeftPoint(center, zoom);
    //       return new L.Bounds(topLeftPoint, topLeftPoint.add(this.getSize()));
    // },

    /**
     * Change map rotation
     * 
     * @param {number} theta map degrees
     * 
     * @since leaflet-rotate (v0.1)
     */
    setBearing: function(theta) {
        if (!L.Browser.any3d || !this._rotate) { return; }

        var bearing = L.Util.wrapNum(theta, [0, 360]) * L.DomUtil.DEG_TO_RAD,
            center = this._getPixelCenter(),
            oldPos = this._getRotatePanePos().rotateFrom(-this._bearing, center),
            newPos = oldPos.rotateFrom(bearing, center);

        // CSS transform
        L.DomUtil.setPosition(this._rotatePane, oldPos, bearing, center);

        this._pivot = center;
        this._bearing = bearing;
        this._rotatePanePos = newPos;

        this.fire('rotate');
    },

    /**
     * Get current map rotation
     * 
     * @returns {number} theta map degrees
     * 
     * @since leaflet-rotate (v0.1)
     */
    getBearing: function() {
        return this._bearing * L.DomUtil.RAD_TO_DEG;
    },

    /**
     * Creates a new [map pane](#map-pane) with the given name if it doesn't
     * exist already, then returns it. The pane is created as a child of
     * `container`, or as a child of the main map pane if not set.
     * 
     * @param {String} name leaflet pane
     * @param {HTMLElement} [container] parent element
     * @returns {HTMLElement} pane container
     */
    // createPane: function(name, container) {
    //     if (!this._rotate || name == 'mapPane') {
    //         return mapProto.createPane.apply(this, arguments);
    //     }
    //     // init "rotatePane"
    //     if (!this._rotatePane) {
    //         // this._pivot = this.getSize().divideBy(2);
    //         this._rotatePane = mapProto.createPane.call(this, 'rotatePane', this._mapPane);
    //         L.DomUtil.setPosition(this._rotatePane, new L.Point(0, 0), this._bearing, this._pivot);
    //     }
    //     return mapProto.createPane.call(this, name, container || this._rotatePane);
    // },

    /**
     * Panes are DOM elements used to control the ordering of layers on
     * the map. You can access panes with [`map.getPane`](#map-getpane)
     * or [`map.getPanes`](#map-getpanes) methods. New panes can be created
     * with the [`map.createPane`](#map-createpane) method.
     * 
     * Every map has the following default panes that differ only in zIndex:
     * 
     * - mapPane     [HTMLElement = 'auto'] - Pane that contains all other map panes
     * - tilePane    [HTMLElement = 2]      - Pane for tile layers
     * - overlayPane [HTMLElement = 4]      - Pane for overlays like polylines and polygons
     * - shadowPane  [HTMLElement = 5]      - Pane for overlay shadows (e.g. marker shadows)
     * - markerPane  [HTMLElement = 6]      - Pane for marker icons
     * - tooltipPane [HTMLElement = 650]    - Pane for tooltips.
     * - popupPane   [HTMLElement = 700]    - Pane for popups.
     */
    _initPanes: function() {
        var panes = this._panes = {};
        this._paneRenderers = {};

        this._mapPane = this.createPane('mapPane', this._container);
        L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));

        if (this._rotate) {
            this._rotatePane = this.createPane('rotatePane', this._mapPane);
            this._norotatePane = this.createPane('norotatePane', this._mapPane);
            // rotatePane
            this.createPane('tilePane', this._rotatePane);
            this.createPane('overlayPane', this._rotatePane);
            // norotatePane
            this.createPane('shadowPane', this._norotatePane);
            this.createPane('markerPane', this._norotatePane);
            this.createPane('tooltipPane', this._norotatePane);
            this.createPane('popupPane', this._norotatePane);
        } else {
            this.createPane('tilePane');
            this.createPane('overlayPane');
            this.createPane('shadowPane');
            this.createPane('markerPane');
            this.createPane('tooltipPane');
            this.createPane('popupPane');
        }

        if (!this.options.markerZoomAnimation) {
            L.DomUtil.addClass(panes.markerPane, 'leaflet-zoom-hide');
            L.DomUtil.addClass(panes.shadowPane, 'leaflet-zoom-hide');
        }
    },

    /**
     * Pans the map the minimum amount to make the `latlng` visible. Use
     * padding options to fit the display to more restricted bounds.
     * If `latlng` is already within the (optionally padded) display bounds,
     * the map will not be panned.
     * 
     * @see https://github.com/Raruto/leaflet-rotate/issues/18
     * 
     * @param {L.LatLng} latlng coordinates
     * @param {Object} [options={}] padding options
     * 
     * @returns {L.Map} current map instance
     */
    panInside(latlng, options) {
        if (!this._rotate || Math.abs(this._bearing).toFixed(1) < 0.1) {
            return mapProto.panInside.apply(this, arguments);
        }

        options = options || {};

        const paddingTL = L.point(options.paddingTopLeft || options.padding || [0, 0]),
            paddingBR = L.point(options.paddingBottomRight || options.padding || [0, 0]),
            /** @TODO use mapProto.panInside */
            // pixelPoint = this.project(latlng),
            // pixelBounds = this.getPixelBounds(),
            // pixelCenter = this.project(this.getCenter()),
            rect = this._container.getBoundingClientRect(),
            pixelPoint = this.latLngToContainerPoint(latlng),
            pixelBounds = L.bounds([ L.point(rect), L.point(rect).add(this.getSize()) ]),
            pixelCenter = pixelBounds.getCenter(),
            //
            paddedBounds = L.bounds([pixelBounds.min.add(paddingTL), pixelBounds.max.subtract(paddingBR)]),
            paddedSize = paddedBounds.getSize();
        
        if (!paddedBounds.contains(pixelPoint)) {
            this._enforcingBounds = true;
            const centerOffset = pixelPoint.subtract(paddedBounds.getCenter());
            const offset = paddedBounds.extend(pixelPoint).getSize().subtract(paddedSize);
            pixelCenter.x += centerOffset.x < 0 ? -offset.x : offset.x;
            pixelCenter.y += centerOffset.y < 0 ? -offset.y : offset.y;
            /** @TODO use mapProto.panInside */
            // this.panTo(this.unproject(pixelCenter), options);
            this.panTo(this.containerPointToLatLng(pixelCenter), options);
            //
            this._enforcingBounds = false;
        }
        return this;
    },

    /**
     * Pans the map to the closest view that would lie inside the given bounds
     * (if it's not already), controlling the animation using the options specific,
     * if any.
     * 
     * @TODO check if map bounds calculated by `L.Map::panInsideBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     * 
     * @param {L.LatLngBounds} bounds coordinates
     * @param {Object} [options] pan options
     * @returns {L.Map} current map instance
     */
    // panInsideBounds: function (bounds, options) {
    //     this._enforcingBounds = true;
    //     var center = this.getCenter(),
    //         newCenter = this._limitCenter(center, this._zoom, L.latLngBounds(bounds));
    //
    //     if (!center.equals(newCenter)) {
    //         this.panTo(newCenter, options);
    //     }
    //
    //     this._enforcingBounds = false;
    //     return this;
    // },

    // adjust center for view to get inside bounds
    // _limitCenter(center, zoom, bounds) {
    //
    //     if (!bounds) { return center; }
    //
    //     const centerPoint = this.project(center, zoom),
    //         viewHalf = this.getSize().divideBy(2),
    //         viewBounds = new Bounds(centerPoint.subtract(viewHalf), centerPoint.add(viewHalf)),
    //         offset = this._getBoundsOffset(viewBounds, bounds, zoom);
    //
    //     // If offset is less than a pixel, ignore.
    //     // This prevents unstable projections from getting into
    //     // an infinite loop of tiny offsets.
    //     if (Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1) {
    //             return center;
    //     }
    //
    //     return this.unproject(centerPoint.add(offset), zoom);
    // },

    // @method flyToBounds(bounds: LatLngBounds, options?: fitBounds options): this
    // Sets the view of the map with a smooth animation like [`flyTo`](#map-flyto),
    // but takes a bounds parameter like [`fitBounds`](#map-fitbounds).
    // flyToBounds(bounds, options) {
    //     const target = this._getBoundsCenterZoom(bounds, options);
    //     return this.flyTo(target.center, target.zoom, options);
    // },

    // _getBoundsCenterZoom(bounds, options) {
    //
    //     options = options || {};
    //     bounds = bounds.getBounds ? bounds.getBounds() : toLatLngBounds(bounds);
    //
    //     const paddingTL = L.point(options.paddingTopLeft || options.padding || [0, 0]),
    //           paddingBR = L.point(options.paddingBottomRight || options.padding || [0, 0]);
    //
    //     let zoom = this.getBoundsZoom(bounds, false, paddingTL.add(paddingBR));
    //
    //     zoom = (typeof options.maxZoom === 'number') ? Math.min(options.maxZoom, zoom) : zoom;
    //
    //     if (zoom === Infinity) {
    //         return { center: bounds.getCenter(), zoom };
    //     }
    //
    //     return { center, zoom };
    //
    // },

    /**
     * Returns the maximum zoom level on which the given bounds fit to the map
     * view in its entirety. If `inside` (optional) is set to `true`, the method
     * instead returns the minimum zoom level on which the map view fits into
     * the given bounds in its entirety.
     * 
     * @param {L.LatLngBounds} bounds
     * @param {Boolean} [inside=false]
     * @param {L.Point} [padding=[0,0]]
     * 
     * @returns {Number} zoom level
     */
    getBoundsZoom(bounds, inside, padding) {
        if (!this._rotate || Math.abs(this._bearing).toFixed(1) < 0.1) {
            return mapProto.getBoundsZoom.apply(this, arguments);
        }

        bounds = L.latLngBounds(bounds);
        padding = L.point(padding || [0, 0]);

        let zoom = this.getZoom() || 0;
        const min = this.getMinZoom(),
                max = this.getMaxZoom(),
                /** @TODO use mapProto.getBoundsZoom */
                // nw = bounds.getNorthWest(),
                // se = bounds.getSouthEast(),
                // size = this.getSize().subtract(padding),
                // boundsSize = L.bounds(this.project(se, zoom), this.project(nw, zoom)).getSize(),
                size = this.getSize().subtract(padding),
                boundsSize = this.mapBoundsToContainerBounds(bounds).getSize(),
                snap = this.options.zoomSnap,
                scalex = size.x / boundsSize.x,
                scaley = size.y / boundsSize.y,
                scale = inside ? Math.max(scalex, scaley) : Math.min(scalex, scaley);

        zoom = this.getScaleZoom(scale, zoom);

        if (snap) {
            zoom = Math.round(zoom / (snap / 100)) * (snap / 100); // don't jump if within 1% of a snap level
            zoom = inside ? Math.ceil(zoom / snap) * snap : Math.floor(zoom / snap) * snap;
        }

        return Math.max(min, Math.min(max, zoom));
    },

    /**
     * Layer point of the current center
     * 
     * @returns {L.Point} layer center
     */
    // _getCenterLayerPoint: function () {
    //    return this.containerPointToLayerPoint(this.getSize()._divideBy(2));
    // },

    /**
     * Offset of the specified place to the current center in pixels
     * 
     * @param {L.LatLng} latlng map coordinates
     */
    _getCenterOffset: function(latlng) {
        var centerOffset = mapProto._getCenterOffset.apply(this, arguments);
        if (this._rotate) {
            centerOffset = centerOffset.rotate(this._bearing);
        }
        return centerOffset;
    },

    /**
     * @since leaflet-rotate (v0.1)
     */
    _getRotatePanePos: function() {
        return this._rotatePanePos || new L.Point(0, 0);
        // return L.DomUtil.getPosition(this._rotatePane) || new L.Point(0, 0);
    },

    // _latLngToNewLayerPoint(latlng, zoom, center) {
    //    const topLeft = this._getNewPixelOrigin(center, zoom);
    //    return this.project(latlng, zoom)._subtract(topLeft);
    //},

    _getNewPixelOrigin: function(center, zoom) {
        if (!this._rotate) {
            return mapProto._getNewPixelOrigin.apply(this, arguments);
        }
        var viewHalf = this.getSize()._divideBy(2);
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
     * @return {L.Point} map pivot point (center)
     */
    _getPixelCenter: function() {
        if (!this._rotate && mapProto._getPixelCenter) {
            return mapProto._getPixelCenter.apply(this, arguments);
        }
        return this.getSize()._divideBy(2)._subtract(this._getMapPanePos());
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
            /** @TODO use mapProto._handleGeolocationResponse */
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
            /** @TODO use mapProto._handleGeolocationResponse */
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

    /**
     * @see https://github.com/ronikar/Leaflet/blob/5c480ef959b947c3beed7065425a5a36c486262b/src/geo/LatLngBounds.js#L253-L264
     * 
     * @param {L.Bounds} points 
     * @returns {L.Bounds}
     */
    // toCircumscribedBounds(points) {
    //     var minX = points.reduce(function (pv, v) { return Math.min(pv, v.x); }, points[0].x),
    //         maxX = points.reduce(function (pv, v) { return Math.max(pv, v.x); }, points[0].x),
    //         minY = points.reduce(function (pv, v) { return Math.min(pv, v.y); }, points[0].y),
    //         maxY = points.reduce(function (pv, v) { return Math.max(pv, v.y); }, points[0].y);
    //
    //     return L.bounds(L.point(minX, minY), L.point(maxX, maxY));
    // },

});
