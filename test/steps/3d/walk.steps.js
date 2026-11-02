import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';

Then('keyboard walking moves toward a wall, stops at it and can move away', { timeout: 30000 }, async function () {
  const errors = [];
  this.page.on('pageerror', error => errors.push(error.message));
  await this.page.evaluate(async () => {
    const map = test3d.map;
    map.setBearing(0);
    const wall = new L.Layer({ source: { type: '3d' } }).addTo(map);
    await nativeChecks.ready(wall);
    wall._createMesh({
      position: [-10, 0, -4, 10, 0, -4, 10, 4, -4, -10, 0, -4, 10, 4, -4, -10, 4, -4],
      normal: Array(6).fill([0, 0, 1]).flat(),
      color: Array(18).fill(0.5),
    });
    const walk = new L.Layer({ source: { type: 'walk', speed: 6 } }).addTo(map);
    await nativeChecks.ready(walk);
  });
  const button = this.page.getByRole('button', { name: 'Walk', exact: true });
  await button.click();
  await this.page.waitForFunction(() => {
    const walk = Object.values(test3d.map._layers).find(layer => layer instanceof L.Layer.types.walk);
    return walk.root.children.length === 5;
  });
  const start = await this.page.evaluate(() => {
    const walk = Object.values(test3d.map._layers).find(layer => layer instanceof L.Layer.types.walk);
    return { lat: walk.walker.latlng.lat, phase: walk.walker.phase };
  });
  await this.page.keyboard.down('KeyW');
  try {
    await this.page.waitForFunction(lat => {
      const walk = Object.values(test3d.map._layers).find(layer => layer instanceof L.Layer.types.walk);
      return (walk.walker.latlng.lat - lat) * 111320 > 0.5;
    }, start.lat);
    await this.page.waitForTimeout(1200);
  } finally {
    await this.page.keyboard.up('KeyW');
  }
  const stopped = await this.page.evaluate(() => {
    const walk = Object.values(test3d.map._layers).find(layer => layer instanceof L.Layer.types.walk);
    return { lat: walk.walker.latlng.lat, phase: walk.walker.phase, center: test3d.map.getCenter().lat };
  });
  const travelled = (stopped.lat - start.lat) * 111320;
  assert.ok(travelled > 2.5 && travelled < 4, `Stopped before the 4 m wall: ${travelled} m`);
  assert.ok(stopped.phase > start.phase, 'Walking advances the limb animation');
  assert.deepEqual(errors, [], 'Keyboard movement must not throw during collision checks');
  assert.ok(Math.abs(stopped.center - stopped.lat) < 1e-6, `The map follows the walker: ${JSON.stringify(stopped)}`);
  await this.page.keyboard.down('KeyS');
  try {
    await this.page.waitForFunction(lat => {
      const walk = Object.values(test3d.map._layers).find(layer => layer instanceof L.Layer.types.walk);
      return (lat - walk.walker.latlng.lat) * 111320 > 0.5;
    }, stopped.lat);
  } finally {
    await this.page.keyboard.up('KeyS');
  }
  await this.page.keyboard.press('Escape');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, [], 'Keyboard movement must not throw during collision checks');
});

Then('the walk layer moves the pedestrian on Pont d\'Iéna, stops it at walls and Esc restores the map', { timeout: 90000 }, async function () {
  await this.page.waitForFunction(() => map._terrain3D?._bridgeMesh, null, { timeout: 30000 });
  // Pont d'Iéna deck, about 9 m above the DEM's riverbed.
  await this.page.evaluate(() => map.setView([48.8597, 2.2924], 17, { animate: false }));
  const before = await this.page.evaluate(() => ({ zoom: map.getZoom(), pitch: map.getPitch() }));
  const button = this.page.getByRole('button', { name: 'Walk', exact: true });
  // Not in the layers control: a map button outside it.
  assert.equal(await this.page.locator('.leaflet-control-layers').getByText('Walk', { exact: true }).count(), 0);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await this.page.waitForFunction(() => {
    const walk = Object.values(map._layers).find(layer => layer instanceof L.Layer.types.walk);
    return walk.walker.latlng && walk.root.children.length === 5;
  });
  const state = () => this.page.evaluate(() => {
    const walk = Object.values(map._layers).find(layer => layer instanceof L.Layer.types.walk), [body] = walk.root.children;
    return {
      ...walk.walker.latlng, heading: walk.walker.heading, bearing: map.getBearing(), pitch: map.getPitch(),
      dragging: map.dragging.enabled(), center: map.getCenter(),
      feet: body.position[1] + walk.root.position[1], deck: map._terrain3D._getElevation(walk.walker.latlng),
    };
  });
  const start = await state();
  assert.equal(start.pitch, 75);
  assert.equal(start.dragging, false);
  assert.ok(start.deck > 35 && start.deck < 37, `Deck elevation: ${start.deck}`);
  assert.ok(Math.abs(start.feet - start.deck) < 0.01, `Feet ${start.feet} on deck ${start.deck}`);

  await this.page.keyboard.down('KeyW');
  await this.page.waitForTimeout(1500);
  await this.page.keyboard.up('KeyW');
  const walked = await state();
  const north = (walked.lat - start.lat) * 111320, east = (walked.lng - start.lng) * 111320 * Math.cos(start.lat * Math.PI / 180);
  const view = -start.bearing * Math.PI / 180;
  assert.ok(Math.hypot(north, east) > 1, `Walked ${Math.hypot(north, east)} m`);
  assert.ok((north * Math.cos(view) + east * Math.sin(view)) / Math.hypot(north, east) > 0.99, 'W walks along the view direction');
  assert.ok(Math.abs(walked.center.lat - walked.lat) < 1e-6 && Math.abs(walked.center.lng - walked.lng) < 1e-6, 'The camera follows the walker');

  const box = await this.page.locator('#map').boundingBox();
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.down();
  await this.page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
  await this.page.mouse.up();
  const looked = await state();
  assert.ok(Math.abs(looked.bearing - walked.bearing - 25) < 0.5, `Drag turns the camera: ${walked.bearing} -> ${looked.bearing}`);
  assert.ok(Math.abs(looked.lat - walked.lat) < 1e-9 && Math.abs(looked.lng - walked.lng) < 1e-9, 'Dragging does not move the walker');

  await this.page.keyboard.down('KeyD');
  await this.page.keyboard.down('KeyW');
  await this.page.waitForTimeout(600);
  await this.page.keyboard.up('KeyD');
  await this.page.waitForTimeout(1500);
  await this.page.keyboard.up('KeyW');
  const turned = await state();
  const behind = Math.abs(((-turned.heading * 180 / Math.PI - turned.bearing) % 360 + 540) % 360 - 180);
  assert.ok(turned.heading > looked.heading + 0.5, `D turns right: ${looked.heading} -> ${turned.heading}`);
  assert.ok(behind < 5, `The camera follows behind the walker: ${behind}°`);

  // Champ de Mars side street: running south ends against a building facade (after sliding along it).
  await this.page.evaluate(() => {
    const walk = Object.values(map._layers).find(layer => layer instanceof L.Layer.types.walk);
    walk.walker.latlng = new L.LatLng(48.8560, 2.2950);
    walk.walker.heading = Math.PI;
  });
  await this.page.keyboard.down('KeyW');
  let previous, stuck;
  for (let i = 0; i < 100 && !stuck; i++) {
    await this.page.waitForTimeout(300);
    const { lat, lng } = await state();
    stuck = previous && Math.hypot(lat - previous.lat, lng - previous.lng) < 1e-7;
    previous = { lat, lng };
  }
  await this.page.keyboard.up('KeyW');
  const south = (48.8560 - previous.lat) * 111320;
  assert.ok(stuck, 'A building stops the walker');
  assert.ok(south > 40 && south < 120, `Stopped ${south} m south, at the facade`);

  await this.page.keyboard.press('Escape');
  const after = await this.page.evaluate(() => ({
    dragging: map.dragging.enabled(), zoom: map.getZoom(), pitch: map.getPitch(),
    meshes: Object.values(map._layers).find(layer => layer instanceof L.Layer.types.walk).root.children.length,
  }));
  assert.deepEqual(after, { dragging: true, zoom: before.zoom, pitch: before.pitch, meshes: 0 });
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  // The button toggles too.
  await button.click();
  assert.equal(await this.page.evaluate(() => map.dragging.enabled()), false);
  await button.click();
  assert.equal(await this.page.evaluate(() => map.dragging.enabled()), true);
});
