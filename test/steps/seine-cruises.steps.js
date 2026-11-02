import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';

Then('cruise boats move along the river on scheduled trips and clean up when disabled', { timeout: 90000 }, async function () {
  const errors = [];
  this.page.on('pageerror', error => errors.push(error.message));
  await this.page.waitForFunction(() => cruiseBoats?.renderer);
  const result = await this.page.evaluate(async () => {
    const layer = cruiseBoats, owner = L.Layer.types['3d']._renderers.get(map);
    const boatMeshes = () => layer.root.children.filter(mesh => mesh.extras.featureFaces.length);
    const gpuErrors = [];
    owner.renderer.device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    const select = (day, minute) => {
      const container = sunlightControl.getContainer();
      container.querySelector('input[type=date]').value = day;
      const slider = container.querySelector('input[type=range]');
      slider.value = String(minute); slider.dispatchEvent(new Event('input', { bubbles: true }));
      owner._render();
    };
    select('2026-11-02', 120);
    const nightCount = boatMeshes().length;
    const route = layer.root.children[0];
    const routeAtNight = route.geometry.drawRange.count > 100 && route.visible && route.extras.featureFaces.length === 0 &&
      route.program.depthTest === false && route.program.depthWrite === false;
    select('2026-11-02', 555); // 09:15 UTC = first winter departure 10:15 Paris.
    const first = boatMeshes()[0];
    const firstPosition = [...first.position];
    select('2026-11-02', 565);
    const moved = first.position.some((value, i) => value !== firstPosition[i]);
    const manualPosition = [...first.position];
    await new Promise(resolve => setTimeout(resolve, 600));
    const frozen = first.position.every((value, i) => value === manualPosition[i]);
    select('2026-11-02', 600);
    const twoTrips = boatMeshes().length;
    const properties = boatMeshes().map(mesh => mesh.extras.featureFaces[0].properties);
    const heights = boatMeshes().map(mesh => mesh.position[1] + layer.root.position[1]);
    const finite = layer.root.children.every(mesh =>
      Object.values(mesh.geometry.attributes).every(attribute => [...attribute.data].every(Number.isFinite)));
    const tooltip = layer.options.tooltipContent({ properties: properties[0] }).textContent;
    const shared = layer.renderer === streetlights.renderer;
    const noDuplicateNodes = new Set(boatMeshes().map(mesh => mesh.id)).size === twoTrips;
    const checkbox = sunlightControl.getContainer().querySelector('input[type=checkbox]');
    checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));
    const independentOfLighting = boatMeshes().length === twoTrips;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    select('2026-06-21', 600);
    const firstSummer = boatMeshes()[0];
    // Exercise live ticking with a deterministic clock in an operating interval.
    const OriginalDate = Date, start = OriginalDate.parse('2026-06-21T10:00:01Z'), wall = performance.now();
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [start + performance.now() - wall])); }
      static now() { return start + performance.now() - wall; }
    };
    let liveMoved;
    try {
      sunlightControl.getContainer().querySelector('button').click();
      await new Promise(resolve => setTimeout(resolve, 350));
      const before = [...firstSummer.position];
      await new Promise(resolve => setTimeout(resolve, 600));
      liveMoved = firstSummer.position.some((value, i) => value !== before[i]);
    } finally { window.Date = OriginalDate; sunlightControl.live = false; }
    select('2026-11-02', 1290);
    const closed = boatMeshes().length === 0 && layer.root.children[0] === route;
    select('2026-11-02', 600);
    const old = boatMeshes()[0];
    layer._setHighlight({ mesh: old, vertexStart: 0, vertexEnd: old.geometry.drawRange.count });
    select('2026-11-02', 660);
    const clearedHighlight = !layer.highlightedFeature;
    const date = sunlightControl.getContainer().querySelector('input[type=date]');
    date.value = ''; date.dispatchEvent(new Event('change'));
    const invalidClears = boatMeshes().length === 0;
    select('2026-11-02', 600);
    const recovered = boatMeshes().length === 2 && boatMeshes().every(mesh => mesh.visible);
    const trip = boatMeshes()[0].extras.featureFaces[0].properties;
    const renderer = owner.renderer, { device } = renderer;
    renderer.context.configure({ device, format: renderer.format, alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const capture = async () => {
      owner._render();
      const width = renderer.canvas.width, height = renderer.canvas.height;
      const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: renderer.context.getCurrentTexture() }, { buffer, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap(); buffer.destroy();
      return pixels;
    };
    let covered = 0;
    for (let distance = 0; distance < cruiseDistance; distance += 10) {
      const position = cruisePosition(distance / cruiseDistance);
      if (map._terrain3D._getElevation([position.lat, position.lng]) > 27.18) covered += 10;
    }
    const riverCoverage = covered / cruiseDistance;
    map.setPitch(0); map.setBearing(0); map.fitBounds(cruiseRoute, { animate: false });
    const overview = await capture();
    route.visible = false;
    const overviewNoRoute = await capture();
    let overviewRoutePixels = 0;
    for (let i = 0; i < overview.length; i += 4) {
      if (Math.abs(overview[i] - overviewNoRoute[i]) + Math.abs(overview[i + 1] - overviewNoRoute[i + 1]) +
        Math.abs(overview[i + 2] - overviewNoRoute[i + 2]) > 15) overviewRoutePixels++;
    }
    route.visible = true;
    map.setPitch(45); map.setBearing(25); map.setView([trip.lat, trip.lng], 19, { animate: false });
    const visible = await capture();
    for (const mesh of boatMeshes()) mesh.visible = false;
    const noBoats = await capture();
    route.visible = false;
    const noRoute = await capture();
    let boatPixels = 0, routePixels = 0;
    for (let i = 0; i < visible.length; i += 4) {
      if (Math.abs(visible[i] - noBoats[i]) + Math.abs(visible[i + 1] - noBoats[i + 1]) +
        Math.abs(visible[i + 2] - noBoats[i + 2]) > 15) boatPixels++;
      if (Math.abs(noRoute[i] - noBoats[i]) + Math.abs(noRoute[i + 1] - noBoats[i + 1]) +
        Math.abs(noRoute[i + 2] - noBoats[i + 2]) > 15) routePixels++;
    }
    for (const mesh of layer.root.children) mesh.visible = true;
    window.previousBoatBuffers = layer.root.children.flatMap(mesh => Object.values(mesh.geometry.attributes).map(a => a.buffer));
    await owner.renderer.device.queue.onSubmittedWorkDone();
    return { nightCount, moved, frozen, twoTrips, properties, heights, finite, tooltip, shared,
      noDuplicateNodes, independentOfLighting, liveMoved, closed, gpuErrors, routeAtNight,
      invalidClears, recovered, clearedHighlight, boatPixels, routePixels, riverCoverage, overviewRoutePixels };
  });
  assert.equal(result.nightCount, 0);
  assert.equal(result.twoTrips, 2);
  assert.deepEqual(result.properties.map(trip => trip.departure), ['10:15', '11:00']);
  assert.ok(result.heights.every(height => Math.abs(height - 27.15) < 1e-8));
  for (const key of ['moved', 'frozen', 'finite', 'shared', 'noDuplicateNodes', 'independentOfLighting', 'liveMoved',
    'closed', 'routeAtNight', 'invalidClears', 'recovered', 'clearedHighlight']) {
    assert.equal(result[key], true, key);
  }
  assert.match(result.tooltip, /not live GPS/);
  assert.deepEqual(result.gpuErrors, []);
  assert.ok(result.boatPixels > 50, `Visible boat pixels: ${result.boatPixels}`);
  assert.ok(result.routePixels > 50, `Visible route pixels: ${result.routePixels}`);
  assert.ok(result.overviewRoutePixels > 100, `Visible route in overview: ${result.overviewRoutePixels}`);
  assert.ok(result.riverCoverage < 0.01, `Less than 1% terrain occlusion (e.g. bridge decks): ${result.riverCoverage}`);
  const control = this.page.getByRole('checkbox', { name: 'Seine tourist boats (scheduled)', exact: true });
  await control.uncheck();
  assert.equal(await this.page.evaluate(() => !cruiseBoats._map && !cruiseBoats.root.children.length &&
    document.querySelector('.cruise-status').textContent.includes('off')), true);
  await control.check();
  await this.page.waitForFunction(() => cruiseBoats.root.children.length === 3);
  assert.equal(await this.page.evaluate(() => cruiseBoats.root.children.every(mesh =>
    Object.values(mesh.geometry.attributes).every(a => !previousBoatBuffers.includes(a.buffer)))), true);
  await this.page.evaluate(() => map.removeLayer(sunlightOverlay));
  assert.equal(await this.page.evaluate(() => cruiseBoats.root.children.length === 1), true);
  assert.deepEqual(errors, []);
});
