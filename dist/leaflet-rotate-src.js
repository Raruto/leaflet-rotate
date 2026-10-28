var leafletRotate = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    toPoint: () => toPoint
  });

  // src/dom/DomUtil.js
  var domUtilProto = Object.assign({}, L.DomUtil);
  Object.assign(L.DomUtil, {
    /**
     * Resets the 3D CSS transform of `el` so it is translated by `offset` pixels,
     * optionally scaled by `scale`, and rotated around `pivot` when `bearing` is set.
     *
     * @param {HTMLElement} el Element to transform.
     * @param {L.Point} [offset] Translation in pixels; defaults to the origin.
     * @param {number} [scale] Optional scale factor.
     * @param {number} [bearing] Optional rotation in radians.
     * @param {L.Point} [pivot] Point in pixels around which to rotate.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setTransform(el, offset, scale, bearing, pivot) {
      let pos = offset || new L.Point(0, 0);
      if (!bearing) {
        return domUtilProto.setTransform(el, pos._round(), scale);
      }
      pos = pos.rotateFrom(bearing, pivot);
      el.style.transform = "translate3d(" + pos.x + "px," + pos.y + "px,0)" + (scale ? " scale(" + scale + ")" : "") + " rotate(" + bearing + "rad)";
    },
    /**
     * Sets the position of `el` to `point`, using CSS transforms or top/left positioning
     * depending on browser support, and optionally rotating it around `pivot`.
     *
     * @param {HTMLElement} el Element to position.
     * @param {L.Point} point Position in pixels.
     * @param {number} [bearing] Rotation in radians; zero or omitted uses Leaflet positioning.
     * @param {L.Point} [pivot] Point in pixels around which to rotate.
     * @param {number} [scale] Optional scale factor.
     * 
     * @returns {void}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setPosition(el, point, bearing, pivot, scale) {
      if (!bearing) {
        return domUtilProto.setPosition(el, point);
      }
      el._leaflet_pos = point;
      L.DomUtil.setTransform(el, point, scale, bearing, pivot);
    },
    /**
     * Returns the position assigned to `el`.
     *
     * @param {HTMLElement} el Element whose Leaflet position is requested.
     * 
     * @returns {L.Point} Stored Leaflet position, or the position measured by Leaflet.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getPosition(el) {
      return el._leaflet_pos || domUtilProto.getPosition(el);
    }
  });

  // src/dom/Draggable.js
  L.Draggable.include({
    /** @TODO */
    // updateMapBearing(mapBearing) {
    //     this._mapBearing = mapBearing;
    // },
  });

  // src/geometry/Point.js
  Object.assign(L.Point.prototype, {
    /**
     * Rotate around (0,0) by applying the 2D rotation matrix:
     * 
     * ⎡ x' ⎤ = ⎡ cos θ  -sin θ ⎤ ⎡ x ⎤
     * ⎣ y' ⎦   ⎣ sin θ   cos θ ⎦ ⎣ y ⎦
     * 
     * @param {number} theta Rotation angle in radians, counterclockwise.
     * @returns {L.Point} Rotated point (or this point when theta is zero).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotate(theta) {
      return this.rotateFrom(theta, new L.Point(0, 0));
    },
    /**
     * Rotate around (pivot.x, pivot.y) by:
     * 
     * 1. subtract (pivot.x, pivot.y)
     * 2. rotate around (0, 0)
     * 3. add (pivot.x, pivot.y) back
     * 
     * same as `this.subtract(pivot).rotate(theta).add(pivot)`
     * 
     * @param {number} theta Rotation angle in radians, counterclockwise.
     * @param {L.Point} pivot Point to rotate around.
     * 
     * @returns {L.Point}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateFrom(theta, pivot) {
      if (!theta) {
        return this;
      }
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const cx = pivot.x, cy = pivot.y;
      const x = this.x - cx, y = this.y - cy;
      return new L.Point(
        x * cosTheta - y * sinTheta + cx,
        x * sinTheta + y * cosTheta + cy
      );
    }
  });
  function toPoint(point) {
    if (point == null || point instanceof L.Point) {
      return point;
    }
    return Array.isArray(point) ? new L.Point(point[0], point[1]) : new L.Point(point.x, point.y);
  }

  // src/layer/DivOverlay.js
  var divOverlayProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.DivOverlay.prototype));
  L.DivOverlay.include({
    /**
     * Extend overlay event subscriptions to refresh position after map rotation and pitch.
     * 
     * @listens L.Map~rotate
     * @listens L.Map~pitch
     *
     * @returns {Object} Leaflet event map for the overlay.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = Object.assign(divOverlayProto.getEvents.apply(this, arguments), {
        rotate: this._updatePosition,
        pitch: this._updatePitchEvents
      });
      if (this._map && this._map._pitch) {
        events.move = this._updatePosition;
      }
      return events;
    },
    /**
     * Listen to map movement only while pitch is non-zero.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchEvents() {
      if (this._map._pitch) {
        this._map.on("move", this._updatePosition, this);
      } else {
        this._map.off("move", this._updatePosition, this);
      }
    },
    /**
     * Reposition the overlay after map movement, applying rotation/pitch-aware coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updatePosition() {
      if (!this._map) {
        return;
      }
      divOverlayProto._updatePosition.apply(this, arguments);
      if (this._map._rotate && this._zoomAnimated) {
        const anchor = this._getAnchor();
        const pos = L.DomUtil.getPosition(this._container).subtract(anchor);
        L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
      } else if (this._map._rotate) {
        const mapPanePoint = this._map.rotatedPointToMapPanePoint(this._map.latLngToLayerPoint(this._latlng)), offset = toPoint(this.options.offset || [0, 0]), anchor = this._getAnchor();
        this._containerLeft = -Math.round(this._containerWidth / 2) + mapPanePoint.x + offset.x + anchor.x;
        this._containerBottom = -(mapPanePoint.y + offset.y + anchor.y);
        this._container.style.left = this._containerLeft + "px";
        this._container.style.bottom = this._containerBottom + "px";
        this._container.style.top = "";
        L.DomUtil.setPosition(this._container, new L.Point(0, 0));
        this._container.style.transform = "";
      }
    }
  });

  // src/layer/Popup.js
  var popupProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Popup.prototype));
  L.Popup.include({
    /**
     * Update the popup position during zoom animation and transform it into map-pane coordinates.
     *
     * @param {Object} e Zoom animation event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoom(e) {
      popupProto._animateZoom.apply(this, arguments);
      if (this._map && this._map._rotate) {
        const anchor = this._getAnchor();
        const pos = L.DomUtil.getPosition(this._container).subtract(anchor);
        L.DomUtil.setPosition(this._container, this._map.rotatedPointToMapPanePoint(pos).add(anchor));
      }
    },
    /**
     * Pan the map when a popup with auto-pan enabled would extend beyond the viewport.
     * 
     * @see https://github.com/fnicollet/Leaflet/pull/21
     *
     * @fires L.Map#autopanstart
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _adjustPan() {
      if (!this.options.autoPan || this._map._panAnim && this._map._panAnim._inProgress) {
        return;
      }
      if (this._autopanning) {
        this._autopanning = false;
        return;
      }
      const map = this._map, marginBottom = parseInt(getComputedStyle(this._container).marginBottom, 10) || 0, containerHeight = this._container.offsetHeight + marginBottom, containerWidth = this._containerWidth, layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);
      layerPos._add(L.DomUtil.getPosition(this._container));
      const containerPos = layerPos._add(this._map._getMapPanePos()), padding = toPoint(this.options.autoPanPadding || [0, 0]), paddingTL = toPoint(this.options.autoPanPaddingTopLeft || padding), paddingBR = toPoint(this.options.autoPanPaddingBottomRight || padding), size = map.getSize();
      let dx = 0, dy = 0;
      if (containerPos.x + containerWidth + paddingBR.x > size.x) {
        dx = containerPos.x + containerWidth - size.x + paddingBR.x;
      }
      if (containerPos.x - dx - paddingTL.x < 0) {
        dx = containerPos.x - paddingTL.x;
      }
      if (containerPos.y + containerHeight + paddingBR.y > size.y) {
        dy = containerPos.y + containerHeight - size.y + paddingBR.y;
      }
      if (containerPos.y - dy - paddingTL.y < 0) {
        dy = containerPos.y - paddingTL.y;
      }
      if (dx || dy) {
        if (this.options.keepInView) {
          this._autopanning = true;
        }
        map.fire("autopanstart").panBy([dx, dy]);
      }
    }
  });

  // src/layer/Tooltip.js
  var tooltipProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Tooltip.prototype));
  L.Tooltip.include({
    /**
     * Reposition the tooltip during zoom animation using transformed map coordinates.
     *
     * @param {Object} e Zoom animation event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoom(e) {
      if (!this._map._rotate) {
        return tooltipProto._animateZoom.apply(this, arguments);
      }
      let pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);
      pos = this._map.rotatedPointToMapPanePoint(pos);
      this._setPosition(pos);
    },
    /**
     * Recompute tooltip screen position after map movement.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updatePosition() {
      if (!this._map._rotate) {
        return tooltipProto._updatePosition.apply(this, arguments);
      }
      let pos = this._map.latLngToLayerPoint(this._latlng);
      pos = this._map.rotatedPointToMapPanePoint(pos);
      this._setPosition(pos);
    }
  });

  // src/layer/marker/Icon.js
  var iconProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Icon.prototype));
  L.Icon.include({
    /**
     * Set marker icon dimensions and anchor styles, including the rotation origin.
     * 
     * @param {HTMLImageElement} img Icon or shadow element.
     * @param {string} name Icon style key (`icon` or `shadow`).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _setIconStyles(img, name) {
      const options = this.options;
      let sizeOption = options[name + "Size"];
      if (typeof sizeOption === "number") {
        sizeOption = [sizeOption, sizeOption];
      }
      const size = sizeOption ? new L.Point(...Array.isArray(sizeOption) ? sizeOption : [sizeOption.x, sizeOption.y]) : null, anchorOption = name === "shadow" && options.shadowAnchor || options.iconAnchor || size && size.divideBy(2, true), anchor = anchorOption ? new L.Point(...Array.isArray(anchorOption) ? anchorOption : [anchorOption.x, anchorOption.y]) : null;
      img.className = "leaflet-marker-" + name + " " + (options.className || "");
      if (anchor) {
        img.style.marginLeft = -anchor.x + "px";
        img.style.marginTop = -anchor.y + "px";
        img.style.transformOrigin = anchor.x + "px " + anchor.y + "px 0px";
      }
      if (size) {
        img.style.width = size.x + "px";
        img.style.height = size.y + "px";
      }
    }
  });

  // src/layer/marker/Marker.js
  var markerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Marker.prototype));
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
    scale: void 0
  });
  var markerDragProto;
  var MarkerDrag = {
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
      const marker = this._marker, rotated_marker = marker.options.rotation || marker.options.rotateWithView, shadow = marker._shadow;
      let iconPos = L.DomUtil.getPosition(marker._icon);
      if (!rotated_marker && shadow) {
        L.DomUtil.setPosition(shadow, iconPos);
      }
      if (marker._map._rotate) {
        iconPos = marker._map.mapPanePointToRotatedPoint(iconPos);
      }
      const latlng = marker._map.layerPointToLatLng(iconPos);
      marker._latlng = latlng;
      e.latlng = latlng;
      e.oldLatLng = this._oldLatLng;
      if (rotated_marker) marker.setLatLng(latlng);
      else marker.fire("move", e);
      marker.fire("drag", e);
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
    }
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
        pitch: this._updatePitchEvents
      });
      if (this._map && this._map._pitch) {
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
      if (this._map._pitch) {
        this._map.on("move", this.update, this);
      } else {
        this._map.off("move", this.update, this);
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
        markerDragProto = markerDragProto || Object.getPrototypeOf(this.dragging);
        this.dragging.disable();
        Object.assign(this.dragging, {
          // _onDragStart: MarkerDrag._onDragStart.bind(this.dragging),
          _onDrag: MarkerDrag._onDrag.bind(this.dragging),
          _onDragEnd: MarkerDrag._onDragEnd.bind(this.dragging)
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
      if (this._map._rotate) {
        pos = this._map.rotatedPointToMapPanePoint(pos);
      }
      let bearing = this.options.rotation || 0;
      if (this.options.rotateWithView) {
        bearing += this._map._bearing;
      }
      if (this.options.keepUpright) {
        bearing = (bearing % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (bearing > Math.PI / 2 && bearing < 3 * Math.PI / 2) {
          bearing += Math.PI;
        }
        bearing %= 2 * Math.PI;
      }
      if (this._icon) {
        L.DomUtil.setPosition(this._icon, pos, bearing, pos, this.options.scale);
      }
      if (this._shadow) {
        L.DomUtil.setPosition(this._shadow, pos, bearing, pos, this.options.scale);
      }
      this._zIndex = pos.y + this.options.zIndexOffset;
      this._resetZIndex();
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
    }
  });

  // src/layer/tile/GridLayer.js
  var gridLayerProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.GridLayer.prototype));
  L.GridLayer.include({
    /**
     * Add a throttled tile refresh after map bearing changes.
     * 
     * @listens L.Map~rotate
     * 
     * @returns {Object} Leaflet event map for the grid layer.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = gridLayerProto.getEvents.apply(this, arguments);
      if (this._map._rotate && !this.options.updateWhenIdle) {
        if (!this._onRotate) {
          this._onRotate = L.Util.throttle(this._onMoveEnd, this.options.updateInterval, this);
        }
        events.rotate = this._onRotateEvent;
      }
      return events;
    },
    /**
     * Keep tile levels aligned when a bearing/pitch change shifts the pixel origin
     * (eg. when the rotation pivot is not the view center), then refresh tiles (throttled).
     * 
     * @listens L.Map~rotate
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onRotateEvent() {
      const map = this._map;
      if (!map) {
        return;
      }
      const origin = map.getPixelOrigin();
      if (this._rotateOrigin && !this._rotateOrigin.equals(origin) && !map._animatingZoom && this._levels) {
        this._setZoomTransforms(map.getCenter(), map.getZoom());
      }
      this._rotateOrigin = origin;
      this._onRotate();
    },
    /**
     * Return tile pixel bounds that cover the rotated viewport.
     * 
     * @param {L.LatLng} center View center used to calculate bounds.
     * 
     * @returns {L.Bounds} Pixel bounds covered by the layer's tiles.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getTiledPixelBounds(center) {
      if (!this._map._rotate) {
        return gridLayerProto._getTiledPixelBounds.apply(this, arguments);
      }
      return this._map._getNewPixelBounds(center, this._tileZoom);
    }
  });

  // src/layer/vector/Renderer.js
  var rendererProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Renderer.prototype));
  var rendererBase = Object.getPrototypeOf(L.Renderer.prototype);
  var rendererGetEvents = rendererProto.getEvents || rendererBase.getEvents;
  var rendererOnMoveEnd = rendererProto._onMoveEnd || rendererBase._onMoveEnd;
  L.Renderer.include({
    /**
     * Subscribe the renderer to map rotation so its visible bounds are recalculated.
     * 
     * @listens L.Map~rotate
     * 
     * @returns {Object} Leaflet event map for the renderer.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getEvents() {
      const events = rendererGetEvents.apply(this, arguments);
      return Object.assign(events, { rotate: this._onRotate });
    },
    /**
     * Refresh renderer bounds after bearing or pitch changes.
     * 
     * Paths are reprojected only when the pixel origin actually changed (eg. fractional centers
     * after an off-center zoom), since reprojection is the main cost with long polylines.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onRotate() {
      if (!this._map._rotate) {
        return;
      }
      const origin = this._map.getPixelOrigin();
      if (!this._rotateOrigin || !this._rotateOrigin.equals(origin)) {
        this._rotateOrigin = origin;
        clearTimeout(this._rotateTimer);
        this._onZoomEnd();
        this._updateAfterRotate();
        return;
      }
      if (this._bounds && this._bounds.contains(this._map._getPaddedPixelBounds(0))) {
        return;
      }
      clearTimeout(this._rotateTimer);
      const wait = (this._lastRotateUpdate || 0) + 100 - performance.now();
      if (wait > 0) {
        this._rotateTimer = setTimeout(() => this._map && this._updateAfterRotate(), wait);
      } else {
        this._updateAfterRotate();
      }
    },
    /**
     * Recalculate renderer bounds and redraw after bearing or pitch changes.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _updateAfterRotate() {
      this._lastRotateUpdate = performance.now();
      if (L.version.startsWith("2.")) {
        this._onMoveEnd();
      } else {
        this._update();
      }
    },
    /**
     * Add the zoom-animation class needed for correct renderer transforms in Leaflet 1.
     *
     * Fixes `map.flyTo()` when `map.options.zoomAnimation` is false.
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    onAdd() {
      rendererProto.onAdd.apply(this, arguments);
      if (L.version <= "1.9.3") {
        this._container.classList.add("leaflet-zoom-animated");
      }
    },
    /**
     * Update the renderer transform during zoom animation, accounting for rotated coordinates.
     * 
     * @see https://github.com/Leaflet/Leaflet/pull/8794
     * @see https://github.com/Leaflet/Leaflet/pull/8103
     * @see https://github.com/Leaflet/Leaflet/issues/7466
     * 
     * @param {L.LatLng} center Target map center.
     * @param {number} zoom Target zoom level.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _updateTransform(center, zoom) {
      const v2 = L.version.startsWith("2.");
      if (!this._map._rotate) {
        return (v2 ? rendererBase : rendererProto)._updateTransform.apply(this, arguments);
      }
      if (!v2 && zoom === this._zoom) {
        return;
      }
      const scale = this._map.getZoomScale(zoom, this._zoom), offset = this._topLeftPoint.multiplyBy(scale).subtract(this._map._getNewPixelOrigin(center, zoom));
      L.DomUtil.setTransform(this._container, offset, scale);
    },
    /**
     * Recalculate bounds and finish renderer updates after movement on Leaflet 2.
     *
     * @param {Object} ev Map movement event.
     * 
     * @since leaflet-rotate (v0.4.0)
     */
    _onMoveEnd(ev) {
      if (!L.version.startsWith("2.") || !this._map._rotate) {
        return rendererOnMoveEnd.apply(this, arguments);
      }
      this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
      this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
      this._center = this._map.getCenter();
      this._zoom = this._map.getZoom();
      this._topLeftPoint = this._map._getNewPixelOrigin(this._center, this._zoom).add(this._bounds.min);
      this._updateTransform(this._center, this._zoom);
      this._resizeContainer();
      this._onSettled(ev);
    },
    /**
     * Resize the renderer container to cover the pitch-aware map bounds.
     * 
     * @since leaflet-rotate (v0.4.0)
     */
    _resizeContainer() {
      if (!L.version.startsWith("2.") || !this._map._rotate || !this._bounds) {
        return rendererBase._resizeContainer.apply(this, arguments);
      }
      const size = this._bounds.getSize();
      this._container.style.width = size.x + "px";
      this._container.style.height = size.y + "px";
      return size;
    },
    // getEvents() {
    //     const events = {
    //         viewreset: this._reset,
    //         zoom: this._onZoom,
    //         moveend: this._update,
    //         zoomend: this._onZoomEnd
    //     };
    //     if (this._zoomAnimated) {
    //         events.zoomanim = this._onAnimZoom;
    //     }
    //     return events;
    // },
    // _onAnimZoom(ev) {
    //     this._updateTransform(ev.center, ev.zoom);
    // },
    // _onZoom() {
    //     this._updateTransform(this._map.getCenter(), this._map.getZoom());
    // },
    // _onZoomEnd() {
    //     for (const id in this._layers) {
    //         this._layers[id]._project();
    //     }
    // },
    // _reset() {
    //     this._update();
    //     this._updateTransform(this._center, this._zoom);
    //     for (const id in this._layers) {
    //         this._layers[id]._reset();
    //     }
    // },
    // _updatePaths() {
    //     for (const id in this._layers) {
    //         this._layers[id]._update();
    //     }
    // },
    /**
     * Recalculate renderer bounds and cached view state.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _update() {
      if (!this._map._rotate) {
        return rendererProto._update.apply(this, arguments);
      }
      this._bounds = this._map._getPaddedPixelBounds(this.options.padding);
      this._topLeft = this._map.layerPointToLatLng(this._bounds.min);
      this._center = this._map.getCenter();
      this._zoom = this._map.getZoom();
      this._topLeftPoint = this._map._getNewPixelOrigin(this._center, this._zoom).add(this._bounds.min);
    }
  });

  // src/map/Map.js
  var mapProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Map.prototype));
  L.Map.mergeOptions({
    /**
     * @type {boolean} Enable bearing and pitch transformations.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotate: false,
    /**
     * @type {number} Initial map bearing in degrees.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bearing: 0,
    /**
     * @type {number} Initial map pitch in degrees, clamped to 0–85.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    pitch: 0,
    /**
     * @type {number} Maximum distance of the pitched map plane from the map center, in multiples
     *                of the map height. Tiles, vectors and `getBounds()` stop there (and always
     *                before the horizon); a `.leaflet-pitch-sky` element fills the area above.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    pitchMaxDistance: 3
  });
  L.Map.include({
    /**
     * Apply an immediate animated-zoom frame without waiting for a transition delay.
     *
     * @param {L.LatLng} center Target center.
     * @param {number} zoom Target zoom level.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _animateZoomNoDelay(center, zoom) {
      if (!this._mapPane) {
        return;
      }
      this._animatingZoom = true;
      this._animateToCenter = center;
      this._animateToZoom = zoom;
      this._move(center, zoom, void 0, true);
      this._onZoomTransitionEnd();
    },
    /**
     * Initialize the Leaflet map and apply its initial bearing and pitch.
     * 
     * @param {HTMLElement|string} id Map container element or its ID.
     * @param {Object} [options={}] Leaflet map options, including `rotate`, `bearing`, and `pitch`.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(id, options) {
      if (options.rotate) {
        this._rotate = true;
        this._bearing = 0;
        this._pitch = 0;
      }
      mapProto.initialize.apply(this, arguments);
      if (this.options.rotate) {
        this.on("resize", this._updatePitchTransform, this);
        this.on("move", this._updatePitchSky, this);
        this.setBearing(this.options.bearing);
        this.setPitch(this.options.pitch);
      }
    },
    /**
     * Given a pixel coordinate relative to the map container,
     * returns the corresponding pixel coordinate relative to
     * the [origin pixel](#map-getpixelorigin).
     * 
     * @param {L.Point|number[]} point Pixel coordinate in the map container.
     * 
     * @returns {L.Point} Corresponding layer-point coordinate.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    containerPointToLayerPoint(point) {
      if (!this._rotate) {
        return mapProto.containerPointToLayerPoint.apply(this, arguments);
      }
      if (this._pitch) {
        return this._transformPitchPoint(
          toPoint(point).subtract(this._getMapPanePos()),
          this._pitchInverseTransform
        );
      }
      return toPoint(point).subtract(this._getMapPanePos()).rotateFrom(-this._bearing, this._getRotatePanePos()).subtract(this._getRotatePanePos());
    },
    /**
     * Given a pixel coordinate relative to the [origin pixel](#map-getpixelorigin),
     * returns the corresponding pixel coordinate relative to the map container.
     * 
     * @param {L.Point|number[]} point Pixel coordinate in layer-point space.
     * 
     * @returns {L.Point} Corresponding pixel coordinate in the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    layerPointToContainerPoint(point) {
      if (!this._rotate) {
        return mapProto.layerPointToContainerPoint.apply(this, arguments);
      }
      if (this._pitch) {
        return this._transformPitchPoint(point, this._pitchTransform).add(this._getMapPanePos());
      }
      return toPoint(point).add(this._getRotatePanePos()).rotateFrom(this._bearing, this._getRotatePanePos()).add(this._getMapPanePos());
    },
    /**
     * Converts a coordinate from the rotated pane reference system
     * to the reference system of the not rotated map pane.
     * 
     * (rotatePane) --> (mapPane)
     * (rotatePane) --> (norotatePane)
     * 
     * @param {L.Point|number[]} point Point in the rotated pane.
     * 
     * @returns {L.Point} Corresponding point in map-pane coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotatedPointToMapPanePoint(point) {
      if (this._pitch) {
        return this._transformPitchPoint(point, this._pitchTransform);
      }
      return toPoint(point).rotate(this._bearing)._add(this._getRotatePanePos());
    },
    /**
     * Converts a coordinate from the not rotated map pane reference system
     * to the reference system of the rotated pane.
     * 
     * (mapPane) --> (rotatePane)
     * (norotatePane) --> (rotatePane)
     * 
     * @param {L.Point|number[]} point Point in map-pane coordinates.
     * 
     * @returns {L.Point} Corresponding point in the rotated pane.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    mapPanePointToRotatedPoint(point) {
      if (this._pitch) {
        return this._transformPitchPoint(point, this._pitchInverseTransform);
      }
      return toPoint(point)._subtract(this._getRotatePanePos()).rotate(-this._bearing);
    },
    // latLngToLayerPoint(latlng) {
    //     const projectedPoint = this.project(L.latLng(latlng))._round();
    //     return projectedPoint._subtract(this.getPixelOrigin());
    // },
    // latLngToContainerPoint(latlng) {
    // 	return this.layerPointToContainerPoint(this.latLngToLayerPoint(toLatLng(latlng)));
    // },
    /**
     * Given latlng bounds, returns the bounds in projected pixel
     * relative to the map container.
     * 
     * @see https://github.com/ronikar/Leaflet/blob/5c480ef959b947c3beed7065425a5a36c486262b/src/map/Map.js#L1114-L1135
     * 
     * @param {L.LatLngBounds} bounds Geographic bounds to project.
     * 
     * @returns {L.Bounds} Axis-aligned bounds in container-pixel coordinates.
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    mapBoundsToContainerBounds(bounds) {
      if (!this._rotate && mapProto.mapBoundsToContainerBounds) {
        return mapProto.mapBoundsToContainerBounds.apply(this, arguments);
      }
      const origin = this.getPixelOrigin();
      const nw = this.layerPointToContainerPoint(this.project(bounds.getNorthWest())._subtract(origin)), ne = this.layerPointToContainerPoint(this.project(bounds.getNorthEast())._subtract(origin)), sw = this.layerPointToContainerPoint(this.project(bounds.getSouthWest())._subtract(origin)), se = this.layerPointToContainerPoint(this.project(bounds.getSouthEast())._subtract(origin));
      return new L.Bounds([
        new L.Point(Math.min(nw.x, ne.x, se.x, sw.x), Math.min(nw.y, ne.y, se.y, sw.y)),
        // [ minX, minY ]
        new L.Point(Math.max(nw.x, ne.x, se.x, sw.x), Math.max(nw.y, ne.y, se.y, sw.y))
        // [ maxX, maxY ]
      ]);
    },
    /**
     * Return the geographic bounds of the current viewport, accounting for rotation and pitch.
     * 
     * The result is the smallest geographic bounds containing all four viewport corners.
     * 
     * @returns {L.LatLngBounds} Geographic bounds visible in the map viewport.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getBounds() {
      if (!this._rotate) {
        return mapProto.getBounds.apply(this, arguments);
      }
      const [min, max] = this._getPitchedContainerBounds(0);
      return new L.LatLngBounds([
        this.containerPointToLatLng([min.x, min.y]),
        // topleft
        this.containerPointToLatLng([max.x, min.y]),
        // topright 
        this.containerPointToLatLng([max.x, max.y]),
        // bottomright
        this.containerPointToLatLng([min.x, max.y])
        // bottomleft
      ]);
    },
    /**
     * Return the container rectangle covering the visible map plane, optionally padded by a
     * fraction of the map size. When pitched, its top is cut at the far plane (see `pitchMaxDistance`)
     * so that it never reaches the horizon, where the plane would extend to infinity.
     * 
     * @param {number} padding Padding as a fraction of the map size.
     * 
     * @returns {L.Point[]} Top-left and bottom-right container points.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _getPitchedContainerBounds(padding) {
      const size = this.getSize(), min = size.multiplyBy(-padding), max = size.multiplyBy(1 + padding);
      if (this._pitch) {
        min.y = Math.min(Math.max(min.y, this._getPitchFarY()), max.y);
      }
      return [min, max];
    },
    /**
     * Return the container y coordinate of the far plane: points above it are farther than
     * `pitchMaxDistance` from the map center, or beyond the horizon.
     * 
     * @returns {number} Container y coordinate (`-Infinity` when the whole map is close enough).
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _getPitchFarY() {
      const size = this.getSize(), inverse = this._pitchInverseTransform, panePos = this._getMapPanePos(), x = size.x / 2 - panePos.x, centerY = size.y / 2 - panePos.y, maxDistance = this.options.pitchMaxDistance * size.y, w = (y) => inverse.g * x + inverse.h * y + inverse.i, centerW = w(centerY), center = this._transformPitchPoint([x, centerY], inverse), isNear = (y) => w(y) * centerW > 0 && this._transformPitchPoint([x, y], inverse).distanceTo(center) <= maxDistance;
      let far = -size.y - panePos.y, near = centerY;
      if (isNear(far)) {
        return -Infinity;
      }
      for (let i = 0; i < 20; i++) {
        const mid = (far + near) / 2;
        if (isNear(mid)) {
          near = mid;
        } else {
          far = mid;
        }
      }
      return near + panePos.y;
    },
    /**
     * Returns the bounds of the current map view in projected pixel
     * coordinates (sometimes useful in layer and overlay implementations).
     * 
     * @TODO find out if map bounds calculated by `L.Map::getPixelBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     * 
     * @returns {L.Bounds}
     */
    // getPixelBounds(center, zoom) {
    //     // const topLeftPoint = map.containerPointToLayerPoint(this._getTopLeftPoint());
    //     const topLeftPoint = this._getTopLeftPoint(center, zoom);
    //       return new L.Bounds(topLeftPoint, topLeftPoint.add(this.getSize()));
    // },
    /**
     * Set the map bearing, optionally animating to the new value.
     * 
     * @param {number} theta Target bearing in degrees; normalized to [0, 360).
     * @param {Object} [options] Animation options.
     * @param {boolean} [options.animate=false] Animate the change.
     * @param {number} [options.duration=0.25] Animation duration in seconds.
     * @param {number} [options.easeLinearity=0.5] Easing curve linearity.
     * 
     * @returns {void}
     * 
     * @fires L.Map#rotate
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    setBearing(theta, options) {
      if (!this._rotate) {
        return;
      }
      if (options && options.animate) {
        this._animatePitchBearing(this.getPitch(), theta, options);
        return;
      }
      this._stopPitchBearingAnimation();
      this._setBearing(theta);
    },
    /**
     * Animate pitch and bearing together (bearing follows the shortest path).
     * 
     * @param {number} pitch Target pitch in degrees.
     * @param {number} bearing Target bearing in degrees.
     * @param {Object} [options] Animation options.
     * @param {number} [options.duration=0.25] Animation duration in seconds.
     * @param {number} [options.easeLinearity=0.5] Easing curve linearity.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _animatePitchBearing(pitch, bearing, options) {
      this._stopPitchBearingAnimation();
      const animationId = this._bearingAnimationId;
      const startBearing = this.getBearing(), startPitch = this.getPitch(), endBearing = L.Util.wrapNum(bearing, [0, 360]), endPitch = Math.max(0, Math.min(pitch, 85)), delta = (endBearing - startBearing + 540) % 360 - 180, duration = Math.max(0, options.duration == null ? 0.25 : options.duration) * 1e3, easeLinearity = Math.max(options.easeLinearity || 0.5, 0.2), startTime = performance.now();
      const animate = function() {
        if (!this._mapPane || this._bearingAnimationId !== animationId) {
          return;
        }
        const progress = duration ? Math.min((performance.now() - startTime) / duration, 1) : 1, eased = 1 - Math.pow(1 - progress, 1 / easeLinearity);
        if (progress < 1) {
          this._bearingAnimationFrame = requestAnimationFrame(animate.bind(this));
        } else {
          delete this._bearingAnimationFrame;
        }
        this._setPitchAndBearing(
          progress === 1 ? endPitch : startPitch + (endPitch - startPitch) * eased,
          progress === 1 ? endBearing : startBearing + delta * eased
        );
      };
      this._bearingAnimationFrame = requestAnimationFrame(animate.bind(this));
    },
    /**
     * Cancel a running pitch/bearing animation.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _stopPitchBearingAnimation() {
      this._bearingAnimationId = (this._bearingAnimationId || 0) + 1;
      if (this._bearingAnimationFrame) {
        cancelAnimationFrame(this._bearingAnimationFrame);
        delete this._bearingAnimationFrame;
      }
    },
    /**
     * Rotate the map back to north (bearing 0), animated by default.
     * 
     * @param {Object} [options] Animation options (`animate`, `duration`, `easeLinearity`).
     * 
     * @returns {L.Map} This map instance.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    resetNorth(options) {
      options = Object.assign({ animate: true, duration: 0.5 }, options);
      if (options.animate) {
        this._animatePitchBearing(this.getPitch(), 0, options);
      } else {
        this.setBearing(0);
      }
      return this;
    },
    /**
     * Rotate the map back to north and remove the pitch, animated by default.
     * 
     * @param {Object} [options] Animation options (`animate`, `duration`, `easeLinearity`).
     * 
     * @returns {L.Map} This map instance.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    resetNorthPitch(options) {
      options = Object.assign({ animate: true, duration: 0.5 }, options);
      if (options.animate) {
        this._animatePitchBearing(0, 0, options);
      } else {
        this._stopPitchBearingAnimation();
        this._setPitchAndBearing(0, 0);
      }
      return this;
    },
    /**
     * Apply a bearing immediately and update the rotated pane and map coordinates.
     * 
     * @param {number} theta Bearing in degrees.
     * @param {L.LatLng} [mapCenter] Center to preserve while applying the change.
     * 
     * @fires L.Map#rotate
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _setBearing(theta, mapCenter) {
      if (!mapCenter && this._loaded) {
        mapCenter = this.getCenter();
      }
      const bearing = L.Util.wrapNum(theta, [0, 360]) * (Math.PI / 180), center = this._getPixelCenter(), oldPos = this._getRotatePanePos().rotateFrom(-this._bearing, center), newPos = oldPos.rotateFrom(bearing, center);
      this._pivot = center;
      this._bearing = bearing;
      this._rotatePanePos = newPos;
      if (this._pitch) {
        this._rotatePane._leaflet_pos = oldPos;
        this._updatePitchTransform();
      } else {
        L.DomUtil.setPosition(this._rotatePane, oldPos, bearing, center);
      }
      if (mapCenter) {
        this._pixelOrigin = this.project(mapCenter, this._zoom).subtract(this.containerPointToLayerPoint(this.getSize().divideBy(2)));
        delete this._lastCenter;
        this.fire("move");
      }
      this.fire("rotate");
    },
    /**
     * Transform a point with a projective matrix, accepting DOMMatrix or its 2D inverse.
     * 
     * @param {L.Point|number[]} point Input pixel coordinate.
     * @param {DOMMatrix|Object} matrix Forward or inverse transformation matrix.
     * 
     * @returns {L.Point} Transformed pixel coordinate.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _transformPitchPoint(point, matrix) {
      point = toPoint(point);
      if (!(matrix instanceof DOMMatrix)) {
        const denominator = matrix.g * point.x + matrix.h * point.y + matrix.i;
        return new L.Point(
          (matrix.a * point.x + matrix.b * point.y + matrix.c) / denominator,
          (matrix.d * point.x + matrix.e * point.y + matrix.f) / denominator
        );
      }
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return new L.Point(transformed.x / transformed.w, transformed.y / transformed.w);
    },
    /**
     * Apply the current pitch/bearing CSS transform and cache its forward and inverse matrices.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _updatePitchTransform() {
      if (!this._pitch || !this._rotatePane) {
        return;
      }
      const pivot = this._getPixelCenter(), size = this.getSize(), perspective = Math.max(1, size.y * 1.5), position = this._rotatePane._leaflet_pos || new L.Point(0, 0), transform = `translate3d(${pivot.x}px,${pivot.y}px,0) perspective(${perspective}px) rotateX(${this.getPitch()}deg) rotateZ(${this.getBearing()}deg) translate3d(${position.x - pivot.x}px,${position.y - pivot.y}px,0)`;
      this._rotatePane.style.transformOrigin = "0 0";
      this._rotatePane.style.transform = transform;
      const matrix = this._pitchTransform = new DOMMatrix(transform), a = matrix.m11, b = matrix.m21, c = matrix.m41, d = matrix.m12, e = matrix.m22, f = matrix.m42, g = matrix.m14, h = matrix.m24, i = matrix.m44, determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
      this._pitchInverseTransform = {
        a: (e * i - f * h) / determinant,
        b: (c * h - b * i) / determinant,
        c: (b * f - c * e) / determinant,
        d: (f * g - d * i) / determinant,
        e: (a * i - c * g) / determinant,
        f: (c * d - a * f) / determinant,
        g: (d * h - e * g) / determinant,
        h: (b * g - a * h) / determinant,
        i: (a * e - b * d) / determinant
      };
      this._updatePitchSky();
    },
    /**
     * Fill the area above the far plane (where no tiles are loaded) with a sky gradient.
     * Style it through the `.leaflet-pitch-sky` class.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _updatePitchSky() {
      const farY = this._pitch && this._pitchInverseTransform ? this._getPitchFarY() : -Infinity;
      if (farY <= 0) {
        if (this._pitchSky) {
          this._pitchSky.style.display = "none";
        }
        return;
      }
      if (!this._pitchSky) {
        this._pitchSky = L.DomUtil.create("div", "leaflet-pitch-sky", this._container);
        Object.assign(this._pitchSky.style, {
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          zIndex: 0,
          pointerEvents: "none",
          background: "linear-gradient(#9ec5e8, #dfe9f0)"
        });
      }
      this._pitchSky.style.display = "";
      this._pitchSky.style.height = `${Math.ceil(farY) + 1}px`;
    },
    /**
     * Set the map pitch in degrees. Values are clamped to the range 0–85.
     *
     * @param {number} pitch Pitch angle in degrees; clamped to [0, 85].
     * @param {Object} [options] Animation options (`animate`, `duration`, `easeLinearity`).
     * 
     * @returns {L.Map} This map instance.
     * 
     * @fires L.Map#pitch
     * 
     * @since leaflet-rotate (0.5.0)
     */
    setPitch(pitch, options) {
      if (options && options.animate) {
        this._animatePitchBearing(pitch, this.getBearing(), options);
        return this;
      }
      this._stopPitchBearingAnimation();
      this._setPitchAndBearing(pitch, this.getBearing());
      return this;
    },
    /**
     * Update pitch and bearing together, preserving the current map center.
     * Used by the Ctrl+drag handler to avoid applying two separate transforms.
     * 
     * @param {number} pitch Pitch angle in degrees.
     * @param {number} bearing Bearing angle in degrees.
     * 
     * @fires L.Map#pitch
     * @fires L.Map#rotate
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _setPitchAndBearing(pitch, bearing) {
      if (!this._rotate) {
        return;
      }
      const clampedPitch = Math.max(0, Math.min(pitch, 85)) * (Math.PI / 180), clampedBearing = L.Util.wrapNum(bearing, [0, 360]) * (Math.PI / 180), pitchChanged = clampedPitch !== this._pitch;
      if (!pitchChanged && clampedBearing === this._bearing) {
        return;
      }
      const mapCenter = this._loaded ? this.getCenter() : void 0;
      if (pitchChanged) {
        this._pitch = clampedPitch;
        this._rotatePane.style.transformOrigin = L.version.startsWith("2.") ? "0 0" : "";
      }
      this._setBearing(bearing, mapCenter);
      if (pitchChanged) {
        if (!this._pitch) {
          this._updatePitchSky();
        }
        this.fire("pitch");
      }
    },
    /**
     * Get the current map pitch in degrees.
     * 
     * @returns {number} Pitch angle in degrees.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    getPitch() {
      return (this._pitch || 0) * (180 / Math.PI);
    },
    /**
     * Zoom while keeping the given point fixed on screen, also when the map is pitched.
     *
     * Leaflet interpolates in container space, which is not linear under perspective;
     * interpolating in layer space keeps the point under the cursor.
     *
     * @param {L.LatLng|L.Point} latlng Geographic point or container point to keep fixed.
     * @param {number} zoom Target zoom level.
     * @param {Object} [options] Zoom options.
     *
     * @returns {L.Map} This map instance.
     *
     * @since leaflet-rotate (0.5.1)
     */
    setZoomAround(latlng, zoom, options) {
      if (!this._pitch) {
        return mapProto.setZoomAround.apply(this, arguments);
      }
      const scale = this.getZoomScale(zoom), size = this.getSize(), center = this.containerPointToLayerPoint(size.divideBy(2)), containerPoint = latlng instanceof L.Point ? latlng : this.latLngToContainerPoint(latlng), point = this.containerPointToLayerPoint(containerPoint), newCenter = this.layerPointToLatLng(center.add(point.subtract(center).multiplyBy(1 - 1 / scale)));
      options = Object.assign({}, options);
      if (options.animate === void 0 && new L.Bounds(new L.Point(0, 0), size).contains(containerPoint)) {
        options.animate = true;
      }
      return this.setView(newCenter, zoom, { zoom: options });
    },
    /**
     * Get the current map bearing. Enable the `rotate` map option before calling.
     * 
     * @returns {number} Bearing in degrees, normalized to [0, 360).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getBearing() {
      return this._bearing * (180 / Math.PI);
    },
    /**
     * Creates a new [map pane](#map-pane) with the given name if it doesn't
     * exist already, then returns it. The pane is created as a child of
     * `container`, or as a child of the main map pane if not set.
     * 
     * @param {String} name leaflet pane
     * @param {HTMLElement} [container] parent element
     * 
     * @returns {HTMLElement} pane container
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    // createPane(name, container) {
    //     if (!this._rotate || name == 'mapPane') {
    //         return mapProto.createPane.apply(this, arguments);
    //     }
    //     // init "rotatePane"
    //     if (!this._rotatePane) {
    //         // this._pivot = this.getSize().divideBy(2);
    //         this._rotatePane = mapProto.createPane.call(this, 'rotatePane', this._mapPane);
    //         L.DomUtil.setPosition(this._rotatePane, new L.Point(0, 0), this._bearing, this._pivot);
    //     }
    //     return mapProto.createPane.call(this, name, container || this._rotatePane);
    // },
    /**
     * Panes are DOM elements used to control the ordering of layers on
     * the map. You can access panes with [`map.getPane`](#map-getpane)
     * or [`map.getPanes`](#map-getpanes) methods. New panes can be created
     * with the [`map.createPane`](#map-createpane) method.
     * 
     * Every map has the following default panes that differ only in zIndex:
     * 
     * - mapPane     [HTMLElement = 'auto'] - Pane that contains all other map panes
     * - tilePane    [HTMLElement = 2]      - Pane for tile layers
     * - overlayPane [HTMLElement = 4]      - Pane for overlays like polylines and polygons
     * - shadowPane  [HTMLElement = 5]      - Pane for overlay shadows (e.g. marker shadows)
     * - markerPane  [HTMLElement = 6]      - Pane for marker icons
     * - tooltipPane [HTMLElement = 650]    - Pane for tooltips.
     * - popupPane   [HTMLElement = 700]    - Pane for popups.
     */
    /**
     * Create the map's panes, placing tile/vector layers in the transformed pane
     * and markers/overlays in the pane that remains upright.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _initPanes() {
      const panes = this._panes = {};
      this._paneRenderers = {};
      this._mapPane = this.createPane("mapPane", this._container);
      L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));
      if (this._rotate) {
        this._rotatePane = this.createPane("rotatePane", this._mapPane);
        this._norotatePane = this.createPane("norotatePane", this._mapPane);
        if (L.version.startsWith("2.")) {
          this._rotatePane.style.transformOrigin = "0 0";
        }
        this.createPane("tilePane", this._rotatePane);
        this.createPane("overlayPane", this._rotatePane);
        this.createPane("shadowPane", this._norotatePane);
        this.createPane("markerPane", this._norotatePane);
        this.createPane("tooltipPane", this._norotatePane);
        this.createPane("popupPane", this._norotatePane);
      } else {
        this.createPane("tilePane");
        this.createPane("overlayPane");
        this.createPane("shadowPane");
        this.createPane("markerPane");
        this.createPane("tooltipPane");
        this.createPane("popupPane");
      }
      if (!this.options.markerZoomAnimation) {
        panes.markerPane.classList.add("leaflet-zoom-hide");
        panes.shadowPane.classList.add("leaflet-zoom-hide");
      }
    },
    /**
     * Pans the map the minimum amount to make the `latlng` visible. Use
     * padding options to fit the display to more restricted bounds.
     * If `latlng` is already within the (optionally padded) display bounds,
     * the map will not be panned.
     * 
     * @see https://github.com/Raruto/leaflet-rotate/issues/18
     * 
     * @param {L.LatLng} latlng Geographic point to keep visible.
     * @param {Object} [options={}] Padding options (`padding`, `paddingTopLeft`, `paddingBottomRight`).
     * 
     * @returns {L.Map} current map instance
     * 
     * @since leaflet-rotate (v0.1.4)
     */
    panInside(latlng, options) {
      if (!this._rotate || !this._pitch && Math.abs(this._bearing).toFixed(1) < 0.1) {
        return mapProto.panInside.apply(this, arguments);
      }
      options = options || {};
      const paddingTL = toPoint(options.paddingTopLeft || options.padding || [0, 0]), paddingBR = toPoint(options.paddingBottomRight || options.padding || [0, 0]), pixelPoint = this.latLngToContainerPoint(latlng), pixelBounds = new L.Bounds([new L.Point(0, 0), this.getSize()]), pixelCenter = pixelBounds.getCenter(), paddedBounds = new L.Bounds([pixelBounds.min.add(paddingTL), pixelBounds.max.subtract(paddingBR)]), paddedSize = paddedBounds.getSize();
      if (!paddedBounds.contains(pixelPoint)) {
        this._enforcingBounds = true;
        const centerOffset = pixelPoint.subtract(paddedBounds.getCenter());
        const offset = paddedBounds.extend(pixelPoint).getSize().subtract(paddedSize);
        pixelCenter.x += centerOffset.x < 0 ? -offset.x : offset.x;
        pixelCenter.y += centerOffset.y < 0 ? -offset.y : offset.y;
        this.panTo(this.containerPointToLatLng(pixelCenter), options);
        this._enforcingBounds = false;
      }
      return this;
    },
    /**
     * Pans the map to the closest view that would lie inside the given bounds
     * (if it's not already), controlling the animation using the options specific,
     * if any.
     * 
     * @TODO check if map bounds calculated by `L.Map::panInsideBounds()`
     *       function should match the `rotatePane` or `norotatePane` bounds
     *
     * @see https://github.com/fnicollet/Leaflet/issues/7
     * 
     * @param {L.LatLngBounds} bounds Geographic bounds to fit inside the viewport.
     * @param {Object} [options] Pan animation options.
     * 
     * @returns {L.Map} This map instance.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    // panInsideBounds(bounds, options) {
    //     this._enforcingBounds = true;
    //     const center = this.getCenter(),
    //         newCenter = this._limitCenter(center, this._zoom, L.latLngBounds(bounds));
    //
    //     if (!center.equals(newCenter)) {
    //         this.panTo(newCenter, options);
    //     }
    //
    //     this._enforcingBounds = false;
    //     return this;
    // },
    // adjust center for view to get inside bounds
    // _limitCenter(center, zoom, bounds) {
    //
    //     if (!bounds) { return center; }
    //
    //     const centerPoint = this.project(center, zoom),
    //         viewHalf = this.getSize().divideBy(2),
    //         viewBounds = new Bounds(centerPoint.subtract(viewHalf), centerPoint.add(viewHalf)),
    //         offset = this._getBoundsOffset(viewBounds, bounds, zoom);
    //
    //     // If offset is less than a pixel, ignore.
    //     // This prevents unstable projections from getting into
    //     // an infinite loop of tiny offsets.
    //     if (Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1) {
    //             return center;
    //     }
    //
    //     return this.unproject(centerPoint.add(offset), zoom);
    // },
    // @method flyToBounds(bounds: LatLngBounds, options?: fitBounds options): this
    // Sets the view of the map with a smooth animation like [`flyTo`](#map-flyto),
    // but takes a bounds parameter like [`fitBounds`](#map-fitbounds).
    // flyToBounds(bounds, options) {
    //     const target = this._getBoundsCenterZoom(bounds, options);
    //     return this.flyTo(target.center, target.zoom, options);
    // },
    // _getBoundsCenterZoom(bounds, options) {
    //
    //     options = options || {};
    //     bounds = bounds.getBounds ? bounds.getBounds() : toLatLngBounds(bounds);
    //
    //     const paddingTL = L.point(options.paddingTopLeft || options.padding || [0, 0]),
    //           paddingBR = L.point(options.paddingBottomRight || options.padding || [0, 0]);
    //
    //     let zoom = this.getBoundsZoom(bounds, false, paddingTL.add(paddingBR));
    //
    //     zoom = (typeof options.maxZoom === 'number') ? Math.min(options.maxZoom, zoom) : zoom;
    //
    //     if (zoom === Infinity) {
    //         return { center: bounds.getCenter(), zoom };
    //     }
    //
    //     return { center, zoom };
    //
    // },
    /**
     * Returns the maximum zoom level on which the given bounds fit to the map
     * view in its entirety. If `inside` (optional) is set to `true`, the method
     * instead returns the minimum zoom level on which the map view fits into
     * the given bounds in its entirety.
     * 
     * @param {L.LatLngBounds} bounds Geographic bounds to fit.
     * @param {boolean} [inside=false] Fit the viewport inside bounds instead of bounds inside the viewport.
     * @param {L.Point|number[]} [padding=[0,0]] Pixel padding around the viewport.
     * 
     * @returns {number} Zoom level satisfying the fit.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    getBoundsZoom(bounds, inside, padding) {
      if (!this._rotate || !this._pitch && Math.abs(this._bearing).toFixed(1) < 0.1) {
        return mapProto.getBoundsZoom.apply(this, arguments);
      }
      bounds = bounds instanceof L.LatLngBounds ? bounds : new L.LatLngBounds(bounds);
      padding = toPoint(padding || [0, 0]);
      let zoom = this.getZoom() || 0;
      const min = this.getMinZoom(), max = this.getMaxZoom(), size = this.getSize().subtract(padding), boundsSize = this.mapBoundsToContainerBounds(bounds).getSize(), snap = this.options.zoomSnap, scalex = size.x / boundsSize.x, scaley = size.y / boundsSize.y, scale = inside ? Math.max(scalex, scaley) : Math.min(scalex, scaley);
      zoom = this.getScaleZoom(scale, zoom);
      if (snap) {
        zoom = Math.round(zoom / (snap / 100)) * (snap / 100);
        zoom = inside ? Math.ceil(zoom / snap) * snap : Math.floor(zoom / snap) * snap;
      }
      return Math.max(min, Math.min(max, zoom));
    },
    /**
     * Layer point of the current center
     * 
     * @returns {L.Point} layer center
     */
    // _getCenterLayerPoint() {
    //    return this.containerPointToLayerPoint(this.getSize()._divideBy(2));
    // },
    /**
     * Return the pixel offset from the current center to the given geographic point.
     * 
     * @param {L.LatLng} latlng Geographic point.
     * 
     * @returns {L.Point} Offset in container pixels (the map pane is panned in screen space), adjusted for bearing and pitch.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getCenterOffset(latlng) {
      if (!this._rotate) {
        return mapProto._getCenterOffset.apply(this, arguments);
      }
      return this.latLngToContainerPoint(latlng)._subtract(this.getSize()._divideBy(2));
    },
    /**
     * Return the current position of the rotated pane.
     * 
     * @returns {L.Point} Rotated-pane position in map-pane coordinates.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getRotatePanePos() {
      return this._rotatePanePos || new L.Point(0, 0);
    },
    // _latLngToNewLayerPoint(latlng, zoom, center) {
    //    const topLeft = this._getNewPixelOrigin(center, zoom);
    //    return this.project(latlng, zoom)._subtract(topLeft);
    //},
    /**
     * Calculate the pixel origin for a target view while preserving bearing-aware alignment.
     * 
     * @param {L.LatLng} center Target center.
     * @param {number} zoom Target zoom level.
     * 
     * @returns {L.Point} New pixel origin.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getNewPixelOrigin(center, zoom) {
      if (!this._rotate) {
        return mapProto._getNewPixelOrigin.apply(this, arguments);
      }
      return this.project(center, zoom)._subtract(this.containerPointToLayerPoint(this.getSize()._divideBy(2)))._round();
    },
    /**
     * Calculate the pixel bounds needed to cover the transformed viewport.
     * 
     * @param {L.LatLng} [center=this.getCenter()] Target center.
     * @param {number} [zoom=this.getZoom()] Target zoom level.
     * 
     * @returns {L.Bounds} Pixel bounds in projected map coordinates.
     * 
     * @since leaflet-rotate (v0.2.0)
     * 
     * @see src\layer\tile\GridLayer::_getTiledPixelBounds()
     */
    _getNewPixelBounds(center, zoom) {
      center = center || this.getCenter();
      zoom = zoom || this.getZoom();
      if (!this._rotate && mapProto._getNewPixelBounds) {
        return mapProto._getNewPixelBounds.apply(this, arguments);
      }
      const mapZoom = this._animatingZoom ? Math.max(this._animateToZoom, this.getZoom()) : this.getZoom(), scale = this.getZoomScale(mapZoom, zoom), pixelCenter = this.project(center, zoom).floor(), [min, max] = this._getPitchedContainerBounds(0), corners = [[min.x, min.y], [max.x, min.y], [min.x, max.y], [max.x, max.y]].map((point) => this.containerPointToLayerPoint(point));
      if (this._pitch) {
        const viewCenter = this.containerPointToLayerPoint(this.getSize()._divideBy(2));
        return new L.Bounds(corners.map((point) => pixelCenter.add(point.subtract(viewCenter).divideBy(scale))));
      }
      const halfSize = new L.Bounds(corners.map((point) => point.floor())).getSize().divideBy(scale * 2);
      return new L.Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize));
    },
    /**
     * @since leaflet-rotate (v0.2.0)
     * 
     * @returns {L.Point} Map pivot point in pixel coordinates.
     */
    _getPixelCenter() {
      if (!this._rotate && mapProto._getPixelCenter) {
        return mapProto._getPixelCenter.apply(this, arguments);
      }
      return this.getSize()._divideBy(2)._subtract(this._getMapPanePos());
    },
    /**
     * @see src\layer\vector\Renderer::_update()
     * 
     * @param {number} padding Bounds padding as a fraction of map size.
     * 
     * @returns {L.Bounds} Padded bounds in layer-point coordinates.
     * 
     * @since leaflet-rotate (v0.2.0)
     */
    _getPaddedPixelBounds(padding) {
      if (!this._rotate && mapProto._getPaddedPixelBounds) {
        return mapProto._getPaddedPixelBounds.apply(this, arguments);
      }
      const [padMin, padMax] = this._getPitchedContainerBounds(padding);
      return new L.Bounds([
        this.containerPointToLayerPoint([padMin.x, padMin.y]).floor(),
        this.containerPointToLayerPoint([padMin.x, padMax.y]).floor(),
        this.containerPointToLayerPoint([padMax.x, padMin.y]).floor(),
        this.containerPointToLayerPoint([padMax.x, padMax.y]).floor()
      ]);
    },
    /**
     * Build and fire Leaflet's location-found event, including the device heading.
     * 
     * @param {GeolocationPosition} pos Browser geolocation result.
     * 
     * @fires L.Map#locationfound
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _handleGeolocationResponse(pos) {
      if (!this._container._leaflet_id) {
        return;
      }
      const lat = pos.coords.latitude, lng = pos.coords.longitude, hdg = pos.coords.heading, latlng = new L.LatLng(lat, lng), bounds = latlng.toBounds(pos.coords.accuracy), options = this._locateOptions;
      if (options.setView) {
        const zoom = this.getBoundsZoom(bounds);
        this.setView(latlng, options.maxZoom ? Math.min(zoom, options.maxZoom) : zoom);
      }
      const data = {
        latlng,
        bounds,
        timestamp: pos.timestamp,
        /** @TODO use mapProto._handleGeolocationResponse */
        heading: hdg
      };
      for (const i in pos.coords) {
        if (typeof pos.coords[i] === "number") {
          data[i] = pos.coords[i];
        }
      }
      this.fire("locationfound", data);
    }
    /**
     * @see https://github.com/ronikar/Leaflet/blob/5c480ef959b947c3beed7065425a5a36c486262b/src/geo/LatLngBounds.js#L253-L264
     * 
     * @param {L.Bounds} points 
     * 
     * @returns {L.Bounds}
     */
    // toCircumscribedBounds(points) {
    //     const minX = points.reduce(function (pv, v) { return Math.min(pv, v.x); }, points[0].x),
    //         maxX = points.reduce(function (pv, v) { return Math.max(pv, v.x); }, points[0].x),
    //         minY = points.reduce(function (pv, v) { return Math.min(pv, v.y); }, points[0].y),
    //         maxY = points.reduce(function (pv, v) { return Math.max(pv, v.y); }, points[0].y);
    //
    //     return L.bounds(L.point(minX, minY), L.point(maxX, maxY));
    // },
  });

  // src/map/handler/CompassBearing.js
  L.Map.CompassBearing = L.Handler.extend({
    /**
     * @param {L.Map} map Map whose bearing follows device orientation.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
      this._map = map;
      if ("ondeviceorientationabsolute" in window) {
        this.__deviceOrientationEvent = "deviceorientationabsolute";
      } else if ("ondeviceorientation" in window) {
        this.__deviceOrientationEvent = "deviceorientation";
      }
      this._throttled = L.Util.throttle(this._onDeviceOrientation, 100, this);
    },
    /**
     * Subscribe to the supported device-orientation event, if available.
     * On iOS, permission is requested first (call `enable()` from a user gesture).
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      if (this._map._rotate && this.__deviceOrientationEvent) {
        L.DomEvent.on(window, this.__deviceOrientationEvent, this._throttled, this);
        const DOE = window.DeviceOrientationEvent;
        if (DOE && DOE.requestPermission) {
          DOE.requestPermission().then((state) => "denied" === state && this.enabled() && this.disable()).catch(() => {
          });
        }
      } else {
        this.disable();
      }
    },
    /**
     * Unsubscribe from device orientation when the handler is disabled.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      if (this._map._rotate && this.__deviceOrientationEvent) {
        L.DomEvent.off(window, this.__deviceOrientationEvent, this._throttled, this);
      }
    },
    /**
     * Apply a device orientation reading to the map bearing.
     *
     * `DeviceOrientationEvent.absolute` - Indicates whether the device is providing absolute
     *                                     orientation values (relatives to Magnetic North) or
     *                                     using some arbitrary frame determined by the device.
     * 
     * `DeviceOrientationEvent.alpha`    - Returns the rotation of the device around the Z axis;
     *                                     that is, the number of degrees by which the device is
     *                                     being twisted around the center of the screen.
     * 
     * `window.orientation`              - Returns the screen orientation in degrees (in 90-degree increments)
     *                                     of the viewport relative to the device's natural orientation.
     *                                     Its only possible values are -90, 0, 90, and 180. Positive
     *                                     values are counterclockwise; negative values are clockwise.
     * 
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/absolute
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/alpha
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/orientation
     *
     * @param {DeviceOrientationEvent} e Orientation reading from the browser.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onDeviceOrientation(e) {
      let angle = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.alpha;
      let deviceOrientation = 0;
      if (!Number.isFinite(angle)) {
        return;
      }
      if (!e.absolute && e.webkitCompassHeading) {
        angle = 360 - angle;
      }
      if (!e.absolute && "undefined" !== typeof window.orientation) {
        deviceOrientation = window.orientation;
      }
      this._map.setBearing(angle - deviceOrientation);
    }
  });
  L.Map.addInitHook("addHandler", "compassBearing", L.Map.CompassBearing);

  // src/map/handler/ContainerMutation.js
  L.Map.mergeOptions({
    /**
     * Whether the map uses mutation observers to
     * detect changes in its container and trigger
     * `invalidateSize`. Disabled by default due to
     * support not being available in all web browsers.
     *
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     * 
     * @see https://developer.mozilla.org/docs/Web/API/MutationObserver
     */
    trackContainerMutation: false
  });
  L.Map.ContainerMutation = L.Handler.extend({
    /**
     * Start observing the map container's style attribute.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      if (!this._observer) {
        this._observer = new MutationObserver(L.Util.bind(this._map.invalidateSize, this._map));
      }
      this._observer.observe(this._map.getContainer(), {
        childList: false,
        attributes: true,
        characterData: false,
        subtree: false,
        attributeFilter: ["style"]
      });
    },
    /**
     * Stop observing container mutations.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      this._observer.disconnect();
    }
  });
  L.Map.addInitHook("addHandler", "trackContainerMutation", L.Map.ContainerMutation);

  // src/map/handler/TouchGestures.js
  function touchToContainerPoint(map, touch) {
    const container = map.getContainer(), rect = container.getBoundingClientRect();
    return new L.Point(
      touch.clientX - rect.left - container.clientLeft,
      touch.clientY - rect.top - container.clientTop
    );
  }
  L.Map.mergeOptions({
    /**
     * Whether pinch zoom may temporarily exceed min/max zoom and bounce back.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bounceAtZoomLimits: true
  });
  L.Map.TouchGestures = L.Handler.extend({
    /**
     * Initialize the shared handler from the map's touch zoom/rotation options.
     * 
     * @param {L.Map} map Map whose touch gestures are handled.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
      this._map = map;
      this.rotate = !!this._map.options.touchRotate;
      this.zoom = !!this._map.options.touchZoom;
      this.pitch = !!this._map.options.touchPitch;
    },
    /**
     * Listen for the start of two-finger gestures on the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      L.DomEvent.on(this._map._container, "touchstart", this._onTouchStart, this);
    },
    /**
     * Remove the touch-start listener.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      L.DomEvent.off(this._map._container, "touchstart", this._onTouchStart, this);
    },
    /**
     * Record initial touch points and start tracking a two-finger gesture.
     * 
     * @param {TouchEvent} e Touch-start event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onTouchStart(e) {
      const map = this._map;
      if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming || this._rotating || this._gesture) {
        return;
      }
      const p1 = touchToContainerPoint(map, e.touches[0]), p2 = touchToContainerPoint(map, e.touches[1]), vector = p1.subtract(p2);
      const canPitch = this.pitch && map._rotate && Math.abs(vector.x) > Math.abs(vector.y);
      if (!canPitch && !this.zoom && !this.rotate) {
        return;
      }
      this._gesture = canPitch ? "pending" : "pinch";
      this._startP1 = p1;
      this._startP2 = p2;
      map._stopPitchBearingAnimation();
      this._centerPoint = map.getSize()._divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      if (this.zoom) {
        if (map.options.touchZoom !== "center") {
          this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
        }
        this._startDist = p1.distanceTo(p2);
        this._startZoom = map.getZoom();
        this._zooming = true;
      } else {
        this._zooming = false;
      }
      if (this.rotate) {
        this._startTheta = Math.atan(vector.x / vector.y);
        this._startBearing = map.getBearing();
        if (vector.y < 0) {
          this._startBearing += 180;
        }
        this._rotating = true;
      } else {
        this._rotating = false;
      }
      this._moved = false;
      map._stop();
      L.DomEvent.on(document, "touchmove", this._onTouchMove, this).on(document, "touchend touchcancel", this._onTouchEnd, this);
      L.DomEvent.preventDefault(e);
    },
    /**
     * Update bearing and/or zoom while the two touch points move.
     * 
     * @param {TouchEvent} e Touch-move event.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onTouchMove(e) {
      if (!e.touches || e.touches.length !== 2 || !this._gesture) {
        return;
      }
      const map = this._map, p1 = touchToContainerPoint(map, e.touches[0]), p2 = touchToContainerPoint(map, e.touches[1]), vector = p1.subtract(p2), scale = p1.distanceTo(p2) / this._startDist;
      let delta;
      if (this._gesture === "pending") {
        const d1 = p1.subtract(this._startP1), d2 = p2.subtract(this._startP2);
        if (Math.max(d1.x * d1.x + d1.y * d1.y, d2.x * d2.x + d2.y * d2.y) < 25) {
          L.DomEvent.preventDefault(e);
          return;
        }
        const vertical = (d) => Math.abs(d.y) > Math.abs(d.x);
        if (vertical(d1) && vertical(d2) && Math.sign(d1.y) === Math.sign(d2.y)) {
          this._gesture = "pitch";
          this._lastPitchY = (this._startP1.y + this._startP2.y) / 2;
          this._zooming = this._rotating = false;
        } else {
          this._gesture = "pinch";
        }
      }
      if (this._gesture === "pitch") {
        const y = (p1.y + p2.y) / 2;
        map._setPitchAndBearing(map.getPitch() - (y - this._lastPitchY) * 0.5, map.getBearing());
        this._lastPitchY = y;
        L.DomEvent.preventDefault(e);
        return;
      }
      if (!(this._zooming || this._rotating)) {
        return;
      }
      if (this._rotating) {
        const theta = Math.atan(vector.x / vector.y);
        let bearingDelta = (theta - this._startTheta) * (180 / Math.PI);
        if (vector.y < 0) {
          bearingDelta += 180;
        }
        if (bearingDelta) {
          map.setBearing(this._startBearing - bearingDelta);
        }
      }
      if (this._zooming) {
        this._zoom = map.getScaleZoom(scale, this._startZoom);
        if (!map.options.bounceAtZoomLimits && (this._zoom < map.getMinZoom() && scale < 1 || this._zoom > map.getMaxZoom() && scale > 1)) {
          this._zoom = map._limitZoom(this._zoom);
        }
        if (map.options.touchZoom === "center") {
          this._center = this._startLatLng;
          if (scale === 1) {
            return;
          }
        } else {
          delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
          if (scale === 1 && delta.x === 0 && delta.y === 0) {
            return;
          }
          const mapDelta = map._pitch ? map.containerPointToLayerPoint(this._centerPoint.add(delta)).subtract(map.containerPointToLayerPoint(this._centerPoint)) : delta.rotate(-map.getBearing() * (Math.PI / 180));
          this._center = map.unproject(map.project(this._pinchStartLatLng).subtract(mapDelta));
        }
      }
      if (!this._moved) {
        map._moveStart(true, false);
        this._moved = true;
      }
      const moveFn = map._move.bind(map, this._center, this._zoom, { pinch: true, round: false }, void 0);
      moveFn();
      if (this.zoom) {
        if (map.options.zoomAnimation) {
          map._animateZoomNoDelay(this._center, map._limitZoom(this._zoom));
        } else {
          map._resetView(this._center, map._limitZoom(this._zoom));
        }
      }
      L.DomEvent.preventDefault(e);
    },
    /**
     * Finish the gesture, settle the zoom and remove document listeners.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onTouchEnd() {
      const gesture = this._gesture;
      delete this._gesture;
      if (gesture === "pitch" || gesture === "pending" || !this._moved || !(this._zooming || this._rotating)) {
        this._zooming = false;
        this._rotating = false;
        L.DomEvent.off(document, "touchmove", this._onTouchMove, this).off(document, "touchend touchcancel", this._onTouchEnd, this);
        return;
      }
      this._zooming = false;
      this._rotating = false;
      L.DomEvent.off(document, "touchmove", this._onTouchMove, this).off(document, "touchend touchcancel", this._onTouchEnd, this);
      if (this.zoom) {
        if (this._map.options.zoomAnimation) {
          this._map._animateZoom(this._center, this._map._limitZoom(this._zoom), true, this._map.options.zoomSnap);
        } else {
          this._map._resetView(this._center, this._map._limitZoom(this._zoom));
        }
      }
    }
  });
  L.Map.addInitHook("addHandler", "touchGestures", L.Map.TouchGestures);

  // src/map/handler/TouchRotate.js
  L.Map.mergeOptions({
    /**
     * Whether the map can be rotated with a two-finger rotation gesture
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    touchRotate: false
  });
  L.Map.TouchRotate = L.Handler.extend({
    /**
     * Enable rotation handling in the map's shared touch gesture handler.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      this._map.touchGestures.enable();
      this._map.touchGestures.rotate = true;
    },
    /**
     * Disable rotation handling without affecting pinch zoom.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      this._map.touchGestures.rotate = false;
    }
  });
  L.Map.addInitHook("addHandler", "touchRotate", L.Map.TouchRotate);

  // src/map/handler/TouchPitch.js
  L.Map.mergeOptions({
    /**
     * Whether the map can be pitched by dragging two fingers vertically
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (0.5.1)
     */
    touchPitch: false
  });
  L.Map.TouchPitch = L.Handler.extend({
    /**
     * Enable pitch handling in the map's shared touch gesture handler.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    addHooks() {
      this._map.touchGestures.enable();
      this._map.touchGestures.pitch = true;
    },
    /**
     * Disable pitch handling without affecting pinch zoom and rotation.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    removeHooks() {
      this._map.touchGestures.pitch = false;
    }
  });
  L.Map.addInitHook("addHandler", "touchPitch", L.Map.TouchPitch);

  // src/map/handler/ShiftKeyRotate.js
  L.Map.mergeOptions({
    /**
     * Whether Shift+wheel changes the map bearing.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    shiftKeyRotate: true,
    /**
     * Whether Ctrl+drag (or right-button drag) changes bearing and pitch.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (0.5.0)
     */
    pitchDrag: true
  });
  L.Map.ShiftKeyRotate = L.Handler.extend({
    /**
     * @param {L.Map} map Map controlled by this handler.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    initialize(map) {
      this._map = map;
      this._onMouseDownBound = this._onMouseDown.bind(this);
      this._onMouseMoveBound = this._onMouseMove.bind(this);
      this._onMouseUpBound = this._onMouseUp.bind(this);
      this._onContextMenuBound = this._onContextMenu.bind(this);
      this._applyBound = this._apply.bind(this);
    },
    /**
     * Attach enabled wheel and pointer/mouse gesture listeners.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      if (this._map.options.shiftKeyRotate) {
        L.DomEvent.on(this._map._container, "wheel", this._handleShiftScroll, this);
      }
      if (this._map.options.pitchDrag) {
        this.addPitchHooks();
      }
    },
    /**
     * Detach gesture listeners and cancel any active drag.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      L.DomEvent.off(this._map._container, "wheel", this._handleShiftScroll, this);
      this.removePitchHooks();
    },
    /**
     * Listen for the start of Ctrl+drag pitch gestures.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    addPitchHooks() {
      if (this._pitchHooksAdded) {
        return;
      }
      this._pitchEvents = L.version.startsWith("2.") ? ["pointerdown", "pointermove", "pointerup pointercancel"] : ["mousedown", "mousemove", "mouseup"];
      this._map._container.addEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
      this._map._container.addEventListener("contextmenu", this._onContextMenuBound, true);
      this._pitchHooksAdded = true;
    },
    /**
     * Stop listening for pitch gestures and remove active document listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    removePitchHooks() {
      if (!this._pitchHooksAdded) {
        return;
      }
      this._map._container.removeEventListener(this._pitchEvents[0], this._onMouseDownBound, true);
      this._map._container.removeEventListener("contextmenu", this._onContextMenuBound, true);
      this._onMouseUp();
      delete this._pitchEvents;
      this._pitchHooksAdded = false;
    },
    /**
     * Rotate the map in fixed increments while Shift is held during wheel input.
     * 
     * @param {WheelEvent} e Wheel event from the map container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _handleShiftScroll(e) {
      if (e.shiftKey) {
        e.preventDefault();
        this._map.scrollWheelZoom.disable();
        this._map.setBearing(this._map.getBearing() + Math.sign(e.deltaY) * 5);
      } else {
        this._map.scrollWheelZoom.enable();
      }
    },
    /**
     * Start Ctrl+drag (or right-button drag) and capture subsequent movement outside the map.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture start event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseDown(e) {
      if (this._dragging) {
        return;
      }
      this._moved = false;
      if (!this._map._rotate || !this._map.options.pitchDrag || !(e.button === 2 || e.ctrlKey && e.button === 0)) {
        return;
      }
      const scrollWheelZoom = this._map.scrollWheelZoom;
      if (scrollWheelZoom && scrollWheelZoom._timer) {
        clearTimeout(scrollWheelZoom._timer);
        scrollWheelZoom._timer = null;
        scrollWheelZoom._delta = 0;
        scrollWheelZoom._startTime = null;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._map._stopPitchBearingAnimation();
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._pitchDelta = this._bearingDelta = 0;
      document.addEventListener(this._pitchEvents[1], this._onMouseMoveBound);
      for (const event of this._pitchEvents[2].split(" ")) {
        document.addEventListener(event, this._onMouseUpBound);
      }
    },
    /**
     * Accumulate pointer movement as pitch (vertical) and bearing (horizontal).
     * Far from the horizontal center line the bearing follows the pointer angle
     * around the map center.
     * 
     * @param {MouseEvent|PointerEvent} e Gesture movement event.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseMove(e) {
      const rect = this._map._container.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, x = e.clientX, y = e.clientY;
      this._pitchDelta += (this._lastY - y) * 0.5;
      this._bearingDelta += Math.abs(cy - this._lastY) > 100 ? (Math.atan2(y - cy, x - cx) - Math.atan2(y - cy, this._lastX - cx)) * (180 / Math.PI) : (x - this._lastX) * 0.8 * (y < cy ? 1 : -1);
      this._lastX = x;
      this._lastY = y;
      this._moved = true;
      if (!this._frame) {
        this._frame = requestAnimationFrame(this._applyBound);
      }
      e.preventDefault();
    },
    /**
     * Apply accumulated movement once per animation frame.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _apply() {
      this._frame = null;
      if (!this._pitchDelta && !this._bearingDelta) {
        return;
      }
      this._map._setPitchAndBearing(this._map.getPitch() + this._pitchDelta, this._map.getBearing() + this._bearingDelta);
      this._pitchDelta = this._bearingDelta = 0;
    },
    /**
     * Suppress the context menu that follows a right-button drag.
     * 
     * @param {MouseEvent} e Context menu event.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onContextMenu(e) {
      if (this._moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    /**
     * End Ctrl+drag, flush pending movement and clear document-level listeners.
     * 
     * @since leaflet-rotate (0.5.0)
     */
    _onMouseUp() {
      if (!this._pitchEvents || !this._dragging) {
        return;
      }
      document.removeEventListener(this._pitchEvents[1], this._onMouseMoveBound);
      for (const event of this._pitchEvents[2].split(" ")) {
        document.removeEventListener(event, this._onMouseUpBound);
      }
      cancelAnimationFrame(this._frame);
      if (this._map._mapPane) {
        this._apply();
      }
      this._frame = null;
      this._dragging = false;
      delete this._lastX;
      delete this._lastY;
    }
  });
  L.Map.addInitHook(function() {
    if (this.options.shiftKeyRotate) {
      this.shiftKeyRotate = new L.Map.ShiftKeyRotate(this);
      this.shiftKeyRotate.enable();
    } else if (this.options.pitchDrag) {
      this.shiftKeyRotate = new L.Map.ShiftKeyRotate(this);
      this.shiftKeyRotate.addPitchHooks();
      this.on("unload", this.shiftKeyRotate.removePitchHooks, this.shiftKeyRotate);
    }
    if (this.scrollWheelZoom.enabled() && this.options.shiftKeyRotate) {
      this.scrollWheelZoom.disable();
      this.scrollWheelZoom.enable();
    }
  });

  // src/map/handler/TouchZoom.js
  L.Map.mergeOptions({
    /**
     * Whether the map can be zoomed by touch-dragging
     * with two fingers. If passed `'center'`, it will
     * zoom to the center of the view regardless of
     * where the touch events (fingers) were. Enabled
     * for touch-capable web browsers.
     * 
     * @type {(Boolean|String)}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    touchZoom: L.Browser.touch,
    /**
     * @TODO check if this is a duplicate of `L.Map.TouchGestures::bounceAtZoomLimits`
     * 
     * Set it to false if you don't want the map to
     * zoom beyond min/max zoom and then bounce back
     * when pinch-zooming.
     * 
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    bounceAtZoomLimits: false
  });
  L.Map.TouchZoom = L.Handler.extend({
    /**
     * Enable pinch zoom handling and mark the shared touch handler as active.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
      this._map._container.classList.add("leaflet-touch-zoom");
      this._map.touchGestures.enable();
      this._map.touchGestures.zoom = true;
    },
    /**
     * Disable pinch zoom handling while preserving touch rotation state.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
      this._map._container.classList.remove("leaflet-touch-zoom");
      this._map.touchGestures.zoom = false;
    }
  });
  L.Map.addInitHook("addHandler", "touchZoom", L.Map.TouchZoom);

  // src/control/Rotate.js
  L.Control.Rotate = L.Control.extend({
    options: {
      position: "topleft",
      closeOnZeroBearing: true,
      visualizePitch: true
    },
    /**
     * Create the control element and subscribe to map rotation and pitch.
     * 
     * @param {L.Map} map
     * 
     * @returns {HTMLElement} Control container.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    onAdd(map) {
      const container = this._container = L.DomUtil.create("div", "leaflet-control-rotate leaflet-bar");
      const arrow = this._arrow = L.DomUtil.create("span", "leaflet-control-rotate-arrow");
      arrow.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,%3Csvg width='29' height='29' viewBox='0 0 29 29' xmlns='http://www.w3.org/2000/svg' fill='%23333'%3E%3Cpath d='M10.5 14l4-8 4 8h-8z'/%3E%3Cpath d='M10.5 16l4 8 4-8h-8z' fill='%23ccc'/%3E%3C/svg%3E")`;
      arrow.style.display = "block";
      arrow.style.width = "100%";
      arrow.style.height = "100%";
      arrow.style.backgroundRepeat = "no-repeat";
      arrow.style.backgroundPosition = "50%";
      arrow.style.pointerEvents = "none";
      const link = this._link = L.DomUtil.create("a", "leaflet-control-rotate-toggle", container);
      link.appendChild(arrow);
      link.href = "#";
      link.title = this.options.visualizePitch ? "Reset bearing and pitch" : "Reset bearing to north";
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", link.title);
      link.style.cursor = "grab";
      link.style.touchAction = "none";
      this._onPointerMoveBound = this._onPointerMove.bind(this);
      this._onPointerUpBound = this._onPointerUp.bind(this);
      L.DomEvent.on(link, "dblclick contextmenu", L.DomEvent.stop).on(link, "click", L.DomEvent.stop).on(link, "click", this._onClick, this).on(link, "click", this._refocusOnMap, this);
      link.addEventListener("pointerdown", this._onPointerDown.bind(this));
      map.on("rotate pitch", this._restyle, this);
      this._map = map;
      this._restyle();
      return container;
    },
    /**
     * Remove the map event listener when the control is detached.
     * 
     * @param {L.Map} map
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    onRemove(map) {
      this._onPointerUp();
      map.off("rotate pitch", this._restyle, this);
    },
    /**
     * Reset bearing (and pitch) unless the click ends a drag.
     * 
     * @since leaflet-rotate (0.5.1)
     */
    _onClick() {
      if (this._moved) {
        this._moved = false;
        return;
      }
      if (!this._map || !this._map._rotate) {
        return;
      }
      if (this.options.visualizePitch) {
        this._map.resetNorthPitch();
      } else {
        this._map.resetNorth();
      }
    },
    /**
     * Start dragging the control (mouse, pen or touch).
     * 
     * @param {PointerEvent} e
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerDown(e) {
      if (!this._map || !this._map._rotate || e.button > 0 || this._pointerId != null) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._pointerId = e.pointerId;
      this._startX = this._lastX = e.clientX;
      this._startY = this._lastY = e.clientY;
      this._moved = false;
      this._link.style.cursor = "grabbing";
      document.addEventListener("pointermove", this._onPointerMoveBound);
      document.addEventListener("pointerup", this._onPointerUpBound);
      document.addEventListener("pointercancel", this._onPointerUpBound);
    },
    /**
     * Horizontal movement changes the bearing, vertical movement the pitch.
     * 
     * @param {PointerEvent} e
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerMove(e) {
      if (e.pointerId !== this._pointerId) {
        return;
      }
      e.preventDefault();
      if (!this._moved && Math.hypot(e.clientX - this._startX, e.clientY - this._startY) < 3) {
        return;
      }
      if (!this._moved) {
        this._moved = true;
        this._map._stopPitchBearingAnimation();
      }
      const map = this._map, pitch = this.options.visualizePitch ? map.getPitch() + (this._lastY - e.clientY) * 0.5 : map.getPitch();
      map._setPitchAndBearing(pitch, map.getBearing() + (e.clientX - this._lastX) * 0.8);
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    },
    /**
     * Stop dragging and remove document listeners.
     * 
     * @param {PointerEvent} [e]
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _onPointerUp(e) {
      if (e && e.pointerId !== this._pointerId) {
        return;
      }
      document.removeEventListener("pointermove", this._onPointerMoveBound);
      document.removeEventListener("pointerup", this._onPointerUpBound);
      document.removeEventListener("pointercancel", this._onPointerUpBound);
      if (e && this._moved && !this._link.contains(e.target)) {
        this._moved = false;
      }
      delete this._pointerId;
      if (this._link) {
        this._link.style.cursor = "grab";
        this._restyle();
      }
    },
    /**
     * Update the icon (bearing and pitch) and the control visibility.
     * 
     * @listens L.Map#rotate
     * @listens L.Map#pitch
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _restyle() {
      const map = this._map;
      if (!map) {
        return;
      }
      if (!map.options.rotate) {
        this._link.classList.add("leaflet-disabled");
        return;
      }
      const bearing = map.getBearing(), pitch = map.getPitch();
      this._arrow.style.transform = this.options.visualizePitch && pitch ? `scale(${1 / Math.sqrt(Math.cos(pitch * Math.PI / 180))}) rotateX(${pitch}deg) rotate(${bearing}deg)` : `rotate(${bearing}deg)`;
      if (this.options.closeOnZeroBearing) {
        const hidden = !bearing && !(this.options.visualizePitch && pitch) && this._pointerId == null;
        this._container.style.display = hidden ? "none" : "block";
      }
    }
  });
  if (L.control) {
    L.control.rotate = (options) => new L.Control.Rotate(options);
  }
  L.Map.mergeOptions({
    /**
     * Add the rotation control automatically. Set to `false` to disable,
     * or pass an options object to configure the control.
     * 
     * @type {boolean|Object}
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    rotateControl: true
  });
  L.Map.addInitHook(function() {
    if (this.options.rotateControl) {
      const options = typeof this.options.rotateControl === "object" ? this.options.rotateControl : {};
      this.rotateControl = new L.Control.Rotate(options);
      this.addControl(this.rotateControl);
    }
  });
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=leaflet-rotate-src.js.map
