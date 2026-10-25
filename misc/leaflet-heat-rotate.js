if (!L.HeatLayer && !globalThis.HeatmapOverlay) {
    throw new Error('Load Leaflet.heat or heatmap.js Leaflet plugin before this adapter.');
}

if (L.HeatLayer) {
    const heatLayerOnAdd = L.HeatLayer.prototype.onAdd;
    const heatLayerOnRemove = L.HeatLayer.prototype.onRemove;
    const heatLayerReset = L.HeatLayer.prototype._reset;
    const heatLayerAnimateZoom = L.HeatLayer.prototype._animateZoom;

    L.HeatLayer.include({
        onAdd: function(map) {
            heatLayerOnAdd.apply(this, arguments);
            if (map._rotate) {
                map.getPane('norotatePane').appendChild(this._canvas);
                this._reset();
                map.on('rotate', this._reset, this);
            }
        },

        onRemove: function(map) {
            if (map._rotate) {
                map.off('rotate', this._reset, this);
                map.getPane('overlayPane').appendChild(this._canvas);
            }
            return heatLayerOnRemove.apply(this, arguments);
        },

        _reset: function() {
            if (!this._map._rotate) {
                return heatLayerReset.apply(this, arguments);
            }

            const map = this._map;
            const size = map.getSize();
            L.DomUtil.setPosition(this._canvas, map._getMapPanePos().multiplyBy(-1));

            if (this._heat._width !== size.x) {
                this._canvas.width = this._heat._width = size.x;
            }
            if (this._heat._height !== size.y) {
                this._canvas.height = this._heat._height = size.y;
            }
            this._redraw();
        },

        _animateZoom: function(event) {
            if (!this._map._rotate) {
                return heatLayerAnimateZoom.apply(this, arguments);
            }

            const map = this._map;
            const scale = map.getZoomScale(event.zoom);
            const offset = map._getCenterOffset(event.center)
                .rotate(map._bearing)
                .multiplyBy(-scale)
                .subtract(map._getMapPanePos());
            L.DomUtil.setTransform(this._canvas, offset, scale);
        },
    });
}

if (globalThis.HeatmapOverlay) {
    const heatmapOnAdd = globalThis.HeatmapOverlay.prototype.onAdd;
    const heatmapOnRemove = globalThis.HeatmapOverlay.prototype.onRemove;
    const heatmapDraw = globalThis.HeatmapOverlay.prototype._draw;

    globalThis.HeatmapOverlay.include({
        onAdd: function(map) {
            heatmapOnAdd.apply(this, arguments);
            if (map._rotate) {
                map.getPane('norotatePane').appendChild(this._el);
                this._draw();
                map.on('rotate', this._draw, this);
            }
        },

        onRemove: function(map) {
            if (map._rotate) {
                map.off('rotate', this._draw, this);
                map.getPane('overlayPane').appendChild(this._el);
            }
            return heatmapOnRemove.apply(this, arguments);
        },

        _draw: function() {
            const map = this._map;
            if (!map._rotate) {
                return heatmapDraw.apply(this, arguments);
            }

            L.DomUtil.setPosition(this._el, map._getMapPanePos().multiplyBy(-1));
            this._update();
        },
    });
}
