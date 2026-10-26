/**
 * @external L.Point
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/geometry/Point.js
 */

Object.assign(L.Point.prototype, {

    /**
     * Rotate around (0,0) by applying the 2D rotation matrix:
     * 
     * ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
     * ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
     * 
     * @param {number} theta Rotation angle in radians, counterclockwise.
     * @returns {L.Point} Rotated point (or this point when theta is zero).
     */
    rotate(theta) {
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
     * @param {number} theta Rotation angle in radians, counterclockwise.
     * @param {L.Point} pivot Point to rotate around.
     * 
     * @returns {L.Point}
     */
    rotateFrom(theta, pivot) {
        if (!theta) { return this; }
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const cx = pivot.x,
            cy = pivot.y;
        const x = this.x - cx,
            y = this.y - cy;

        return new L.Point(
            x * cosTheta - y * sinTheta + cx,
            x * sinTheta + y * cosTheta + cy
        );
    },

});

/**
 * Convert an array or point-like object to an `L.Point`.
 * @param {L.Point|number[]|{x:number,y:number}|null} point Coordinate to convert.
 * @returns {L.Point|null} Existing point, converted point, or `null` for a null input.
 */
export function toPoint(point) {
    if (point == null || point instanceof L.Point) {
        return point;
    }
    return Array.isArray(point)
        ? new L.Point(point[0], point[1])
        : new L.Point(point.x, point.y);
}
