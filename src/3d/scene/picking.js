import { intersectMeshes } from '../utils/picking.js';
import { traverse, updateWorldMatrix, updateCamera } from '../utils/scene.js';

/** Raycasting, hover/click highlight and tooltips. */
/**
 * Finds the objects under a mouse or pointer event, nearest first.
 *
 * @param {MouseEvent} event
 * @param {Object[]} [objects] Defaults to this layer's root children, not all map layers.
 * @param {boolean} [recursive] Also test the descendants of `objects`.
 * @returns {Object[]} Nearest hit per mesh: object, shared-world point/distance and triangle faceIndex.
 */
export function raycast(backend, event, objects = backend.root.children, recursive = true) {
  if (!backend.renderer) {
    return [];
  }
  const rect = backend._map.getContainer().getBoundingClientRect();
  updateWorldMatrix(backend.scene);
  updateCamera(backend.camera);
  // Unproject the mouse (-1..1) into a world-space ray from the camera.
  const inverseCamera       = new DOMMatrix(backend.camera.projectionViewMatrix).inverse();
  const inverseCameraValues = inverseCamera.toFloat64Array();
  if (![...inverseCameraValues].every(Number.isFinite)) {
    throw new Error('Singular 3D transform');
  }
  backend.raycaster.origin[0] = backend.camera.position[0];
  backend.raycaster.origin[1] = backend.camera.position[1];
  backend.raycaster.origin[2] = backend.camera.position[2];
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
  backend.raycaster.direction[0] = end[0] - backend.raycaster.origin[0];
  backend.raycaster.direction[1] = end[1] - backend.raycaster.origin[1];
  backend.raycaster.direction[2] = end[2] - backend.raycaster.origin[2];
  const rayLength = Math.hypot(...backend.raycaster.direction) || 1;
  backend.raycaster.direction[0] /= rayLength;
  backend.raycaster.direction[1] /= rayLength;
  backend.raycaster.direction[2] /= rayLength;
  const meshes = [];
  for (const object of objects) {
    if (recursive) traverse(object, mesh => { if
      (mesh.geometry && mesh.visible) meshes.push(mesh);
    });
    else if (object.geometry && object.visible) meshes.push(object);
  }
  return intersectMeshes(backend.raycaster, meshes, backend.renderer.uniformData?.[55]);
}

/**
 * Translate a geometry hit into a configured model or batched source feature.
 * Sorted half-open face ranges permit binary search without a feature per triangle.
 * @returns {PickedFeature|null}
 */
export function findFeature(backend, event) {
  if (!backend.root || !backend.camera) return null;
  for (const hit of backend.raycast(event, backend.root.children, Boolean(backend.model))) {
    if (backend.model) {
      let object = hit.object;
      while (object && object !== backend.model) object = object.parent;
      if (object === backend.model) {
        return {
          id: backend.model.id, properties: backend.model.extras,
          model: backend.model, mesh: hit.object, point: hit.point
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
}

/** Highlight a source vertex range in the shader; vertex colors stay untouched. */
export function setHighlight(backend, feature) {
  if (feature?.model) feature = null;
  if (backend.highlightedFeature?.mesh === feature?.mesh &&
    backend.highlightedFeature?.vertexStart === feature?.vertexStart) return;
  if (backend.highlightedFeature) backend.highlightedFeature.mesh.highlight = null;
  backend.highlightedFeature = feature;
  if (feature) feature.mesh.highlight = [feature.vertexStart, feature.vertexEnd];
  backend.update();
}

/** Update tooltip content/position and arbitrate cursor ownership across shared layers. */
export function showFeature(backend, feature, event) {
  const tooltip = backend._tooltip;
  if (!tooltip) return;
  if (feature) {
    tooltip.replaceChildren(backend.options.tooltipContent(feature));
    tooltip.hidden = false;
    const rect = backend.container.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    tooltip.style.left = `${x + tooltip.offsetWidth + 16 > rect.width ? x - tooltip.offsetWidth - 12 : x + 12}px`;
    tooltip.style.top = `${y + tooltip.offsetHeight + 16 > rect.height ? y - tooltip.offsetHeight - 12 : y + 12}px`;
  } else {
    tooltip.hidden = true;
  }
  const shared = backend._shared;
  if (shared) {
    const visible = [...shared._layers].some(layer => layer._tooltip && !layer._tooltip.hidden);
    if (visible) {
      if (shared._cursor === undefined) shared._cursor = backend.container.style.cursor;
      backend.container.style.cursor = 'pointer';
    } else if (shared._cursor !== undefined) {
      backend.container.style.cursor = shared._cursor;
      delete shared._cursor;
    }
  }
}

/** Hover is transient; featurehover also reports misses with feature:null. */
export function onPointerMove(backend, event) {
  backend.hoveredFeature = backend._findFeature(event);
  backend._setHighlight(backend.hoveredFeature);
  backend._showFeature(backend.hoveredFeature, event);
  backend.fire('featurehover', { feature: backend.hoveredFeature, originalEvent: event });
}

/** Emit click without moving the map or pinning the tooltip. */
export function onClick(backend, event) {
  const feature = backend._findFeature(event);
  backend.hoveredFeature = feature;
  backend._setHighlight(feature);
  backend._showFeature(feature, event);
  backend.fire('featureclick', { feature, originalEvent: event });
}

/** Clear hover, highlight and tooltip without retaining a selected feature. */
export function onPointerLeave(backend) {
  backend.hoveredFeature = null;
  backend._setHighlight(null);
  backend._showFeature(null);
  backend.fire('featurehover', { feature: null });
}
