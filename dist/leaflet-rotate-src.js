(function (factory) {
    typeof define === 'function' && define.amd ? define(factory) :
    factory();
}((function () { 'use strict';

    /**
     * L.DomUtil
     */
    const domUtilProto = L.extend({}, L.DomUtil);

    L.extend(L.DomUtil, {

        setTransform: function(el, offset, scale, bearing, pivot) {
            var pos = offset || new L.Point(0, 0);

            if (!bearing) {
                offset = pos._round();
                return domUtilProto.setTransform.call(this, el, offset, scale);
            }

            pos = pos.rotateFrom(bearing, pivot);

            el.style[L.DomUtil.TRANSFORM] =
                'translate3d(' + pos.x + 'px,' + pos.y + 'px' + ',0)' +
                (scale ? ' scale(' + scale + ')' : '') +
                ' rotate(' + bearing + 'rad)';
        },

        setPosition: function(el, point, bearing, pivot) { // (HTMLElement, Point[, Boolean])
            if (!bearing) {
                return domUtilProto.setPosition.call(this, el, point);
            }

            /*eslint-disable */
            el._leaflet_pos = point;
            /*eslint-enable */

            if (L.Browser.any3d) {
                L.DomUtil.setTransform(el, point, undefined, bearing, pivot);
            } else {
                el.style.left = point.x + 'px';
                el.style.top = point.y + 'px';
            }
        },

        // Constants for rotation
        DEG_TO_RAD: Math.PI / 180,
        RAD_TO_DEG: 180 / Math.PI,

    });

    /**
     * L.Draggable
     */
    L.Draggable.include({

        updateMapBearing: function(mapBearing) {
            this._mapBearing = mapBearing;
        },

    });

    /**
     * L.Point
     */
    L.extend(L.Point.prototype, {

        // Rotate around (0,0) by applying the 2D rotation matrix:
        // ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
        // ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
        // Theta must be given in radians.
        rotate: function(theta) {
            if (!theta) { return this; }
            var sinTheta = Math.sin(theta);
            var cosTheta = Math.cos(theta);

            return new L.Point(
                this.x * cosTheta - this.y * sinTheta,
                this.x * sinTheta + this.y * cosTheta
            );
        },

        // Rotate around (pivot.x, pivot.y) by:
        // 1. subtract (pivot.x, pivot.y)
        // 2. rotate around (0, 0)
        // 3. add (pivot.x, pivot.y) back
        // same as `this.subtract(pivot).rotate(theta).add(pivot)`
        rotateFrom: function(theta, pivot) {
            if (!theta) { return this; }
            var sinTheta = Math.sin(theta);
            var cosTheta = Math.cos(theta);
            var cx = pivot.x,
                cy = pivot.y;
            var x = this.x - cx,
                y = this.y - cy;

            return new L.Point(
                x * cosTheta - y * sinTheta + cx,
                x * sinTheta + y * cosTheta + cy
            );
        },

    });

    /**
     * L.DivOverlay
     */
    const divOverlayProto = L.extend({}, L.DivOverlay.prototype);

    L.DivOverlay.include({

        getEvents: function() {
            return L.extend(divOverlayProto.getEvents.call(this), { rotate: this._updatePosition });
        },

        _updatePosition: function() {
            if (!this._map) { return; }

            var pos = this._map.latLngToLayerPoint(this._latlng),
                offset = L.point(this.options.offset),
                anchor = this._getAnchor();

            if (this._zoomAnimated) {
                // TODO: use divOverlayProto._updatePosition
                if (this._map._rotate) {
                    pos = this._map.rotatedPointToMapPanePoint(pos);
                }
                L.DomUtil.setPosition(this._container, pos.add(anchor));
            } else {
                offset = offset.add(pos).add(anchor);
            }

            var bottom = this._containerBottom = -offset.y,
                left = this._containerLeft = -Math.round(this._containerWidth / 2) + offset.x;

            // bottom position the popup in case the height of the popup changes (images loading etc)
            this._container.style.bottom = bottom + 'px';
            this._container.style.left = left + 'px';
        },

    });

    /**
     * L.Popup
     */
    const popupProto = L.extend({}, L.Popup.prototype);

    L.Popup.include({

        _animateZoom: function(e) {
            if (!this._map._rotate) {
                popupProto._animateZoom.call(this, e);
            }
            var pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center),
                anchor = this._getAnchor();

            pos = this._map.rotatedPointToMapPanePoint(pos);

            L.DomUtil.setPosition(this._container, pos.add(anchor));
        },

        _adjustPan: function() {
            if (!this.options.autoPan || (this._map._panAnim && this._map._panAnim._inProgress)) { return; }

            var map = this._map,
                marginBottom = parseInt(L.DomUtil.getStyle(this._container, 'marginBottom'), 10) || 0,
                containerHeight = this._container.offsetHeight + marginBottom,
                containerWidth = this._containerWidth,
                layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);

            layerPos._add(L.DomUtil.getPosition(this._container));

            // var containerPos = map.layerPointToContainerPoint(layerPos);
            // TODO: use popupProto._adjustPan
            var containerPos = layerPos._add(this._map._getMapPanePos()),
                padding = L.point(this.options.autoPanPadding),
                paddingTL = L.point(this.options.autoPanPaddingTopLeft || padding),
                paddingBR = L.point(this.options.autoPanPaddingBottomRight || padding),
                size = map.getSize(),
                dx = 0,
                dy = 0;

            if (containerPos.x + containerWidth + paddingBR.x > size.x) { // right
                dx = containerPos.x + containerWidth - size.x + paddingBR.x;
            }
            if (containerPos.x - dx - paddingTL.x < 0) { // left
                dx = containerPos.x - paddingTL.x;
            }
            if (containerPos.y + containerHeight + paddingBR.y > size.y) { // bottom
                dy = containerPos.y + containerHeight - size.y + paddingBR.y;
            }
            if (containerPos.y - dy - paddingTL.y < 0) { // top
                dy = containerPos.y - paddingTL.y;
            }

            // @namespace Map
            // @section Popup events
            // @event autopanstart: Event
            // Fired when the map starts autopanning when opening a popup.
            if (dx || dy) {
                map
                    .fire('autopanstart')
                    .panBy([dx, dy]);
            }
        },

    });

    /**
     * L.Tooltip
     */
    const tooltipProto = L.extend({}, L.Tooltip.prototype);

    L.Tooltip.include({

        _updatePosition: function() {
            if (!this._map._rotate) {
                return tooltipProto._updatePosition.call(this);
            }
            var pos = this._map.latLngToLayerPoint(this._latlng);

            pos = this._map.rotatedPointToMapPanePoint(pos);
            this._setPosition(pos);
        },

        _animateZoom: function(e) {
            if (!this._map._rotate) {
                return tooltipProto._animateZoom.call(this, e);
            }
            var pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);

            pos = this._map.rotatedPointToMapPanePoint(pos);
            this._setPosition(pos);
        },

    });

    /**
     * L.Icon
     */
    const iconProto = L.extend({}, L.Icon.prototype);

    L.Icon.include({

        _setIconStyles: function(img, name) {
            var options = this.options;
            var sizeOption = options[name + 'Size'];

            if (typeof sizeOption === 'number') {
                sizeOption = [sizeOption, sizeOption];
            }

            var size = L.point(sizeOption),
                anchor = L.point(name === 'shadow' && options.shadowAnchor || options.iconAnchor ||
                    size && size.divideBy(2, true));

            img.className = 'leaflet-marker-' + name + ' ' + (options.className || '');

            if (anchor) {
                img.style.marginLeft = (-anchor.x) + 'px';
                img.style.marginTop = (-anchor.y) + 'px';
                // TODO: use iconProto._setIconStyles
                img.style[L.DomUtil.TRANSFORM + "Origin"] = anchor.x + "px " + anchor.y + "px 0px";
            }

            if (size) {
                img.style.width = size.x + 'px';
                img.style.height = size.y + 'px';
            }
        },

    });

    /**
     * L.Handler.MarkerDrag
     */
    var markerDragProto;

    var MarkerDrag = {

        _onDragStart: function() {
            if (!this._marker._map._rotate) {
                return markerDragProto._onDragStart.call(this)
            }
            this._draggable.updateMapBearing(this._marker._map._bearing);
        },

        _onDrag: function(e) {
            var marker = this._marker,
                // TODO: use markerDragProto._onDrag
                rotated_marker = marker.options.rotation || marker.options.rotateWithView,
                shadow = marker._shadow,
                iconPos = L.DomUtil.getPosition(marker._icon);

            // TODO: use markerDragProto._onDrag
            // update shadow position
            if (!rotated_marker && shadow) {
                L.DomUtil.setPosition(shadow, iconPos);
            }

            // TODO: use markerDragProto._onDrag
            if (marker._map._rotate) {
                // Reverse calculation from mapPane coordinates to rotatePane coordinates
                iconPos = marker._map.mapPanePointToRotatedPoint(iconPos);
            }
            var latlng = marker._map.layerPointToLatLng(iconPos);

            marker._latlng = latlng;
            e.latlng = latlng;
            e.oldLatLng = this._oldLatLng;

            // TODO: use markerDragProto._onDrag
            if (rotated_marker) marker.setLatLng(latlng); // use `setLatLng` to presisit rotation. low efficiency
            else marker.fire('move', e); // `setLatLng` will trig 'move' event. we imitate here.

            // @event drag: Event
            // Fired repeatedly while the user drags the marker.
            marker
                .fire('drag', e);
        },

        _onDragEnd: function(e) {
            if (this._marker._map._rotate) {
                this._marker.update();
            }
            markerDragProto._onDragEnd.call(this, e);
        },

    };

    /**
     * L.Marker
     */
    const markerProto = L.extend({}, L.Marker.prototype);

    L.Marker.mergeOptions({

        // @option rotation: Number = 0
        // Rotation of this marker in rad
        rotation: 0,

        // @option rotateWithView: Boolean = false
        // Rotate this marker when map rotates
        rotateWithView: false,

    });

    L.Marker.include({

        getEvents: function() {
            return L.extend(markerProto.getEvents.call(this), { rotate: this.update });
        },

        onAdd: function(map) {
            markerProto.onAdd.call(this, map);
            map.on('rotate', this.update, this);
        },

        _initInteraction: function() {
            var ret = markerProto._initInteraction.call(this);
            if (this.dragging && this.dragging.enabled() && this._map && this._map._rotate) {
                // L.Handler.MarkerDrag is used internally by L.Marker to make the markers draggable
                markerDragProto = markerDragProto || Object.getPrototypeOf(this.dragging);
                this.dragging._onDragStart = MarkerDrag._onDragStart.bind(this.dragging);
                this.dragging._onDrag = MarkerDrag._onDrag.bind(this.dragging);
                this.dragging._onDragEnd = MarkerDrag._onDragEnd.bind(this.dragging);
                this.dragging.disable();
                this.dragging.enable();
            }
            return ret;
        },

        _setPos: function(pos) {

            // TODO: use markerProto._setPos
            if (this._map._rotate) {
                pos = this._map.rotatedPointToMapPanePoint(pos);
            }

            // TODO: use markerProto._setPos
            var bearing = this.options.rotation || 0;
            if (this.options.rotateWithView) {
                bearing += this._map._bearing;
            }

            // TODO: use markerProto._setPos
            L.DomUtil.setPosition(this._icon, pos, bearing, pos);

            // TODO: use markerProto._setPos
            if (this._shadow) {
                L.DomUtil.setPosition(this._shadow, pos, bearing, pos);
            }

            this._zIndex = pos.y + this.options.zIndexOffset;

            this._resetZIndex();
        },

        _updateZIndex: function(offset) {
            if (!this._map._rotate) {
                return markerProto._updateZIndex.call(this, offset)
            }
            this._icon.style.zIndex = Math.round(this._zIndex + offset);
        },

        setRotation: function(rotation) {
            this.options.rotation = rotation;
            this.update();
        },

    });

    /**
     * L.GridLayer
     */
    const gridLayerProto = L.extend({}, L.GridLayer.prototype);

    L.GridLayer.include({

        getEvents: function() {
            var events = gridLayerProto.getEvents.call(this);
            if (this._map._rotate && !this.options.updateWhenIdle) {
                if (!this._onRotate) {
                    this._onRotate = L.Util.throttle(this._onMoveEnd, this.options.updateInterval, this);
                }
                events.rotate = this._onRotate;
            }
            return events;
        },

        _getTiledPixelBounds: function(center) {
            if (!this._map._rotate) {
                return gridLayerProto._getTiledPixelBounds.call(this, center);
            }

            var map = this._map,
                mapZoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom(),
                scale = map.getZoomScale(mapZoom, this._tileZoom),
                pixelCenter = map.project(center, this._tileZoom).floor(),
                size = map.getSize(),
                halfSize = new L.Bounds([
                    map.containerPointToLayerPoint([0, 0]).floor(),
                    map.containerPointToLayerPoint([size.x, 0]).floor(),
                    map.containerPointToLayerPoint([0, size.y]).floor(),
                    map.containerPointToLayerPoint([size.x, size.y]).floor()
                ]).getSize().divideBy(scale * 2);

            return new L.Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize));
        },

    });

    /**
     * L.Canvas
     */
    const canvasProto = L.extend({}, L.Canvas.prototype);

    L.Canvas.include({

        onAdd: function() {
            canvasProto.onAdd.call(this);
            // When rotating the canvas itself, it is cleared by some weird reason, so redraw.
            this._map.on('rotate', this._redraw, this);
        },

        onRemove: function() {
            canvasProto.onRemove.call(this);
            this._map.off('rotate', this._redraw, this);
        },

        _update: function() {
            canvasProto._update.call(this);
            // Tell paths to redraw themselves
            this.fire('update');
        },

    });

    /**
     * L.Renderer
     */
    const rendererProto = L.extend({}, L.Renderer.prototype);

    L.Renderer.include({

        onAdd: function() {
            rendererProto.onAdd.call(this);
            // this._map.on('rotate', this._update, this);
        },

        onRemove: function() {
            rendererProto.onRemove.call(this);
            // this._map.off('rotate', this._update, this);
        },

        _updateTransform: function(center, zoom) {
            if (!this._map._rotate) {
                return rendererProto._updateTransform.call(this, center, zoom);
            }
            var scale = this._map.getZoomScale(zoom, this._zoom),
                offset = this._map._latLngToNewLayerPoint(this._topLeft, zoom, center);
            if (L.Browser.any3d) {
                L.DomUtil.setTransform(this._container, offset, scale);
            } else {
                L.DomUtil.setPosition(this._container, offset);
            }
        },

        _update: function() {
            if (!this._map._rotate) {
                return rendererProto._update.call(this);
            }
            // Update pixel bounds of renderer container (for positioning/sizing/clipping later)
            // Subclasses are responsible of firing the 'update' event.
            var p = this.options.padding,
                map = this._map,
                size = this._map.getSize(),
                padMin = size.multiplyBy(-p),
                padMax = size.multiplyBy(1 + p),
                //// TODO: Somehow refactor this out into map.something() - the code is
                ////   pretty much the same as in GridLayer.
                clip = new L.Bounds([
                    map.containerPointToLayerPoint([padMin.x, padMin.y]).floor(),
                    map.containerPointToLayerPoint([padMin.x, padMax.y]).floor(),
                    map.containerPointToLayerPoint([padMax.x, padMin.y]).floor(),
                    map.containerPointToLayerPoint([padMax.x, padMax.y]).floor()
                ]);
            //min = this._map.containerPointToLayerPoint(size.multiplyBy(-p)).round();

            this._bounds = clip;
            // this._topLeft = clip.min;
            this._topLeft = this._map.layerPointToLatLng(clip.min);

            this._center = this._map.getCenter();
            this._zoom = this._map.getZoom();
        },

    });

    /**
     * L.SVG
     */
    const svgProto = L.extend({}, L.SVG.prototype);

    L.SVG.include({

        _update: function() {
            svgProto._update.call(this);
            if (this._map._rotate) {
                this.fire('update');
            }
        },

    });

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

    /*
     * L.Map.CompassBearing will rotate the map according to a smartphone's compass.
     */

    L.Map.CompassBearing = L.Handler.extend({

        initialize: function(map) {
            if (!window.DeviceOrientationEvent) {
                this._capable = false;
                return;
            }
            this._capable = true;
            this._map = map;

            this._throttled = L.Util.throttle(this._onDeviceOrientation, 1000, this);
        },

        addHooks: function() {
            if (this._capable && this._map._rotate) {
                L.DomEvent.on(window, 'deviceorientation', this._throttled, this);
            }
        },

        removeHooks: function() {
            if (this._capable && this._map._rotate) {
                L.DomEvent.off(window, 'deviceorientation', this._throttled, this);
            }
        },

        _onDeviceOrientation: function(event) {
            if (event.alpha !== null) {
                this._map.setBearing(event.alpha - window.orientation);
            }
        },

    });

    // @section Handlers
    // @property compassBearing: Handler
    // Compass bearing handler.
    L.Map.addInitHook('addHandler', 'compassBearing', L.Map.CompassBearing);

    /*
     * L.Handler.ContainerMutation triggers `invalidateResize` when the map's DOM container mutates.
     */

    // @namespace Map
    // @section Interaction Options
    L.Map.mergeOptions({

        // @option trackContainerMutation: Boolean = false
        // Whether the map uses [mutation observers](https://developer.mozilla.org/docs/Web/API/MutationObserver)
        // to detect changes in its container and trigger `invalidateSize`. Disabled
        // by default due to support not being available in all web browsers.
        trackContainerMutation: false

    });

    L.Map.ContainerMutation = L.Handler.extend({

        addHooks: function() {
            if (!L.Browser.mutation) {
                return;
            }

            if (!this._observer) {
                this._observer = new MutationObserver(L.Util.bind(this._onMutation, this));
            }

            this._observer.observe(this._map.getContainer(), {
                childList: false,
                attributes: true,
                characterData: false,
                subtree: false,
                attributeFilter: ['style']
            });
        },

        removeHooks: function() {
            if (!L.Browser.mutation) {
                return;
            }
            this._observer.disconnect();
        },

        _onMutation: function() {
            this._map.invalidateSize();
        },

    });

    // @section Handlers
    // @property containerMutation: Handler
    // Container mutation handler (disabled unless [`trackContainerMutation`](#map-trackcontainermutation) is set).
    L.Map.addInitHook('addHandler', 'trackContainerMutation', L.Map.ContainerMutation);

    /*
     * L.Handler.TouchGestures is both TouchZoom plus TouchRotate.
     */

    // @namespace Map
    // @section Interaction Options
    L.Map.mergeOptions({

        // @option bounceAtZoomLimits: Boolean = true
        // Set it to false if you don't want the map to zoom beyond min/max zoom
        // and then bounce back when pinch-zooming.
        bounceAtZoomLimits: true,

    });

    L.Map.TouchGestures = L.Handler.extend({

        initialize: function(map) {
            this._map = map;
            this.rotate = !!this._map.options.touchRotate;
            this.zoom = !!this._map.options.touchZoom;
        },

        addHooks: function() {
            L.DomEvent.on(this._map._container, 'touchstart', this._onTouchStart, this);
        },

        removeHooks: function() {
            L.DomEvent.off(this._map._container, 'touchstart', this._onTouchStart, this);
        },

        _onTouchStart: function(e) {
            var map = this._map;

            if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming || this._rotating) { return; }

            var p1 = map.mouseEventToContainerPoint(e.touches[0]),
                p2 = map.mouseEventToContainerPoint(e.touches[1]),
                vector = p1.subtract(p2);

            this._centerPoint = map.getSize()._divideBy(2);
            this._startLatLng = map.containerPointToLatLng(this._centerPoint);

            if (this.zoom) {
                if (map.options.touchZoom !== 'center') {
                    this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
                }
                this._startDist = p1.distanceTo(p2);
                this._startZoom = map.getZoom();
                this._zooming = true;
            } else {
                this._zooming = false;
            }

            if (this.rotate) {
                this._startTheta = Math.atan(vector.x / vector.y);
                this._startBearing = map.getBearing();
                if (vector.y < 0) { this._startBearing += 180; }
                this._rotating = true;
            } else {
                this._rotating = false;
            }

            this._moved = false;

            map.stop();

            L.DomEvent
                .on(document, 'touchmove', this._onTouchMove, this)
                .on(document, 'touchend', this._onTouchEnd, this);

            L.DomEvent.preventDefault(e);
        },

        _onTouchMove: function(e) {
            if (!e.touches || e.touches.length !== 2 || !(this._zooming || this._rotating)) { return; }

            var map = this._map,
                p1 = map.mouseEventToContainerPoint(e.touches[0]),
                p2 = map.mouseEventToContainerPoint(e.touches[1]),
                vector = p1.subtract(p2),
                scale = p1.distanceTo(p2) / this._startDist,
                delta;

            if (this._rotating) {
                var theta = Math.atan(vector.x / vector.y);
                var bearingDelta = (theta - this._startTheta) * L.DomUtil.RAD_TO_DEG;
                if (vector.y < 0) { bearingDelta += 180; }
                if (bearingDelta) {
                    /// TODO: The pivot should be the last touch point, but zoomAnimation manages to
                    ///   overwrite the rotate pane position. Maybe related to #3529.
                    map.setBearing(this._startBearing - bearingDelta);
                }
            }

            if (this._zooming) {
                this._zoom = map.getScaleZoom(scale, this._startZoom);

                if (!map.options.bounceAtZoomLimits && (
                        (this._zoom < map.getMinZoom() && scale < 1) ||
                        (this._zoom > map.getMaxZoom() && scale > 1))) {
                    this._zoom = map._limitZoom(this._zoom);
                }

                if (map.options.touchZoom === 'center') {
                    this._center = this._startLatLng;
                    if (scale === 1) { return; }
                } else {
                    // Get delta from pinch to center, so centerLatLng is delta applied to initial pinchLatLng
                    delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
                    if (scale === 1 && delta.x === 0 && delta.y === 0) { return; }

                    var alpha = -map.getBearing() * L.DomUtil.DEG_TO_RAD;

                    this._center = map.unproject(map.project(this._pinchStartLatLng).subtract(delta.rotate(alpha)));
                }

            }

            if (!this._moved) {
                map._moveStart(true);
                this._moved = true;
            }

            L.Util.cancelAnimFrame(this._animRequest);

            var moveFn = L.bind(map._move, map, this._center, this._zoom, { pinch: true, round: false });
            this._animRequest = L.Util.requestAnimFrame(moveFn, this, true);

            L.DomEvent.preventDefault(e);
        },

        _onTouchEnd: function() {
            if (!this._moved || !this._zooming) {
                this._zooming = false;
                return;
            }

            this._zooming = false;
            this._rotating = false;
            L.Util.cancelAnimFrame(this._animRequest);

            L.DomEvent
                .off(document, 'touchmove', this._onTouchMove)
                .off(document, 'touchend', this._onTouchEnd);

            if (this.zoom) {
                // Pinch updates GridLayers' levels only when snapZoom is off, so snapZoom becomes noUpdate.
                if (this._map.options.zoomAnimation) {
                    this._map._animateZoom(this._center, this._map._limitZoom(this._zoom), true, this._map.options.snapZoom);
                } else {
                    this._map._resetView(this._center, this._map._limitZoom(this._zoom));
                }
            }
        },

    });

    // @section Handlers
    // @property touchGestures: Handler
    // Touch gestures handler.
    L.Map.addInitHook('addHandler', 'touchGestures', L.Map.TouchGestures);

    /*
     * L.Handler.TouchRotate is used by L.Map to add two-finger rotation gestures.
     */

    // @namespace Map
    // @section Interaction Options
    L.Map.mergeOptions({

        // @section Touch interaction options
        // @option touchRotate: Boolean|String = *
        // Whether the map can be rotated with a two-finger rotation gesture
        touchRotate: false,

    });

    L.Map.TouchRotate = L.Handler.extend({

        addHooks: function() {
            this._map.touchGestures.enable();
            this._map.touchGestures.rotate = true;
        },

        removeHooks: function() {
            this._map.touchGestures.rotate = false;
        },

    });

    // @section Handlers
    // @property touchZoom: Handler
    // Touch rotate handler.
    L.Map.addInitHook('addHandler', 'touchRotate', L.Map.TouchRotate);

    /*
     * L.Handler.ShiftKeyRotate is used by L.Map to add shift-wheel rotation.
     */

    // @namespace Map
    // @section Interaction Options
    L.Map.mergeOptions({

        // @section ShiftKey interaction options
        // @option shiftKeyRotate: Boolean|String = *
        // Whether the map can be rotated with a shit-wheel rotation
        shiftKeyRotate: true,

    });

    L.Map.ShiftKeyRotate = L.Handler.extend({

        addHooks: function() {
            L.DomEvent.on(this._map._container, "wheel", this._handleShiftScroll, this);
            // this._map.shiftKeyRotate.enable();
            this._map.shiftKeyRotate.rotate = true;
        },

        removeHooks: function() {
            L.DomEvent.off(this._map._container, "wheel", this._handleShiftScroll, this);
            this._map.shiftKeyRotate.rotate = false;
        },

        _handleShiftScroll: function(e) {
            if (e.shiftKey) {
                e.preventDefault();
                this._map.scrollWheelZoom.disable();
                this._map.setBearing((this._map._bearing * L.DomUtil.RAD_TO_DEG) + Math.sign(e.deltaY) * 5);
            } else {
                this._map.scrollWheelZoom.enable();
            }
        },

    });

    // @section Handlers
    // @property touchZoom: Handler
    // Touch rotate handler.
    L.Map.addInitHook('addHandler', 'shiftKeyRotate', L.Map.ShiftKeyRotate);

    // decrease "scrollWheelZoom" handler priority over "shiftKeyRotate" handler
    L.Map.addInitHook(function() {
        if (this.scrollWheelZoom.enabled() && this.shiftKeyRotate.enabled()) {
            this.scrollWheelZoom.disable();
            this.scrollWheelZoom.enable();
        }
    });

    /*
     * L.Handler.TouchZoom is used by L.Map to add pinch zoom on supported mobile browsers.
     */

    // @namespace Map
    // @section Interaction Options
    L.Map.mergeOptions({

        // @section Touch interaction options
        // @option touchZoom: Boolean|String = *
        // Whether the map can be zoomed by touch-dragging with two fingers. If
        // passed `'center'`, it will zoom to the center of the view regardless of
        // where the touch events (fingers) were. Enabled for touch-capable web
        // browsers except for old Androids.
        touchZoom: L.Browser.touch && !L.Browser.android23,

        bounceAtZoomLimits: false,
    });

    L.Map.TouchZoom = L.Handler.extend({

        addHooks: function() {
            L.DomUtil.addClass(this._map._container, 'leaflet-touch-zoom');
            this._map.touchGestures.enable();
            this._map.touchGestures.zoom = true;
        },

        removeHooks: function() {
            L.DomUtil.removeClass(this._map._container, 'leaflet-touch-zoom');
            this._map.touchGestures.zoom = false;
        },

    });

    // @section Handlers
    // @property touchZoom: Handler
    // Touch zoom handler.
    L.Map.addInitHook('addHandler', 'touchZoom', L.Map.TouchZoom);

    /**
     * L.Control.Rotate
     */

    // A tri-state control for map rotation. States are:
    // Locked (default)
    // Unlocked (user can pinch-rotate)
    // Follow (rotation follows device orientation, if available)
    L.Control.Rotate = L.Control.extend({

        options: {
            position: 'topleft',
            closeOnZeroBearing: true
        },

        onAdd: function(map) {
            this._onDeviceOrientation = L.Util.throttle(this._unthrottledOnDeviceOrientation, 100, this);

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

            map.on('rotate', this._restyle.bind(this));

            // State flag
            this._follow = false;
            this._canFollow = false;

            if (this.options.closeOnZeroBearing && map.getBearing() === 0) {
                container.style.display = 'none';
            }

            return container;
        },

        _handleMouseDown: function(e) {
            L.DomEvent.stopPropagation(e);
            this.dragging = true;
            this.dragstartX = e.pageX;
            this.dragstartY = e.pageY;
            L.DomEvent
                .on(document, 'mousemove', this._handleMouseDrag, this)
                .on(document, 'mouseup', this._handleMouseUp, this);
        },

        _handleMouseUp: function(e) {
            L.DomEvent.stopPropagation(e);
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
            var map = this._map;

            if (!map) { return; }

            if (!map.touchRotate.enabled() && !map.compassBearing.enabled()) {
                // Go from disabled to touch
                map.touchRotate.enable();

                // console.log('state is now: touch rotate');
            } else {

                if (!map.compassBearing.enabled()) {
                    // Go from touch to compass
                    map.touchRotate.disable();
                    map.compassBearing.enable();

                    // console.log('state is now: compass');

                    // It is possible that compass is not supported. If so,
                    // the hangler will automatically go from compass to disabled.
                } else {
                    // Go from compass to disabled
                    map.compassBearing.disable();

                    // console.log('state is now: locked');

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
                var map = this._map;
                var bearing = map.getBearing();
                if (this.options.closeOnZeroBearing && bearing) {
                    this._container.style.display = 'block';
                }

                var cssTransform = 'rotate(' + bearing + 'deg)';
                this._arrow.style.transform = cssTransform;

                if (map.compassBearing.enabled()) {
                    this._link.style.backgroundColor = 'orange';
                } else if (map.touchRotate.enabled()) {
                    this._link.style.backgroundColor = null;
                } else {
                    this._link.style.backgroundColor = 'grey';
                    if (this.options.closeOnZeroBearing && map.getBearing() === 0) {
                        this._container.style.display = 'none';
                    }
                }
            } else {
                L.DomUtil.addClass(this._link, 'leaflet-disabled');
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

})));
//# sourceMappingURL=leaflet-rotate-src.js.map
