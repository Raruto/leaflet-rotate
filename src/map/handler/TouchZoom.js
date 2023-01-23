/*
 * L.Handler.TouchZoom is used by L.Map to add pinch zoom on supported mobile browsers.
 */

// @namespace Map
// @section Interaction Options
L.Map.mergeOptions({

    // @section Touch interaction options
    // @option touchZoom: Boolean|String = *
    // Whether the map can be zoomed by touch-dragging with two fingers. If
    // passed `'center'`, it will zoom to the center of the view regardless of
    // where the touch events (fingers) were. Enabled for touch-capable web
    // browsers.
    touchZoom: Browser.touch,

    /**
     * @TODO check if this is a duplicate of `L.Map.TouchGestures::bounceAtZoomLimits`
     */

    // @option bounceAtZoomLimits: Boolean = true
    // Set it to false if you don't want the map to zoom beyond min/max zoom
    // and then bounce back when pinch-zooming.
    bounceAtZoomLimits: false,

});

L.Map.TouchZoom = L.Handler.extend({

    addHooks: function() {
        L.DomUtil.addClass(this._map._container, 'leaflet-touch-zoom');
        this._map.touchGestures.enable();
        this._map.touchGestures.zoom = true;
    },

    removeHooks: function() {
        L.DomUtil.removeClass(this._map._container, 'leaflet-touch-zoom');
        this._map.touchGestures.zoom = false;
    },

});

// @section Handlers
// @property touchZoom: Handler
// Touch zoom handler.
L.Map.addInitHook('addHandler', 'touchZoom', L.Map.TouchZoom);
