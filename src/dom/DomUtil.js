/**
 * @external L.DomUtil
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/DomUtil.js
 */

const domUtilProto = Object.assign({}, L.DomUtil);

Object.assign(L.DomUtil, {
    /**
     * Resets the 3D CSS transform of `el` so it is translated by `offset` pixels,
     * optionally scaled by `scale`, and rotated around `pivot` when `bearing` is set.
     *
     * @param {HTMLElement} el Element to transform.
     * @param {L.Point} [offset] Translation in pixels; defaults to the origin.
     * @param {number} [scale] Optional scale factor.
     * @param {number} [bearing] Optional rotation in radians.
     * @param {L.Point} [pivot] Point in pixels around which to rotate.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setTransform(el, offset, scale, bearing, pivot) {
        let pos = offset || new L.Point(0, 0);

        if (!bearing) {
            return domUtilProto.setTransform(el, pos._round(), scale);
        }

        pos = pos.rotateFrom(bearing, pivot);
        el.style.transform =
            'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)' +
            (scale ? ' scale(' + scale + ')' : '') +
            ' rotate(' + bearing + 'rad)';
    },

    /**
     * Sets the position of `el` to `point`, using CSS transforms or top/left positioning
     * depending on browser support, and optionally rotating it around `pivot`.
     *
     * @param {HTMLElement} el Element to position.
     * @param {L.Point} point Position in pixels.
     * @param {number} [bearing] Rotation in radians; zero or omitted uses Leaflet positioning.
     * @param {L.Point} [pivot] Point in pixels around which to rotate.
     * @param {number} [scale] Optional scale factor.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setPosition(el, point, bearing, pivot, scale) {
        if (!bearing) {
            return domUtilProto.setPosition(el, point);
        }

        el._leaflet_pos = point;
        L.DomUtil.setTransform(el, point, scale, bearing, pivot);
    },

    /**
     * Returns the position assigned to `el`.
     *
     * @param {HTMLElement} el Element whose Leaflet position is requested.
     * 
     * @returns {L.Point} Stored Leaflet position, or the position measured by Leaflet.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getPosition(el) {
        return el._leaflet_pos || domUtilProto.getPosition(el);
    }
});
