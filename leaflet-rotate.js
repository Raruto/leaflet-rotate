/**
 * L.DomUtil
 */
const domUtilProto = {
    setTransform: L.DomUtil.setTransform,
    setPosition: L.DomUtil.setPosition
};
L.extend(L.DomUtil, {
    setTransform: function(el, offset, scale, bearing, pivot) {
        if (!bearing) {
            return domUtilProto.setTransform.call(this, el, offset, scale);
        }

        var pos = offset || new L.Point(0, 0);

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
    RAD_TO_DEG: 180 / Math.PI
});

/**
 * L.Point
 */
L.extend(L.Point.prototype, {
    rotate: function(theta) {
        if (!theta) { return this; }
        // Rotate around (0,0) by applying the 2D rotation matrix:
        // ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
        // ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
        // Theta must be given in radians.
        var sinTheta = Math.sin(theta);
        var cosTheta = Math.cos(theta);

        return new L.Point(
            this.x * cosTheta - this.y * sinTheta,
            this.x * sinTheta + this.y * cosTheta
        );
    },
    rotateFrom: function(theta, pivot) {
        if (!theta) { return this; }
        return this.clone().subtract(pivot).rotate(theta).add(pivot);
    }
});

/**
 * L.Marker
 */
const markerProto = {
    onAdd: L.Marker.prototype.onAdd,
    _setPos: L.Marker.prototype._setPos
};
L.Marker.include({
    onAdd: function(map) {
        markerProto.onAdd.call(this, map);
        map.on('rotate', this.update, this);
    },
    _setPos: function(pos) {
        markerProto._setPos.call(this, pos);
        if (this._map._rotate) {
            var anchor = this.options.icon.options.iconAnchor || new L.Point(0, 0);
            L.DomUtil.setPosition(this._icon, pos, -this._map._bearing || 0, pos.add(anchor));
        }
    },
});

/**
 * L.GridLayer
 */
const gridLayerProto = {
    _getTiledPixelBounds: L.GridLayer.prototype._getTiledPixelBounds,
};
L.GridLayer.include({
    _getTiledPixelBounds: function(center) {
        if (!this._map._rotate || !this._map._bearing) {
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
const canvasProto = {
    onAdd: L.Canvas.prototype.onAdd,
    onRemove: L.Canvas.prototype.onRemove,
};
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
});

/**
 * L.Renderer
 */
const rendererProto = {
    onAdd: L.Renderer.prototype.onAdd,
    onRemove: L.Renderer.prototype.onRemove,
    _updateTransform: L.Renderer.prototype._updateTransform,
    _update: L.Renderer.prototype._update,
};
L.Renderer.include({
    onAdd: function() {
        rendererProto.onAdd.call(this);
        this._map.on('rotate', this._update, this);
    },
    onRemove: function() {
        rendererProto.onRemove.call(this);
        this._map.off('rotate', this._update, this);
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
    }
});

/**
 * L.Map
 */
const mapProto = {
    initialize: L.Map.prototype.initialize,
    createPane: L.Map.prototype.createPane,
    containerPointToLayerPoint: L.Map.prototype.containerPointToLayerPoint,
    layerPointToContainerPoint: L.Map.prototype.layerPointToContainerPoint,
    _initPanes: L.Map.prototype._initPanes,
    _getNewPixelOrigin: L.Map.prototype._getNewPixelOrigin,
};
L.Map.mergeOptions({ rotate: false, });
L.Map.include({
    initialize: function(id, options) { // (HTMLElement or String, Object)
        if (options.rotate) {
            this._rotate = true;
            this._bearing = 0;
        }
        mapProto.initialize.call(this, id, options);
    },
    createPane: function(name, container) {
        if (!this._rotate || name == 'mapPane') {
            return mapProto.createPane.call(this, name, container);
        }
        // init "rotatePane"
        if (!this._rotatePane) {
            // this._pivot = this.getSize().divideBy(2);
            this._rotatePane = mapProto.createPane.call(this, 'rotatePane', this._mapPane);
            L.DomUtil.setPosition(this._rotatePane, new L.Point(0, 0), this._bearing, this._pivot);
        }
        return mapProto.createPane.call(this, name, container || this._rotatePane);
    },
    containerPointToLayerPoint: function(point) { // (Point)
        if (!this._rotate || !this._bearing) {
            return mapProto.containerPointToLayerPoint.call(this, point);
        }
        return L.point(point)
            .subtract(this._getMapPanePos())
            .rotateFrom(-this._bearing, this._getRotatePanePos())
            .subtract(this._getRotatePanePos());
    },
    layerPointToContainerPoint: function(point) { // (Point)
        if (!this._rotate || !this._bearing) {
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

        L.DomUtil.setPosition(this._rotatePane, this._rotatePanePos, this._bearing, this._rotatePanePos);

        this.fire('rotate');
    },
    getBearing: function() {
        return this._bearing * L.DomUtil.RAD_TO_DEG;
    },
    // TODO: handle "tooltip" and "popup" panes
    // _initPanes: function() {
    //     // mapProto._initPanes.call(this);
    //
    //     var panes = this._panes = {};
    //     this._paneRenderers = {};
    //     // @section
    //     //
    //     // Panes are DOM elements used to control the ordering of layers on the map. You
    //     // can access panes with [`map.getPane`](#map-getpane) or
    //     // [`map.getPanes`](#map-getpanes) methods. New panes can be created with the
    //     // [`map.createPane`](#map-createpane) method.
    //     //
    //     // Every map has the following default panes that differ only in zIndex.
    //     //
    //     // @pane mapPane: HTMLElement = 'auto'
    //     // Pane that contains all other map panes
    //     this._mapPane = this.createPane('mapPane', this._container);
    //     L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));
    //
    //     if (this._rotate) {
    //         this._rotatePane = this.createPane('rotatePane', this._mapPane);
    //         L.DomUtil.setPosition(this._rotatePane, new L.Point(0, 0), this._bearing, this._pivot);
    //     }
    //
    //     // @pane tilePane: HTMLElement = 200
    //     // Pane for `GridLayer`s and `TileLayer`s
    //     this.createPane('tilePane');
    //     // @pane overlayPane: HTMLElement = 400
    //     // Pane for vector overlays (`Path`s), like `Polyline`s and `Polygon`s
    //     this.createPane('shadowPane');
    //     // @pane shadowPane: HTMLElement = 500
    //     // Pane for overlay shadows (e.g. `Marker` shadows)
    //     this.createPane('overlayPane');
    //     // @pane markerPane: HTMLElement = 600
    //     // Pane for `Icon`s of `Marker`s
    //     this.createPane('markerPane');
    //     // @pane tooltipPane: HTMLElement = 650
    //     // Pane for tooltip.
    //     this.createPane('tooltipPane', this._mapPane);
    //     // @pane popupPane: HTMLElement = 700
    //     // Pane for `Popup`s.
    //     this.createPane('popupPane', this._mapPane);
    //     if (!this.options.markerZoomAnimation) {
    //         L.DomUtil.addClass(panes.markerPane, 'leaflet-zoom-hide');
    //         L.DomUtil.addClass(panes.shadowPane, 'leaflet-zoom-hide');
    //     }
    // },
    _getRotatePanePos: function() {
        return this._rotatePanePos || new L.Point(0, 0);
    },
    _getNewPixelOrigin: function(center, zoom) {
        var viewHalf = this.getSize()._divideBy(2);
        if (!this._rotate || !this._bearing) {
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
});

L.Map.addInitHook(function(){
  
});
