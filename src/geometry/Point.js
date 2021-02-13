/**
 * L.Point
 */
L.extend(L.Point.prototype, {

    // Rotate around (0,0) by applying the 2D rotation matrix:
    // ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
    // ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
    // Theta must be given in radians.
    rotate: function(theta) {
        if (!theta) { return this; }
        var sinTheta = Math.sin(theta);
        var cosTheta = Math.cos(theta);

        return new L.Point(
            this.x * cosTheta - this.y * sinTheta,
            this.x * sinTheta + this.y * cosTheta
        );
    },

    // Rotate around (pivot.x, pivot.y) by:
    // 1. subtract (pivot.x, pivot.y)
    // 2. rotate around (0, 0)
    // 3. add (pivot.x, pivot.y) back
    // same as `this.subtract(pivot).rotate(theta).add(pivot)`
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
