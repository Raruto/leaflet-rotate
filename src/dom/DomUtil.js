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
     * @param {HTMLElement} el
     * @param {L.Point} offset
     * @param {Number} scale
     * @param {Number} bearing
     * @param {L.Point} pivot
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
     * @param {HTMLElement} el
     * @param {L.Point} point
     * @param {Number} bearing
     * @param {L.Point} pivot
     * @param {Number} scale
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
     * @param {HTMLElement} el
     * @returns {L.Point}
     */
    getPosition(el) {
        return el._leaflet_pos || domUtilProto.getPosition(el);
    }
});
