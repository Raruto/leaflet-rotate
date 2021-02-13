/**
 * L.Tooltip
 */
const tooltipProto = {
    _updatePosition: L.Tooltip.prototype._updatePosition,
    _animateZoom: L.Tooltip.prototype._animateZoom,
};

L.Tooltip.include({

    _updatePosition: function() {
        if (!this._map._rotate) {
            return tooltipProto._updatePosition.call(this);
        }
        var pos = this._map.latLngToLayerPoint(this._latlng);

        pos = this._map.rotatedPointToMapPanePoint(pos);
        this._setPosition(pos);
    },

    _animateZoom: function(e) {
        if (!this._map._rotate) {
            return tooltipProto._animateZoom.call(this);
        }
        var pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);

        pos = this._map.rotatedPointToMapPanePoint(pos);
        this._setPosition(pos);
    },

});
