/**
 * L.Renderer
 */
const rendererProto = L.extend({}, L.Renderer.prototype);

L.Renderer.include({

    // onAdd: function() {
    //     rendererProto.onAdd.call(this);
    //     // this._map.on('rotate', this._update, this);
    // },

    // onRemove: function() {
    //     rendererProto.onRemove.call(this);
    //     // this._map.off('rotate', this._update, this);
    // },

    /**
     * @TODO rechek this changes from leaflet@v1.9.3
     * 
     * @see https://github.com/Leaflet/Leaflet/compare/v1.7.0...v1.9.3
     */
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
        this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
        this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
        this._center = this._map.getCenter();
        this._zoom = this._map.getZoom();
    },

});
