/**
 * @external L.DomUtil
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/DomUtil.js
 */

const domUtilProto = L.extend({}, L.DomUtil);

L.extend(L.DomUtil, {

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

    setPosition: function(el, point, bearing, pivot, scale) { // (HTMLElement, Point[, Boolean])
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

    // Constants for rotation
    DEG_TO_RAD: Math.PI / 180,
    RAD_TO_DEG: 180 / Math.PI,

});
