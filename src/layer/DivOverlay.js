/**
 * @external L.DivOverlay
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/DivOverlay.js
 */

const divOverlayProto = L.extend({}, L.DivOverlay.prototype);

L.DivOverlay.include({

    /**
     * Update L.Popup and L.Tooltip anchor positions after
     * the map is moved by calling `map.setBearing(theta)`
     * 
     * @listens L.Map~rotate
     */
    getEvents: function() {
        return L.extend(divOverlayProto.getEvents.apply(this, arguments), { rotate: this._updatePosition });
    },

    /**
     * 0. update element anchor point (divOverlayProto v1.9.3)
     * 1. rotate around anchor point (subtract anchor -> rotate point -> add anchor)
     */
    _updatePosition: function() {
        if (!this._map) { return; }
        divOverlayProto._updatePosition.apply(this, arguments);
        if (this._map._rotate && this._zoomAnimated) {
            var anchor = this._getAnchor();
            var pos = L.DomUtil.getPosition(this._container).subtract(anchor);
            L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
        } else if (this._map._rotate) {
            var mapPanePoint = this._map.rotatedPointToMapPanePoint(this._map.latLngToLayerPoint(this._latlng)),
                offset = L.point(this.options.offset),
                anchor = this._getAnchor();

            this._containerLeft = -Math.round(this._containerWidth / 2) + mapPanePoint.x + offset.x + anchor.x;
            this._containerBottom = -(mapPanePoint.y + offset.y + anchor.y);
            this._container.style.left = this._containerLeft + 'px';
            this._container.style.bottom = this._containerBottom + 'px';
            this._container.style.top = '';
            L.DomUtil.setPosition(this._container, new L.Point(0, 0));
            this._container.style.transform = '';
        }

    },

});
