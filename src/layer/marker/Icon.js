/**
 * Applies icon-anchor transform origins so marker rotation pivots around its anchor.
 *
 * @external L.Icon
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Icon.js
 */

const iconProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Icon.prototype));

L.Icon.include({

    /**
     * Set marker icon dimensions and anchor styles, including the rotation origin.
     * 
     * @param {HTMLImageElement} img Icon or shadow element.
     * @param {string} name Icon style key (`icon` or `shadow`).
     */
    _setIconStyles(img, name) {
        const options = this.options;
        let sizeOption = options[name + 'Size'];

        if (typeof sizeOption === 'number') {
            sizeOption = [sizeOption, sizeOption];
        }

        const size = sizeOption ? new L.Point(...(Array.isArray(sizeOption) ? sizeOption : [sizeOption.x, sizeOption.y])) : null,
            anchorOption = name === 'shadow' && options.shadowAnchor || options.iconAnchor || size && size.divideBy(2, true),
            anchor = anchorOption ? new L.Point(...(Array.isArray(anchorOption) ? anchorOption : [anchorOption.x, anchorOption.y])) : null;

        img.className = 'leaflet-marker-' + name + ' ' + (options.className || '');

        if (anchor) {
            img.style.marginLeft = (-anchor.x) + 'px';
            img.style.marginTop = (-anchor.y) + 'px';
            /** @TODO use iconProto._setIconStyles */
            img.style.transformOrigin = anchor.x + "px " + anchor.y + "px 0px";
        }

        if (size) {
            img.style.width = size.x + 'px';
            img.style.height = size.y + 'px';
        }
    },

});
