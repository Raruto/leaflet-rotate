/**
 * Adds rotation and pitch-aware positioning to Leaflet markers.
 *
 * @external L.Marker
 * @external L.Handler.MarkerDrag
 * 
 * @property {number} [rotation=0] Marker icon rotation in radians.
 * @property {boolean} [rotateWithView=false] Rotate the icon with the map bearing.
 * @property {boolean} [keepUpright=false] Flip a map-aligned icon to keep it upright.
 * @property {number} [scale] Optional scale applied to the icon and shadow.
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.js
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.Drag.js
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/Draggable.js
 */

const markerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Marker.prototype));

L.Marker.mergeOptions({

    /**
     * Rotation of the marker icon in radians.
     * 
     * @type {Number}
     */
    rotation: 0,

    /**
     * Rotate the marker icon when the map bearing changes.
     *
     * Combine with `keepUpright: true` to keep the marker readable while
     * preserving its line alignment.
     * 
     * @type {Boolean}
     */
    rotateWithView: false,

    /**
     * Flip the icon when needed to keep it upright while map-aligned.
     *
     * @type {Boolean}
     */
    keepUpright: false,

    /**
     * Optional scale of the marker icon and shadow.
     * 
     * @type {Number}
     */
    scale: undefined,

});

let markerDragProto; // retrived at runtime (see below: L.Marker::_initInteraction())

const MarkerDrag = {

    // _onDragStart() {
    //     if (!this._marker._map._rotate) {
    //         return markerDragProto._onDragStart.apply(this, arguments);
    //     }
    //     this._draggable.updateMapBearing(this._marker._map._bearing);
    // },

    /**
     * Update a dragged marker's geographic position from its transformed icon position.
     * 
     * @param {Object} e Marker drag event with `latlng` and `oldLatLng` fields.
     */
    _onDrag(e) {
        const marker = this._marker,
            /** @TODO use markerDragProto._onDrag */
            rotated_marker = marker.options.rotation || marker.options.rotateWithView,
            shadow = marker._shadow;
        let iconPos = L.DomUtil.getPosition(marker._icon);

        /** @TODO use markerDragProto._onDrag */
        // update shadow position
        if (!rotated_marker && shadow) {
            L.DomUtil.setPosition(shadow, iconPos);
        }

        /** @TODO use markerDragProto._onDrag */
        if (marker._map._rotate) {
            // Reverse calculation from mapPane coordinates to rotatePane coordinates
            iconPos = marker._map.mapPanePointToRotatedPoint(iconPos);
        }
        const latlng = marker._map.layerPointToLatLng(iconPos);

        marker._latlng = latlng;
        e.latlng = latlng;
        e.oldLatLng = this._oldLatLng;

        /** @TODO use markerDragProto._onDrag */
        if (rotated_marker) marker.setLatLng(latlng); // use `setLatLng` to presisit rotation. low efficiency
        else marker.fire('move', e); // `setLatLng` will trig 'move' event. we imitate here.

        // @event drag: Event
        // Fired repeatedly while the user drags the marker.
        marker
            .fire('drag', e);
    },

    /**
     * Reposition the marker after a drag ends, then run Leaflet's drag-end logic.
     * 
     * @param {Object} e Marker drag-end event.
     */
    _onDragEnd(e) {
        if (this._marker._map._rotate) {
            this._marker.update();
        }
        markerDragProto._onDragEnd.apply(this, arguments);
    },

};

L.Marker.include({

    /**
     * Extend marker event subscriptions to reposition its icon after bearing or pitch changes.
     * 
     * @listens L.Map~rotate
     * @listens L.Map~pitch
     * 
     * @returns {Object} Leaflet event map for the marker.
     */
    getEvents() {
        const events = Object.assign(markerProto.getEvents.apply(this, arguments), {
            rotate: this.update,
            pitch: this._updatePitchEvents,
        });
        if (this._map && this._map._pitch) {
            events.move = this.update;
        }
        return events;
    },

    /**
     * Subscribe to map movement while pitch is active to keep the icon aligned.
     */
    _updatePitchEvents() {
        if (this._map._pitch) {
            this._map.on('move', this.update, this);
        } else {
            this._map.off('move', this.update, this);
        }
    },

    /**
     * Install rotation-aware drag callbacks when marker dragging is enabled.
     */
    _initInteraction() {
        const ret = markerProto._initInteraction.apply(this, arguments);
        if (this.dragging && this.dragging.enabled() && this._map && this._map._rotate) {
            // L.Handler.MarkerDrag is used internally by L.Marker to make the markers draggable
            markerDragProto = markerDragProto || Object.getPrototypeOf(this.dragging);
            this.dragging.disable();
            Object.assign(this.dragging, {
                // _onDragStart: MarkerDrag._onDragStart.bind(this.dragging),
                _onDrag: MarkerDrag._onDrag.bind(this.dragging),
                _onDragEnd: MarkerDrag._onDragEnd.bind(this.dragging),
            });
            this.dragging.enable();
        }
        return ret;
    },

    /**
     * Position and rotate the marker icon and shadow in map-pane coordinates.
     * 
     * @param {L.Point} pos Marker anchor in layer-point coordinates.
     */
    _setPos(pos) {

        /** @TODO use markerProto._setPos */
        if (this._map._rotate) {
            pos = this._map.rotatedPointToMapPanePoint(pos);
        }

        /** @TODO use markerProto._setPos */
        let bearing = this.options.rotation || 0;
        if (this.options.rotateWithView) {
            bearing += this._map._bearing;
        }
        if (this.options.keepUpright) {
            bearing = ((bearing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            if (bearing > Math.PI / 2 && bearing < 3 * Math.PI / 2) {
                bearing += Math.PI;
            }
            bearing %= 2 * Math.PI;
        }

        /** @TODO use markerProto._setPos */
        if (this._icon) {
            L.DomUtil.setPosition(this._icon, pos, bearing, pos, this.options.scale);
        }

        /** @TODO use markerProto._setPos */
        if (this._shadow) {
            L.DomUtil.setPosition(this._shadow, pos, bearing, pos, this.options.scale);
        }

        this._zIndex = pos.y + this.options.zIndexOffset;

        this._resetZIndex();
    },

    // _updateZIndex(offset) {
    //     if (!this._map._rotate) {
    //         return markerProto._updateZIndex.apply(this, arguments);
    //     }
    //     this._icon.style.zIndex = Math.round(this._zIndex + offset);
    // },

    /**
     * Set the marker icon's rotation and redraw it.
     * 
     * @param {number} rotation Angle in radians.
     * 
     * @returns {void}
     */
    setRotation(rotation) {
        this.options.rotation = rotation;
        this.update();
    },

});
