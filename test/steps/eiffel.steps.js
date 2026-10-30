import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';

Given('the Eiffel Tower example page is open', { timeout: 60000 }, async function () {
  await this.page.setViewportSize({ width: 800, height: 600 });
  await this.page.goto(`${this.baseUrl}/examples/leaflet-rotate-eiffel.html`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForFunction(() => window.map && typeof window.map.getPitch === 'function');
  const layout = await this.page.evaluate(() => {
    const rect = map.getContainer().getBoundingClientRect();
    return {
      width: rect.width, height: rect.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      preferCanvas: map.options.preferCanvas,
      importMapOnly: [...document.scripts].every(script =>
        !script.src && ['importmap', 'module'].includes(script.type)),
      vectorLayers: Object.values(map._layers).filter(layer => layer instanceof L.Path).length,
      backgrounds: [...document.querySelectorAll('.leaflet-control-layers-base label')].map(label => label.textContent.trim())
    };
  });
  assert.equal(layout.width, layout.viewportWidth);
  assert.equal(layout.height, layout.viewportHeight);
  assert.equal(layout.preferCanvas, true);
  assert.equal(layout.importMapOnly, true);
  assert.equal(layout.vectorLayers, 0);
  assert.deepEqual(layout.backgrounds, ['Empty', 'Streets', 'Satellite']);
});

When('I visit and inspect the Eiffel Tower 3D model', { timeout: 60000 }, async function () {
  await this.page.waitForFunction(() =>
    !document.getElementById('eiffel-status').textContent.startsWith('Loading'),
  null, { timeout: 45000 });
  assert.match(await this.page.locator('#eiffel-status').textContent(), /3D ready/);
  await this.page.waitForFunction(() => map.getZoom() === 17 && Math.abs(map.getPitch() - 45) < 0.01);
  this.eiffel = await this.page.evaluate(async () => {
    const THREE = await import('three');
    let tower;
    map.eachLayer(layer => {
      if (layer.renderer?.domElement.classList.contains('leaflet-eiffel-tower')) tower = layer;
    });
    const bounds = new THREE.Box3().setFromObject(tower.model);
    const height = bounds.max.y - bounds.min.y;
    let meshes = 0;
    tower.model.traverse(object => { if (object.isMesh) meshes++; });
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
      if (layer instanceof L.TileLayer && layer._map && layer._url) baseLayer = layer;
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
        const world = tower.model.localToWorld(new THREE.Vector3(...foot.local));
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
      const level = tower._zoomLevel;
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
    tower._render();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visiblePixels = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]) visiblePixels++;
    }
    const clickThrough = getComputedStyle(renderer.domElement).pointerEvents === 'none';
    map.removeLayer(tower);
    const removed = !document.querySelector('.leaflet-eiffel-tower');
    tower.addTo(map);
    const restoredSize = tower.renderer.getSize(new THREE.Vector2());
    return {
      height, meshes, errors, footprintErrors, tileErrors, zoomErrors, animatedFrames, hiddenFrames,
      visiblePixels, clickThrough, removed,
      restored: restoredSize.x === map.getSize().x && restoredSize.y === map.getSize().y,
      latitude: tower.location.lat,
      longitude: tower.location.lng
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
  assert.equal(result.restored, true);
});
