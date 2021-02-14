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
