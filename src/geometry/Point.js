/**
 * @external L.Point
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/geometry/Point.js
 */

L.extend(L.Point.prototype, {

    /**
     * Rotate around (0,0) by applying the 2D rotation matrix:
     * 
     * ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
     * ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
     * 
     * @param theta must be given in radians.
     */
    rotate: function(theta) {
        return this.rotateFrom(theta, new L.Point(0,0))
    },

    /**
     * Rotate around (pivot.x, pivot.y) by:
     * 
     * 1. subtract (pivot.x, pivot.y)
     * 2. rotate around (0, 0)
     * 3. add (pivot.x, pivot.y) back
     * 
     * same as `this.subtract(pivot).rotate(theta).add(pivot)`
     * 
     * @param {Number} theta 
     * @param {L.Point} pivot 
     * 
     * @returns {L.Point}
     */
    rotateFrom: function(theta, pivot) {
        if (!theta) { return this; }
        var sinTheta = Math.sin(theta);
        var cosTheta = Math.cos(theta);
        var cx = pivot.x,
            cy = pivot.y;
        var x = this.x - cx,
            y = this.y - cy;

        return new L.Point(
            x * cosTheta - y * sinTheta + cx,
            x * sinTheta + y * cosTheta + cy
        );
    },

});
