import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';

Then('a 3D layer creates and cleans up its own hover tooltip', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer3D({
      source: 'paris-buildings.pmtiles',
      featureStyle: () => ({ top: 10 }),
      tooltipContent: feature => `Height: ${feature.properties.height} m`,
    }).addTo(map);
    await layer.ready;
    const container = map.getContainer();
    container.style.cursor = 'crosshair';
    const tooltip = container.querySelector('.leaflet-3d-tooltip');
    const created = tooltip.parentElement === container && tooltip.hidden &&
      tooltip.getAttribute('role') === 'tooltip' && tooltip.getAttribute('aria-live') === 'polite';
    const rect = container.getBoundingClientRect();
    const position = { clientX: rect.left + 20, clientY: rect.top + 20 };
    const mesh = layer.createMesh({
      position: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normal: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      color: [1, 0, 0, 1, 0, 0, 1, 0, 0],
    });
    const feature = { id: 'test', properties: { height: 10 }, mesh,
      vertexStart: 0, vertexEnd: 3, baseColor: layer.color(0xff0000) };
    layer._findFeature = event => event.clientX === position.clientX ? feature : null;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    const displayed = !tooltip.hidden && tooltip.textContent === 'Height: 10 m' &&
      tooltip.style.left === '32px' && tooltip.style.top === '32px' &&
      container.style.cursor === 'pointer' && layer.highlightedFeature === feature;
    let clicked;
    layer.on('featureclick', event => { clicked = event; });
    container.dispatchEvent(new MouseEvent('click', position));
    const clickNotPinned = !tooltip.hidden && clicked.feature === feature && !('selected' in clicked);
    container.dispatchEvent(new MouseEvent('mousemove', { ...position, clientX: position.clientX + 50 }));
    const hidden = tooltip.hidden && container.style.cursor === 'crosshair' && !layer.highlightedFeature;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    container.dispatchEvent(new MouseEvent('click', position));
    container.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: document.body }));
    container.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));
    const leaveCleared = tooltip.hidden && container.style.cursor === 'crosshair' && !layer.highlightedFeature;
    const other = new L.Layer3D(map.getCenter(), {
      source: 'paris-buildings.pmtiles', featureStyle: () => ({ top: 10 }),
      tooltipContent: () => 'Other feature',
    }).addTo(map);
    await other.ready;
    layer._showFeature(feature, position);
    other._showFeature(feature, position);
    layer.remove();
    const sharedCursor = container.style.cursor === 'pointer' && !other._featureTooltip.hidden;
    other.remove();
    const removed = !tooltip.isConnected && !container.querySelector('.leaflet-3d-tooltip') &&
      container.style.cursor === 'crosshair';
    layer.addTo(map);
    const restored = container.querySelector('.leaflet-3d-tooltip');
    const recreated = restored !== tooltip && restored.hidden;
    layer._showFeature(feature, position);
    layer.remove();
    const restoredCursor = container.style.cursor === 'crosshair';
    mesh.geometry.dispose();
    container.style.cursor = '';
    return { created, displayed, clickNotPinned, hidden, leaveCleared, sharedCursor, removed, recreated, restoredCursor };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

Then('3D layers without a location keep their first map origin', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const initial = map.getCenter();
    const beforeReady = new L.Layer3D({ ariaLabel: 'Automatic origin' }).addTo(map);
    const afterReady = new L.Layer3D();
    await Promise.all([beforeReady.ready, afterReady.ready]);
    const deferred = afterReady.location === null && !afterReady.renderer;
    afterReady.addTo(map);
    const origins = beforeReady.location.equals(initial) && afterReady.location.equals(initial);
    const shared = beforeReady.renderer === afterReady.renderer &&
      beforeReady.root.position.length() === 0 && afterReady.root.position.length() === 0;
    beforeReady.remove();
    afterReady.remove();
    map.setView([48.86, 2.3], 17, { animate: false });
    beforeReady.addTo(map);
    afterReady.addTo(map);
    const retained = beforeReady.location.equals(initial) && afterReady.location.equals(initial) &&
      beforeReady.renderer === afterReady.renderer;
    beforeReady.remove();
    afterReady.remove();
    const explicit = new L.Layer3D({ lat: 48.858, lng: 2.295 });
    await explicit.ready;
    const explicitPreserved = explicit.location.equals([48.858, 2.295]);
    return { deferred, origins, shared, retained, explicitPreserved };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

Then('a configured 3D model loads with its transforms and attribution', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer3D({
      center: [48.8582601, 2.29449985],
      model: '../misc/eiffel-tower.glb',
      rotation: [0, 0.8, 0],
      scale: [1.02, 1, 1.01],
      attribution: 'Test model attribution',
      tooltipContent: feature => feature.model === layer.model ? 'Eiffel Tower' : 'Unexpected model',
    }).addTo(map);
    await layer.ready;
    const geometry = new layer.THREE.Box3().setFromObject(layer.model);
    const centered = layer.location.equals([48.8582601, 2.29449985]);
    const attached = layer.model.parent === layer.root;
    const rotation = layer.model.rotation.y;
    const scale = layer.model.scale.toArray();
    const attribution = map.attributionControl.getContainer().textContent.includes('Test model attribution');
    layer._shared._render();
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    let position;
    layer.model.traverse(object => {
      if (position || !object.isMesh) return;
      const vertices = object.geometry.getAttribute('position');
      for (let i = 0; i < Math.min(vertices.count, 90); i++) {
        const point = new layer.THREE.Vector3().fromBufferAttribute(vertices, i);
        object.localToWorld(point).project(layer.camera);
        if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1) continue;
        const candidate = { clientX: Math.floor(rect.left + (point.x + 1) * rect.width / 2),
          clientY: Math.floor(rect.top + (1 - point.y) * rect.height / 2) };
        if (layer._findFeature(candidate)?.model === layer.model) {
          position = candidate;
          break;
        }
      }
    });
    if (!position) throw new Error('No visible model mesh was picked');
    const hit = layer._findFeature(position);
    const material = hit.mesh.material;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    const tooltip = layer._featureTooltip;
    const modelTooltip = !tooltip.hidden && tooltip.textContent === 'Eiffel Tower' &&
      container.style.cursor === 'pointer' && layer.hoveredFeature.mesh === hit.mesh &&
      hit.mesh.material === material && !layer.highlightedFeature;
    container.dispatchEvent(new MouseEvent('click', position));
    for (const type of ['mouseout', 'mouseleave']) {
      container.dispatchEvent(new MouseEvent(type, { relatedTarget: document.body }));
    }
    const hoverOnly = tooltip.hidden && container.style.cursor !== 'pointer' && !layer.hoveredFeature;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    layer.remove();
    const tooltipRemoved = !tooltip.isConnected && container.style.cursor !== 'pointer';
    const attributionRemoved = !map.attributionControl.getContainer().textContent.includes('Test model attribution');
    layer.addTo(map);
    const retained = layer.model.parent === layer.root;
    const tooltipRecreated = layer._featureTooltip !== tooltip && layer._featureTooltip.hidden;
    layer.remove();
    return { centered, attached, rotation, scale, attribution, attributionRemoved, retained,
      modelTooltip, hoverOnly, tooltipRemoved, tooltipRecreated,
      height: geometry.max.y - geometry.min.y };
  });
  assert.ok(result.height > 299 && result.height < 301);
  assert.equal(result.rotation, 0.8);
  assert.deepEqual(result.scale, [1.02, 1, 1.01]);
  for (const name of ['centered', 'attached', 'attribution', 'attributionRemoved', 'retained',
    'modelTooltip', 'hoverOnly', 'tooltipRemoved', 'tooltipRecreated']) {
    assert.equal(result[name], true, name);
  }
});

Given('a map with the standalone 3D module and no dependency import map', async function () {
  this.threeRequests = [];
  this.page.on('request', request => {
    if (request.url().includes('unpkg.com/three@')) this.threeRequests.push(request.url());
  });
  await this.page.route('**/test/standalone-3d.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css">
      <div id="first" style="width:400px;height:300px"></div>
      <div id="second" style="width:400px;height:300px"></div>
      <script src="https://unpkg.com/leaflet@${process.env.LEAFLET_VERSION === '2' ? '2.0.0-alpha.1/dist/leaflet-global-src.js' : '1.9/dist/leaflet-src.js'}"></script>
      <script>globalThis.L = globalThis.leaflet || globalThis.L;</script>
      <script src="../dist/leaflet-rotate-src.js"></script>
      <script src="../misc/3DLayer.js"></script>
      <script src="../misc/PMTilesLayer.js"></script>
      <script>
        window.test3d = { Layer3D: L.Layer3D, map: new L.Map('first', {
          center: [48.8582601, 2.29449985], zoom: 17, rotate: true, pitch: 45, bearing: 30
        }) };
      </script>`,
  }));
  await this.page.goto(`${this.baseUrl}/test/standalone-3d.html`);
  await this.page.waitForFunction(() => window.test3d);
  assert.deepEqual(this.threeRequests, []);
  assert.equal(await this.page.evaluate(() => [...document.scripts].every(script => !script.type)), true);
  assert.equal(await this.page.evaluate(() => L.Layer3D.SceneRenderer), undefined);
});

When('I add and remove independent 3D layers', { timeout: 60000 }, async function () {
  this.shared3d = await this.page.evaluate(async () => {
    const { Layer3D, map } = test3d;
    const control = new L.Control.Layers().addTo(map);
    const pending = new Layer3D(map.getCenter()).addTo(map);
    pending.remove();
    await pending.ready;
    const pendingRemoved = !document.querySelector('.leaflet-3d');
    const first = new Layer3D([48.8582601, 2.29449985]).addTo(map);
    control.addOverlay(first, 'First 3D layer');
    const second = new Layer3D([48.8602, 2.298]).addTo(map);
    await Promise.all([first.ready, second.ready]);
    const THREE = first.THREE;
    const object = second.createGroup();
    second.add(object);
    const shared = first.renderer === second.renderer && first.camera === second.camera &&
      first.scene === second.scene && first.root !== second.root &&
      first.root.parent === second.root.parent && document.querySelectorAll('.leaflet-3d').length === 1;
    first._shared._render();
    const world = second.root.localToWorld(new THREE.Vector3(10, 0, 20));
    const screen = world.clone().project(second.camera);
    const crs = map.options.crs;
    const point = crs.project(second.location);
    const metres = Math.cos(second.location.lat * Math.PI / 180);
    const latlng = crs.unproject(new L.Point(point.x + 10 / metres, point.y - 20 / metres));
    const expected = map.latLngToContainerPoint(latlng);
    const size = map.getSize();
    const error = new L.Point((screen.x + 1) * size.x / 2, (1 - screen.y) * size.y / 2).distanceTo(expected);
    const renderer = second.renderer;
    let disposals = 0;
    const dispose = renderer.dispose.bind(renderer);
    renderer.dispose = () => { disposals++; dispose(); };
    first.remove();
    const retained = second.renderer === renderer && renderer.domElement.isConnected && disposals === 0;
    first.addTo(map);
    const rejoined = first.renderer === renderer;
    const overlayRegistration = control._layers.filter(entry => entry.layer === first).length === 1 &&
      control._layers.find(entry => entry.layer === first).name === 'First 3D layer';
    const checkbox = () => [...map.getContainer().querySelectorAll('.leaflet-control-layers-overlays label')]
      .find(label => label.textContent.includes('First 3D layer')).querySelector('input');
    checkbox().click();
    const checkboxDisabled = !map.hasLayer(first);
    checkbox().click();
    const checkboxEnabled = map.hasLayer(first) && first.renderer === renderer;
    const otherMap = new L.Map('second', { center: second.location, zoom: 17, rotate: true });
    const other = await new Layer3D(second.location).addTo(otherMap).ready;
    const isolated = other.renderer !== renderer && document.querySelectorAll('.leaflet-3d').length === 2;
    first.remove();
    second.remove();
    const released = disposals === 1 && !renderer.domElement.isConnected && other.renderer.domElement.isConnected;
    second.addTo(map);
    const restored = second.renderer !== renderer && second.root.children.includes(object);
    map.remove();
    otherMap.remove();
    return { pendingRemoved, shared, error, retained, rejoined, isolated, released, restored,
      overlayRegistration, checkboxDisabled, checkboxEnabled,
      cleaned: !document.querySelector('.leaflet-3d') };
  });
});

Then('3D groups retain their geographic origins and share resources only on the same map', function () {
  const { error, ...checks } = this.shared3d;
  for (const [name, value] of Object.entries(checks)) assert.equal(value, true, name);
  assert.ok(error < 1.5, `Geographic origin error: ${error}px`);
});

Then('a failed three.js import rejects readiness and emits an error without leaving a canvas', async function () {
  await this.page.route('https://unpkg.com/three@*/**', route => route.abort('failed'));
  const result = await this.page.evaluate(async () => {
    const layer = new test3d.Layer3D(test3d.map.getCenter()).addTo(test3d.map);
    let emitted;
    layer.on('error', event => { emitted = event.error; });
    const error = await layer.ready.then(() => null, error => error);
    layer.remove();
    return { rejected: error instanceof Error, emitted: error === emitted,
      removed: !test3d.map.hasLayer(layer), noCanvas: !document.querySelector('.leaflet-3d') };
  });

  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

Then('PMTiles layers own archive initialization and native zoom selection', async function () {
    const result = await this.page.evaluate(async () => {
      const map = test3d.map;
      let resolveHeader;
      const archive = {
        getHeader: () => new Promise(resolve => { resolveHeader = resolve; }),
        getZxy: async () => undefined,
      };
      const layer = new L.PMTilesLayer('test.pmtiles', { archive }).addTo(map);
      const delayed = !layer._container;
      await Promise.resolve();
      resolveHeader({ maxZoom: 12 });
      await layer.ready;
      const nativeZoom = layer.options.maxNativeZoom;
      const tileZoom = layer._tileZoom;
      const initialized = Boolean(layer._container);
      layer.remove();
      const override = await new L.PMTilesLayer('test.pmtiles', {
        archive: { getHeader: async () => ({ maxZoom: 12 }) }, maxNativeZoom: 10,
      }).ready;
      const failed = new L.PMTilesLayer('test.pmtiles', {
        archive: { getHeader: async () => { throw new Error('Missing archive'); } },
      });
      let emitted;
      failed.on('error', event => { emitted = event.error; });
      const error = await failed.ready.then(() => null, error => error);
      const coords = { z: 12, x: 1, y: 2 };
      const raster = await new L.PMTilesLayer('test.pmtiles', {
        archive: { getHeader: async () => ({ maxZoom: 12 }), getZxy: async () => undefined },
      }).ready;
      const missingTile = await new Promise(resolve => {
        raster.createTile(coords, (error, tile) => resolve({ error, tile }));
      });
      raster.options.archive.getZxy = async () => ({
        data: new TextEncoder().encode('{"type":"Point","coordinates":[0,0]}'),
      });
      const invalidTile = await new Promise(resolve => {
        raster.createTile(coords, (error, tile) => resolve({ error, tile }));
      });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      raster.options.archive.getZxy = async () => ({ data: await blob.arrayBuffer() });
      const loadedTile = await new Promise((resolve, reject) => {
        raster.createTile(coords, (error, tile) => error ? reject(error) : resolve(tile));
      });
      let requested = false;
      raster.options.archive.getZxy = async () => { requested = true; };
      let completed = false;
      const cancelled = raster.createTile(coords, () => { completed = true; });
      raster.fire('tileunload', { tile: cancelled });
      let completeOnZoom = false;
      const zoomCancelled = raster.createTile(coords, () => { completeOnZoom = true; });
      raster._tiles = { test: { coords, el: zoomCancelled } };
      raster._tileZoom = 13;
      raster._abortLoading();
      await new Promise(resolve => setTimeout(resolve, 0));
      return { delayed, nativeZoom, tileZoom, initialized, override: override.options.maxNativeZoom,
        failed: error?.message === 'Missing archive' && emitted === error,
        noFallback: failed.options.maxNativeZoom === undefined,
        tileBase: layer instanceof L.TileLayer,
        missingRaster: missingTile.error?.message === 'Tile 12/1/2 is not in the offline archive' &&
          missingTile.tile.error === missingTile.error.message,
        invalidRaster: invalidTile.error?.message === 'Unable to decode tile 12/1/2' &&
          invalidTile.tile.error === invalidTile.error.message && invalidTile.tile.objectURL === null,
        loadedRaster: loadedTile.tagName === 'IMG' && loadedTile.alt === '' &&
          loadedTile.done && loadedTile.naturalWidth === 1 && loadedTile.objectURL === null,
        cancelled: cancelled.request.signal.aborted && !requested && !completed,
        zoomCancelled: zoomCancelled.request.signal.aborted && !completeOnZoom };
    });
    assert.deepEqual(result, {
      delayed: true, nativeZoom: 12, tileZoom: 12, initialized: true, override: 10,
      failed: true, noFallback: true,
      tileBase: true, missingRaster: true, invalidRaster: true, loadedRaster: true,
      cancelled: true, zoomCancelled: true,
    });
});


Given('the Eiffel Tower example page is open', { timeout: 60000 }, async function () {
  await this.page.setViewportSize({ width: 800, height: 600 });
  await this.page.goto(`${this.baseUrl}/examples/leaflet-rotate-3d-layer.html`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForFunction(() => window.map && typeof window.map.getPitch === 'function');
  await this.page.evaluate(() => Promise.all(layers._layers.map(entry => entry.layer.ready)));
  const layout = await this.page.evaluate(() => {
    const rect = map.getContainer().getBoundingClientRect();
    return {
      width: rect.width, height: rect.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      preferCanvas: map.options.preferCanvas,
      classicScriptsOnly: [...document.scripts].every(script => !script.type),
      globalLibraries: typeof L.Layer3D === 'function' && typeof L.PMTilesLayer === 'function',
      vectorLayers: Object.values(map._layers).filter(layer => layer instanceof L.Path).length,
      backgrounds: [...document.querySelectorAll('.leaflet-control-layers-base label')].map(label => label.textContent.trim()),
      activeBackgrounds: layers._layers.filter(entry => !entry.overlay && map.hasLayer(entry.layer)).map(entry => entry.name),
      orthophotoUrl: layers._layers.find(entry => entry.name === 'Orthophoto IGN').layer.options.archive.url
    };
  });
  assert.equal(layout.width, layout.viewportWidth);
  assert.equal(layout.height, layout.viewportHeight);
  assert.equal(layout.preferCanvas, true);
  assert.equal(layout.classicScriptsOnly, true);
  assert.equal(layout.globalLibraries, true);
  assert.equal(layout.vectorLayers, 0);
  assert.deepEqual(layout.backgrounds, ['Empty', 'Plan IGN', 'Orthophoto IGN']);
  assert.deepEqual(layout.activeBackgrounds, ['Orthophoto IGN']);
  assert.match(layout.orthophotoUrl, /\/examples\/data\/paris-orthophotos\.pmtiles$/);
});

When('I visit and inspect the Eiffel Tower 3D model', { timeout: 60000 }, async function () {
  await this.page.waitForFunction(() =>
    Object.values(map._layers).some(layer => layer.model && layer.renderer),
  null, { timeout: 45000 });
  await this.page.waitForFunction(() => map.getZoom() === 17 && Math.abs(map.getPitch() - 45) < 0.01);
  this.eiffel = await this.page.evaluate(async () => {
    let tower, eiffel;
    map.eachLayer(layer => {
      if (layer.renderer && !layer.model) tower = layer;
      if (layer.model) eiffel = layer;
    });
    const THREE = tower.THREE;
    const bounds = new THREE.Box3().setFromObject(eiffel.model);
    const height = bounds.max.y - bounds.min.y;
    let meshes = 0;
    eiffel.model.traverse(object => { if (object.isMesh) meshes++; });
    const errors = [];
    // Outer ground corners: OSM nodes 33388343, 33388336, 33388327 and 33388350.
    const feet = [
      { local: [60.118438720703125, 0, -60.605037689208984], latlng: [48.8590453, 2.2944834] },
      { local: [60.11847686767578, 0, 60.60499954223633], latlng: [48.8582718, 2.2956897] },
      { local: [-60.118438720703125, 0, 60.605037689208984], latlng: [48.8574753, 2.2945144] },
      { local: [-60.11847686767578, 0, -60.60499954223633], latlng: [48.8582480, 2.2933119] }
    ];
    const footprintErrors = [];
    const tileErrors = [];
    let baseLayer;
    map.eachLayer(layer => {
      if (layer instanceof L.PMTilesLayer && layer._map) baseLayer = layer;
    });
    for (const [zoom, pitch, bearing] of [[17, 0, 0], [17, 45, 30], [18, 60, 135], [16, 80, 270]]) {
      map.setView(tower.location, zoom, { animate: false });
      map.setPitch(pitch);
      map.setBearing(bearing);
      map.panBy([35, -20], { animate: false });
      await new Promise(requestAnimationFrame);
      const scale = map.options.crs.scale(zoom) /
        (40075016.68557849 * Math.cos(tower.location.lat * Math.PI / 180));
      const origin = map.project(tower.location).subtract(map.getPixelOrigin());
      const size = map.getSize();
      for (const [x, z] of [[-40, -40], [0, 0], [40, 40]]) {
        const expected = map.layerPointToContainerPoint(origin.add([x * scale, z * scale]));
        const ndc = new THREE.Vector3(x, 0, z).project(tower.camera);
        const actual = new L.Point((ndc.x + 1) * size.x / 2, (1 - ndc.y) * size.y / 2);
        errors.push(actual.distanceTo(expected));
      }
      const level = baseLayer._levels[baseLayer._tileZoom];
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0';
      level.el.append(probe);
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const borderX = parseFloat(style.borderLeftWidth);
      const borderY = parseFloat(style.borderTopWidth);
      for (const foot of feet) {
        const world = eiffel.model.localToWorld(new THREE.Vector3(...foot.local));
        const geographic = map.unproject(map.project(tower.location).add([world.x * scale, world.z * scale]), zoom);
        footprintErrors.push(geographic.distanceTo(new L.LatLng(...foot.latlng)));
        const point = map.project(new L.LatLng(...foot.latlng), baseLayer._tileZoom).subtract(level.origin);
        probe.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
        const ground = probe.getBoundingClientRect();
        const expected = new L.Point(ground.x - rect.x - borderX, ground.y - rect.y - borderY);
        const ndc = world.project(tower.camera);
        const actual = new L.Point((ndc.x + 1) * size.x / 2, (1 - ndc.y) * size.y / 2);
        tileErrors.push(actual.distanceTo(expected));
      }
      probe.remove();
    }

    const zoomErrors = [];
    let animatedFrames = 0;
    let hiddenFrames = 0;
    const render = tower.renderer.render;
    tower.renderer.render = function (...args) {
      render.apply(this, args);
      if (!map._animatingZoom) return;
      animatedFrames++;
      if (this.domElement.hidden) hiddenFrames++;
      const level = tower._shared._zoomLevel;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0';
      level.el.append(probe);
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const size = map.getSize();
      const scale = map.options.crs.scale(level.zoom) /
        (40075016.68557849 * Math.cos(tower.location.lat * Math.PI / 180));
      const origin = map.project(tower.location, level.zoom).subtract(level.origin);
      for (const [x, z] of [[0, 0], [-40, -40], [40, 40]]) {
        probe.style.transform = `translate3d(${origin.x + x * scale}px,${origin.y + z * scale}px,0)`;
        const ground = probe.getBoundingClientRect();
        const expected = new L.Point(
          ground.x - rect.x - parseFloat(style.borderLeftWidth),
          ground.y - rect.y - parseFloat(style.borderTopWidth)
        );
        const ndc = new THREE.Vector3(x, 0, z).project(tower.camera);
        const actual = new L.Point((ndc.x + 1) * size.x / 2, (1 - ndc.y) * size.y / 2);
        zoomErrors.push(actual.distanceTo(expected));
      }
      probe.remove();
    };
    map.setView(tower.location, 16, { animate: false });
    map.setPitch(45);
    map.setBearing(30);
    map.panBy([70, -35], { animate: false });
    for (const zoom of [17, 16, 17, 16]) {
      await new Promise(requestAnimationFrame);
      await new Promise(resolve => {
        map.once('zoomend', resolve);
        map.setZoomAround(new L.Point(320, 220), zoom, { animate: true });
      });
    }
    tower.renderer.render = render;

    map.setView(tower.location, 17, { animate: false });
    map.setPitch(60);
    map.setBearing(30);
    await new Promise(requestAnimationFrame);
    const renderer = tower.renderer;
    const gl = renderer.getContext();
    tower._shared._render();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visiblePixels = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]) visiblePixels++;
    }
    const clickThrough = getComputedStyle(renderer.domElement).pointerEvents === 'none';
    map.removeLayer(tower);
    const sharedCanvasRemains = document.querySelector('.leaflet-3d') === eiffel.renderer.domElement;
    map.removeLayer(eiffel);
    const other3d = [];
    map.eachLayer(layer => { if (layer instanceof L.Layer3D) other3d.push(layer); });
    other3d.forEach(layer => layer.remove());
    const removed = !document.querySelector('.leaflet-3d');
    tower.addTo(map);
    eiffel.addTo(map);
    other3d.forEach(layer => layer.addTo(map));
    const restoredSize = tower.renderer.getSize(new THREE.Vector2());
    return {
      height, meshes, errors, footprintErrors, tileErrors, zoomErrors, animatedFrames, hiddenFrames,
      visiblePixels, clickThrough, removed, sharedCanvasRemains,
      restored: restoredSize.x === map.getSize().x && restoredSize.y === map.getSize().y,
      latitude: eiffel.location.lat,
      longitude: eiffel.location.lng
    };
  });
});

Then('the tower is rendered at its geographic position through camera changes', function () {
  const result = this.eiffel;
  assert.ok(result.height > 299 && result.height < 301, JSON.stringify(result));
  assert.ok(result.meshes > 1, JSON.stringify(result));
  assert.ok(Math.max(...result.errors) < 1.5, `Logical coordinate rounding errors: ${result.errors}`);
  assert.ok(Math.max(...result.footprintErrors) < 0.5, `Footprint errors in metres: ${result.footprintErrors}`);
  assert.ok(Math.max(...result.tileErrors) < 2, `Tile alignment errors in pixels: ${result.tileErrors}`);
  assert.ok(result.animatedFrames >= 4, `Too few animated zoom frames: ${result.animatedFrames}`);
  assert.equal(result.hiddenFrames, 0);
  assert.ok(Math.max(...result.zoomErrors) < 0.1, `Animated tile alignment errors: ${result.zoomErrors}`);
  assert.ok(result.visiblePixels > 1000, JSON.stringify(result));
  assert.equal(result.latitude, 48.8582601);
  assert.equal(result.longitude, 2.29449985);
  assert.equal(result.clickThrough, true);
  assert.equal(result.removed, true);
  assert.equal(result.sharedCanvasRemains, true);
  assert.equal(result.restored, true);
});

const ring = (west, south, size = 0.0004) => [
  [west, south], [west + size, south], [west + size, south + size],
  [west, south + size], [west, south]
];

Given('the Paris buildings example is open with sample volumes', { timeout: 60000 }, async function () {
  this.buildingRequests = [];
  this.buildingConcurrency = 0;
  this.maxBuildingConcurrency = 0;
  this.failBuildings = false;
  this.sampleBuildings = [
    {
      type: 'Feature',
      properties: { h_et_max: 4, nb_pl: 5, b_rdc: 1 },
      geometry: { type: 'Polygon', coordinates: [ring(2.2955, 48.8585), ring(2.2956, 48.8586, 0.0002)] }
    },
    {
      type: 'Feature',
      properties: { h_et_max: 4, nb_pl: 2, b_rdc: 0 },
      geometry: { type: 'MultiPolygon', coordinates: [[ring(2.296, 48.8585)], [ring(2.2965, 48.8585)]] }
    },
    {
      type: 'Feature',
      properties: { h_et_max: null, nb_pl: null, b_rdc: 1 },
      geometry: { type: 'Polygon', coordinates: [ring(2.297, 48.8585)] }
    }
  ];
  await this.page.exposeFunction('pmtilesTile', async (url, z, x, y) => {
    if (!url.endsWith('/paris-buildings.pmtiles')) return null;
    this.buildingRequests.push({ z, x, y });
    this.buildingConcurrency++;
    this.maxBuildingConcurrency = Math.max(this.maxBuildingConcurrency, this.buildingConcurrency);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (this.failBuildings) return { error: 'HTTP 503' };
      // Like the real archive, every block returns all buildings it may intersect.
      return JSON.stringify({ type: 'FeatureCollection', features: this.sampleBuildings });
    } finally {
      this.buildingConcurrency--;
    }
  });
  await this.page.setViewportSize({ width: 800, height: 600 });
  await this.page.goto(`${this.baseUrl}/examples/leaflet-rotate-3d-layer.html`, { waitUntil: 'domcontentloaded' });
  await this.page.evaluate(() => Promise.all(layers._layers.map(entry => entry.layer.ready)));
  await this.page.waitForFunction(() => {
    const buildings = Object.values(map._layers).find(layer => layer.group);
    return buildings && buildings._inflight === 0 && buildings._areas.size > 0 &&
      [...buildings._areas.values()].reduce((sum, area) => sum + (area.buildings || 0), 0) === 2;
  },
  null, { timeout: 45000 });
});

Then('the building volumes preserve courtyards and elevated floors', async function () {
  const result = await this.page.evaluate(async () => {
    let tower, buildings;
    map.eachLayer(layer => {
      if (layer.renderer && !layer.model) tower = layer;
      if (layer.group) buildings = layer;
    });
    const THREE = tower.THREE;
    const mesh = buildings.group.children[0];
    mesh.updateMatrixWorld(true);
    const origin = map.options.crs.project(tower.location);
    const metres = Math.cos(tower.location.lat * Math.PI / 180);
    const hits = (lat, lon) => {
      const point = map.options.crs.project(new L.LatLng(lat, lon));
      const ray = new THREE.Raycaster(
        new THREE.Vector3((point.x - origin.x) * metres, 100, -(point.y - origin.y) * metres),
        new THREE.Vector3(0, -1, 0)
      );
      return ray.intersectObject(mesh).map(hit => hit.point.y);
    };
    const elevated = map.options.crs.project(new L.LatLng(48.8587, 2.2962));
    const underside = new THREE.Raycaster(
      new THREE.Vector3((elevated.x - origin.x) * metres, 0, -(elevated.y - origin.y) * metres),
      new THREE.Vector3(0, 1, 0)
    ).intersectObject(mesh).map(hit => hit.point.y);
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    return {
      holes: hits(48.8587, 2.2957),
      underside,
      roof: hits(48.85855, 2.29555),
      multipart: [hits(48.8587, 2.2962), hits(48.8587, 2.2967)],
      min: geometry.boundingBox.min.y,
      max: geometry.boundingBox.max.y,
      sharedScene: buildings.root.parent === buildings.scene &&
        Object.values(map._layers).filter(layer => layer instanceof L.Layer3D)
          .every(layer => layer.renderer === buildings.renderer),
      true3DLayer: buildings instanceof L.Layer3D && !(buildings instanceof L.GridLayer),
      noSubclass: buildings.constructor === L.Layer3D,
      meshes: buildings.group.children.length,
      skipped: [...buildings._areas.values()].reduce((sum, area) => sum + (area.skipped || 0), 0)
    };
  });
  assert.deepEqual(result.holes, []);
  assert.ok(result.underside.some(height => Math.abs(height - 9) < 0.001));
  assert.ok(result.roof.some(height => Math.abs(height - 15) < 0.001));
  assert.ok(result.multipart.every(hits => hits.some(height => Math.abs(height - 15) < 0.001)));
  assert.ok(Math.abs(result.min) < 0.001);
  assert.ok(Math.abs(result.max - 15) < 0.001);
  assert.equal(result.sharedScene, true);
  assert.equal(result.true3DLayer, true);
  assert.equal(result.noSubclass, true);
  assert.equal(result.meshes, 1);
  assert.equal(result.skipped, 1);

  const genericStyle = await this.page.evaluate(async feature => {
    const buildings = Object.values(map._layers).find(layer => layer.group);
    const coords = { z: buildings.header.minZoom };
    const point = map.project(new L.LatLng(48.8585, 2.2955), coords.z).divideBy(256).floor();
    Object.assign(coords, { x: point.x, y: point.y });
    const area = { coords, request: new AbortController() };
    const original = buildings.options.featureStyle;
    let content;
    try {
      buildings.options.featureStyle = feature => ({ top: feature.properties.height, bottom: 7, color: 0xff0000 });
      content = await buildings._createMesh([{ ...feature, id: 'custom-volume',
        properties: { height: 22 } }], area);
      const geometry = content.mesh.geometry;
      geometry.computeBoundingBox();
      buildings.options.featureStyle = () => ({ top: 3, bottom: 4 });
      const error = await buildings._createMesh([feature], area).then(() => null, error => error.message);
      return { top: geometry.boundingBox.max.y, bottom: geometry.boundingBox.min.y,
        color: Array.from(geometry.getAttribute('color').array.slice(0, 3)),
        id: content.mesh.userData.featureFaces[0].id, error };
    } finally {
      buildings.options.featureStyle = original;
      content?.mesh.geometry.dispose();
    }
  }, this.sampleBuildings[0]);
  assert.deepEqual(genericStyle, { top: 22, bottom: 7, color: [1, 0, 0], id: 'custom-volume',
    error: 'Invalid extrusion heights: expected top > bottom >= 0' });

  const interaction = await this.page.evaluate(async () => {
    let tower, buildings;
    map.eachLayer(layer => {
      if (layer.renderer && !layer.model) tower = layer;
      if (layer.group) buildings = layer;
    });
    const THREE = tower.THREE;
    buildings.featureEvents = [];
    buildings.on('featurehover featureclick', event => {
      buildings.featureEvents.push({ type: event.type, id: event.feature?.id });
    });
    const range = buildings.group.children[0].userData.featureFaces[0];
    const origin = map.options.crs.project(tower.location);
    const point = map.options.crs.project(new L.LatLng(48.85855, 2.29555));
    const world = new THREE.Vector3(
      (point.x - origin.x) * Math.cos(tower.location.lat * Math.PI / 180),
      15,
      -(point.y - origin.y) * Math.cos(tower.location.lat * Math.PI / 180)
    ).project(tower.camera);
    const rect = map.getContainer().getBoundingClientRect();
    const position = {
      clientX: rect.left + (world.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - world.y) * rect.height / 2
    };
    const before = Array.from(
      buildings.group.children[0].geometry.getAttribute('color').array.slice(range.vertexStart * 3, range.vertexStart * 3 + 3)
    );
    map.getContainer().dispatchEvent(new MouseEvent('mousemove', { ...position, bubbles: true }));
    return {
      position,
      vertexStart: range.vertexStart,
      before
    };
  });
  await this.page.waitForFunction(() =>
    document.querySelector('.leaflet-3d-tooltip').textContent.includes('Estimated height: 15 m'));
  const highlightedColor = await this.page.evaluate(vertexStart => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    return {
      color: Array.from(
        buildings.group.children[0].geometry.getAttribute('color').array.slice(vertexStart * 3, vertexStart * 3 + 3)
      ),
      highlighted: buildings.highlightedFeature?.vertexStart,
      hovered: buildings.hoveredFeature?.vertexStart
    };
  }, interaction.vertexStart);
  this.hoverHighlight = highlightedColor.color.some((value, index) => value !== interaction.before[index]);
  await this.page.mouse.click(interaction.position.clientX, interaction.position.clientY);
  await this.page.evaluate(() => {
    for (const type of ['mouseout', 'mouseleave']) {
      map.getContainer().dispatchEvent(new MouseEvent(type, { relatedTarget: document.body }));
    }
  });
  this.clickCleared = await this.page.evaluate(() => {
      let buildings;
      map.eachLayer(layer => { if (layer.group) buildings = layer; });
      return buildings._featureTooltip.hidden && !buildings.hoveredFeature && !buildings.highlightedFeature &&
        map.getContainer().style.cursor !== 'pointer';
    });
  assert.equal(this.hoverHighlight, true, JSON.stringify({ interaction, highlightedColor }));
  assert.equal(this.clickCleared, true);
  const events = await this.page.evaluate(() => {
    const buildings = Object.values(map._layers).find(layer => layer.group);
    return buildings.featureEvents;
  });
  assert.ok(events.some(event => event.type === 'featurehover' && event.id));
  assert.ok(events.some(event => event.type === 'featureclick' && event.id));
});

When('I move and toggle the Paris building volumes', { timeout: 60000 }, async function () {
  const status = text => this.page.waitForFunction(text => {
    const buildings = layers._layers.find(entry => entry.layer.options.source).layer;
    if (buildings._inflight || !buildings._areas.size) return false;
    const areas = [...buildings._areas.values()];
    if (text === 'Unable to load') return areas.some(area => area.error);
    if (areas.some(area => !area.done)) return false;
    const loaded = areas.reduce((sum, area) => sum + (area.buildings || 0), 0);
    return loaded === (text === '2 Paris building volumes loaded' ? 2 : 0);
  }, text);
  const meshes = () => this.page.evaluate(() => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    return buildings.group.children.length;
  });
  const away = () => this.page.evaluate(() => map.setView([48.85657, 2.33307], 16, { animate: false }));
  const back = () => this.page.evaluate(() => map.setView([48.8582601, 2.29449985], 17, { animate: false }));

  await away();
  await status('No building volumes in the current area');
  this.lastBuildingTile = this.buildingRequests[this.buildingRequests.length - 1];
  this.releasedAfterPan = await meshes() === 0;
  await back();
  await status('2 Paris building volumes loaded');
  this.reloadedOnReturn = await meshes() === 1;

  await this.page.getByRole('checkbox', { name: 'Eiffel Tower (3D)', exact: true }).uncheck();
  this.independentBuildings = await this.page.evaluate(() => {
    let eiffel, buildings;
    map.eachLayer(layer => {
      if (layer.model) eiffel = layer;
      if (layer.group) buildings = layer;
    });
    return !eiffel && buildings.group.parent === buildings.scene &&
      buildings.renderer.domElement.isConnected && buildings.group.children.length === 1;
  });

  await this.page.getByRole('checkbox', { name: 'Paris buildings (3D)', exact: true }).uncheck();
  await this.page.waitForTimeout(100);
  const requestsWhenDisabled = this.buildingRequests.length;
  await this.page.evaluate(() => map.panBy([10, 10], { animate: false }));
  await this.page.waitForTimeout(500);
  this.noRequestsWhenDisabled = this.buildingRequests.length === requestsWhenDisabled;

  this.failBuildings = true;
  await this.page.getByRole('checkbox', { name: 'Paris buildings (3D)', exact: true }).check();
  await status('Unable to load');
  this.failureText = await this.page.evaluate(() => {
    const buildings = Object.values(map._layers).find(layer => layer.group);
    return [...buildings._areas.values()].map(area => area.error).filter(Boolean).join('; ');
  });
  this.failBuildings = false;
  // Leaving the neighbourhood drops failed blocks; returning retries them.
  await away();
  await status('No building volumes in the current area');
  await back();
  await status('2 Paris building volumes loaded');
  this.recoveredBuildings = true;

  const requestsBeforeCameraChanges = this.buildingRequests.length;
  await this.page.evaluate(() => {
    map.setZoom(13, { animate: false });
    map.setPitch(70);
    map.setBearing(120);
  });
  await status('2 Paris building volumes loaded');
  this.retainedAtLowZoom = await meshes() === 1;
  await this.page.waitForTimeout(100);
  this.noRequestsForCameraChanges = this.buildingRequests.length === requestsBeforeCameraChanges;
  this.areaBudget = await this.page.evaluate(() => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    return { areas: buildings._areas.size, inflight: buildings._inflight };
  });
  this.cancelledConstruction = await this.page.evaluate(async feature => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    const point = map.project(new L.LatLng(48.8585, 2.2955), buildings.header.minZoom).divideBy(256).floor();
    const area = { coords: { z: buildings.header.minZoom, x: point.x, y: point.y }, request: new AbortController() };
    const before = buildings.root.children.length;
    requestAnimationFrame(() => area.request.abort());
    const content = await buildings._createMesh(Array(10000).fill(feature), area);
    return content === null && buildings.root.children.length === before;
  }, this.sampleBuildings[0]);
});

Then('3D neighbourhoods stay bounded, release distant volumes, and recover from failures', function () {
  assert.equal(this.lastBuildingTile.z, 16);
  assert.equal(this.releasedAfterPan, true);
  assert.equal(this.reloadedOnReturn, true);
  assert.equal(this.independentBuildings, true);
  assert.equal(this.noRequestsWhenDisabled, true);
  assert.match(this.failureText, /HTTP 503/);
  assert.equal(this.recoveredBuildings, true);
  assert.equal(this.retainedAtLowZoom, true);
  assert.equal(this.noRequestsForCameraChanges, true);
  assert.ok(this.areaBudget.areas <= 9);
  assert.ok(this.areaBudget.inflight <= 2);
  assert.ok(this.maxBuildingConcurrency <= 2, `Concurrent archive requests: ${this.maxBuildingConcurrency}`);
  assert.equal(this.cancelledConstruction, true);
});
