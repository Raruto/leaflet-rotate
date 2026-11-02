/** Raycasting, hover/click highlight and tooltips. Mixed into L.Layer.types['3d']. */
export default {
  /**
   * Finds the objects under a mouse or pointer event, nearest first.
   *
   * @param {MouseEvent} event
   * @param {Object[]} [objects] Defaults to this layer's root children, not all map layers.
   * @param {boolean} [recursive] Also test the descendants of `objects`.
   * @returns {Object[]} Nearest hit per mesh: object, shared-world point/distance and triangle faceIndex.
   */
  raycast(event, objects = this.root.children, recursive = true) {
    if (!this.renderer) {
      return [];
    }
    const rect = this._map.getContainer().getBoundingClientRect();
    this._updateWorldMatrix(this.scene, true);
    this._updateCamera(this.camera);
    // Unproject the mouse (-1..1) into a world-space ray from the camera.
    const inverseCamera       = new DOMMatrix(this.camera.projectionViewMatrix).inverse();
    const inverseCameraValues = inverseCamera.toFloat64Array();
    if (![...inverseCameraValues].every(Number.isFinite)) {
      throw new Error('Singular 3D transform');
    }
    this.raycaster.origin[0] = this.camera.position[0];
    this.raycaster.origin[1] = this.camera.position[1];
    this.raycaster.origin[2] = this.camera.position[2];
    const unprojected = new DOMPoint(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0,
      1
    ).matrixTransform(inverseCamera);
    const end = [
      unprojected.x / unprojected.w,
      unprojected.y / unprojected.w,
      unprojected.z / unprojected.w
    ];
    this.raycaster.direction[0] = end[0] - this.raycaster.origin[0];
    this.raycaster.direction[1] = end[1] - this.raycaster.origin[1];
    this.raycaster.direction[2] = end[2] - this.raycaster.origin[2];
    const rayLength = Math.hypot(...this.raycaster.direction) || 1;
    this.raycaster.direction[0] /= rayLength;
    this.raycaster.direction[1] /= rayLength;
    this.raycaster.direction[2] /= rayLength;
    const meshes = [],
            hits = [],
               a = [0, 0, 0],
               b = [0, 0, 0],
               c = [0, 0, 0],
             sub = (a, b) => a.map((v, i) => v - b[i]),
           cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
            dot  = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    for (const object of objects) {
      if (recursive) this.traverse(object, mesh => { if
        (mesh.geometry && mesh.visible) meshes.push(mesh);
      });
      else if (object.geometry && object.visible) meshes.push(object);
    }
    for (const mesh of meshes) {
      // Test in mesh-local space; compare distances only after returning to shared world space.
      const inverse       = new DOMMatrix(mesh.worldMatrix).inverse();
      const inverseValues = inverse.toFloat64Array();
      if (![...inverseValues].every(Number.isFinite)) {
        throw new Error('Singular 3D transform');
      }
      const localOrigin    = new DOMPoint(...this.raycaster.origin, 1).matrixTransform(inverse);
      const origin         = [
        localOrigin.x / localOrigin.w,
        localOrigin.y / localOrigin.w,
        localOrigin.z / localOrigin.w
      ];
      const localDirection  = new DOMPoint(...this.raycaster.direction, 0).matrixTransform(inverse);
      const direction       = [
        localDirection.x,
        localDirection.y,
        localDirection.z
      ];
      const directionLength = Math.hypot(...direction) || 1;
      direction[0] /= directionLength; direction[1] /= directionLength; direction[2] /= directionLength;
      // AABB slab test reuses the same local ray as the triangle test.
      if (!mesh.geometry.bounds) {
        this._computeBounds(mesh.geometry);
      }
      let near = 0, far = Infinity;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(direction[i]) < 1e-12) {
          if (origin[i] < mesh.geometry.bounds.min[i] || origin[i] > mesh.geometry.bounds.max[i]) {
            far = -Infinity;
            break;
          }
        } else {
          const a = (mesh.geometry.bounds.min[i] - origin[i]) / direction[i],
                b = (mesh.geometry.bounds.max[i] - origin[i]) / direction[i];
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
        }
      }
      if (far < near) {
        continue;
      }
      const { position, index } = mesh.geometry.attributes;
      let closest = Infinity, faceIndex;
      for (let i = 0; i < (index?.count || position.count); i += 3) {
        const ai = (index ? index.data[i] : i) * position.size;
        const bi = (index ? index.data[i + 1] : i + 1) * position.size;
        const ci = (index ? index.data[i + 2] : i + 2) * position.size;
        a[0] = position.data[ai];
        a[1] = position.data[ai + 1];
        a[2] = position.data[ai + 2];
        b[0] = position.data[bi];
        b[1] = position.data[bi + 1];
        b[2] = position.data[bi + 2];
        c[0] = position.data[ci];
        c[1] = position.data[ci + 1];
        c[2] = position.data[ci + 2];
        // Moller-Trumbore: barycentric triangle coordinates and local ray distance.
        const e = sub(b, a),
              f = sub(c, a),
              p = cross(direction, f),
              det = dot(e, p);
        if (mesh.program.cullFace !== null ? det < 1e-9 : Math.abs(det) < 1e-9) {
          continue;
        }
        const t = sub(origin, a),
              u = dot(t, p) / det;
        if (u < 0 || u > 1) {
          continue;
        }
        const q = cross(t, e),
              v = dot(direction, q) / det;
        if (v < 0 || u + v > 1) {
          continue;
        }
        if (mesh.program.nightLight) {
          const uv = mesh.geometry.attributes.uv.data;
          const ids = index ? [index.data[i], index.data[i + 1], index.data[i + 2]] : [i, i + 1, i + 2];
          const x = uv[ids[0] * 2] * (1 - u - v) + uv[ids[1] * 2] * u + uv[ids[2] * 2] * v;
          const y = uv[ids[0] * 2 + 1] * (1 - u - v) + uv[ids[1] * 2 + 1] * u + uv[ids[2] * 2 + 1] * v;
          if (x <= 2 && (!this.renderer.uniformData?.[55] || x * x + y * y > 0.9)) continue;
        }
        const distance = dot(f, q) / det;
        if (distance > 0 && distance < closest) {
          closest = distance; faceIndex = i / 3;
        }
      }
      if (faceIndex === undefined) continue;
      const point = new DOMPoint(
        direction[0] * closest + origin[0],
        direction[1] * closest + origin[1],
        direction[2] * closest + origin[2],
        1
      ).matrixTransform(new DOMMatrix(mesh.worldMatrix));
      const worldPoint = [point.x / point.w, point.y / point.w, point.z / point.w];
      hits.push({
        faceIndex,
        object:     mesh,
        point:      worldPoint,
        distance:   Math.hypot(
          worldPoint[0] - this.raycaster.origin[0],
          worldPoint[1] - this.raycaster.origin[1],
          worldPoint[2] - this.raycaster.origin[2]
        )
      });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  },

  /**
   * Translate a geometry hit into a configured model or batched source feature.
   * Sorted half-open face ranges permit binary search without a feature per triangle.
   * @returns {PickedFeature|null}
   */
  _findFeature(event) {
    if (!this.root || !this.camera) return null;
    for (const hit of this.raycast(event, this.root.children, Boolean(this.model))) {
      if (this.model) {
        let object = hit.object;
        while (object && object !== this.model) object = object.parent;
        if (object === this.model) {
          return {
            id: this.model.id, properties: this.model.extras,
            model: this.model, mesh: hit.object, point: hit.point
          };
        }
      }
      const ranges = hit.object.extras?.featureFaces;
      if (!ranges) continue;
      let low = 0, high = ranges.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const range = ranges[middle];
        if (hit.faceIndex < range.faceStart) high = middle - 1;
        else if (hit.faceIndex >= range.faceEnd) low = middle + 1;
        else return { ...range, mesh: hit.object, point: hit.point };
      }
    }
    return null;
  },

  /** Highlight a source vertex range in the shader; vertex colors stay untouched. */
  _setHighlight(feature) {
    if (feature?.model) feature = null;
    if (this.highlightedFeature?.mesh === feature?.mesh &&
      this.highlightedFeature?.vertexStart === feature?.vertexStart) return;
    if (this.highlightedFeature) this.highlightedFeature.mesh.highlight = null;
    this.highlightedFeature = feature;
    if (feature) feature.mesh.highlight = [feature.vertexStart, feature.vertexEnd];
    this.update();
  },

  /** Update tooltip content/position and arbitrate cursor ownership across shared layers. */
  _showFeature(feature, event) {
    const tooltip = this._tooltip;
    if (!tooltip) return;
    if (feature) {
      tooltip.replaceChildren(this.options.tooltipContent(feature));
      tooltip.hidden = false;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      tooltip.style.left = `${x + tooltip.offsetWidth + 16 > rect.width ? x - tooltip.offsetWidth - 12 : x + 12}px`;
      tooltip.style.top = `${y + tooltip.offsetHeight + 16 > rect.height ? y - tooltip.offsetHeight - 12 : y + 12}px`;
    } else {
      tooltip.hidden = true;
    }
    const shared = this._shared;
    if (shared) {
      const visible = [...shared._layers].some(layer => layer._tooltip && !layer._tooltip.hidden);
      if (visible) {
        if (shared._cursor === undefined) shared._cursor = this.container.style.cursor;
        this.container.style.cursor = 'pointer';
      } else if (shared._cursor !== undefined) {
        this.container.style.cursor = shared._cursor;
        delete shared._cursor;
      }
    }
  },

  /** Hover is transient; featurehover also reports misses with feature:null. */
  _onPointerMove(event) {
    this.hoveredFeature = this._findFeature(event);
    this._setHighlight(this.hoveredFeature);
    this._showFeature(this.hoveredFeature, event);
    this.fire('featurehover', { feature: this.hoveredFeature, originalEvent: event });
  },

  /** Emit click without moving the map or pinning the tooltip. */
  _onClick(event) {
    const feature = this._findFeature(event);
    this.hoveredFeature = feature;
    this._setHighlight(feature);
    this._showFeature(feature, event);
    this.fire('featureclick', { feature, originalEvent: event });
  },

  /** Clear hover, highlight and tooltip without retaining a selected feature. */
  _onPointerLeave() {
    this.hoveredFeature = null;
    this._setHighlight(null);
    this._showFeature(null);
    this.fire('featurehover', { feature: null });
  },
};
