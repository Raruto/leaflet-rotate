/**
 * Preserve the final position when an active drag returns within its starting
 * click tolerance. Marker geographic coordinates are adapted in `L.Marker`.
 *
 * @external L.Draggable
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/Draggable.js
 */

/**
 * A class for making DOM elements draggable (including touch support).
 * Used internally for map and marker dragging. Only works for elements
 * that were positioned with [`L.DomUtil.setPosition`](#domutil-setposition).
 *
 * @since leaflet-rotate (v0.1.0)
 */

const draggableProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Draggable.prototype));

L.Draggable.include({
    _onMove(e) {
        const pointer = e.touches ? e.touches[0] : e;
        if (this._enabled && this._moving && (!e.touches || e.touches.length === 1)) {
            const offset = new L.Point(pointer.clientX, pointer.clientY).subtract(this._startPoint);
            if ((!offset.x && !offset.y) || Math.abs(offset.x) + Math.abs(offset.y) < this.options.clickTolerance) {
                L.DomEvent.preventDefault(e);
                this._newPos = this._startPos.add(new L.Point(
                    offset.x / this._parentScale.x, offset.y / this._parentScale.y
                ));
                this._lastEvent = e;
                this._updatePosition();
                return;
            }
        }
        return draggableProto._onMove.apply(this, arguments);
    },
});