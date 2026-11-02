import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';

Then('streetlights and the Eiffel Tower emit light only during simulated night', { timeout: 120000 }, async function () {
  const errors = [];
  this.page.on('pageerror', error => errors.push(error.message));
  this.page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const loaded = () => this.page.waitForFunction(() => {
    const layer = window.streetlights;
    if (!layer?._areas) return false;
    const failed = [...layer._areas.values()].find(area => area.error);
    if (failed) throw new Error(failed.error);
    return layer._inflight === 0 && [...layer._areas.values()].some(area => area.buildings > 0);
  }, null, { timeout: 60000 });
  await loaded();
  await this.page.waitForFunction(() => {
    const owner = L.Layer.types['3d']._renderers.get(map);
    return owner?._roofRaster && map._terrain3D?._rasterTiles.size > 0 &&
      !Object.values(map._layers).some(layer => layer.isLoading?.()) &&
      [...owner._layers].every(layer => !layer.url || (layer._inflight === 0 &&
        [...layer._areas.values()].every(area => area.done || area.error)));
  }, null, { timeout: 60000 });
  const result = await this.page.evaluate(async () => {
    const { lampStyle, lampTooltip } = await import('../examples/night-lights.js');
    const layer = streetlights, owner = L.Layer.types['3d']._renderers.get(map);
    const { device, context, canvas, format } = owner.renderer;
    const gpuErrors = [];
    device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    const features = layer.root.children.flatMap(mesh => mesh.extras.featureFaces);
    const actualStyle = lampStyle(features[0]);
    const surfaceOnly = features.every(feature => lampStyle(feature) !== null);
    const poles = [];
    layer._lampPostGeometry({ x: 10, y: 20, ground: 3 }, { top: 8, poleRadius: 0.12 },
      (a, ah, b, bh, c, ch) => poles.push([a, ah], [b, bh], [c, ch]));
    const poleBounds = [Math.min(...poles.map(([p, h]) => p.ground + h)),
      Math.max(...poles.map(([p, h]) => p.ground + h))];
    const supportIds = new Set();
    let expectedPoles = 0;
    for (const feature of features) {
      if (!lampStyle(feature).poleRadius) continue;
      const key = feature.properties.cod_ouvrag || feature.id;
      if (!supportIds.has(key)) { supportIds.add(key); expectedPoles++; }
    }
    const poleVertices = layer.root.children.reduce((sum, mesh) =>
      sum + mesh.geometry.attributes.uv.data.reduce((count, value, i) => count + Number(i % 2 === 0 && value === 3), 0), 0);
    const tooltip = lampTooltip({ properties: { foyer: '<img src=x onerror=alert(1)>', support_hauteur: '7',
      lampe_flux: 'None', lampe_temperature_couleur: '2700', lib_regime: 'HORAIRE EP' } });
    const geometry = [];
    layer._lightGeometry({ x: 10, y: 20, ground: 3 }, { top: 8, lightRadius: 12, color: 0xffcc88 },
      (a, ah, b, bh, c, ch) => geometry.push([a, ah], [b, bh], [c, ch]));
    const emitterHeight = geometry.every(([point, height]) => Math.abs(point.ground + height - 11) <= 0.651);
    const date = sunlightControl.getContainer().querySelector('input[type=date]');
    const slider = sunlightControl.getContainer().querySelector('input[type=range]');
    const select = minute => {
      date.value = '2026-06-21'; slider.value = String(minute);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      owner._render();
    };
    context.configure({ device, format, alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const capture = async () => {
      owner._render();
      const bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() }, { buffer, bytesPerRow },
        [canvas.width, canvas.height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap(); buffer.destroy();
      return pixels;
    };
    const brighter = (a, b) => {
      let count = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] + a[i + 1] + a[i + 2] > b[i] + b[i + 1] + b[i + 2] + 15) count++;
      }
      return count;
    };
    select(0);
    const nightStrength = owner.renderer.uniformData[55];
    const lit = await capture();
    layer.root.visible = false;
    const unlit = await capture();
    layer.root.visible = true;
    const lampPixels = brighter(lit, unlit);
    const tower = layers._layers.find(entry => entry.name === 'Eiffel Tower (3D)').layer;
    const programs = new Set();
    tower.traverse(tower.root, mesh => { if (mesh.program) programs.add(mesh.program); });
    for (const program of programs) program.nightSparkle = false;
    const darkTower = await capture();
    tower.root.visible = false;
    const withoutTower = await capture();
    tower.root.visible = true;
    let towerSurfacePixels = 0;
    for (let i = 0; i < darkTower.length; i += 4) {
      if (Math.abs(darkTower[i] - withoutTower[i]) + Math.abs(darkTower[i + 1] - withoutTower[i + 1]) +
        Math.abs(darkTower[i + 2] - withoutTower[i + 2]) > 3) towerSurfacePixels++;
    }
    for (const program of programs) program.nightSparkle = true;
    const towerPixels = brighter(lit, darkTower);
    // Hide terrain and the luminous sprite triangles: only nearby 3D surfaces can brighten.
    const terrain = [...owner._layers].find(layer => layer instanceof L.Layer.types.terrain);
    terrain.root.visible = false;
    const ranges = layer.root.children.map(mesh => [mesh, mesh.geometry.drawRange.count]);
    for (const [mesh] of ranges) mesh.geometry.drawRange.count = 0;
    const objectsLit = await capture();
    layer.root.visible = false;
    const objectsUnlit = await capture();
    layer.root.visible = true;
    terrain.root.visible = true;
    for (const [mesh, count] of ranges) mesh.geometry.drawRange.count = count;
    const objectPixels = brighter(objectsLit, objectsUnlit);
    select(720);
    const dayStrength = owner.renderer.uniformData[55];
    const dayLit = await capture();
    layer.root.visible = false;
    const dayWithoutLamps = await capture();
    layer.root.visible = true;
    const dayLampPixels = brighter(dayLit, dayWithoutLamps) + brighter(dayWithoutLamps, dayLit);
    select(0);
    const checkbox = sunlightControl.getContainer().querySelector('input[type=checkbox]');
    checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));
    owner._render();
    const disabledStrength = owner.renderer.uniformData[55];
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    owner._render();
    window.oldLightMeshes = [...layer.root.children];
    return {
      count: features.length, ids: features.every(f => f.id === f.properties.foyer),
      surfaceOnly, poleBounds, poleVertices, expectedPoles,
      geometry: geometry.length, emitterHeight,
      validBuffers: layer.root.children.every(mesh =>
        Object.values(mesh.geometry.attributes).every(attribute => [...attribute.data].every(Number.isFinite))),
      style: actualStyle, safeTooltip: !tooltip.querySelector('img') && tooltip.textContent.includes('<img'),
      explicitEstimates: tooltip.textContent.includes('6000 lm (assumed)') && tooltip.textContent.includes('not measured lux'),
      nightStrength, dayStrength, disabledStrength, lampPixels, dayLampPixels, towerPixels, towerSurfacePixels, objectPixels,
      shared: layer.renderer === tower.renderer, gpuErrors,
    };
  });
  assert.ok(result.count > 100, JSON.stringify(result));
  assert.equal(result.ids, true);
  assert.equal(result.geometry, 18);
  assert.equal(result.surfaceOnly, true);
  assert.deepEqual(result.poleBounds, [3, 11.15]);
  assert.ok(result.expectedPoles > 100);
  assert.equal(result.poleVertices, result.expectedPoles * 144);
  for (const key of ['emitterHeight', 'validBuffers', 'safeTooltip', 'explicitEstimates', 'shared']) {
    assert.equal(result[key], true, key);
  }
  assert.equal(result.nightStrength, 1);
  assert.equal(result.dayStrength, 0);
  assert.equal(result.disabledStrength, 0);
  assert.deepEqual(errors, [], JSON.stringify(result));
  assert.deepEqual(result.gpuErrors, []);
  assert.ok(result.lampPixels > 100, `Actual lamp light pixels: ${JSON.stringify(result)}`);
  assert.ok(result.towerPixels > 20, `Actual tower point-light pixels: ${result.towerPixels}`);
  assert.ok(result.towerPixels < result.towerSurfacePixels * 0.35, `Tower must not glow uniformly: ${JSON.stringify(result)}`);
  assert.ok(result.objectPixels > 50, `Lamp illumination on 3D objects, excluding terrain and sprites: ${result.objectPixels}`);
  assert.ok(result.dayLampPixels > 50, `Solid poles must remain visible in daylight: ${JSON.stringify(result)}`);
  assert.deepEqual(result.gpuErrors, []);
  const control = this.page.getByRole('checkbox', { name: 'Paris streetlights (night)', exact: true });
  await control.uncheck();
  assert.equal(await this.page.evaluate(() => !streetlights._map && streetlights._areas.size === 0), true);
  await control.check();
  await loaded();
  assert.equal(await this.page.evaluate(() =>
    streetlights.root.children.every(mesh => !window.oldLightMeshes.includes(mesh))), true);
  assert.deepEqual(errors, []);
});
