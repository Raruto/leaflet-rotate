/**
 * Extends Leaflet maps with bearing rotation and 3D pitch.
 *
 * @external L.Map
 * 
 * @since leaflet-rotate (v0.1.0)
 * 
 * @see https://github.com/Leaflet/Leaflet/blob/v1.9.3/src/map/Map.js
 */

/**
 * @event L.Map#rotate Fired after the map bearing changes.
 * 
 * @since leaflet-rotate (v0.1.0)
 */

/**
 * @event L.Map#pitch Fired after the map pitch changes.
 * 
 * @since leaflet-rotate (0.5.0)
 */

import { toPoint } from '../geometry/Point';

const mapProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(L.Map.prototype));

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
    pitchMaxDistance: 3,

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
        if (!this._mapPane) { return; }

        this._animatingZoom = true;
        this._animateToCenter = center;
        this._animateToZoom = zoom;
        this._move(center, zoom, undefined, true);
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
            this.on('resize', this._updatePitchTransform, this);
            this.on('move', this._updatePitchSky, this);
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
        return toPoint(point)
            .subtract(this._getMapPanePos())
            .rotateFrom(-this._bearing, this._getRotatePanePos())
            .subtract(this._getRotatePanePos());
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
        return toPoint(point)
            .add(this._getRotatePanePos())
            .rotateFrom(this._bearing, this._getRotatePanePos())
            .add(this._getMapPanePos());
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
        return toPoint(point)
            .rotate(this._bearing)
            ._add(this._getRotatePanePos());
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
        return toPoint(point)
            ._subtract(this._getRotatePanePos())
            .rotate(-this._bearing);
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

        // const nw = this.latLngToContainerPoint(bounds.getNorthWest()),
        //       ne = this.latLngToContainerPoint(bounds.getNorthEast()),
        //       sw = this.latLngToContainerPoint(bounds.getSouthWest()),
        //       se = this.latLngToContainerPoint(bounds.getSouthEast());

        // same as `this.latLngToContainerPoint(latlng)` but with floating point precision
        const origin = this.getPixelOrigin();
        const nw = this.layerPointToContainerPoint(this.project(bounds.getNorthWest())._subtract(origin)),
              ne = this.layerPointToContainerPoint(this.project(bounds.getNorthEast())._subtract(origin)),
              sw = this.layerPointToContainerPoint(this.project(bounds.getSouthWest())._subtract(origin)),
              se = this.layerPointToContainerPoint(this.project(bounds.getSouthEast())._subtract(origin));

        return new L.Bounds([
            new L.Point(Math.min(nw.x, ne.x, se.x, sw.x), Math.min(nw.y, ne.y, se.y, sw.y)), // [ minX, minY ]
            new L.Point(Math.max(nw.x, ne.x, se.x, sw.x), Math.max(nw.y, ne.y, se.y, sw.y))  // [ maxX, maxY ]
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

        // SEE: https://github.com/fnicollet/Leaflet/pull/22
        //
        // const bounds = this.getPixelBounds(),
        // sw = this.unproject(bounds.getBottomLeft()),
        // ne = this.unproject(bounds.getTopRight());
        // return new LatLngBounds(sw, ne);
        //

        // LatLngBounds' constructor automatically
        // extends the bounds to fit the passed points
        const [min, max] = this._getPitchedContainerBounds(0);
        return new L.LatLngBounds([
            this.containerPointToLatLng([min.x, min.y]), // topleft
            this.containerPointToLatLng([max.x, min.y]), // topright 
            this.containerPointToLatLng([max.x, max.y]), // bottomright
            this.containerPointToLatLng([min.x, max.y]), // bottomleft
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
        const size = this.getSize(),
            min = size.multiplyBy(-padding),
            max = size.multiplyBy(1 + padding);
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
        const size = this.getSize(),
            inverse = this._pitchInverseTransform,
            panePos = this._getMapPanePos(),
            x = size.x / 2 - panePos.x,
            centerY = size.y / 2 - panePos.y,
            maxDistance = this.options.pitchMaxDistance * size.y,
            w = y => inverse.g * x + inverse.h * y + inverse.i,
            centerW = w(centerY),
            center = this._transformPitchPoint([x, centerY], inverse),
            // the horizon is horizontal on screen (bearing is applied before the pitch)
            isNear = y => w(y) * centerW > 0 && this._transformPitchPoint([x, y], inverse).distanceTo(center) <= maxDistance;

        let far = -size.y - panePos.y, near = centerY;
        if (isNear(far)) { return -Infinity; }
        for (let i = 0; i < 20; i++) {
            const mid = (far + near) / 2;
            if (isNear(mid)) { near = mid; } else { far = mid; }
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
        if (!this._rotate) { return; }

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

        const startBearing = this.getBearing(),
            startPitch = this.getPitch(),
            endBearing = L.Util.wrapNum(bearing, [0, 360]),
            endPitch = Math.max(0, Math.min(pitch, 85)),
            delta = ((endBearing - startBearing + 540) % 360) - 180,
            duration = Math.max(0, options.duration == null ? 0.25 : options.duration) * 1000,
            easeLinearity = Math.max(options.easeLinearity || 0.5, 0.2),
            startTime = performance.now();

        const animate = function() {
            if (!this._mapPane || this._bearingAnimationId !== animationId) {
                return;
            }

            const progress = duration ? Math.min((performance.now() - startTime) / duration, 1) : 1,
                eased = 1 - Math.pow(1 - progress, 1 / easeLinearity);

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

        const bearing = L.Util.wrapNum(theta, [0, 360]) * (Math.PI / 180),
            center = this._getPixelCenter(),
            oldPos = this._getRotatePanePos().rotateFrom(-this._bearing, center),
            newPos = oldPos.rotateFrom(bearing, center);

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
            this._pixelOrigin = this.project(mapCenter, this._zoom)
                .subtract(this.containerPointToLayerPoint(this.getSize().divideBy(2)));
            delete this._lastCenter;
            this.fire('move');
        }

        this.fire('rotate');
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
        if (!this._pitch || !this._rotatePane) { return; }

        const pivot = this._getPixelCenter(),
            size = this.getSize(),
            perspective = Math.max(1, size.y * 1.5),
            position = this._rotatePane._leaflet_pos || new L.Point(0, 0),
            transform = `translate3d(${pivot.x}px,${pivot.y}px,0) perspective(${perspective}px) rotateX(${this.getPitch()}deg) rotateZ(${this.getBearing()}deg) translate3d(${position.x - pivot.x}px,${position.y - pivot.y}px,0)`;

        this._rotatePane.style.transformOrigin = '0 0';
        this._rotatePane.style.transform = transform;
        // parse the transform directly: getComputedStyle() would force a style recalculation on every frame
        const matrix = this._pitchTransform = new DOMMatrix(transform),
            a = matrix.m11, b = matrix.m21, c = matrix.m41,
            d = matrix.m12, e = matrix.m22, f = matrix.m42,
            g = matrix.m14, h = matrix.m24, i = matrix.m44,
            determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

        this._pitchInverseTransform = {
            a: (e * i - f * h) / determinant,
            b: (c * h - b * i) / determinant,
            c: (b * f - c * e) / determinant,
            d: (f * g - d * i) / determinant,
            e: (a * i - c * g) / determinant,
            f: (c * d - a * f) / determinant,
            g: (d * h - e * g) / determinant,
            h: (b * g - a * h) / determinant,
            i: (a * e - b * d) / determinant,
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
            if (this._pitchSky) { this._pitchSky.style.display = 'none'; }
            return;
        }
        if (!this._pitchSky) {
            this._pitchSky = L.DomUtil.create('div', 'leaflet-pitch-sky', this._container);
            Object.assign(this._pitchSky.style, {
                position: 'absolute', left: 0, top: 0, width: '100%', zIndex: 0, pointerEvents: 'none',
                background: 'linear-gradient(#9ec5e8, #dfe9f0)',
            });
        }
        this._pitchSky.style.display = '';
        // overlap the far edge slightly to hide antialiasing gaps
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
        if (!this._rotate) { return; }

        const clampedPitch = Math.max(0, Math.min(pitch, 85)) * (Math.PI / 180),
            clampedBearing = L.Util.wrapNum(bearing, [0, 360]) * (Math.PI / 180),
            pitchChanged = clampedPitch !== this._pitch;
        if (!pitchChanged && clampedBearing === this._bearing) { return; }

        const mapCenter = this._loaded ? this.getCenter() : undefined;
        if (pitchChanged) {
            this._pitch = clampedPitch;
            this._rotatePane.style.transformOrigin = L.version.startsWith('2.') ? '0 0' : '';
        }
        this._setBearing(bearing, mapCenter);
        if (pitchChanged) {
            if (!this._pitch) { this._updatePitchSky(); }
            this.fire('pitch');
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
        const scale = this.getZoomScale(zoom),
            size = this.getSize(),
            center = this.containerPointToLayerPoint(size.divideBy(2)),
            containerPoint = latlng instanceof L.Point ? latlng : this.latLngToContainerPoint(latlng),
            point = this.containerPointToLayerPoint(containerPoint),
            newCenter = this.layerPointToLatLng(center.add(point.subtract(center).multiplyBy(1 - 1 / scale)));
        options = Object.assign({}, options);
        // Leaflet skips the animation when the origin is "far" in layer space, which is always the case near the horizon.
        if (options.animate === undefined && new L.Bounds(new L.Point(0, 0), size).contains(containerPoint)) {
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

        this._mapPane = this.createPane('mapPane', this._container);
        L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));

        if (this._rotate) {
            this._rotatePane = this.createPane('rotatePane', this._mapPane);
            this._norotatePane = this.createPane('norotatePane', this._mapPane);
            if (L.version.startsWith('2.')) {
                this._rotatePane.style.transformOrigin = '0 0';
            }
            // rotatePane
            this.createPane('tilePane', this._rotatePane);
            this.createPane('overlayPane', this._rotatePane);
            // norotatePane
            this.createPane('shadowPane', this._norotatePane);
            this.createPane('markerPane', this._norotatePane);
            this.createPane('tooltipPane', this._norotatePane);
            this.createPane('popupPane', this._norotatePane);
        } else {
            this.createPane('tilePane');
            this.createPane('overlayPane');
            this.createPane('shadowPane');
            this.createPane('markerPane');
            this.createPane('tooltipPane');
            this.createPane('popupPane');
        }

        if (!this.options.markerZoomAnimation) {
            panes.markerPane.classList.add('leaflet-zoom-hide');
            panes.shadowPane.classList.add('leaflet-zoom-hide');
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
        if (!this._rotate || (!this._pitch && Math.abs(this._bearing).toFixed(1) < 0.1)) {
            return mapProto.panInside.apply(this, arguments);
        }

        options = options || {};

        const paddingTL = toPoint(options.paddingTopLeft || options.padding || [0, 0]),
            paddingBR = toPoint(options.paddingBottomRight || options.padding || [0, 0]),
            /** @TODO use mapProto.panInside */
            // pixelPoint = this.project(latlng),
            // pixelBounds = this.getPixelBounds(),
            // pixelCenter = this.project(this.getCenter()),
            pixelPoint = this.latLngToContainerPoint(latlng),
            pixelBounds = new L.Bounds([new L.Point(0, 0), this.getSize()]),
            pixelCenter = pixelBounds.getCenter(),
            //
            paddedBounds = new L.Bounds([pixelBounds.min.add(paddingTL), pixelBounds.max.subtract(paddingBR)]),
            paddedSize = paddedBounds.getSize();
        
        if (!paddedBounds.contains(pixelPoint)) {
            this._enforcingBounds = true;
            const centerOffset = pixelPoint.subtract(paddedBounds.getCenter());
            const offset = paddedBounds.extend(pixelPoint).getSize().subtract(paddedSize);
            pixelCenter.x += centerOffset.x < 0 ? -offset.x : offset.x;
            pixelCenter.y += centerOffset.y < 0 ? -offset.y : offset.y;
            /** @TODO use mapProto.panInside */
            // this.panTo(this.unproject(pixelCenter), options);
            this.panTo(this.containerPointToLatLng(pixelCenter), options);
            //
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
        if (!this._rotate || (!this._pitch && Math.abs(this._bearing).toFixed(1) < 0.1)) {
            return mapProto.getBoundsZoom.apply(this, arguments);
        }

        bounds = bounds instanceof L.LatLngBounds ? bounds : new L.LatLngBounds(bounds);
        padding = toPoint(padding || [0, 0]);

        let zoom = this.getZoom() || 0;
        const min = this.getMinZoom(),
                max = this.getMaxZoom(),
                /** @TODO use mapProto.getBoundsZoom */
                // nw = bounds.getNorthWest(),
                // se = bounds.getSouthEast(),
                // size = this.getSize().subtract(padding),
                // boundsSize = L.bounds(this.project(se, zoom), this.project(nw, zoom)).getSize(),
                size = this.getSize().subtract(padding),
                boundsSize = this.mapBoundsToContainerBounds(bounds).getSize(),
                snap = this.options.zoomSnap,
                scalex = size.x / boundsSize.x,
                scaley = size.y / boundsSize.y,
                scale = inside ? Math.max(scalex, scaley) : Math.min(scalex, scaley);

        zoom = this.getScaleZoom(scale, zoom);

        if (snap) {
            zoom = Math.round(zoom / (snap / 100)) * (snap / 100); // don't jump if within 1% of a snap level
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
     * @returns {L.Point} Offset in layer pixels, adjusted for bearing and pitch.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    _getCenterOffset(latlng) {
        let centerOffset = mapProto._getCenterOffset.apply(this, arguments);
        if (this._pitch) {
            const center = this.getSize()._divideBy(2);
            centerOffset = this.containerPointToLayerPoint(center.add(centerOffset))
                .subtract(this.containerPointToLayerPoint(center));
        } else if (this._rotate) {
            centerOffset = centerOffset.rotate(this._bearing);
        }
        return centerOffset;
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
        // return L.DomUtil.getPosition(this._rotatePane) || new L.Point(0, 0);
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
        if (!this._rotate || L.version.startsWith('2.')) {
            return mapProto._getNewPixelOrigin.apply(this, arguments);
        }
        const viewHalf = this.getSize()._divideBy(2);
        return this.project(center, zoom)
            .rotate(this._bearing)
            ._subtract(viewHalf)
            ._add(this._getMapPanePos())
            ._add(this._getRotatePanePos())
            .rotate(-this._bearing)
            ._round();
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
        const mapZoom = this._animatingZoom ? Math.max(this._animateToZoom, this.getZoom()) : this.getZoom(),
            scale = this.getZoomScale(mapZoom, zoom),
            pixelCenter = this.project(center, zoom).floor(),
            [min, max] = this._getPitchedContainerBounds(0),
            corners = [[min.x, min.y], [max.x, min.y], [min.x, max.y], [max.x, max.y]]
                .map(point => this.containerPointToLayerPoint(point));

        if (this._pitch) {
            // the pitched view is not symmetric: the far side covers much more than the near one
            const viewCenter = this.containerPointToLayerPoint(this.getSize()._divideBy(2));
            return new L.Bounds(corners.map(point => pixelCenter.add(point.subtract(viewCenter).divideBy(scale))));
        }

        const halfSize = new L.Bounds(corners.map(point => point.floor())).getSize().divideBy(scale * 2);

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
        if (!this._container._leaflet_id) { return; }

        const lat = pos.coords.latitude,
            lng = pos.coords.longitude,
            /** @TODO use mapProto._handleGeolocationResponse */
            hdg = pos.coords.heading,
            latlng = new L.LatLng(lat, lng),
            bounds = latlng.toBounds(pos.coords.accuracy),
            options = this._locateOptions;

        if (options.setView) {
            const zoom = this.getBoundsZoom(bounds);
            this.setView(latlng, options.maxZoom ? Math.min(zoom, options.maxZoom) : zoom);
        }

        const data = {
            latlng: latlng,
            bounds: bounds,
            timestamp: pos.timestamp,
            /** @TODO use mapProto._handleGeolocationResponse */
            heading: hdg
        };

        for (const i in pos.coords) {
            if (typeof pos.coords[i] === 'number') {
                data[i] = pos.coords[i];
            }
        }

        // @event locationfound: LocationEvent
        // Fired when geolocation (using the [`locate`](#map-locate) method)
        // went successfully.
        this.fire('locationfound', data);
    },

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
