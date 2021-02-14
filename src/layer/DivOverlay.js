/**
 * L.DivOverlay
 */
const divOverlayProto = L.extend({}, L.DivOverlay.prototype);

L.DivOverlay.include({

    getEvents: function() {
        return L.extend(divOverlayProto.getEvents.call(this), { rotate: this._updatePosition });
    },

    _updatePosition: function() {
        if (!this._map) { return; }

        var pos = this._map.latLngToLayerPoint(this._latlng),
            offset = L.point(this.options.offset),
            anchor = this._getAnchor();

        if (this._zoomAnimated) {
            // TODO: use divOverlayProto._updatePosition
            if (this._map._rotate) {
                pos = this._map.rotatedPointToMapPanePoint(pos);
            }
            L.DomUtil.setPosition(this._container, pos.add(anchor));
        } else {
            offset = offset.add(pos).add(anchor);
        }

        var bottom = this._containerBottom = -offset.y,
            left = this._containerLeft = -Math.round(this._containerWidth / 2) + offset.x;

        // bottom position the popup in case the height of the popup changes (images loading etc)
        this._container.style.bottom = bottom + 'px';
        this._container.style.left = left + 'px';
    },

});
