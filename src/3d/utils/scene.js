/** A fresh, empty scene-graph node. */
export const emptyNode = () => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  children: [],
  visible: true,
});

/** Reparent/detach scene data without drawing or disposing GPU resources. */
export function setParent(node, parent) {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = parent;
  if (parent) parent.children.push(node);
}

/** Depth-first walk; a truthy callback result skips that node's descendants. */
export function traverse(node, callback) {
  if (callback(node)) return;
  for (const child of node.children) traverse(child, callback);
}

/** Compose parent*local matrices; a node.matrix overrides its position/rotation/scale. */
export function updateWorldMatrix(node) {
  const parent = node.parent;
  const parentVersion = parent?._worldMatrixVersion || 0;
  const matrixMode = Boolean(node.matrix);
  let changed = node._worldParent !== parent || node._parentWorldVersion !== parentVersion ||
    node._worldMatrixMode !== matrixMode;
  if (node.matrix) {
    const state = node._matrixState ||= new Float64Array(16);
    for (let i = 0; i < 16; i++) {
      if (state[i] !== node.matrix[i]) changed = true;
      state[i] = node.matrix[i];
    }
  } else {
    const state = node._transformState ||= new Float64Array(9);
    for (let i = 0; i < 9; i++) {
      const value = i < 3 ? node.position[i] : i < 6 ? node.rotation[i - 3] : node.scale[i - 6];
      if (state[i] !== value) changed = true;
      state[i] = value;
    }
  }
  if (!changed) {
    for (const child of node.children) updateWorldMatrix(child);
    return;
  }
  let local;
  if (node.matrix) local = node.matrix;
  else {
    const degrees = 180 / Math.PI;
    const matrix = new DOMMatrix().translate(...node.position);
    // Node rotations use YXZ, as did the previous renderer.
    matrix.rotateAxisAngleSelf(0, 1, 0, node.rotation[1] * degrees);
    matrix.rotateAxisAngleSelf(1, 0, 0, node.rotation[0] * degrees);
    matrix.rotateAxisAngleSelf(0, 0, 1, node.rotation[2] * degrees);
    local = matrix.scale(...node.scale).toFloat64Array();
  }
  const world = parent
    ? new DOMMatrix(parent.worldMatrix).multiply(new DOMMatrix(local)).toFloat64Array()
    : local;
  for (let i = 0; i < 16; i++) node.worldMatrix[i] = world[i];
  node._worldParent = parent;
  node._parentWorldVersion = parentVersion;
  node._worldMatrixMode = matrixMode;
  node._worldMatrixVersion = (node._worldMatrixVersion || 0) + 1;
  for (const child of node.children) updateWorldMatrix(child);
}

/** Orthonormal view basis plus perspective matrices, refreshed before projecting/drawing. */
export function updateCamera(camera) {
  const z       = camera.position.map((v, i) => v - camera.target[i]);
  const zLength = Math.hypot(...z) || 1;
  const cross   = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < 3; i++) {
    z[i] /= zLength;
  }
  const x = cross(camera.up, z), xLength = Math.hypot(...x) || 1;
  for (let i = 0; i < 3; i++) {
    x[i] /= xLength;
  }
  const y = cross(z, x);
  const view = new DOMMatrix([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, ...camera.position, 1]).inverse().toFloat64Array();
  if (![...view].every(Number.isFinite)) {
    throw new Error('Singular 3D transform');
  }
  for (let i = 0; i < 16; i++) {
    camera.viewMatrix[i] = view[i];
  }
  const f = 1 / Math.tan(camera.fov * Math.PI / 360),
        n = camera.near,
        r = camera.far;
  const projection = [f / camera.aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, r / (n - r), -1, 0, 0, r * n / (n - r), 0];
  for (let i = 0; i < 16; i++) {
    camera.projectionMatrix[i] = projection[i];
  }
  const projectionView = new DOMMatrix(camera.projectionMatrix).multiply(new DOMMatrix(camera.viewMatrix)).toFloat64Array();
  for (let i = 0; i < 16; i++) {
    camera.projectionViewMatrix[i] = projectionView[i];
  }
}
