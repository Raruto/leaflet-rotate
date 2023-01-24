/**
 * L.DivOverlay
 */
const divOverlayProto = L.extend({}, L.DivOverlay.prototype);

L.DivOverlay.include({

    getEvents: function() {
        return L.extend(divOverlayProto.getEvents.call(this), { rotate: this._updatePosition });
    },

    _updatePosition: function() {
        // 0. update anchor (leaflet v1.9.3)
        divOverlayProto._updatePosition.call(this);
        // 1. subtract anchor
        // 2. rotate element
        // 3. restore anchor
        if (this._map && this._map._rotate && this._zoomAnimated) {
            var anchor = this._getAnchor();
            var pos = L.DomUtil.getPosition(this._container).subtract(anchor);
            L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
        }

    },

});
