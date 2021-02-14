/**
 * L.Icon
 */
const iconProto = L.extend({}, L.Icon.prototype);

L.Icon.include({

    _setIconStyles: function(img, name) {
        var options = this.options;
        var sizeOption = options[name + 'Size'];

        if (typeof sizeOption === 'number') {
            sizeOption = [sizeOption, sizeOption];
        }

        var size = L.point(sizeOption),
            anchor = L.point(name === 'shadow' && options.shadowAnchor || options.iconAnchor ||
                size && size.divideBy(2, true));

        img.className = 'leaflet-marker-' + name + ' ' + (options.className || '');

        if (anchor) {
            img.style.marginLeft = (-anchor.x) + 'px';
            img.style.marginTop = (-anchor.y) + 'px';
            // TODO: use iconProto._setIconStyles
            img.style[L.DomUtil.TRANSFORM + "Origin"] = anchor.x + "px " + anchor.y + "px 0px";
        }

        if (size) {
            img.style.width = size.x + 'px';
            img.style.height = size.y + 'px';
        }
    },

});
