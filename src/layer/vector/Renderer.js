/**
 * @external L.Renderer
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/vector/Renderer.js
 */

const rendererProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Renderer.prototype));
const rendererBase = Object.getPrototypeOf(L.Renderer.prototype);
const rendererGetEvents = rendererProto.getEvents || rendererBase.getEvents;
const rendererOnMoveEnd = rendererProto._onMoveEnd || rendererBase._onMoveEnd;

L.Renderer.include({

    /**
     * Redraw L.Canvas and L.SVG renderer bounds after the
     * map is moved by just calling `map.setBearing(theta)`
     * 
     * @listens L.Map~rotate
     */
    getEvents() {
        const events = rendererGetEvents.apply(this, arguments);
        return Object.assign(events, { rotate: this._onRotate });
    },

    _onRotate() {
        if (!this._map._rotate) { return; }
        this._onZoomEnd();
        if (L.version.startsWith('2.')) {
            this._onMoveEnd();
        } else {
            this._update();
        }
    },

    /**
     * Fix for `map.flyTo()` when `false === map.options.zoomAnimation`
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     */
    onAdd() {
        rendererProto.onAdd.apply(this, arguments);
        if (L.version <= "1.9.3") {
            // always keep transform-origin as 0 0
            this._container.classList.add('leaflet-zoom-animated');
        }
    },

    /**
     * @FIXME layer drifts on `map.setZoom()` (eg. zoom during animation)
     * 
     * the main cause seems to be related to `this._updateTransform(path._center, path._zoom))`
     * and `this._topLeft = this._map.layerPointToLatLng(this._bounds.min);`
     * 
     * @example
     *   map.setZoom(2);
     *   path._renderer._update();
     *   path._renderer._updateTransform(path._renderer._center, path._renderer._zoom);
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * @see https://github.com/Leaflet/Leaflet/pull/8103
     * @see https://github.com/Leaflet/Leaflet/issues/7466
     * 
     * @TODO rechek this changes from leaflet@v1.9.3
     * 
     * @see https://github.com/Leaflet/Leaflet/compare/v1.7.0...v1.9.3
     */
    _updateTransform(center, zoom) {
        if (L.version.startsWith('2.')) {
            if (this._map._rotate) {
                const scale = this._map.getZoomScale(zoom, this._zoom),
                    offset = this._topLeftPoint.multiplyBy(scale)
                        .subtract(this._map._getNewPixelOrigin(center, zoom));

                L.DomUtil.setTransform(this._container, offset, scale);
                return;
            }
            return rendererBase._updateTransform.apply(this, arguments);
        }
        if (!this._map._rotate) {
            return rendererProto._updateTransform.apply(this, arguments);
        }
        if (zoom === this._zoom) {
            // _reset() has already repositioned the renderer at the current zoom.
            return;
        }
        /**
         * @FIXME see path._renderer._reset();
         */
        const scale = this._map.getZoomScale(zoom, this._zoom),
            offset = this._map._latLngToNewLayerPoint(this._topLeft, zoom, center);

        L.DomUtil.setTransform(this._container, offset, scale);
        
    },

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
    },

});
