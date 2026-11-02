import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Then } from '@cucumber/cucumber';
import { along, scheduledTrips, speed, vehicleOffsets } from '../../../src/3d/utils/traffic.js';
import { trafficHour } from '../../../misc/paris-traffic.js';

const [cruise] = JSON.parse(readFileSync(new URL('../../../misc/seine-cruises.geojson', import.meta.url))).features;
const cruises = date => scheduledTrips(date, cruise.properties.timetable);
const route = cruise.geometry.coordinates;

Then('a 300 m lane with {int} vehicles per hour at {int} m\\/s holds {int} vehicles', function (flow, velocity, count) {
  assert.equal(vehicleOffsets(300, flow, velocity).length, count);
  if (velocity === speed) assert.equal(vehicleOffsets(300, flow).length, count);
});

Then('a 300 m lane holds more than 3 times the vehicles at {int} than at {int} vehicles per hour', function (busy, quiet) {
  assert.ok(vehicleOffsets(300, busy).length > vehicleOffsets(300, quiet).length * 3);
});

Then('every vehicle of a 300 m lane at {int} vehicles per hour lies inside the lane', function (flow) {
  assert.ok(vehicleOffsets(300, flow).every(offset => offset > 0 && offset < 300));
});

const lane = [[0, 0, 10], [100, 0, 20], [100, 50, 20]], distances = [0, 100, 150];
const headings = { east: [1, 0], north: [0, 1] };
Then(/^along a (flat )?lane (\d+) m from the start is at x (\d+), height (\d+), z (\d+) heading (east|north)$/, function (flat, at, x, y, z, heading) {
  const points = flat ? lane.map(([px, pz]) => [px, pz]) : lane;
  const [dx, dz] = headings[heading];
  assert.deepEqual(along(points, distances, Number(at)), { x: Number(x), y: Number(y), z: Number(z), dx, dz });
});

Then('the Paris counting hour for {string} is {string}', function (time, hour) {
  const latest = Date.parse('2026-11-01T23:00:00Z');
  if (hour === 'error') assert.throws(() => trafficHour(time, latest));
  else assert.equal(trafficHour(time, latest).toISOString(), hour);
});

Then('at {string} the cruises in service are {string}', function (time, departures) {
  assert.deepEqual(cruises(time).map(trip => trip.departure), departures ? departures.split(', ') : []);
});

Then('the cruise departing at {string} is halfway at {string}', function (departure, time) {
  assert.equal(cruises(time).find(trip => trip.departure === departure).progress, 0.5);
});

Then('cruise progress grows from {string} to {string}', function (from, to) {
  assert.ok(cruises(to)[0].progress > cruises(from)[0].progress);
});

Then('cruises at {string} fail with {string}', function (time, error) {
  assert.throws(() => cruises(time), new RegExp(error));
});

Then('the cruise route ends where it starts', function () {
  assert.deepEqual(route[0], route.at(-1));
});

Then('the cruise route is between {int} and {int} km long', function (low, high) {
  let length = 0;
  for (let i = 1; i < route.length; i++) {
    const [lng0, lat0] = route[i - 1], [lng, lat] = route[i];
    length += Math.hypot((lat - lat0) * 111200, (lng - lng0) * 111200 * Math.cos(lat * Math.PI / 180));
  }
  // The 60-minute timetable then implies a plausible 3-4.5 m/s cruise speed.
  assert.ok(length > low * 1000 && length < high * 1000, `Route length ${length}`);
});

Then('the cruise route stays between latitudes {float} and {float} and longitudes {float} and {float}', function (south, north, west, east) {
  assert.ok(route.every(([lng, lat]) => lat > south && lat < north && lng > west && lng < east));
});

Then('cruise boats move along the river on scheduled trips and clean up when disabled', { timeout: 90000 }, async function () {
  const errors = [];
  this.page.on('pageerror', error => errors.push(error.message));
  await this.page.waitForFunction(() => cruiseBoats?.renderer);
  const result = await this.page.evaluate(async () => {
    const layer = cruiseBoats, owner = L.Layer.types['3d']._renderers.get(map);
    const { along, scheduledTrips } = await import(new URL('../dist/3d/utils/traffic.js', location.href));
    const [cruise] = (await (await fetch('../misc/seine-cruises.geojson')).json()).features;
    const cruiseRoute = cruise.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const cruiseLengths = cruiseRoute.map((point, i) => i && map.distance(cruiseRoute[i - 1], point));
    cruiseLengths.forEach((length, i) => { if (i) cruiseLengths[i] += cruiseLengths[i - 1]; });
    const cruiseDistance = cruiseLengths.at(-1);
    const cruisePosition = progress => { const { x, z } = along(cruiseRoute, cruiseLengths, progress * cruiseDistance); return [x, z]; };
    // One batched mesh holds every boat; each boat owns a featureFaces vertex range.
    const boats = () => layer.root.children.find(mesh => mesh.extras.featureFaces.length);
    const boatCount = () => boats()?.extras.featureFaces.length ?? 0;
    const stride = () => boats().extras.featureFaces[0].vertexEnd * 3;
    // Boats are placed by a compute pass: read the positions back from the GPU.
    const gpuPositions = async () => {
      const { buffer } = boats().geometry.attributes.position, { device } = owner.renderer;
      const read = device.createBuffer({ size: buffer.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(buffer, 0, read, 0, buffer.size);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(read.getMappedRange().slice(0));
      read.destroy();
      return data;
    };
    const firstBoat = async () => [...(await gpuPositions()).slice(0, stride())];
    const gpuErrors = [];
    owner.renderer.device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    const select = (day, minute) => {
      const container = sunlightOverlay.control.getContainer();
      container.querySelector('input[type=date]').value = day;
      const slider = container.querySelector('input[type=range]');
      slider.value = String(minute); slider.dispatchEvent(new Event('input', { bubbles: true }));
      owner._render();
    };
    select('2026-11-02', 120);
    const nightCount = boatCount();
    const route = layer.root.children[0];
    const routeAtNight = route.geometry.drawRange.count > 100 && route.visible && route.extras.featureFaces.length === 0 &&
      route.program.depthTest === false && route.program.depthWrite === false;
    select('2026-11-02', 555); // 09:15 UTC = first winter departure 10:15 Paris.
    const firstPosition = await firstBoat();
    select('2026-11-02', 565);
    const moved = (await firstBoat()).some((value, i) => value !== firstPosition[i]);
    const manualPosition = await firstBoat();
    await new Promise(resolve => setTimeout(resolve, 600));
    const frozen = (await firstBoat()).every((value, i) => value === manualPosition[i]);
    select('2026-11-02', 600);
    const twoTrips = boatCount();
    const properties = boats().extras.featureFaces.map(face => face.properties);
    // The hull's first vertex sits 0.1 m above the water surface.
    const positions = await gpuPositions();
    const heights = boats().extras.featureFaces.map(face => positions[face.vertexStart * 3 + 1] - 0.1 + layer.root.position[1]);
    // The CPU copy used for picking must match the compute pass.
    layer.raycast({ clientX: 0, clientY: 0 });
    const cpuMatchesGpu = boats().geometry.attributes.position.data.every((value, i) => Math.abs(value - positions[i]) < 1e-3);
    const finite = positions.every(Number.isFinite) && layer.root.children.every(mesh =>
      Object.values(mesh.geometry.attributes).every(attribute => [...attribute.data].every(Number.isFinite)));
    const tooltip = layer.options.tooltipContent({ properties: properties[0] }).textContent;
    const shared = layer.renderer === streetlights.renderer;
    const noDuplicateNodes = new Set(boats().extras.featureFaces.map(face => face.id)).size === twoTrips;
    select('2026-06-21', 600);
    // Exercise live ticking with a deterministic clock in an operating interval.
    const OriginalDate = Date, start = OriginalDate.parse('2026-06-21T10:00:01Z'), wall = performance.now();
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [start + performance.now() - wall])); }
      static now() { return start + performance.now() - wall; }
    };
    let liveMoved;
    try {
      sunlightOverlay.control.getContainer().querySelector('button').click();
      await new Promise(resolve => setTimeout(resolve, 350));
      const before = await firstBoat();
      await new Promise(resolve => setTimeout(resolve, 600));
      liveMoved = (await firstBoat()).some((value, i) => value !== before[i]);
    } finally { window.Date = OriginalDate; sunlightOverlay.control.live = false; }
    select('2026-11-02', 1290);
    const closed = boatCount() === 0 && layer.root.children.length === 1 && layer.root.children[0] === route;
    select('2026-11-02', 600);
    layer._setHighlight({ ...boats().extras.featureFaces[0], mesh: boats() });
    select('2026-11-02', 660);
    const clearedHighlight = !layer.highlightedFeature;
    const date = sunlightOverlay.control.getContainer().querySelector('input[type=date]');
    date.value = ''; date.dispatchEvent(new Event('change'));
    const invalidClears = boatCount() === 0;
    select('2026-11-02', 600);
    const recovered = boatCount() === 2 && boats().visible;
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
      if (map._terrain3D._getElevation(position) > 27.18) covered += 10;
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
    map.setPitch(45); map.setBearing(25); map.setView(cruisePosition(scheduledTrips('2026-11-02T10:00:00Z', cruise.properties.timetable)[0].progress), 19, { animate: false });
    const visible = await capture();
    boats().visible = false;
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
    return { nightCount, moved, frozen, twoTrips, properties, heights, finite, cpuMatchesGpu, tooltip, shared,
      noDuplicateNodes, liveMoved, closed, gpuErrors, routeAtNight,
      invalidClears, recovered, clearedHighlight, boatPixels, routePixels, riverCoverage, overviewRoutePixels };
  });
  assert.equal(result.nightCount, 0);
  assert.equal(result.twoTrips, 2);
  assert.deepEqual(result.properties.map(trip => trip.departure), ['10:15', '11:00']);
  assert.ok(result.heights.every(height => Math.abs(height - 27.15) < 1e-4), String(result.heights));
  for (const key of ['moved', 'frozen', 'finite', 'cpuMatchesGpu', 'shared', 'noDuplicateNodes', 'liveMoved',
    'closed', 'routeAtNight', 'invalidClears', 'recovered', 'clearedHighlight']) {
    assert.equal(result[key], true, key);
  }
  assert.match(result.tooltip, /not live GPS/);
  assert.deepEqual(result.gpuErrors, []);
  assert.ok(result.boatPixels > 50, `Visible boat pixels: ${result.boatPixels}`);
  assert.ok(result.routePixels > 50, `Visible route pixels: ${result.routePixels}`);
  assert.ok(result.overviewRoutePixels > 100, `Visible route in overview: ${result.overviewRoutePixels}`);
  assert.ok(result.riverCoverage < 0.01, `Less than 1% terrain occlusion (e.g. bridge decks): ${result.riverCoverage}`);
  const control = this.page.getByRole('checkbox', { name: 'Bateaux-Mouches', exact: true });
  await control.uncheck();
  assert.equal(await this.page.evaluate(() => !cruiseBoats._map && !cruiseBoats.root.children.length &&
    [...document.querySelectorAll('.traffic-status')].some(status => status.textContent === 'Cruises: layer off')), true);
  await control.check();
  await this.page.waitForFunction(() => cruiseBoats.root.children.length === 2);
  assert.equal(await this.page.evaluate(() => cruiseBoats.root.children.every(mesh =>
    Object.values(mesh.geometry.attributes).every(a => !previousBoatBuffers.includes(a.buffer)))), true);
  // Without a clock the boats run live on the current timetable.
  await this.page.evaluate(() => map.removeLayer(sunlightOverlay));
  assert.equal(await this.page.evaluate(async () => {
    const { scheduledTrips } = await import(new URL('../dist/3d/utils/traffic.js', location.href));
    const [cruise] = (await (await fetch('../misc/seine-cruises.geojson')).json()).features;
    await new Promise(requestAnimationFrame);
    const boats = cruiseBoats.root.children.find(mesh => mesh.extras.featureFaces.length);
    return (boats?.extras.featureFaces.length ?? 0) === scheduledTrips(new Date(), cruise.properties.timetable).length;
  }), true);
  assert.deepEqual(errors, []);
});
