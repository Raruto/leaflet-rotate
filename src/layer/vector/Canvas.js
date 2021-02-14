/**
 * L.Canvas
 */
const canvasProto = L.extend({}, L.Canvas.prototype);

L.Canvas.include({

    onAdd: function() {
        canvasProto.onAdd.call(this);
        // When rotating the canvas itself, it is cleared by some weird reason, so redraw.
        this._map.on('rotate', this._redraw, this);
    },

    onRemove: function() {
        canvasProto.onRemove.call(this);
        this._map.off('rotate', this._redraw, this);
    },

    _update: function() {
        canvasProto._update.call(this);
        // Tell paths to redraw themselves
        this.fire('update')
    },

});
