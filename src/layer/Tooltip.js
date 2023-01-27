/**
 * @external L.Tooltip
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/Tooltip.js
 */

const tooltipProto = L.extend({}, L.Tooltip.prototype);

L.Tooltip.include({

    _animateZoom: function(e) {
        if (!this._map._rotate) {
            return tooltipProto._animateZoom.apply(this, arguments);
        }
        var pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);

        pos = this._map.rotatedPointToMapPanePoint(pos);
        this._setPosition(pos);
    },

    _updatePosition: function() {
        if (!this._map._rotate) {
            return tooltipProto._updatePosition.apply(this, arguments);
        }
        var pos = this._map.latLngToLayerPoint(this._latlng);

        pos = this._map.rotatedPointToMapPanePoint(pos);
        this._setPosition(pos);
    },

});
