/**
 * @external L.DomUtil
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/DomUtil.js
 */

const domUtilProto = L.extend({}, L.DomUtil);

L.extend(L.DomUtil, {

    /**
     * Resets the 3D CSS transform of `el` so it is
     * translated by `offset` pixels and optionally
     * scaled by `scale`. Does not have an effect if
     * the browser doesn't support 3D CSS transforms.
     * 
     * @param {HTMLElement} el 
     * @param {L.Point} offset 
     * @param {Number} scale
     * @param {Number} bearing 
     * @param {L.Point} pivot 
     */
    setTransform: function(el, offset, scale, bearing, pivot) {
        var pos = offset || new L.Point(0, 0);

        if (!bearing) {
            offset = pos._round();
            return domUtilProto.setTransform.apply(this, arguments);
        }

        pos = pos.rotateFrom(bearing, pivot);

        el.style[L.DomUtil.TRANSFORM] =
            'translate3d(' + pos.x + 'px,' + pos.y + 'px' + ',0)' +
            (scale ? ' scale(' + scale + ')' : '') +
            ' rotate(' + bearing + 'rad)';
    },

    /**
     * Sets the position of `el` to coordinates specified by
     * `position`, using CSS translate or top/left positioning
     * depending on the browser (used by Leaflet internally
     * to position its layers).
     * 
     * @param {HTMLElement} el 
     * @param {L.Point} point 
     * @param {Number} bearing
     * @param {L.Point} pivot 
     * @param {Number} scale 
     */
    setPosition: function(el, point, bearing, pivot, scale) {
        if (!bearing) {
            return domUtilProto.setPosition.apply(this, arguments);
        }

        /*eslint-disable */
        el._leaflet_pos = point;
        /*eslint-enable */

        if (L.Browser.any3d) {
            L.DomUtil.setTransform(el, point, scale, bearing, pivot);
        } else {
            el.style.left = point.x + 'px';
            el.style.top = point.y + 'px';
        }
    },

    /**
     * @constant radians = degrees × π/180°
     */
    DEG_TO_RAD: Math.PI / 180,

    /**
     * @constant degrees = radians × 180°/π
     */
    RAD_TO_DEG: 180 / Math.PI,

});
