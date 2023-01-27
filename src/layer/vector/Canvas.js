/**
 * @external L.Canvas
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/vector/Canvas.js
 */

const canvasProto = L.extend({}, L.Canvas.prototype);

L.Canvas.include({

    // onAdd: function() {
    //     canvasProto.onAdd.apply(this, arguments);
    //     // When rotating the canvas itself, it is cleared by some weird reason, so redraw.
    //     this._map.on('rotate', this._redraw, this);
    // },

    // onRemove: function() {
    //     canvasProto.onRemove.apply(this, arguments);
    //     this._map.off('rotate', this._redraw, this);
    // },

    // _update: function() {
    //     canvasProto._update.apply(this, arguments);
    //     // Tell paths to redraw themselves
    //     this.fire('update')
    // },

});
