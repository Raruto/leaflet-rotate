/**
 * @external L.SVG
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/vector/SVG.js
 */

const svgProto = L.extend({}, L.SVG.prototype);

L.SVG.include({

    // _update: function() {
    //     svgProto._update.apply(this, arguments);
    //     if (this._map._rotate) {
    //         this.fire('update');
    //     }
    // },

});
