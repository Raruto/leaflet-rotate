/**
 * Apply maxBoundsViscosity in projected ground coordinates before moving the map pane.
 */
import { L } from './L.js';

const DragHandler = L.DragHandler || L.Map.Drag;
const dragProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(DragHandler.prototype));

DragHandler.include({

    /**
     * Capture the ground footprint and pointer anchor before a constrained drag.
     */
    _onDragStart() {
        dragProto._onDragStart.apply(this, arguments);
        const map = this._map;
        this._rotateLimit = null;
        if (!map._rotate || !map.options.maxBounds || !map.options.maxBoundsViscosity) { return; }
        const anchor = (map.pointerEventToContainerPoint || map.mouseEventToContainerPoint).call(map, {
                clientX: this._draggable._startPoint.x, clientY: this._draggable._startPoint.y,
            }),
            footprint = map._getPaddedPixelBounds(0, false),
            origin = map.getPixelOrigin();
        this._rotateLimit = {
            anchor,
            layerAnchor: map.containerPointToLayerPoint(anchor),
            panePos: map._getMapPanePos().clone(),
            footprint: new L.Bounds(footprint.min.add(origin), footprint.max.add(origin)),
            matrix: map._pitch ? map._pitchTransform : null,
            inverse: map._pitchInverseTransform,
            bearing: map._bearing,
        };
    },

    /**
     * Apply max-bounds viscosity in ground coordinates during a rotated drag.
     */
    _onPreDragLimit() {
        const limit = this._rotateLimit;
        if (!this._map._rotate || !limit) {
            return dragProto._onPreDragLimit.apply(this, arguments);
        }
        const map = this._map,
            draggable = this._draggable,
            offset = draggable._newPos.subtract(draggable._startPos),
            shift = limit.matrix
                ? map._transformPitchPoint(limit.anchor.add(offset).subtract(limit.panePos), limit.inverse,
                    limit.anchor.subtract(limit.panePos))
                    .subtract(limit.layerAnchor)
                : offset.rotate(-limit.bearing),
            correction = map._getBoundsOffset(new L.Bounds(
                limit.footprint.min.subtract(shift), limit.footprint.max.subtract(shift)
            ), map.options.maxBounds);
        shift._subtract(correction.multiplyBy(this._viscosity));
        const limitedOffset = limit.matrix
            ? map._transformPitchPoint(limit.layerAnchor.add(shift), limit.matrix)
                .add(limit.panePos).subtract(limit.anchor)
            : shift.rotate(limit.bearing);
        draggable._newPos = draggable._startPos.add(limitedOffset);
    },

});
