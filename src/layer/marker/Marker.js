/**
 * Adds rotation and pitch-aware positioning to Leaflet markers.
 *
 * @external L.Marker
 * @external L.Handler.MarkerDrag
 * 
 * @property {number} [rotation=0] Marker icon rotation in radians.
 * @property {boolean} [rotateWithView=false] Rotate the icon with the map bearing.
 * @property {boolean} [keepUpright=false] Flip a map-aligned icon to keep it upright.
 * @property {number} [scale] Optional scale applied to the icon and shadow.
 *
 * When the map has `preferCanvas: true`, markers using an image `L.Icon`
 * are drawn on the map's Canvas renderer instead of creating `<img>` elements.
 * 
 * @since leaflet-rotate (v0.1.0)
 * 
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.js
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/layer/marker/Marker.Drag.js
 * @see https://github.com/Leaflet/Leaflet/tree/v1.9.3/src/dom/Draggable.js
 */

const markerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Marker.prototype));

L.Marker.mergeOptions({

    /**
     * Rotation of the marker icon in radians.
     * 
     * @type {Number}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotation: 0,

    /**
     * Rotate the marker icon when the map bearing changes.
     *
     * Combine with `keepUpright: true` to keep the marker readable while
     * preserving its line alignment.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateWithView: false,

    /**
     * Flip the icon when needed to keep it upright while map-aligned.
     *
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    keepUpright: false,

    /**
     * Optional scale of the marker icon and shadow.
     * 
     * @type {Number}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    scale: undefined,

});

let markerDragProto; // retrived at runtime (see below: L.Marker::_initInteraction())

const canvasImages = {};

const toPoint = value => {
    if (value == null) { return null; }
    if (typeof value === 'number') { return new L.Point(value, value); }
    return Array.isArray(value) ? new L.Point(value[0], value[1]) : new L.Point(value.x, value.y);
};

// Marker sprites use screen-space coordinates, unlike vectors on the map plane.
const MarkerCanvas = L.Canvas.extend({

    getEvents() {
        return {
            move: this._refresh,
            zoom: this._refresh,
            rotate: this._refresh,
            pitch: this._refresh,
            resize: this._refresh,
            viewreset: this._refresh,
            zoomanim: this._animateMarkers,
        };
    },

    onAdd() {
        this._initContainer();
        this._container.classList.add('leaflet-zoom-animated');
        // Below DOM markers (whose z-index follows their y position) so they stay visible and clickable.
        this._container.style.zIndex = -1e9;
        this.getPane().prepend(this._container);
        this._zoomProbe = L.DomUtil.create('div', 'leaflet-zoom-animated', this.getPane());
        this._zoomProbe.style.visibility = 'hidden';
        this._zoomProbe.style.pointerEvents = 'none';
        this._refresh();
    },

    onRemove() {
        cancelAnimationFrame(this._zoomFrame);
        this._zoomProbe.remove();
        L.Canvas.prototype.onRemove.apply(this, arguments);
    },

    _animateMarkers(e) {
        if (!this._map._animatingZoom) {
            this._viewEvent = e;
            this._refresh();
            return;
        }
        cancelAnimationFrame(this._zoomFrame);
        const map = this._map;
        this._zoomFrom = { zoom: map.getZoom(), origin: map.getPixelOrigin().clone() };
        this._viewEvent = e;
        this._zoomProgress = 0;
        // Sample a native CSS transition started alongside Leaflet's tile/vector transitions.
        const probe = this._zoomProbe;
        probe.style.transition = 'none';
        probe.style.transform = 'translate3d(0px,0,0)';
        getComputedStyle(probe).transform;
        probe.style.transition = '';
        probe.style.transform = 'translate3d(1px,0,0)';
        const frame = () => {
            if (!this._map || !map._animatingZoom) { return; }
            this._zoomProgress = new DOMMatrix(getComputedStyle(probe).transform).m41;
            this._refresh();
            this._zoomFrame = requestAnimationFrame(frame);
        };
        this._refresh();
        this._zoomFrame = requestAnimationFrame(frame);
    },

    _refresh(e) {
        const map = this._map,
            min = map._getMapPanePos().multiplyBy(-1).round(),
            size = map.getSize(),
            ratio = window.devicePixelRatio || 1;
        this._bounds = new L.Bounds(min, min.add(size));
        L.DomUtil.setPosition(this._container, min);
        this._container.style.width = size.x + 'px';
        this._container.style.height = size.y + 'px';
        if (this._container.width !== Math.round(size.x * ratio)
            || this._container.height !== Math.round(size.y * ratio)) {
            this._container.width = Math.round(size.x * ratio);
            this._container.height = Math.round(size.y * ratio);
        }
        this._ctx.setTransform(ratio, 0, 0, ratio, -min.x * ratio, -min.y * ratio);
        if (!map._animatingZoom && this._zoomFrom) {
            cancelAnimationFrame(this._zoomFrame);
            this._zoomFrom = this._viewEvent = null;
        }
        if (!map._animatingZoom && e) { this._viewEvent = null; }
        for (const layer of Object.values(this._layers)) {
            layer._project();
        }
        this._redrawBounds = null;
        this._redraw();
    },

});

/**
 * Internal Canvas layer that draws an `L.Marker` image icon (and its shadow).
 *
 * Pointer events are forwarded to the owning marker, so its popups, tooltips
 * and listeners keep working.
 *
 * @since leaflet-rotate (0.6.0)
 */
const CanvasIcon = L.CircleMarker.extend({

    initialize(marker) {
        const map = marker._map;
        if (!map._canvasMarkerRenderer) {
            map._canvasMarkerRenderer = new MarkerCanvas({ pane: 'markerPane' });
        }
        L.CircleMarker.prototype.initialize.call(this, marker.getLatLng(), {
            radius: 0,
            interactive: marker.options.interactive,
            bubblingMouseEvents: marker.options.bubblingMouseEvents,
            renderer: map._canvasMarkerRenderer,
        });
        this._marker = marker;
        this._loadImages();
    },

    _loadImages() {
        const icon = this._marker.options.icon;
        this._images = {};
        for (const name of ['shadow', 'icon']) {
            const url = icon._getIconUrl(name);
            if (!url) { continue; }
            let img = canvasImages[url];
            if (!img) {
                img = canvasImages[url] = new Image();
                img.src = url;
            }
            if (!img.complete) {
                img.addEventListener('load', () => this._map && this._images[name] === img && this.redraw(), { once: true });
            }
            this._images[name] = img;
        }
    },

    _getPart(name) {
        const img = this._images[name];
        if (!img || !img.complete || !img.naturalWidth) { return null; }
        const options = this._marker.options.icon.options,
            size = toPoint(options[name + 'Size']) || new L.Point(img.naturalWidth, img.naturalHeight),
            anchor = toPoint(name === 'shadow' && options.shadowAnchor || options.iconAnchor) || size.divideBy(2);
        return { img, size, anchor };
    },

    _getAngle() {
        return this._marker._getIconBearing();
    },

    getLatLng() {
        return this._marker.getLatLng();
    },

    fire(type) {
        if (type === 'add' || type === 'remove') {
            return L.CircleMarker.prototype.fire.apply(this, arguments);
        }
        this._marker.fire.apply(this._marker, arguments);
        return this;
    },

    listens(type) {
        if (type === 'add' || type === 'remove') {
            return L.CircleMarker.prototype.listens.apply(this, arguments);
        }
        return this._marker.listens.apply(this._marker, arguments);
    },

    _project() {
        const map = this._map,
            view = this._renderer._viewEvent,
            from = this._renderer._zoomFrom;
        let point = view
                ? map._latLngToNewLayerPoint(this.getLatLng(), view.zoom, view.center)
                : map.latLngToLayerPoint(this.getLatLng());
        if (from) {
            const start = map.project(this.getLatLng(), from.zoom).subtract(from.origin);
            point = start.add(point.subtract(start).multiplyBy(this._renderer._zoomProgress));
        }
        const matrix = map._pitch && map._pitchTransform;
        this._behindCamera = Boolean(matrix && matrix.m14 * point.x + matrix.m24 * point.y + matrix.m44 <= 0);
        this._point = map._rotate ? map.rotatedPointToMapPanePoint(point) : point;
        this._updateBounds();
        this._marker._syncCanvasAccessibility();
    },

    _updateBounds() {
        const scale = this._marker.options.scale || 1;
        let radius = 0;
        for (const name of ['shadow', 'icon']) {
            const part = this._getPart(name);
            if (!part) { continue; }
            const { size, anchor } = part;
            radius = Math.max(radius, Math.hypot(Math.max(anchor.x, size.x - anchor.x), Math.max(anchor.y, size.y - anchor.y)) * scale);
        }
        const r = new L.Point(radius, radius);
        this._pxBounds = new L.Bounds(this._point.subtract(r), this._point.add(r));
    },

    _empty() {
        return this._behindCamera || !this._renderer._bounds.intersects(this._pxBounds);
    },

    _updatePath() {
        const renderer = this._renderer;
        if (!renderer._drawing || this._empty()) { return; }

        const ctx = renderer._ctx,
            options = this._marker.options,
            scale = options.scale || 1;

        ctx.save();
        ctx.globalAlpha = options.opacity;
        ctx.translate(this._point.x, this._point.y);
        ctx.rotate(this._getAngle());
        ctx.scale(scale, scale);
        for (const name of ['shadow', 'icon']) {
            const part = this._getPart(name);
            if (part) {
                ctx.drawImage(part.img, -part.anchor.x, -part.anchor.y, part.size.x, part.size.y);
            }
        }
        ctx.restore();
    },

    _containsPoint(p) {
        if (this._behindCamera) { return false; }
        const part = this._getPart('icon');
        if (!part) { return false; }
        const point = this._map._rotate ? this._map.rotatedPointToMapPanePoint(p) : p;
        const local = point.subtract(this._point)
            .rotate(-this._getAngle())
            .divideBy(this._marker.options.scale || 1)
            .add(part.anchor);
        return local.x >= 0 && local.y >= 0 && local.x <= part.size.x && local.y <= part.size.y;
    },

});

const CanvasMarkerDrag = L.Handler.extend({

    initialize(marker) {
        this._marker = marker;
    },

    addHooks() {
        this._canvas = this._marker._canvasIcon._renderer._container;
        L.DomEvent.on(this._canvas, 'pointerdown', this._onDown, this);
        this._stopClick = e => {
            if (this._moved) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        };
        this._canvas.addEventListener('click', this._stopClick, true);
    },

    removeHooks() {
        this._onUp();
        L.DomEvent.off(this._canvas, 'pointerdown', this._onDown, this);
        this._canvas.removeEventListener('click', this._stopClick, true);
    },

    moved() {
        return Boolean(this._moved);
    },

    _containerPoint(e) {
        const map = this._marker._map;
        return (map.pointerEventToContainerPoint || map.mouseEventToContainerPoint).call(map, e);
    },

    _onDown(e) {
        if (this._pointerId != null) {
            if (e.pointerId !== this._pointerId) { this._onUp(); }
            return;
        }
        this._moved = false;
        if (e.button !== 0 || !e.isPrimary || e.shiftKey || e.ctrlKey || e.metaKey) { return; }
        const marker = this._marker,
            map = marker._map,
            point = map.containerPointToLayerPoint(this._containerPoint(e)),
            layer = marker._canvasIcon;
        if (!layer._containsPoint(point)) { return; }
        // Only the topmost interactive layer can start a drag.
        for (let order = layer._renderer._drawLast; order; order = order.prev) {
            if (order.layer.options.interactive && order.layer._containsPoint(point)) {
                if (order.layer !== layer) { return; }
                break;
            }
            if (!order.prev) { return; }
        }
        L.DomEvent.stop(e);
        this._mapDragging = map.dragging && map.dragging.enabled();
        if (this._mapDragging) { map.dragging.disable(); }
        map._stop();
        this._pointerId = e.pointerId;
        this._startPoint = this._point = this._containerPoint(e);
        this._offset = map.latLngToContainerPoint(marker.getLatLng()).subtract(this._point);
        this._oldLatLng = marker.getLatLng();
        L.DomEvent.on(document, 'pointermove', this._onMove, this);
        L.DomEvent.on(document, 'pointerup pointercancel', this._onUp, this);
        L.DomEvent.on(window, 'blur', this._onUp, this);
    },

    _onMove(e) {
        if (e.pointerId !== this._pointerId) { return; }
        this._point = this._containerPoint(e);
        if (!this._moved) {
            const delta = this._point.subtract(this._startPoint);
            if (Math.abs(delta.x) + Math.abs(delta.y) < 3) { return; }
            this._moved = true;
            this._marker.closePopup();
            this._marker.fire('movestart').fire('dragstart');
        }
        if (this._pointerId == null) { return; }
        L.DomEvent.preventDefault(e);
        this._lastEvent = e;
        this._updatePosition();
        cancelAnimationFrame(this._panRequest);
        if (this._marker.options.autoPan) { this._adjustPan(); }
    },

    _updatePosition() {
        const marker = this._marker,
            latlng = marker._map.containerPointToLatLng(this._point.add(this._offset)),
            data = { latlng, oldLatLng: this._oldLatLng, originalEvent: this._lastEvent };
        marker._latlng = latlng;
        marker.update();
        marker.fire('move', data).fire('drag', data);
    },

    _adjustPan() {
        if (this._pointerId == null) { return; }
        const marker = this._marker,
            map = marker._map,
            padding = toPoint(marker.options.autoPanPadding),
            max = map.getSize().subtract(padding),
            point = this._point.add(this._offset),
            speed = marker.options.autoPanSpeed,
            movement = new L.Point(
                point.x < padding.x ? -speed : point.x > max.x ? speed : 0,
                point.y < padding.y ? -speed : point.y > max.y ? speed : 0
            );
        if (!movement.x && !movement.y) { return; }
        map.panBy(movement, { animate: false });
        this._updatePosition();
        this._panRequest = requestAnimationFrame(() => this._adjustPan());
    },

    _onUp(e) {
        if (this._pointerId == null || e && e.pointerId != null && e.pointerId !== this._pointerId) { return; }
        this._pointerId = null;
        cancelAnimationFrame(this._panRequest);
        L.DomEvent.off(document, 'pointermove', this._onMove, this);
        L.DomEvent.off(document, 'pointerup pointercancel', this._onUp, this);
        L.DomEvent.off(window, 'blur', this._onUp, this);
        if (this._mapDragging) {
            this._marker._map.dragging.enable();
            this._mapDragging = false;
        }
        if (this._moved) {
            this._marker.fire('moveend').fire('dragend', {
                distance: this._point.distanceTo(this._startPoint),
            });
        }
    },

});

const MarkerDrag = {

    // _onDragStart() {
    //     if (!this._marker._map._rotate) {
    //         return markerDragProto._onDragStart.apply(this, arguments);
    //     }
    //     this._draggable.updateMapBearing(this._marker._map._bearing);
    // },

    /**
     * Update a dragged marker's geographic position from its transformed icon position.
     * 
     * @param {Object} e Marker drag event with `latlng` and `oldLatLng` fields.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onDrag(e) {
        const marker = this._marker,
            /** @TODO use markerDragProto._onDrag */
            rotated_marker = marker.options.rotation || marker.options.rotateWithView,
            shadow = marker._shadow;
        let iconPos = L.DomUtil.getPosition(marker._icon);

        /** @TODO use markerDragProto._onDrag */
        // update shadow position
        if (!rotated_marker && shadow) {
            L.DomUtil.setPosition(shadow, iconPos);
        }

        /** @TODO use markerDragProto._onDrag */
        if (marker._map._rotate) {
            // Reverse calculation from mapPane coordinates to rotatePane coordinates
            iconPos = marker._map.mapPanePointToRotatedPoint(iconPos);
        }
        const latlng = marker._map.layerPointToLatLng(iconPos);

        marker._latlng = latlng;
        e.latlng = latlng;
        e.oldLatLng = this._oldLatLng;

        /** @TODO use markerDragProto._onDrag */
        if (rotated_marker) marker.setLatLng(latlng); // use `setLatLng` to presisit rotation. low efficiency
        else marker.fire('move', e); // `setLatLng` will trig 'move' event. we imitate here.

        // @event drag: Event
        // Fired repeatedly while the user drags the marker.
        marker
            .fire('drag', e);
    },

    /**
     * Reposition the marker after a drag ends, then run Leaflet's drag-end logic.
     * 
     * @param {Object} e Marker drag-end event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onDragEnd(e) {
        if (this._marker._map._rotate) {
            this._marker.update();
        }
        markerDragProto._onDragEnd.apply(this, arguments);
    },

};

L.Marker.include({

    /**
     * Extend marker event subscriptions to reposition its icon after bearing or pitch changes.
     * 
     * @listens L.Map~rotate
     * @listens L.Map~pitch
     * 
     * @returns {Object} Leaflet event map for the marker.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
        const events = Object.assign(markerProto.getEvents.apply(this, arguments), {
            rotate: this.update,
            pitch: this._updatePitchEvents,
        });
        if (this._map && this._map._pitch && !this._canvasIcon) {
            events.move = this.update;
        }
        return events;
    },

    /**
     * Subscribe to map movement while pitch is active to keep the icon aligned.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchEvents() {
        if (this._map._pitch && !this._canvasIcon) {
            this._map.on('move', this.update, this);
        } else {
            this._map.off('move', this.update, this);
        }
    },

    /**
     * Install rotation-aware drag callbacks when marker dragging is enabled.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _initInteraction() {
        const ret = markerProto._initInteraction.apply(this, arguments);
        if (this.dragging && this.dragging.enabled() && this._map && this._map._rotate) {
            // L.Handler.MarkerDrag is used internally by L.Marker to make the markers draggable
            markerDragProto = markerDragProto || Object.getPrototypeOf(this.dragging);
            this.dragging.disable();
            Object.assign(this.dragging, {
                // _onDragStart: MarkerDrag._onDragStart.bind(this.dragging),
                _onDrag: MarkerDrag._onDrag.bind(this.dragging),
                _onDragEnd: MarkerDrag._onDragEnd.bind(this.dragging),
            });
            this.dragging.enable();
        }
        return ret;
    },

    /**
     * Position and rotate the marker icon and shadow in map-pane coordinates.
     * 
     * @param {L.Point} pos Marker anchor in layer-point coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _setPos(pos) {

        /** @TODO use markerProto._setPos */
        if (this._map._rotate) {
            pos = this._map.rotatedPointToMapPanePoint(pos);
        }

        /** @TODO use markerProto._setPos */
        const bearing = this._getIconBearing();

        /** @TODO use markerProto._setPos */
        if (this._icon) {
            L.DomUtil.setPosition(this._icon, pos, bearing, pos, this.options.scale);
        }

        /** @TODO use markerProto._setPos */
        if (this._shadow) {
            L.DomUtil.setPosition(this._shadow, pos, bearing, pos, this.options.scale);
        }

        this._zIndex = pos.y + this.options.zIndexOffset;

        this._resetZIndex();
    },

    /**
     * Compute the on-screen icon rotation from `rotation`, `rotateWithView` and `keepUpright`.
     *
     * @returns {number} Angle in radians.
     *
     * @since leaflet-rotate (0.6.0)
     */
    _getIconBearing() {
        let bearing = this.options.rotation || 0;
        if (this.options.rotateWithView) {
            bearing += this._map._bearing;
        }
        if (this.options.keepUpright) {
            bearing = ((bearing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            if (bearing > Math.PI / 2 && bearing < 3 * Math.PI / 2) {
                bearing += Math.PI;
            }
            bearing %= 2 * Math.PI;
        }
        return bearing;
    },

    /**
     * Create the icon as DOM elements or, with `preferCanvas`, as a Canvas layer.
     *
     * @since leaflet-rotate (0.6.0)
     */
    _initIcon() {
        const draggable = this.dragging ? this.dragging.enabled() : this.options.draggable;

        if (this.dragging) {
            this.dragging.disable();
            delete this.dragging;
        }

        // the icon should NOT be drawn onto map's Canvas renderer.
        if (!(
            this._map
            && this._map.options.preferCanvas
            && this.options.icon instanceof L.Icon && !(this.options.icon instanceof L.DivIcon)
            && this.options.icon._getIconUrl('icon')
        )) {
            this._removeCanvasIcon();
            this.options.draggable = draggable;
            return markerProto._initIcon.apply(this, arguments);
        }

        if (this._icon) {
            markerProto._removeIcon.call(this);
        }

        this._removeShadow();

        if (this._canvasIcon) {
            this._canvasIcon._loadImages();
        } else {
            this._canvasIcon = new CanvasIcon(this);
            this._map.addLayer(this._canvasIcon);
        }

        if (this.options.interactive) {
            this.dragging = new CanvasMarkerDrag(this);
            this._canvasIcon.dragging = this.dragging;
            if (draggable) { this.dragging.enable(); }
        }

        // init canvas accessibility
        this._removeCanvasAccessibility();
        if (!this.options.keyboard || !this.options.interactive) { return; }
        const element = this._canvasAccessibleElement = document.createElement('button');
        element.type = 'button';
        element.setAttribute('aria-label', this.options.title || this.options.alt || 'Marker');
        element.title = this.options.title || '';
        element.style.cssText = 'position:absolute;pointer-events:none;opacity:0;background:transparent;border:0;padding:0;box-sizing:border-box;outline:3px solid #005fcc;outline-offset:3px;';
        this.getPane().appendChild(element);
        L.DomEvent.on(element, 'click', this._activateCanvasMarker, this);
        L.DomEvent.on(element, 'focus', this._focusCanvasMarker, this);
        L.DomEvent.on(element, 'blur', this._blurCanvasMarker, this);
        this.on('popupopen popupclose', this._updateCanvasAccessibility, this);
        this._updateCanvasAccessibility();
    },


    _activateCanvasMarker(e) {
        L.DomEvent.stop(e);
        this.fire('click', { originalEvent: e, latlng: this.getLatLng() }, true);
    },

    _focusCanvasMarker() {
        this._positionCanvasAccessibility();
        this._canvasAccessibleElement.style.opacity = '1';
        if (this.options.autoPanOnFocus) { markerProto._panOnFocus.call(this); }
        if (this.getTooltip()) { this.openTooltip(); }
    },

    _blurCanvasMarker() {
        this._canvasAccessibleElement.style.opacity = '0';
        if (this.getTooltip() && !this.getTooltip().options.permanent) { this.closeTooltip(); }
    },

    /**
     * Per-frame sync: keep N buttons cheap by only toggling visibility and positioning the focused one.
     */
    _syncCanvasAccessibility() {
        const element = this._canvasAccessibleElement,
            sprite = this._canvasIcon;
        if (!element || !sprite) { return; }
        if (element.hidden !== sprite._behindCamera) { element.hidden = sprite._behindCamera; }
        if (element === document.activeElement) { this._positionCanvasAccessibility(); }
    },

    _updateCanvasAccessibility() {
        const element = this._canvasAccessibleElement;
        if (!element) { return; }
        this._syncCanvasAccessibility();
        if (this.getPopup()) {
            element.setAttribute('aria-expanded', String(this.isPopupOpen()));
            const popup = this.getPopup().getElement();
            if (popup) {
                popup.id = popup.id || `leaflet-marker-popup-${L.Util.stamp(this)}`;
                element.setAttribute('aria-controls', popup.id);
            }
        }
    },

    _positionCanvasAccessibility() {
        const element = this._canvasAccessibleElement,
            sprite = this._canvasIcon;
        if (!element || !sprite || !sprite._point) { return; }
        const part = sprite._getPart('icon'),
            size = part ? part.size : toPoint(this.options.icon.options.iconSize) || new L.Point(25, 41),
            anchor = part ? part.anchor : toPoint(this.options.icon.options.iconAnchor) || size.divideBy(2),
            scale = this.options.scale ?? 1;
        element.style.width = size.x + 'px';
        element.style.height = size.y + 'px';
        element.style.marginLeft = -anchor.x + 'px';
        element.style.marginTop = -anchor.y + 'px';
        element.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
        L.DomUtil.setPosition(element, sprite._point);
        element.style.transform += ` rotate(${this._getIconBearing()}rad) scale(${scale})`;
    },

    _removeCanvasAccessibility() {
        if (!this._canvasAccessibleElement) { return; }
        L.DomEvent.off(this._canvasAccessibleElement);
        this._canvasAccessibleElement.remove();
        this._canvasAccessibleElement = null;
        this.off('popupopen popupclose', this._updateCanvasAccessibility, this);
    },

    getElement() {
        return this._canvasAccessibleElement || markerProto.getElement.apply(this, arguments);
    },

    /**
     * Remove the DOM icon or the Canvas icon layer.
     *
     * @since leaflet-rotate (0.6.0)
     */
    _removeIcon() {
        this._removeCanvasIcon();
        if (this._icon) {
            markerProto._removeIcon.apply(this, arguments);
        }
    },

    /**
     * @since leaflet-rotate (0.6.0)
     */
    _removeCanvasIcon() {
        this._removeCanvasAccessibility();
        if (this._canvasIcon) {
            this._canvasIcon.remove();
            this._canvasIcon = null;
        }
    },

    /**
     * Reposition the DOM icon or redraw the Canvas icon.
     *
     * @returns {this}
     *
     * @since leaflet-rotate (0.6.0)
     */
    update() {
        if (this._canvasIcon) {
            this._canvasIcon.redraw();
            return this;
        }
        return markerProto.update.apply(this, arguments);
    },

    /**
     * @since leaflet-rotate (0.6.0)
     */
    _updateOpacity() {
        if (this._canvasIcon) {
            this._canvasIcon.redraw();
        }
        return markerProto._updateOpacity.apply(this, arguments);
    },

    // _updateZIndex(offset) {
    //     if (!this._map._rotate) {
    //         return markerProto._updateZIndex.apply(this, arguments);
    //     }
    //     this._icon.style.zIndex = Math.round(this._zIndex + offset);
    // },

    /**
     * Set the marker icon's rotation and redraw it.
     * 
     * @param {number} rotation Angle in radians.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setRotation(rotation) {
        this.options.rotation = rotation;
        this.update();
    },

});
