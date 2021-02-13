/**
 * L.SVG
 */
const svgProto = {
    _update: L.SVG.prototype._update,
};

L.SVG.include({

    _update: function() {
        svgProto._update.call(this);
        if (this._map._rotate) {
            this.fire('update');
        }
    },

});
