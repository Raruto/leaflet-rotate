import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

Then('layer-owned objects preserve values and visibility without engine classes', async function () {
  const result = await this.page.evaluate(async () => {
    const layer = new L.Layer({ source: { type: '3d' } });
    await nativeChecks.ready(layer);
    layer.addTo(test3d.map);
    const scene = nativeChecks.group();
    const mesh = nativeChecks.mesh(layer, {
      position: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normal: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      color: [1, 0, 0, 1, 0, 0, 1, 0, 0],
    });
    mesh.worldMatrix = Array.from(new DOMMatrix().translate(0, 0, -1).toFloat64Array());
    const rect = layer._map.getContainer().getBoundingClientRect();
    layer.camera.position.splice(0, 3, 0.25, 0.25, 2);
    layer.camera.target.splice(0, 3, 0.25, 0.25, -1);
    layer.camera.up.splice(0, 3, 0, 1, 0);
    layer.camera.aspect = rect.width / rect.height;
    const center = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const hit = layer.raycast(center, [mesh], false)[0];
    const worldCameraRay = hit?.object === mesh && hit.faceIndex === 0 &&
      hit.point.every((value, index) => Math.abs(value - [0.25, 0.25, -1][index]) < 1e-8);
    const matrix = mesh.worldMatrix;
    mesh.worldMatrix = new Array(16).fill(0);
    let singularTransform = false;
    try { layer.raycast(center, [mesh], false); } catch (error) {
      singularTransform = error.message === 'Singular 3D transform';
    }
    mesh.worldMatrix = matrix;
    const objects = [scene, layer.camera, layer.raycaster, layer.renderer, mesh, mesh.geometry, mesh.program];
    const noEngine = !('Native' in L.Layer.types['3d']) && !('Native' in layer) && !('loadModel' in layer) &&
      objects.every(object => object.constructor === Object) &&
      Object.getPrototypeOf(layer.camera.position) === Array.prototype &&
      Object.getPrototypeOf(mesh.worldMatrix) === Array.prototype &&
      objects.every(object => Object.getPrototypeOf(object) === Object.prototype &&
        Object.values(object).every(value => typeof value !== 'function')) &&
      !Object.keys(L.Layer.types['3d'].prototype).some(name => /Methods|Prototype/.test(name));
    const independent = scene.position !== layer.root.position &&
      scene.children !== layer.root.children && scene.worldMatrix !== layer.root.worldMatrix;
    const nodes = [
      { id: 1, program: { transparent: true }, _sortDepth: 0.2 },
      { id: 2, program: { transparent: false } },
      { id: 3, program: { transparent: true }, _sortDepth: 0.8 },
    ];
    const programs = [];
    for (const properties of nodes) {
      const node = nativeChecks.mesh(layer, {
        position: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        normal: [0, 0, 1, 0, 0, 1, 0, 0, 1],
        color: [1, 0, 0, 1, 0, 0, 1, 0, 0],
      }, layer._createProgram({ vertexColors: true }));
      node.program.transparent = properties.program.transparent;
      node.program.blend = [layer.renderer.gl.SRC_ALPHA, layer.renderer.gl.ONE_MINUS_SRC_ALPHA,
        layer.renderer.gl.ONE, layer.renderer.gl.ONE_MINUS_SRC_ALPHA];
      // The shared renderer computes depth from geometry centers, not authored node origins.
      node.position[0] = 0; node.position[1] = 0; node.position[2] = properties.id === 3 ? -100 : 0;
      programs.push(node.program);
      layer.setParent(node, scene);
    }
    const hidden = nativeChecks.group(); hidden.visible = false; layer.setParent(hidden, scene);
    const hiddenMesh = nativeChecks.group();
    Object.assign(hiddenMesh, { geometry: mesh.geometry, program: mesh.program, id: 4 });
    layer.setParent(hiddenMesh, hidden);
    layer.add(scene);
    const order = [];
    const use = layer._useProgram;
    layer._useProgram = function (program) {
      if (programs.includes(program)) order.push(programs.indexOf(program) + 1);
      return use.call(this, program);
    };
    layer._shared._render();
    layer._useProgram = use;
    const sorted = order.join() === '2,3,1';
    layer.traverse(scene, node => {
      if (node !== hiddenMesh && node.geometry?.attributes) {
        for (const attribute of Object.values(node.geometry.attributes)) node.geometry.gl.deleteBuffer(attribute.buffer);
        layer._removeProgram(node.program);
      }
    });
    for (const attribute of Object.values(mesh.geometry.attributes)) mesh.geometry.gl.deleteBuffer(attribute.buffer);
    layer._removeProgram(mesh.program);
    layer.remove();
    return { worldCameraRay, singularTransform, sorted, noEngine, independent };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

Then('3D layers without a location keep their first map origin', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const initial = map.getCenter();
    const beforeReady = new L.Layer({ source: { type: '3d', ariaLabel: 'Automatic origin' } }).addTo(map);
    const afterReady = new L.Layer({ source: { type: '3d' } });
    await Promise.all([beforeReady, afterReady].map(nativeChecks.ready));
    const deferred = afterReady.location == null && !afterReady.renderer;
    afterReady.addTo(map);
    const origins = beforeReady.location.equals(initial) && afterReady.location.equals(initial);
    const shared = beforeReady.renderer === afterReady.renderer &&
      Math.hypot(...beforeReady.root.position) === 0 && Math.hypot(...afterReady.root.position) === 0;
    beforeReady.remove();
    afterReady.remove();
    map.setView([48.86, 2.3], 17, { animate: false });
    beforeReady.addTo(map);
    afterReady.addTo(map);
    const retained = beforeReady.location.equals(initial) && afterReady.location.equals(initial) &&
      beforeReady.renderer === afterReady.renderer;
    beforeReady.remove();
    afterReady.remove();
    const center = [48.858, 2.295];
    const explicit = new L.Layer({ source: { type: '3d', center } });
    await nativeChecks.ready(explicit);
    center[0] = 0;
    const explicitPreserved = explicit.location.equals([48.858, 2.295]);
    return { deferred, origins, shared, retained, explicitPreserved };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

When('I add and remove independent 3D layers', { timeout: 60000 }, async function () {
  this.shared3d = await this.page.evaluate(async () => {
    const { Layer3D, map } = test3d;
    const control = new L.Control.Layers().addTo(map);
    const pending = new Layer3D({ center: [map.getCenter().lat, map.getCenter().lng] }).addTo(map);
    pending.remove();
    await nativeChecks.ready(pending);
    const pendingRemoved = !document.querySelector('.leaflet-3d');
    const first = new Layer3D({ center: [48.8582601, 2.29449985] }).addTo(map);
    control.addOverlay(first, 'First 3D layer');
    const second = new Layer3D({ center: [48.8602, 2.298] }).addTo(map);
    await Promise.all([first, second].map(nativeChecks.ready));
    const backend = first;
    const object = nativeChecks.group();
    second.add(object);
    const shared = first._shared === first && second._shared === first &&
      L.Layer.types['3d']._renderers.get(map) === first &&
      first.renderer === second.renderer && first.camera === second.camera &&
      first.scene === second.scene && first.root !== second.root &&
      first.root.parent === second.root.parent && document.querySelectorAll('.leaflet-3d').length === 1;
    first._shared._render();
    const worldPoint = new DOMPoint(10, 0, 20, 1).matrixTransform(new DOMMatrix(second.root.worldMatrix));
    const world = [worldPoint.x / worldPoint.w, worldPoint.y / worldPoint.w, worldPoint.z / worldPoint.w];
    const screenPoint = new DOMPoint(...world, 1).matrixTransform(new DOMMatrix(second.camera.projectionViewMatrix));
    const screen = [screenPoint.x / screenPoint.w, screenPoint.y / screenPoint.w, screenPoint.z / screenPoint.w];
    const crs = map.options.crs;
    const point = crs.project(second.location);
    const metres = Math.cos(second.location.lat * Math.PI / 180);
    const latlng = crs.unproject(new L.Point(point.x + 10 / metres, point.y - 20 / metres));
    const expected = map.latLngToContainerPoint(latlng);
    const size = map.getSize();
    const error = new L.Point((screen[0] + 1) * size.x / 2, (1 - screen[1]) * size.y / 2).distanceTo(expected);
    const renderer = second.renderer;
    const canvasDefaults = renderer.gl.canvas.parentNode === map.getPane('webglPane') &&
      map.getPane('webglPane').parentNode === map.getContainer() &&
      map.getPane('webglPane').style.zIndex === '450' &&
      renderer.dpr === Math.min(window.devicePixelRatio, 2);
    let disposals = 0;
    const contextLoss = renderer.gl.getExtension('WEBGL_lose_context');
    const loseContext = contextLoss.loseContext;
    contextLoss.loseContext = function () { disposals++; loseContext.call(this); };
    const sceneOrigin = first.location;
    const matrix = [...first.camera.projectionViewMatrix];
    first.update();
    first.remove();
    await new Promise(requestAnimationFrame);
    const retained = second.renderer === renderer && renderer.gl.canvas.isConnected && disposals === 0 &&
      second._shared === second && L.Layer.types['3d']._renderers.get(map) === second &&
      second._sceneOrigin === sceneOrigin && !first._frame &&
      second.camera.projectionViewMatrix.every((value, index) => Math.abs(value - matrix[index]) < 1e-10);
    const otherMap = new L.Map('second', { center: second.location, zoom: 17, rotate: true });
    first.addTo(otherMap);
    const movedOwner = first._shared === first && first.renderer !== renderer &&
      second._shared === second && second.renderer === renderer;
    otherMap.setBearing(70);
    map.setBearing(65);
    await new Promise(requestAnimationFrame);
    const independentUpdates = first._sceneOrigin === first.location &&
      second.camera.projectionViewMatrix.some((value, index) => Math.abs(value - matrix[index]) > 1e-6);
    first.remove();
    first.addTo(map);
    const rejoined = first.renderer === renderer && first._shared === second &&
      first.root.position.every(value => Math.abs(value) < 1e-8);
    const overlayRegistration = control._layers.filter(entry => entry.layer === first).length === 1 &&
      control._layers.find(entry => entry.layer === first).name === 'First 3D layer';
    const checkbox = () => [...map.getContainer().querySelectorAll('.leaflet-control-layers-overlays label')]
      .find(label => label.textContent.includes('First 3D layer')).querySelector('input');
    checkbox().click();
    const checkboxDisabled = !map.hasLayer(first);
    checkbox().click();
    const checkboxEnabled = map.hasLayer(first) && first.renderer === renderer;
    const other = await nativeChecks.ready(new Layer3D({
      center: [second.location.lat, second.location.lng],
    }).addTo(otherMap));
    const isolated = other.renderer !== renderer && document.querySelectorAll('.leaflet-3d').length === 2;
    second.remove();
    const transferredAgain = first._shared === first && first.renderer === renderer &&
      first._sceneOrigin === sceneOrigin && renderer.gl.canvas.isConnected && disposals === 0;
    first.remove();
    const released = disposals === 1 && !renderer.gl.canvas.isConnected && other.renderer.gl.canvas.isConnected;
    second.addTo(map);
    const restored = second.renderer !== renderer && second.root.children.includes(object);
    map.remove();
    otherMap.remove();
    return { pendingRemoved, shared, canvasDefaults, error, retained, movedOwner, independentUpdates, rejoined, isolated,
      transferredAgain, released, restored,
      overlayRegistration, checkboxDisabled, checkboxEnabled,
      cleaned: !document.querySelector('.leaflet-3d') };
  });
});

Then('3D groups retain their geographic origins and share resources only on the same map', function () {
  const { error, ...checks } = this.shared3d;
  for (const [name, value] of Object.entries(checks)) assert.equal(value, true, name);
  assert.ok(error < 1.5, `Geographic origin error: ${error}px`);
  assert.deepEqual(this.threeRequests, []);
  assert.deepEqual(this.oglRequests, []);
});

Then('an unavailable WebGPU adapter emits an error without leaving a canvas', async function () {
  const result = await this.page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
    try {
      const layer = new test3d.Layer3D().addTo(test3d.map);
      let emitted;
      layer.on('error', event => { emitted = event.error; });
      const error = await nativeChecks.ready(layer).then(() => null, error => error);
      layer.remove();
      return { rejected: error instanceof Error, unavailable: error?.message === 'Unable to acquire a WebGPU adapter',
        emitted: error === emitted, removed: !test3d.map.hasLayer(layer),
        noCanvas: !document.querySelector('.leaflet-3d') };
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'gpu', descriptor);
      else delete navigator.gpu;
    }
  });

  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

When('I select the {string} background in the 3D example', async function (background) {
  await this.page.evaluate(() => {
    const overlays = layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer.types['3d'] &&
      !(entry.layer instanceof L.Layer.types.terrain))
      .map(entry => entry.layer);
    window.exampleSceneBefore = {
      overlays, renderer: overlays[0].renderer, canvas: overlays[0].renderer.canvas,
      model: overlays.find(layer => layer.model).model,
      center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
    };
  });
  await this.page.getByRole('radio', { name: background, exact: true }).check();
});

Then('only the {string} background is active and the 3D scene is unchanged', async function (background) {
  await this.page.waitForFunction(background => {
    const entries = layers._layers.filter(entry => !entry.overlay && map.hasLayer(entry.layer));
    return entries.length === 1 && entries[0].name === background;
  }, background);
  const result = await this.page.evaluate(() => {
    const before = window.exampleSceneBefore;
    const overlays = layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer.types['3d'] &&
      !(entry.layer instanceof L.Layer.types.terrain))
      .map(entry => entry.layer);
    const tower = overlays.find(layer => layer.model);
    return {
      enabled: overlays.length === 6 && overlays.every(layer => map.hasLayer(layer)),
      shared: overlays.every(layer => layer.renderer === before.renderer),
      canvas: document.querySelectorAll('.leaflet-3d').length === 1 &&
        before.canvas.isConnected && tower.renderer.canvas === before.canvas,
      model: tower.model === before.model && tower.model.parent === tower.root,
      camera: map.getCenter().equals(before.center) && map.getZoom() === before.zoom &&
        map.getBearing() === before.bearing && map.getPitch() === before.pitch,
    };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

When('I disable and restore the 3D overlays through the layer control', { timeout: 60000 }, async function () {
  const towerControl = this.page.getByRole('checkbox', { name: 'Eiffel Tower', exact: true });
  const buildingsControl = this.page.getByRole('checkbox', { name: 'Buildings', exact: true });
  const treesControl = this.page.getByRole('checkbox', { name: 'Trees', exact: true });
  const terrainControl = this.page.getByRole('checkbox', { name: 'Terrain (3D)', exact: true });
  const lightsControl = this.page.getByRole('checkbox', { name: 'Streetlights', exact: true });
  const boatsControl = this.page.getByRole('checkbox', { name: 'Bateaux-Mouches', exact: true });
  const trafficControl = this.page.getByRole('checkbox', { name: 'Traffic', exact: true });
  await trafficControl.uncheck();
  await boatsControl.uncheck();
  await lightsControl.uncheck();
  await terrainControl.uncheck();
  await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    window.exampleOverlayBefore = { tower, model: tower.model, canvas: tower.renderer.canvas };
  });
  await towerControl.uncheck();
  const towerDisabled = await this.page.evaluate(() => {
    const before = window.exampleOverlayBefore;
    const buildings = layers._layers.find(entry => entry.layer instanceof L.Layer.types['3d'] &&
      !(entry.layer instanceof L.Layer.types.terrain) && entry.layer.url).layer;
    return !map.hasLayer(before.tower) && map.hasLayer(buildings) &&
      before.canvas.isConnected && buildings.renderer.canvas === before.canvas &&
      !map.attributionControl.getContainer().textContent.includes('CC0 model:') &&
      !before.tower._tooltip;
  });
  await buildingsControl.uncheck();
  const treesRetained = await this.page.evaluate(() => {
    const tree = layers._layers.find(entry => entry.name === 'Trees').layer;
    return map.hasLayer(tree) && tree.renderer.canvas === window.exampleOverlayBefore.canvas &&
      tree.renderer.canvas.isConnected;
  });
  await treesControl.uncheck();
  const allDisabled = await this.page.evaluate(() =>
    !document.querySelector('.leaflet-3d') && !document.querySelector('.leaflet-3d-tooltip') &&
    !window.exampleOverlayBefore.canvas.isConnected);
  await towerControl.check();
  await this.page.waitForFunction(() => {
    const tower = window.exampleOverlayBefore.tower;
    return tower.renderer && tower.model.parent === tower.root;
  });
  const towerRestored = await this.page.evaluate(() => {
    const before = window.exampleOverlayBefore;
    const tower = before.tower;
    return map.hasLayer(tower) && tower.model === before.model &&
      tower.renderer.canvas !== before.canvas && tower.renderer.canvas.isConnected &&
      map.attributionControl.getContainer().textContent.includes('CC0 model:') &&
      tower._tooltip.hidden;
  });
  await buildingsControl.check();
  await treesControl.check();
  await terrainControl.check();
  await lightsControl.check();
  await boatsControl.check();
  await trafficControl.check();
  await this.page.waitForFunction(() => layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer.types['3d'])
    .every(({ layer }) => layer.root && layer.renderer));
  const bothRestored = await this.page.evaluate(() => {
    const overlays = layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer.types['3d'] &&
      !(entry.layer instanceof L.Layer.types.terrain))
      .map(entry => entry.layer);
    return overlays.every(layer => map.hasLayer(layer)) &&
      overlays.every(layer => layer.renderer === overlays[0].renderer) &&
      document.querySelectorAll('.leaflet-3d').length === 1;
  });
  this.exampleOverlayChecks = { towerDisabled, treesRetained, allDisabled, towerRestored, bothRestored };
});

Then('the 3D canvas and model attribution follow the enabled overlays', function () {
  for (const [name, value] of Object.entries(this.exampleOverlayChecks)) assert.equal(value, true, name);
});
