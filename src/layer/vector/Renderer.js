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
