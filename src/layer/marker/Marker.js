/**
 * @external L.Marker
 * @external L.Handler.MarkerDrag
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.js
 */

const markerProto = L.extend({}, L.Marker.prototype);

L.Marker.mergeOptions({

    // @option rotation: Number = 0
    // Rotation of this marker in rad
    rotation: 0,

    // @option rotateWithView: Boolean = false
    // Rotate this marker when map rotates
    rotateWithView: false,

});

var markerDragProto; // retrived at runtime (see below: L.Marker::_initInteraction())

var MarkerDrag = {

    _onDragStart: function() {
        if (!this._marker._map._rotate) {
            return markerDragProto._onDragStart.call(this)
        }
        this._draggable.updateMapBearing(this._marker._map._bearing);
    },

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
        markerDragProto._onDragEnd.call(this, e);
    },

};

L.Marker.include({

    getEvents: function() {
        return L.extend(markerProto.getEvents.call(this), { rotate: this.update });
    },

    onAdd: function(map) {
        markerProto.onAdd.call(this, map);
        map.on('rotate', this.update, this);
    },

    _initInteraction: function() {
        var ret = markerProto._initInteraction.call(this);
        if (this.dragging && this.dragging.enabled() && this._map && this._map._rotate) {
            // L.Handler.MarkerDrag is used internally by L.Marker to make the markers draggable
            markerDragProto = markerDragProto || Object.getPrototypeOf(this.dragging);
            Object.assign(this.dragging, {
                _onDragStart: MarkerDrag._onDragStart.bind(this.dragging),
                _onDrag: MarkerDrag._onDrag.bind(this.dragging),
                _onDragEnd: MarkerDrag._onDragEnd.bind(this.dragging),
            })
            this.dragging.disable();
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
            L.DomUtil.setPosition(this._icon, pos, bearing, pos);
        }

        /** @TODO use markerProto._setPos */
        if (this._shadow) {
            L.DomUtil.setPosition(this._shadow, pos, bearing, pos);
        }

        this._zIndex = pos.y + this.options.zIndexOffset;

        this._resetZIndex();
    },

    /**
     * @FIXME temporary disabled on rotated maps for fix: https://github.com/Raruto/leaflet-rotate/issues/18
     * 
     * @since leaflet@v1.8
     * @see https://github.com/Leaflet/Leaflet/commit/4f639a85efffa49c3e64a07dc0b6f5aa73f13449
     */
    _panOnFocus: function () {
        if (!this._map._rotate) {
            return markerProto._panOnFocus.call(this)
        }

        // var map = this._map;
        // if (!map) { return; }

        // var iconOpts = this.options.icon.options;
        // var size = iconOpts.iconSize ? L.point(iconOpts.iconSize) : L.point(0, 0);
        // var anchor = iconOpts.iconAnchor ? L.point(iconOpts.iconAnchor) : L.point(0, 0);

        // map.panInside(this._latlng, {
        //     paddingTopLeft: anchor,
        //     paddingBottomRight: size.subtract(anchor)
        // });
    },

    _updateZIndex: function(offset) {
        if (!this._map._rotate) {
            return markerProto._updateZIndex.call(this, offset)
        }
        this._icon.style.zIndex = Math.round(this._zIndex + offset);
    },

    setRotation: function(rotation) {
        this.options.rotation = rotation;
        this.update();
    },

});
