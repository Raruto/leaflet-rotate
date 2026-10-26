/**
 * Preserves popup positioning and auto-pan behavior on rotated maps.
 *
 * @external L.Popup
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/Popup.js
 * 
 * @since leaflet-rotate (v0.1.0)
 */

import { toPoint } from '../geometry/Point';

const popupProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Popup.prototype));

L.Popup.include({

    /**
     * Update the popup position during zoom animation and transform it into map-pane coordinates.
     *
     * @param {Object} e Zoom animation event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoom(e) {
        popupProto._animateZoom.apply(this, arguments);
        if (this._map && this._map._rotate) {
            const anchor = this._getAnchor();
            const pos = L.DomUtil.getPosition(this._container).subtract(anchor);
            L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
        }
    },

    /**
     * Pan the map when a popup with auto-pan enabled would extend beyond the viewport.
     * 
     * @see https://github.com/fnicollet/Leaflet/pull/21
     *
     * @fires L.Map#autopanstart
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _adjustPan() {
        if (!this.options.autoPan || (this._map._panAnim && this._map._panAnim._inProgress)) { return; }

        // We can endlessly recurse if keepInView is set and the view resets.
        // Let's guard against that by exiting early if we're responding to our own autopan.
        if (this._autopanning) {
            this._autopanning = false;
            return;
        }

        const map = this._map,
            marginBottom = parseInt(getComputedStyle(this._container).marginBottom, 10) || 0,
            containerHeight = this._container.offsetHeight + marginBottom,
            containerWidth = this._containerWidth,
            layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);

        layerPos._add(L.DomUtil.getPosition(this._container));

        /** @TODO use popupProto._adjustPan */
        // var containerPos = map.layerPointToContainerPoint(layerPos);
        const containerPos = layerPos._add(this._map._getMapPanePos()),
            padding = toPoint(this.options.autoPanPadding || [0, 0]),
            paddingTL = toPoint(this.options.autoPanPaddingTopLeft || padding),
            paddingBR = toPoint(this.options.autoPanPaddingBottomRight || padding),
            size = map.getSize();
        let dx = 0,
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
