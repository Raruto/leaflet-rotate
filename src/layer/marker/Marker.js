/**
 * @external L.Marker
 * @external L.Handler.MarkerDrag
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.js
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.Drag.js
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/Draggable.js
 */

const markerProto = L.extend({}, L.Marker.prototype);

L.Marker.mergeOptions({

    /**
     * Rotation of this marker in rad
     * 
     * @type {Number}
     */
    rotation: 0,

    /**
     * Rotate this marker when map rotates
     * 
     * @type {Boolean}
     */
    rotateWithView: false,

    /**
     * Scale of the marker icon
     * 
     * @type {Number}
     */
    scale: undefined,

});

var markerDragProto; // retrived at runtime (see below: L.Marker::_initInteraction())

var MarkerDrag = {

    // _onDragStart: function() {
    //     if (!this._marker._map._rotate) {
    //         return markerDragProto._onDragStart.apply(this, arguments);
    //     }
    //     this._draggable.updateMapBearing(this._marker._map._bearing);
    // },

    _onDrag: function(e) {
        var marker = this._marker,
            /** @TODO use markerDragProto._onDrag */
            rotated_marker = marker.options.rotation || marker.options.rotateWithView,
            shadow = marker._shadow,
            iconPos = L.DomUtil.getPosition(marker._icon);

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
        var latlng = marker._map.layerPointToLatLng(iconPos);

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

    _onDragEnd: function(e) {
        if (this._marker._map._rotate) {
            this._marker.update();
        }
        markerDragProto._onDragEnd.apply(this, arguments);
    },

};

L.Marker.include({

    /**
     * Update L.Marker anchor position after the map
     * is moved by calling `map.setBearing(theta)`
     * 
     * @listens L.Map~rotate
     */
    getEvents: function() {
        return L.extend(markerProto.getEvents.apply(this, arguments), { rotate: this.update });
    },

    _initInteraction: function() {
        var ret = markerProto._initInteraction.apply(this, arguments);
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

    _setPos: function(pos) {

        /** @TODO use markerProto._setPos */
        if (this._map._rotate) {
            pos = this._map.rotatedPointToMapPanePoint(pos);
        }

        /** @TODO use markerProto._setPos */
        var bearing = this.options.rotation || 0;
        if (this.options.rotateWithView) {
            bearing += this._map._bearing;
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

    // _updateZIndex: function(offset) {
    //     if (!this._map._rotate) {
    //         return markerProto._updateZIndex.apply(this, arguments);
    //     }
    //     this._icon.style.zIndex = Math.round(this._zIndex + offset);
    // },

    setRotation: function(rotation) {
        this.options.rotation = rotation;
        this.update();
    },

});
