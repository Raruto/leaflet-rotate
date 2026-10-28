/**
 * Recalculates vector renderer bounds and transforms for rotated and pitched maps.
 *
 * @external L.Renderer
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/vector/Renderer.js
 * 
 * @since leaflet-rotate (v0.1.0)
 */

const rendererProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Renderer.prototype));
const rendererBase = Object.getPrototypeOf(L.Renderer.prototype);
const rendererGetEvents = rendererProto.getEvents || rendererBase.getEvents;
const rendererOnMoveEnd = rendererProto._onMoveEnd || rendererBase._onMoveEnd;

L.Renderer.include({

    /**
     * Subscribe the renderer to map rotation so its visible bounds are recalculated.
     * 
     * @listens L.Map~rotate
     * 
     * @returns {Object} Leaflet event map for the renderer.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
        const events = rendererGetEvents.apply(this, arguments);
        return Object.assign(events, { rotate: this._onRotate });
    },

    /**
     * Refresh renderer bounds after bearing or pitch changes.
     * 
     * Paths are reprojected only when the pixel origin actually changed (eg. fractional centers
     * after an off-center zoom), since reprojection is the main cost with long polylines.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onRotate() {
        if (!this._map._rotate) { return; }
        const origin = this._map.getPixelOrigin();
        if (!this._rotateOrigin || !this._rotateOrigin.equals(origin)) {
            this._rotateOrigin = origin;
            clearTimeout(this._rotateTimer);
            this._onZoomEnd();
            this._updateAfterRotate();
            return;
        }
        // paths are still aligned: only redraw when the view leaves the already drawn area
        if (this._bounds && this._bounds.contains(this._map._getPaddedPixelBounds(0))) { return; }
        clearTimeout(this._rotateTimer);
        const wait = (this._lastRotateUpdate || 0) + 100 - performance.now();
        if (wait > 0) {
            this._rotateTimer = setTimeout(() => this._map && this._updateAfterRotate(), wait);
        } else {
            this._updateAfterRotate();
        }
    },

    /**
     * Recalculate renderer bounds and redraw after bearing or pitch changes.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _updateAfterRotate() {
        this._lastRotateUpdate = performance.now();
        if (L.version.startsWith('2.')) {
            this._onMoveEnd();
        } else {
            this._update();
        }
    },

    /**
     * Add the zoom-animation class needed for correct renderer transforms in Leaflet 1.
     *
     * Fixes `map.flyTo()` when `map.options.zoomAnimation` is false.
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    onAdd() {
        rendererProto.onAdd.apply(this, arguments);
        if (L.version <= "1.9.3") {
            // always keep transform-origin as 0 0
            this._container.classList.add('leaflet-zoom-animated');
        }
    },

    /**
     * Update the renderer transform during zoom animation, accounting for rotated coordinates.
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * @see https://github.com/Leaflet/Leaflet/pull/8103
     * @see https://github.com/Leaflet/Leaflet/issues/7466
     * 
     * @param {L.LatLng} center Target map center.
     * @param {number} zoom Target zoom level.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updateTransform(center, zoom) {
        const v2 = L.version.startsWith('2.');
        if (!this._map._rotate) {
            return (v2 ? rendererBase : rendererProto)._updateTransform.apply(this, arguments);
        }
        if (!v2 && zoom === this._zoom) {
            // _reset() has already repositioned the renderer at the current zoom.
            return;
        }
        // Stay in pixel space: round-tripping `_topLeft` through lat/lng clamps at low zooms (layers jump).
        const scale = this._map.getZoomScale(zoom, this._zoom),
            offset = this._topLeftPoint.multiplyBy(scale)
                .subtract(this._map._getNewPixelOrigin(center, zoom));

        L.DomUtil.setTransform(this._container, offset, scale);
    },

    /**
     * Recalculate bounds and finish renderer updates after movement on Leaflet 2.
     *
     * @param {Object} ev Map movement event.
     * 
     * @since leaflet-rotate (v0.4.0)
     */
    _onMoveEnd(ev) {
        if (!L.version.startsWith('2.') || !this._map._rotate) {
            return rendererOnMoveEnd.apply(this, arguments);
        }

        this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
        this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
        this._center = this._map.getCenter();
        this._zoom = this._map.getZoom();
        this._topLeftPoint = this._map._getNewPixelOrigin(this._center, this._zoom).add(this._bounds.min);
        this._updateTransform(this._center, this._zoom);
        this._resizeContainer();
        this._onSettled(ev);
    },

    /**
     * Resize the renderer container to cover the pitch-aware map bounds.
     * 
     * @since leaflet-rotate (v0.4.0)
     */
    _resizeContainer() {
        if (!L.version.startsWith('2.') || !this._map._rotate || !this._bounds) {
            return rendererBase._resizeContainer.apply(this, arguments);
        }

        const size = this._bounds.getSize();
        this._container.style.width = size.x + 'px';
        this._container.style.height = size.y + 'px';
        return size;
    },

    // getEvents() {
    //     const events = {
    //         viewreset: this._reset,
    //         zoom: this._onZoom,
    //         moveend: this._update,
    //         zoomend: this._onZoomEnd
    //     };
    //     if (this._zoomAnimated) {
    //         events.zoomanim = this._onAnimZoom;
    //     }
    //     return events;
    // },

    // _onAnimZoom(ev) {
    //     this._updateTransform(ev.center, ev.zoom);
    // },

	// _onZoom() {
    //     this._updateTransform(this._map.getCenter(), this._map.getZoom());
	// },

    // _onZoomEnd() {
    //     for (const id in this._layers) {
    //         this._layers[id]._project();
    //     }
    // },

    // _reset() {
    //     this._update();
    //     this._updateTransform(this._center, this._zoom);

    //     for (const id in this._layers) {
    //         this._layers[id]._reset();
    //     }
    // },

    // _updatePaths() {
    //     for (const id in this._layers) {
    //         this._layers[id]._update();
    //     }
    // },

    /**
     * Recalculate renderer bounds and cached view state.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _update() {
        if (!this._map._rotate) {
            return rendererProto._update.apply(this, arguments);
        }
        // Update pixel bounds of renderer container (for positioning/sizing/clipping later)
        // Subclasses are responsible of firing the 'update' event.
        this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
        this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
        this._center = this._map.getCenter();
        this._zoom = this._map.getZoom();
        this._topLeftPoint = this._map._getNewPixelOrigin(this._center, this._zoom).add(this._bounds.min);
    },

});
