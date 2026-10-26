/**
 * Keeps tooltips positioned correctly when the map is rotated or pitched.
 *
 * @external L.Tooltip
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/Tooltip.js
 * 
 * @since leaflet-rotate (v0.1.0)
 */

const tooltipProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Tooltip.prototype));

L.Tooltip.include({

    /**
     * Reposition the tooltip during zoom animation using transformed map coordinates.
     *
     * @param {Object} e Zoom animation event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoom(e) {
        if (!this._map._rotate) {
            return tooltipProto._animateZoom.apply(this, arguments);
        }
        let pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);

        pos = this._map.rotatedPointToMapPanePoint(pos);
        this._setPosition(pos);
    },

    /**
     * Recompute tooltip screen position after map movement.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updatePosition() {
        if (!this._map._rotate) {
            return tooltipProto._updatePosition.apply(this, arguments);
        }
        let pos = this._map.latLngToLayerPoint(this._latlng);

        pos = this._map.rotatedPointToMapPanePoint(pos);
        this._setPosition(pos);
    },

});
