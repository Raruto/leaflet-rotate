import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Given, Then, When } from '@cucumber/cucumber';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';

Given('the interactive regression page is open', { timeout: 30000 }, async function () {
  this.harnessErrors = [];
  this.page.on('pageerror', error => this.harnessErrors.push(error.message));
  await this.page.route(/server\.arcgisonline\.com|tile\.openstreetmap\.org/, route =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' }));
  const version = process.env.LEAFLET_VERSION === '2' ? '2' : '1';
  await this.page.goto(`${this.baseUrl}/test/index.html?leaflet=${version}&maplibre=0&debug=0`, {
    waitUntil: 'domcontentloaded',
  });
  await this.page.waitForFunction(() => window.runScenario && window.scenarios);
  await this.page.evaluate(() => { map.options.inertia = false; });
  assert.match(await this.page.evaluate(() => L.version), version === '2' ? /^2\.0\.0-alpha/ : /^1\.9/);
});

Then('every interactive scenario is listed in the BDD examples', async function () {
  const source = await readFile(new URL('../features/harness.feature', import.meta.url), 'utf8');
  const messages = generateMessages(source, 'harness.feature', SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
    includeGherkinDocument: true,
    includePickles: false,
    includeSource: false,
    newId: IdGenerator.incrementing(),
  });
  const document = messages.find(message => message.gherkinDocument)?.gherkinDocument;
  assert.ok(document, 'Could not parse harness.feature');
  const examples = document.feature.children.flatMap(child =>
    child.scenario?.examples.flatMap(example => {
      const index = example.tableHeader.cells.findIndex(cell => cell.value === 'scenario');
      return example.tableBody.map(row => row.cells[index].value);
    }) || []);
  const scenarios = await this.page.evaluate(() => scenarios.map(scenario => scenario.name));
  assert.equal(new Set(examples).size, examples.length, 'Duplicate BDD examples');
  assert.deepEqual(examples.sort(), scenarios.sort(), 'Interactive scenarios and BDD examples must match');
});

Then('active drags return to their starting position without turning clicks into drags', async function () {
  await this.page.evaluate(() => {
    const parent = document.createElement('div');
    parent.style.cssText = 'position:absolute;z-index:10000;left:100px;top:100px;width:100px;height:100px;transform:scale(2);transform-origin:0 0';
    const element = document.createElement('div');
    element.id = 'returning-drag';
    element.style.cssText = 'width:20px;height:20px;background:red';
    parent.append(element);
    document.body.append(parent);
    const draggable = new L.Draggable(element);
    draggable.enable();
    window.returningDrag = { draggable, parent, element, starts: 0 };
    draggable.on('dragstart', () => returningDrag.starts++);
    L.DomUtil.setPosition(element, new L.Point(0, 0));
  });
  for (const offset of [0, 1]) {
    const rect = await this.page.locator('#returning-drag').boundingBox();
    const start = { x: rect.x + 10, y: rect.y + 10 };
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(start.x + 30, start.y + 30, { steps: 3 });
    await this.page.mouse.move(start.x + offset, start.y);
    await this.page.mouse.up();
    const result = await this.page.evaluate(() => {
      const { element, draggable, starts } = returningDrag;
      const position = L.DomUtil.getPosition(element);
      L.DomUtil.setPosition(element, new L.Point(0, 0));
      return { x: position.x, y: position.y, starts, moving: draggable._moving };
    });
    assert.ok(Math.abs(result.x - offset / 2) < 1e-7, JSON.stringify(result));
    assert.equal(result.y, 0, JSON.stringify(result));
    assert.equal(result.starts, offset + 1, JSON.stringify(result));
    assert.equal(result.moving, false, JSON.stringify(result));
  }
  const rect = await this.page.locator('#returning-drag').boundingBox();
  await this.page.mouse.move(rect.x + 10, rect.y + 10);
  await this.page.mouse.down();
  await this.page.mouse.move(rect.x + 11, rect.y + 10);
  await this.page.mouse.up();
  const click = await this.page.evaluate(() => {
    const { parent, element, draggable, starts } = returningDrag;
    const position = L.DomUtil.getPosition(element);
    draggable.disable();
    parent.remove();
    return { x: position.x, y: position.y, starts };
  });
  assert.deepEqual(click, { x: 0, y: 0, starts: 2 });
});

When('I run the interactive scenario {string}', { timeout: 30000 }, async function (name) {
  this.harnessResult = await this.page.evaluate(async name => {
    const scenario = scenarios.find(scenario => scenario.name === name);
    if (!scenario) throw new Error(`Unknown interactive scenario: ${name}`);
    const initial = { lat: 50, lng: 5, zoom: 5, bearing: 0, pitch: 0, ...scenario.view };
    map.setView([initial.lat, initial.lng], initial.zoom, { animate: false });
    map.setPitch(initial.pitch);
    map.setBearing(initial.bearing);
    const markerLocations = markers.map(marker => marker.getLatLng());
    const probe = new L.CircleMarker([initial.lat, initial.lng], { radius: 4 }).addTo(map);
    const bearings = [];
    const onRotate = () => bearings.push(map.getBearing());
    map.on('rotate', onRotate);
    const anchorProbe = () => {
      if (scenario.anchor) {
        const [x, y] = scenario.anchor[0];
        probe.setLatLng(map.containerPointToLatLng([map.getSize().x * x, map.getSize().y * y]));
      }
    };
    map.once('rotate', anchorProbe);
    const results = await runScenario(scenario);
    map.off('rotate', onRotate);
    map.off('rotate', anchorProbe);
    const [{ end, drift }] = results;
    const center = map.project(map.getCenter());
    if (scenario.goTo) probe.setLatLng(map.getCenter());
    const expected = map.latLngToContainerPoint(probe.getLatLng());
    const rect = probe.getElement().getBoundingClientRect();
    const container = map.getContainer().getBoundingClientRect();
    const vectorError = Math.hypot(
      rect.left + rect.width / 2 - container.left - map.getContainer().clientLeft - expected.x,
      rect.top + rect.height / 2 - container.top - map.getContainer().clientTop - expected.y,
    );
    probe.remove();
    const destination = scenario.goTo;
    const boundsLayer = { Circle: circle, Polygon: polygon, Path: path, 'Rectangle (fit from z 0)': rectangle }[destination];
    return {
      name, initial, end, drift, vectorError, bearings,
      centerMovement: center.distanceTo(map.project([initial.lat, initial.lng], end.zoom)),
      centerError: map.latLngToContainerPoint(map.getCenter()).distanceTo(map.getSize().divideBy(2)),
      markersUnchanged: markers.every((marker, index) => marker.getLatLng().equals(markerLocations[index])),
      dragging: Boolean(map.shiftKeyRotate._dragging || map.dragging._draggable._moving),
      destinationDistance: destination && !boundsLayer ? map.getCenter().distanceTo(new L.LatLng(...places[destination])) : null,
      boundsVisible: boundsLayer ? map.getBounds().contains(boundsLayer.getBounds()) : null,
    };
  }, name);
});

Then('the interactive camera result is {string}', function (outcome) {
  const r = this.harnessResult, details = JSON.stringify(r);
  assert.deepEqual(this.harnessErrors, [], 'Interactive scenario raised a browser error');
  assert.ok(Object.values(r.end).every(Number.isFinite), details);
  assert.ok(r.end.pitch >= 0 && r.end.pitch <= 85, details);
  assert.ok(r.end.bearing >= 0 && r.end.bearing < 360, details);
  assert.equal(r.markersUnchanged, true, details);
  assert.equal(r.dragging, false, details);
  assert.ok(r.centerError < 1.5, details);
  assert.ok(r.vectorError < 3, details);
  if (r.drift !== null) assert.ok(r.drift < 3, details);
  const bearingDelta = ((r.end.bearing - r.initial.bearing + 540) % 360) - 180;
  if (['zoom in', 'zoom out', 'pan', 'navigate'].includes(outcome)) {
    assert.ok(Math.abs(bearingDelta) < 0.1, details);
    assert.ok(Math.abs(r.end.pitch - r.initial.pitch) < 0.1, details);
  }
  switch (outcome) {
    case 'pitch up':
      assert.ok(r.end.pitch > r.initial.pitch + 1, details);
      assert.ok(Math.abs(bearingDelta) < 0.1, details);
      break;
    case 'pitch zero':
      assert.equal(r.end.pitch, 0, details);
      break;
    case 'pitch max':
      assert.ok(Math.abs(r.end.pitch - 85) < 0.1, details);
      break;
    case 'clockwise':
    case 'counterclockwise':
      assert.ok(outcome === 'clockwise' ? bearingDelta > 1 : bearingDelta < -1, details);
      assert.equal(r.end.pitch, r.initial.pitch, details);
      break;
    case 'pitch and bearing':
    case 'rotate then pan':
    case 'zoom and rotate':
      assert.ok(r.bearings.some(bearing => Math.abs(((bearing - r.initial.bearing + 540) % 360) - 180) > 1), details);
      assert.ok(r.end.pitch > r.initial.pitch + 1, details);
      if (outcome === 'zoom and rotate') assert.ok(r.end.zoom > r.initial.zoom, details);
      break;
    case 'shift rotate':
      assert.ok(Math.abs(bearingDelta - 30) < 0.1, details);
      assert.equal(r.end.pitch, r.initial.pitch, details);
      break;
    case 'cancel zoom':
      assert.equal(r.end.zoom, r.initial.zoom, details);
      assert.ok(r.end.pitch > 1 && Math.abs(bearingDelta) > 1, details);
      break;
    case 'zoom in':
    case 'zoom out':
      assert.ok(outcome === 'zoom in' ? r.end.zoom > r.initial.zoom : r.end.zoom < r.initial.zoom, details);
      break;
    case 'pan':
      assert.equal(r.end.zoom, r.initial.zoom, details);
      break;
    case 'navigate':
      if (r.destinationDistance !== null) {
        assert.ok(r.destinationDistance < 1, details);
        assert.equal(r.end.zoom, 10, details);
      } else {
        assert.equal(r.boundsVisible, true, details);
      }
      break;
    default:
      assert.fail(`Unknown camera expectation: ${outcome}`);
  }
  if (!['zoom in', 'zoom out', 'zoom and rotate', 'pan', 'rotate then pan', 'navigate'].includes(outcome)) {
    assert.equal(r.end.zoom, r.initial.zoom, details);
    assert.ok(r.centerMovement < 1.5, details);
  }
});
