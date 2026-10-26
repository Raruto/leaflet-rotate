/**
 * Keeps popup and tooltip screen positions aligned with rotated and pitched maps.
 *
 * @external L.DivOverlay
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/DivOverlay.js
 * 
 * @since leaflet-rotate (v0.1.0)
 */

import { toPoint } from '../geometry/Point';

const divOverlayProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.DivOverlay.prototype));

L.DivOverlay.include({

    /**
     * Extend overlay event subscriptions to refresh position after map rotation and pitch.
     * 
     * @listens L.Map~rotate
     * @listens L.Map~pitch
     *
     * @returns {Object} Leaflet event map for the overlay.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
        const events = Object.assign(divOverlayProto.getEvents.apply(this, arguments), {
            rotate: this._updatePosition,
            pitch: this._updatePitchEvents,
        });
        if (this._map && this._map._pitch) {
            events.move = this._updatePosition;
        }
        return events;
    },

    /**
     * Listen to map movement only while pitch is non-zero.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchEvents() {
        if (this._map._pitch) {
            this._map.on('move', this._updatePosition, this);
        } else {
            this._map.off('move', this._updatePosition, this);
        }
    },

    /**
     * Reposition the overlay after map movement, applying rotation/pitch-aware coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updatePosition() {
        if (!this._map) { return; }
        divOverlayProto._updatePosition.apply(this, arguments);
        if (this._map._rotate && this._zoomAnimated) {
            const anchor = this._getAnchor();
            const pos = L.DomUtil.getPosition(this._container).subtract(anchor);
            L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
        } else if (this._map._rotate) {
            const mapPanePoint = this._map.rotatedPointToMapPanePoint(this._map.latLngToLayerPoint(this._latlng)),
                offset = toPoint(this.options.offset || [0, 0]),
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
