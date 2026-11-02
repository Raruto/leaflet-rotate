import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { parseColor, triangulate, computeBounds, setVertexColor, treeGeometry, lightGeometry, lampPostGeometry } from '../../../src/3d/utils/geometry.js';
import { emptyNode, setParent, traverse } from '../../../src/3d/utils/scene.js';
import { decodeDirectory, decodeHeader, decompress, tileId } from '../../../src/3d/utils/pmtiles.js';
import { decodeModel, readAccessor, nodeMatrix, vertexNormals, textureSampler } from '../../../src/3d/utils/model.js';
import { lightGrid, worldLights } from '../../../src/3d/utils/lighting.js';
import { bridgeElevation, terrainElevation, terrainGrid, terrainAtlas } from '../../../src/3d/utils/terrain.js';
import { toLanes, tripsAt, routeGeometry } from '../../../src/3d/utils/traffic.js';
import { collider, horizontalRay } from '../../../src/3d/utils/walk.js';
import { materialShaders } from '../../../src/3d/utils/shaders.js';
import { projectCelestialBody } from '../../../src/3d/utils/sun.js';

const checks = {
  geometry() {
    assert.deepEqual(parseColor(0xff8000), { r: 1, g: 128 / 255, b: 0 });
    const ring = coordinates => coordinates.map(([x, y]) => ({ x, y }));
    const outer = ring([[0, 0], [4, 0], [4, 4], [0, 4]]);
    const hole = ring([[1, 1], [1, 3], [3, 3], [3, 1]]);
    const points = [...outer, ...hole], before = structuredClone(points);
    const triangles = triangulate(outer, [hole]);
    const area = triangles.reduce((sum, ids) => {
      const [a, b, c] = ids.map(i => points[i]);
      return sum + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }, 0);
    assert.equal(area, 12);
    assert.deepEqual(points, before);
    assert.throws(() => triangulate(ring([[0, 0], [2, 2], [0, 2], [2, 0]])), /polygon|Polygon/);
    const geometry = { attributes: { position: { data: [-1, 0, -2, 3, 4, 2] }, color: { data: new Float32Array(6) } } };
    computeBounds(geometry);
    assert.deepEqual(geometry.bounds.center, [1, 2, 0]);
    const mesh = { geometry };
    setVertexColor(mesh, 1, 2, parseColor(0xff0000));
    assert.deepEqual([...geometry.attributes.color.data], [0, 0, 0, 1, 0, 0]);
    assert.equal(geometry.attributes.color.needsUpdate, true);
    const point = { x: 0, y: 0, ground: 0 }, emitted = [];
    const add = (...triangle) => emitted.push(triangle);
    treeGeometry(point, { top: 10, trunkRadius: 0.2, crownRadius: 2, crownBottom: 3 }, add);
    lightGeometry(point, { top: 5, lightRadius: 10, color: 0xffffff }, add);
    lampPostGeometry(point, { top: 5, poleRadius: 0.1 }, add);
    assert.ok(emitted.length > 100);
    assert.ok(emitted.every(triangle => Object.values(triangle.at(-1)).every(Number.isFinite)));
  },

  graph() {
    const root = emptyNode(), branch = emptyNode(), leaf = emptyNode(), other = emptyNode();
    setParent(branch, root);
    setParent(leaf, branch);
    setParent(other, root);
    const visited = [];
    traverse(root, node => { visited.push(node); return node === branch; });
    assert.deepEqual(visited, [root, branch, other]);
    setParent(leaf, other);
    assert.deepEqual(branch.children, []);
    assert.equal(leaf.parent, other);
    setParent(leaf, null);
    assert.deepEqual(other.children, []);
    assert.notEqual(root.position, branch.position);
  },

  async archives() {
    assert.deepEqual([[0, 0], [0, 1], [1, 1], [1, 0]].map(([x, y]) => tileId(1, x, y)), [1, 2, 3, 4]);
    assert.throws(() => tileId(1, 2, 0), /Invalid PMTiles tile coordinates/);
    const bytes = Uint8Array.from([2, 1, 3, 1, 1, 2, 3, 1, 0]);
    assert.deepEqual(decodeDirectory(bytes.buffer), [
      { tileId: 1, runLength: 1, length: 2, offset: 0 },
      { tileId: 4, runLength: 1, length: 3, offset: 2 },
    ]);
    assert.throws(() => decodeDirectory(new ArrayBuffer(0)), /Truncated PMTiles directory/);
    assert.throws(() => decodeDirectory(Uint8Array.from([...bytes, 0]).buffer), /Trailing PMTiles directory data/);
    const data = new ArrayBuffer(127), view = new DataView(data);
    view.setBigUint64(8, 127n, true);
    view.setUint8(100, 4);
    assert.equal(decodeHeader(data).rootDirectoryOffset, 127);
    assert.equal(decodeHeader(data).minZoom, 4);
    assert.equal(await decompress(data, 1), data);
    assert.equal(new TextDecoder().decode(await decompress(gzipSync('utility'), 2)), 'utility');
    await assert.rejects(decompress(data, 3), /Unsupported PMTiles compression/);
  },

  models() {
    const description = { asset: { version: '2.0' }, meshes: [] };
    const json = new TextEncoder().encode(JSON.stringify(description)).buffer;
    assert.deepEqual(decodeModel(json), description);
    assert.throws(() => decodeModel(new TextEncoder().encode('{"animations":[{}]}').buffer), /static triangle glTF/);
    const model = {
      buffers: [{ binary: new Float32Array([1, 2, 99, 3, 4, 99]).buffer }],
      bufferViews: [{ buffer: 0, byteLength: 24, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC2' }],
    };
    assert.deepEqual([...readAccessor(model, 0).data], [1, 2, 3, 4]);
    model.bufferViews[0].byteLength = 12;
    assert.throws(() => readAccessor(model, 0), /outside buffer view/);
    const sparse = {
      buffers: [{ binary: Uint8Array.from([2, 128]).buffer }],
      bufferViews: [{ buffer: 0, byteLength: 1 }, { buffer: 0, byteOffset: 1, byteLength: 1 }],
      accessors: [{ componentType: 5121, count: 3, type: 'SCALAR', normalized: true,
        sparse: { count: 1, indices: { componentType: 5121, bufferView: 0 }, values: { bufferView: 1 } } }],
    };
    assert.deepEqual([...readAccessor(sparse, 0).data], [...new Float32Array([0, 0, 128 / 255])]);
    const matrix = nodeMatrix({ translation: [2, 3, 4], scale: [2, 3, 4] });
    assert.deepEqual([matrix[0], matrix[5], matrix[10], ...matrix.slice(12)], [2, 3, 4, 2, 3, 4, 1]);
    assert.deepEqual([...vertexNormals([0, 0, 0, 1, 0, 0, 0, 1, 0])], [0, 0, 1, 0, 0, 1, 0, 0, 1]);
    assert.deepEqual(textureSampler({ wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9986 }),
      { addressModeU: 'clamp-to-edge', addressModeV: 'mirror-repeat', magFilter: 'nearest', minFilter: 'nearest' });
  },

  lighting() {
    const matrix = emptyNode().worldMatrix;
    matrix[12] = 10;
    const values = worldLights([{ position: [1, 2, 3], radius: 4, color: [1, 0.5, 0], flux: 4 * Math.PI }], matrix);
    assert.deepEqual([...values.slice(0, 7)], [11, 2, 3, 4, 1, 0.5, 0]);
    const { data, count } = lightGrid([values], 1024);
    assert.equal(count, 1);
    assert.equal(data[5], 1);
    assert.equal(data[9], 1);
    assert.deepEqual([...data.slice(data[8] * 4, data[8] * 4 + 8)], [...values]);
    assert.throws(() => lightGrid([values], 32), /GPU storage limit/);
    assert.deepEqual([...lightGrid([], 32).data], Array(8).fill(0));
  },

  terrain() {
    const tile = new Float32Array(65536).fill(NaN);
    tile[0] = 10; tile[1] = 20; tile[256] = 30; tile[257] = 40;
    const tiles = new Map([['0/0', tile]]);
    assert.equal(terrainElevation({ x: 1, y: 1 }, tiles), 25);
    tile[0] = NaN;
    assert.equal(terrainElevation({ x: 1, y: 1 }, tiles), 20);
    assert.equal(terrainElevation({ x: 1000, y: 1000 }, tiles), null);
    const bridges = new Map([['0/0', [{ min: [0, 0], max: [10, 10],
      triangles: [[[0, 0, 10], [10, 0, 20], [0, 10, 30]]] }]]]);
    assert.equal(bridgeElevation({ x: 2, y: 3 }, bridges), 18);
    assert.equal(bridgeElevation({ x: 9, y: 9 }, bridges), null);
    const grid = terrainGrid(2);
    assert.equal(grid.position.data.length, 27);
    assert.equal(grid.index.data.length, 24);
    assert.ok([...grid.index.data].every(index => index < 9));
    const atlas = terrainAtlas(tiles, { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } });
    assert.deepEqual([atlas.elevations[0], atlas.low, atlas.high], [-1e9, 20, 40]);
  },

  traffic() {
    const lanes = toLanes({ features: [{ geometry: { type: 'MultiLineString', coordinates: [
      [[2, 48], [3, 49]], [[4, 50], [5, 51]],
    ] }, properties: { flow: 3600, elevation: 7 } }] });
    assert.deepEqual(lanes[0].latlngs, [[48, 2], [49, 3]]);
    assert.equal(lanes[1].elevation, 7);
    const lane = { ...lanes[0], points: [[0, 0, 7], [30, 0, 7]], lengths: [0, 30], length: 30 };
    assert.equal(tripsAt(new Date(0), [lane], 10).length, 3);
    assert.deepEqual(tripsAt(new Date(1000), [lane], 10).map(trip => trip.distance), [15, 25, 5]);
    const route = routeGeometry([lane]);
    assert.equal(route.position.length, 18);
    assert.equal(route.color.length, route.normal.length);
    assert.ok(route.position.every(Number.isFinite));
  },

  walking() {
    const vertices = [0, 0, -1, 0, 2, -1, 0, 0, 1];
    assert.equal(horizontalRay(vertices, 0, -1, 0.5, 0, 1, 0), 1);
    assert.equal(horizontalRay(vertices, 0, -1, 3, 0, 1, 0), -1);
    const mesh = { ...emptyNode(), program: {}, geometry: { attributes: { position: { data: vertices } } } };
    const walls = collider(mesh);
    assert.equal(walls.tri.length, 9);
    assert.equal(collider(mesh), walls);
    assert.ok(walls.cells.size > 0);
  },

  shaders() {
    const plain = materialShaders();
    assert.deepEqual(plain.bindings, []);
    assert.equal(plain.textured, undefined);
    assert.match(plain.fragment, /textureSampleCompareLevel/);
    const textured = materialShaders({ baseTexture: { srgb: true }, roofTexture: true, terrain: {} }, true, 'fn elevation() {}');
    assert.deepEqual(textured.bindings, [
      { name: 'baseTexture', texture: 3, sampler: 4 }, { name: 'roofTexture', texture: 5, sampler: 6 },
    ]);
    assert.match(textured.vertex, /fn elevation\(\)/);
    assert.match(textured.fragment, /input.localPosition/);
    assert.equal(textured.hasTerrain, true);
  },

  sky() {
    const size = { x: 800, y: 600 };
    assert.deepEqual(projectCelestialBody([0, 0, -1], size, Math.PI / 2, 0), { left: 400, top: 300 - 900 * Math.cos(Math.PI / 2) });
    assert.equal(projectCelestialBody([0, 0, 1], size, Math.PI / 2, 0), null);
  },
};

Then('the standalone 3D {string} utilities preserve their results and errors', async function (domain) {
  await checks[domain]();
});

Then('standalone browser math preserves scene transforms and picking', async function () {
  const result = await this.page.evaluate(async base => {
    const { emptyNode, setParent, updateWorldMatrix, updateCamera } = await import(`${base}/dist/3d/utils/scene.js`);
    const { intersectMeshes } = await import(`${base}/dist/3d/utils/picking.js`);
    const parent = emptyNode(), child = emptyNode();
    parent.position = [10, 20, 30];
    parent.scale = [2, 3, 4];
    child.position = [1, 2, 3];
    setParent(child, parent);
    updateWorldMatrix(parent);
    const position = child.worldMatrix.slice(12, 15);
    const version = child._worldMatrixVersion;
    updateWorldMatrix(parent);
    const cached = version === child._worldMatrixVersion;
    parent.position[0] += 5;
    updateWorldMatrix(parent);
    const updated = child.worldMatrix[12] === 17 && child._worldMatrixVersion > version;
    const camera = {
      position: [0, 0, 0], target: [0, 0, -1], up: [0, 1, 0], fov: 60, aspect: 1, near: 1, far: 100,
      viewMatrix: [], projectionMatrix: [], projectionViewMatrix: [],
    };
    updateCamera(camera);
    const project = z => {
      const point = new DOMPoint(0, 0, z, 1).matrixTransform(new DOMMatrix(camera.projectionViewMatrix));
      return point.z / point.w;
    };
    const mesh = z => ({
      ...emptyNode(), position: [0, 0, z], program: { cullFace: null },
      geometry: { attributes: { position: { size: 3, count: 3, data: [-1, -1, 0, 1, -1, 0, 0, 1, 0] } } },
    });
    const near = mesh(-5), far = mesh(-10);
    updateWorldMatrix(near);
    updateWorldMatrix(far);
    const ray = { origin: [0, 0, 0], direction: [0, 0, -1] };
    const hits = intersectMeshes(ray, [far, near]);
    near.program.nightLight = true;
    near.geometry.attributes.uv = { data: [0, 0, 0, 0, 0, 0] };
    const dayHits = intersectMeshes(ray, [near]).length;
    const nightHits = intersectMeshes(ray, [near], 1).length;
    return {
      position, cached, updated, projection: [project(-1), project(-100)],
      hits: hits.map(hit => ({ distance: hit.distance, point: hit.point, faceIndex: hit.faceIndex })),
      dayHits, nightHits,
    };
  }, this.baseUrl);
  assert.deepEqual(result.position, [12, 26, 42]);
  assert.equal(result.cached, true);
  assert.equal(result.updated, true);
  assert.ok(Math.abs(result.projection[0]) < 1e-10);
  assert.ok(Math.abs(result.projection[1] - 1) < 1e-10);
  assert.deepEqual(result.hits, [
    { distance: 5, point: [0, 0, -5], faceIndex: 0 },
    { distance: 10, point: [0, 0, -10], faceIndex: 0 },
  ]);
  assert.deepEqual([result.dayHits, result.nightHits], [0, 1]);
});
