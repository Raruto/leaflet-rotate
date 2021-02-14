/**
 * L.DomUtil
 */
const domUtilProto = L.extend({}, L.DomUtil);

L.extend(L.DomUtil, {

    setTransform: function(el, offset, scale, bearing, pivot) {
        var pos = offset || new L.Point(0, 0);

        if (!bearing) {
            offset = pos._round();
            return domUtilProto.setTransform.call(this, el, offset, scale);
        }

        pos = pos.rotateFrom(bearing, pivot);

        el.style[L.DomUtil.TRANSFORM] =
            'translate3d(' + pos.x + 'px,' + pos.y + 'px' + ',0)' +
            (scale ? ' scale(' + scale + ')' : '') +
            ' rotate(' + bearing + 'rad)';
    },

    setPosition: function(el, point, bearing, pivot) { // (HTMLElement, Point[, Boolean])
        if (!bearing) {
            return domUtilProto.setPosition.call(this, el, point);
        }

        /*eslint-disable */
        el._leaflet_pos = point;
        /*eslint-enable */

        if (L.Browser.any3d) {
            L.DomUtil.setTransform(el, point, undefined, bearing, pivot);
        } else {
            el.style.left = point.x + 'px';
            el.style.top = point.y + 'px';
        }
    },

    // Constants for rotation
    DEG_TO_RAD: Math.PI / 180,
    RAD_TO_DEG: 180 / Math.PI,

});
