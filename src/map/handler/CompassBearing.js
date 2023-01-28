/**
 * Rotates the map according to a smartphone's compass.
 * 
 * @typedef L.Map.CompassBearing
 */

L.Map.CompassBearing = L.Handler.extend({

    initialize: function(map) {
        this._map = map;
        this._throttled = L.Util.throttle(this._onDeviceOrientation, 1000, this);
    },

    addHooks: function() {
        if (this._map._rotate && window.DeviceOrientationEvent) {
            L.DomEvent.on(window, 'deviceorientation', this._throttled, this);
        }
    },

    removeHooks: function() {
        if (this._map._rotate && window.DeviceOrientationEvent) {
            L.DomEvent.off(window, 'deviceorientation', this._throttled, this);
        }
    },

    _onDeviceOrientation: function(event) {
        if (event.alpha !== null && window.orientation !== undefined) {
            this._map.setBearing(event.alpha - window.orientation);
        }
    },

});

/**
 * Add Compass bearing handler to L.Map (disabled unless `window.DeviceOrientationEvent` is set).
 * 
 * @property {L.Map.CompassBearing} compassBearing
 */
L.Map.addInitHook('addHandler', 'compassBearing', L.Map.CompassBearing);
