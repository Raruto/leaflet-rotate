/**
 * Updates tile coverage for rotated map bounds.
 *
 * @external L.GridLayer
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/tile/GridLayer.js
 * 
 * @since leaflet-rotate (v0.1.0)
 */

const gridLayerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.GridLayer.prototype));

L.GridLayer.include({

    /**
     * Add a throttled tile refresh after map bearing changes.
     * 
     * @listens L.Map~rotate
     * 
     * @returns {Object} Leaflet event map for the grid layer.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
        const events = gridLayerProto.getEvents.apply(this, arguments);
        if (this._map._rotate && !this.options.updateWhenIdle) {
            if (!this._onRotate) {
                this._onRotate = L.Util.throttle(this._onMoveEnd, this.options.updateInterval, this);
            }
            events.rotate = this._onRotate;
        }
        return events;
    },

    /**
     * Return tile pixel bounds that cover the rotated viewport.
     * 
     * @param {L.LatLng} center View center used to calculate bounds.
     * 
     * @returns {L.Bounds} Pixel bounds covered by the layer's tiles.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getTiledPixelBounds(center) {
        if (!this._map._rotate) {
            return gridLayerProto._getTiledPixelBounds.apply(this, arguments);
        }

        return this._map._getNewPixelBounds(center, this._tileZoom);
    },

});
