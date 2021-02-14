/**
 * L.Popup
 */
const popupProto = L.extend({}, L.Popup.prototype);

L.Popup.include({

    _animateZoom: function(e) {
        if (!this._map._rotate) {
            popupProto._animateZoom.call(this, e);
        }
        var pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center),
            anchor = this._getAnchor();

        pos = this._map.rotatedPointToMapPanePoint(pos);

        L.DomUtil.setPosition(this._container, pos.add(anchor));
    },

    _adjustPan: function() {
        if (!this.options.autoPan || (this._map._panAnim && this._map._panAnim._inProgress)) { return; }

        var map = this._map,
            marginBottom = parseInt(L.DomUtil.getStyle(this._container, 'marginBottom'), 10) || 0,
            containerHeight = this._container.offsetHeight + marginBottom,
            containerWidth = this._containerWidth,
            layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);

        layerPos._add(L.DomUtil.getPosition(this._container));

        // var containerPos = map.layerPointToContainerPoint(layerPos);
        // TODO: use popupProto._adjustPan
        var containerPos = layerPos._add(this._map._getMapPanePos()),
            padding = L.point(this.options.autoPanPadding),
            paddingTL = L.point(this.options.autoPanPaddingTopLeft || padding),
            paddingBR = L.point(this.options.autoPanPaddingBottomRight || padding),
            size = map.getSize(),
            dx = 0,
            dy = 0;

        if (containerPos.x + containerWidth + paddingBR.x > size.x) { // right
            dx = containerPos.x + containerWidth - size.x + paddingBR.x;
        }
        if (containerPos.x - dx - paddingTL.x < 0) { // left
            dx = containerPos.x - paddingTL.x;
        }
        if (containerPos.y + containerHeight + paddingBR.y > size.y) { // bottom
            dy = containerPos.y + containerHeight - size.y + paddingBR.y;
        }
        if (containerPos.y - dy - paddingTL.y < 0) { // top
            dy = containerPos.y - paddingTL.y;
        }

        // @namespace Map
        // @section Popup events
        // @event autopanstart: Event
        // Fired when the map starts autopanning when opening a popup.
        if (dx || dy) {
            map
                .fire('autopanstart')
                .panBy([dx, dy]);
        }
    },

});
