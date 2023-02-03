/**
 * Rotates the map according to a smartphone's compass.
 * 
 * @typedef L.Map.CompassBearing
 */

L.Map.CompassBearing = L.Handler.extend({

    initialize: function(map) {
        this._map = map;
        /** @see https://caniuse.com/?search=DeviceOrientation */
        if ('ondeviceorientationabsolute' in window) {
            this.__deviceOrientationEvent = 'deviceorientationabsolute';
        } else if('ondeviceorientation' in window) {
            this.__deviceOrientationEvent = 'deviceorientation';
        }
        this._throttled = L.Util.throttle(this._onDeviceOrientation, 100, this);
    },

    addHooks: function() {
        if (this._map._rotate && this.__deviceOrientationEvent) {
            L.DomEvent.on(window, this.__deviceOrientationEvent, this._throttled, this);
        } else {
            // L.Map.CompassBearing handler will be automatically
            // disabled if device orientation is not supported.
            this.disable();
        }
    },

    removeHooks: function() {
        if (this._map._rotate && this.__deviceOrientationEvent) {
            L.DomEvent.off(window, this.__deviceOrientationEvent, this._throttled, this);
        }
    },

    /**
     * `DeviceOrientationEvent.absolute` - Indicates whether the device is providing absolute
     *                                     orientation values (relatives to Magnetic North) or
     *                                     using some arbitrary frame determined by the device.
     * 
     * `DeviceOrientationEvent.alpha`    - Returns the rotation of the device around the Z axis;
     *                                     that is, the number of degrees by which the device is
     *                                     being twisted around the center of the screen.
     * 
     * `window.orientation`              - Returns the screen orientation in degrees (in 90-degree increments)
     *                                     of the viewport relative to the device's natural orientation.
     *                                     Its only possible values are -90, 0, 90, and 180. Positive
     *                                     values are counterclockwise; negative values are clockwise.
     * 
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/absolute
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/alpha
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/orientation
     */
    _onDeviceOrientation: function(e) {
        var angle = e.webkitCompassHeading || e.alpha;
        var deviceOrientation = 0;

        // Safari iOS
        if (!e.absolute && e.webkitCompassHeading) {
            angle = 360 - angle;
        }

        // Older browsers
        if (!e.absolute && 'undefined' !== typeof window.orientation) {
            deviceOrientation = window.orientation;
        }

        this._map.setBearing(angle - deviceOrientation);
    },

});

/**
 * Add Compass bearing handler to L.Map (disabled unless `window.DeviceOrientationEvent` is set).
 * 
 * @property {L.Map.CompassBearing} compassBearing
 */
L.Map.addInitHook('addHandler', 'compassBearing', L.Map.CompassBearing);
