/**
 * TouchGestures is both TouchZoom plus TouchRotate
 * 
 * @see https://github.com/fnicollet/Leaflet/commit/a77af51a6b10f308d1b9a16552091d1d0aee8834
 * @see https://github.com/Leaflet/Leaflet/blob/v1.9.3/src/map/handler/Map.TouchZoom.js
 * 
 * @typedef L.Map.TouchGestures
 */

L.Map.mergeOptions({

    /**
     * Set it to false if you don't want the map to
     * zoom beyond min/max zoom and then bounce back
     * when pinch-zooming.
     * 
     * @type {Boolean}
     */
    bounceAtZoomLimits: true,

    /**
     * Set a minimum bearing value (rotate threshold) to
     * prevent map from rotating when user just wants to
     * zoom.  
     * 
     * @type { number | undefined }
     */
    touchRotateIntertia: undefined

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

        map._stop();

        L.DomEvent
            .on(document, 'touchmove', this._onTouchMove, this)
            .on(document, 'touchend touchcancel', this._onTouchEnd, this);

        L.DomEvent.preventDefault(e);
    },

    _onTouchMove: function(e) {
        if (!e.touches || e.touches.length !== 2 || !(this._zooming || this._rotating)) { return; }

        var map = this._map,
            p1 = map.mouseEventToContainerPoint(e.touches[0]),
            p2 = map.mouseEventToContainerPoint(e.touches[1]),
            vector = p1.subtract(p2),
            scale = p1.distanceTo(p2) / this._startDist,
            inertia = map.options.touchRotateIntertia
            delta;

        if (this._rotating) {
            var theta = Math.atan(vector.x / vector.y);
            var bearingDelta = (theta - this._startTheta) * L.DomUtil.RAD_TO_DEG;
            if (vector.y < 0) { bearingDelta += 180; }
            if (inertia && bearingDelta > inertia) { bearingDelta = 0; }

            if (bearingDelta) {
                /**
                 * @TODO the pivot should be the last touch point,
                 * but zoomAnimation manages to overwrite the rotate
                 * pane position. Maybe related to #3529.
                 * 
                 * @see https://github.com/Leaflet/Leaflet/pull/3529
                 * @see https://github.com/fnicollet/Leaflet/commit/a77af51a6b10f308d1b9a16552091d1d0aee8834
                 */
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
            map._moveStart(true, false);
            this._moved = true;
        }

        L.Util.cancelAnimFrame(this._animRequest);

        var moveFn = map._move.bind(map, this._center, this._zoom, { pinch: true, round: false }, undefined);
        this._animRequest = L.Util.requestAnimFrame(moveFn, this, true);

        L.DomEvent.preventDefault(e);
    },

    _onTouchEnd: function() {
        if (!this._moved || !(this._zooming || this._rotating)) {
            this._zooming = false;
            return;
        }

        this._zooming = false;
        this._rotating = false;
        L.Util.cancelAnimFrame(this._animRequest);

        L.DomEvent
            .off(document, 'touchmove', this._onTouchMove, this)
            .off(document, 'touchend touchcancel', this._onTouchEnd, this);

        if (this.zoom) {
            // Pinch updates GridLayers' levels only when zoomSnap is off, so zoomSnap becomes noUpdate.
            if (this._map.options.zoomAnimation) {
                this._map._animateZoom(this._center, this._map._limitZoom(this._zoom), true, this._map.options.zoomSnap);
            } else {
                this._map._resetView(this._center, this._map._limitZoom(this._zoom));
            }
        }
    },

});

/**
 * Add Touch Gestures handler (enabled unless `touchGestures` is unset).
 * 
 * @property {L.Map.TouchGestures} touchGestures
 */
L.Map.addInitHook('addHandler', 'touchGestures', L.Map.TouchGestures);
