/**
 * L.SVG
 */
const svgProto = L.extend({}, L.SVG.prototype);

L.SVG.include({

    _update: function() {
        svgProto._update.call(this);
        if (this._map._rotate) {
            this.fire('update');
        }
    },

});
