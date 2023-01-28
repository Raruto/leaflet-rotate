/**
 * @external L.Popup
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/Popup.js
 */

const popupProto = L.extend({}, L.Popup.prototype);

L.Popup.include({

    /**
     * 0. update element anchor point (popupProto v1.9.3)
     * 1. rotate around anchor point (subtract anchor -> rotate point -> add anchor)
     */
    _animateZoom: function(e) {
        popupProto._animateZoom.apply(this, arguments);
        if (this._map && this._map._rotate) {
            var anchor = this._getAnchor();
            var pos = L.DomUtil.getPosition(this._container).subtract(anchor);
            L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
        }
    },

    /**
     * Fix for L.popup({ keepInView = true })
     * 
     * @see https://github.com/fnicollet/Leaflet/pull/21
     */
    _adjustPan: function() {
        if (!this.options.autoPan || (this._map._panAnim && this._map._panAnim._inProgress)) { return; }

        // We can endlessly recurse if keepInView is set and the view resets.
        // Let's guard against that by exiting early if we're responding to our own autopan.
        if (this._autopanning) {
            this._autopanning = false;
            return;
        }

        var map = this._map,
            marginBottom = parseInt(L.DomUtil.getStyle(this._container, 'marginBottom'), 10) || 0,
            containerHeight = this._container.offsetHeight + marginBottom,
            containerWidth = this._containerWidth,
            layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);

        layerPos._add(L.DomUtil.getPosition(this._container));

        /** @TODO use popupProto._adjustPan */
        // var containerPos = map.layerPointToContainerPoint(layerPos);
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
            // Track that we're autopanning, as this function will be re-ran on moveend
            if (this.options.keepInView) {
                this._autopanning = true;
            }
            map
                .fire('autopanstart')
                .panBy([dx, dy]);
        }
    },

});
