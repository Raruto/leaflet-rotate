import assert from 'node:assert/strict';
import { After, Given, Then, When } from '@cucumber/cucumber';

After({ tags: '@navigation-bounds' }, function () {
  assert.deepEqual(this.navigationErrors, [], 'No browser errors during navigation');
});

Given('a map with the Paris navigation limits is open', { timeout: 30000 }, async function () {
  this.navigationErrors = [];
  this.page.on('pageerror', error => this.navigationErrors.push(error.message));
  await this.page.clock.install();
  const version = process.env.LEAFLET_VERSION === '2' ? '2.0.0-alpha.1' : '1.9.4';
  const script = process.env.LEAFLET_VERSION === '2' ? 'leaflet-global-src.js' : 'leaflet-src.js';
  await this.page.route('**/test/navigation-bounds.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@${version}/dist/leaflet.css">
      <script src="https://unpkg.com/leaflet@${version}/dist/${script}"></script>
      <script>globalThis.L = globalThis.leaflet || globalThis.L;</script>
      <script src="../dist/leaflet-rotate-src.js"></script>
      </head><body style="margin:0"><div id="map" style="width:800px;height:600px"></div></body></html>`,
  }));
  await this.page.goto(`${this.baseUrl}/test/navigation-bounds.html`);
});

When('navigation rotation is {word} with bearing {int} and pitch {int}', async function (enabled, bearing, pitch) {
  this.navigationOptions = { rotate: enabled === 'true', bearing, pitch };
  await this.page.evaluate(options => {
    window.map = new L.Map('map', {
      ...options, center: [48.8582601, 2.29449985], zoom: 17,
      minZoom: 14, maxZoom: 20, maxBounds: [[48.8162, 2.2424], [48.9022, 2.416]],
      maxBoundsViscosity: 1, inertia: false, zoomAnimation: false,
      rotateControl: false, touchZoom: true, touchRotate: false, touchPitch: false,
      bounceAtZoomLimits: false,
    });
    window.navigationSnapshot = () => {
      const size = map.getSize();
      const [min, max] = map._rotate ? map._getPitchedContainerBounds(0) : [new L.Point(0, 0), size];
      const footprint = new L.Bounds([
        [min.x, min.y], [max.x, min.y], [min.x, max.y], [max.x, max.y],
      ].map(point => map.project(map.containerPointToLatLng(point))));
      const bounds = map.options.maxBounds;
      const limits = new L.Bounds(map.project(bounds.getNorthWest()), map.project(bounds.getSouthEast()));
      const errors = ['x', 'y'].map(axis => {
        if (footprint.getSize()[axis] > limits.getSize()[axis]) {
          // Leaflet centers an oversized viewport, leaving equal overhang on both sides.
          return Math.abs(footprint.getCenter()[axis] - limits.getCenter()[axis]);
        }
        return Math.max(0, limits.min[axis] - footprint.min[axis], footprint.max[axis] - limits.max[axis]);
      });
      return { error: Math.max(...errors), center: map.getCenter(), zoom: map.getZoom(),
        footprint: { min: footprint.min, max: footprint.max }, limits: { min: limits.min, max: limits.max } };
    };
  }, this.navigationOptions);
});

Then('minimum zoom 14 applies to view changes, wheel zoom and pinch zoom', async function () {
  const zooms = await this.page.evaluate(async () => {
    const zooms = [];
    for (const operation of [
      () => map.setView(map.getCenter(), 1, { animate: false }),
      () => map.setZoom(1, { animate: false }),
      () => map.zoomOut(10),
      () => map.setZoomAround([200, 400], 1),
      () => map.fitBounds([[40, -10], [55, 10]], { animate: false }),
    ]) {
      map.setZoom(17, { animate: false });
      operation();
      zooms.push(map.getZoom());
    }
    map.setZoom(14, { animate: false });
    return zooms;
  });
  assert.deepEqual(zooms.slice(0, 4), [14, 14, 14, 14]);
  assert.ok(zooms[4] >= 14, `fitBounds zoom: ${zooms[4]}`);
  await this.page.mouse.move(400, 300);
  await this.page.mouse.wheel(0, 2000);
  await this.page.waitForTimeout(200);
  assert.equal(await this.page.evaluate(() => map.getZoom()), 14);
  const pinch = await this.page.evaluate(async () => {
    const touch = (x, id) => new Touch({ identifier: id, target: map.getContainer(), clientX: x, clientY: 300 });
    const dispatch = (type, xs) => map.getContainer().dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: xs.map((x, id) => touch(x, id)),
    }));
    dispatch('touchstart', [200, 600]);
    dispatch('touchmove', [350, 450]);
    const during = map.getZoom();
    dispatch('touchend', []);
    await new Promise(requestAnimationFrame);
    return { during, after: map.getZoom() };
  });
  assert.deepEqual(pinch, { during: 14, after: 14 });
});

Then('maximum bounds constrain programmatic pans and camera changes', { timeout: 30000 }, async function () {
  const checks = await this.page.evaluate(async () => {
    const checks = [];
    const record = name => checks.push({ name, ...navigationSnapshot() });
    const settle = async () => {
      while (map._panAnim?._inProgress) await new Promise(requestAnimationFrame);
    };
    for (const location of [[48.92, 2.20], [48.92, 2.46], [48.78, 2.20], [48.78, 2.46]]) {
      map.setView(location, 17, { animate: false });
      await settle();
      record('setView');
      map.panTo(location, { animate: false });
      await settle();
      record('panTo');
    }
    for (const offset of [[2000, 0], [-2000, 0], [0, 2000], [0, -2000]]) {
      map.panBy(offset, { animate: false });
      await settle();
      record('panBy');
      const limited = map._limitOffset(new L.Point(...offset), map.options.maxBounds);
      map.panBy(limited, { animate: false });
      await settle();
      record('inertia offset');
    }
    if (map._rotate) {
      for (const [bearing, pitch] of [[45, 0], [135, 45], [270, 85], [0, 0]]) {
        map.setBearing(bearing);
        map.setPitch(pitch);
        await settle();
        record('camera change');
      }
    }
    map.setZoom(14, { animate: false });
    await settle();
    record('minimum zoom / oversized viewport');
    return checks;
  });
  for (const check of checks) assert.ok(check.error <= 2, JSON.stringify(check));
});

async function drag(page, offset, viscosity, inertia = false) {
  await page.evaluate(({ viscosity, inertia }) => {
    map.options.maxBoundsViscosity = viscosity;
    map.options.inertia = inertia;
    map.setView([48.8582601, 2.29449985], 15, { animate: false });
    window.navigationDragFrames = [];
    window.navigationInertiaFrames = [];
    window.navigationReleased = false;
    map.once('dragend', () => { window.navigationReleased = true; });
    window.navigationMoveDone = new Promise(resolve => map.once('moveend', resolve));
    map.off('drag', window.recordNavigationDrag);
    map.off('move', window.recordNavigationInertia);
    window.recordNavigationDrag = () => navigationDragFrames.push(navigationSnapshot());
    window.recordNavigationInertia = () => {
      if (navigationReleased) navigationInertiaFrames.push(navigationSnapshot());
    };
    map.on('drag', recordNavigationDrag);
    map.on('move', recordNavigationInertia);
  }, { viscosity, inertia });
  if (inertia) {
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 100);
  }
  await page.mouse.move(320, 450);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(320 + offset[0] * step / 8, 450 + offset[1] * step / 8);
    if (inertia) await page.clock.runFor(16);
    else if (step < 8) await page.waitForTimeout(10);
  }
  await page.mouse.up();
  if (inertia) await page.clock.resume();
  await page.evaluate(() => navigationMoveDone);
  await page.waitForFunction(() => !map._panAnim?._inProgress && !map.dragging.moving());
  return { during: await page.evaluate(() => navigationDragFrames), after: await page.evaluate(() => navigationSnapshot()),
    inertia: await page.evaluate(() => navigationInertiaFrames) };
}

Then('viscosity 1 prevents crossing maximum bounds during a mouse drag', { timeout: 30000 }, async function () {
  for (const offset of [[3000, 0], [-3000, 0], [0, 900], [0, -100]]) {
    const result = await drag(this.page, offset, 1);
    assert.ok(result.during.length > 0, 'Expected actual mouse drag frames');
    for (const frame of [...result.during, result.after]) assert.ok(frame.error <= 2, JSON.stringify(frame));
  }
});

Then('viscosities 0 and 0.5 allow progressively less overshoot', { timeout: 30000 }, async function () {
  const free = await drag(this.page, [3000, 0], 0);
  const viscous = await drag(this.page, [3000, 0], 0.5);
  const freeError = free.during.at(-1).error;
  const viscousError = viscous.during.at(-1).error;
  assert.ok(freeError > 20, JSON.stringify(free));
  assert.ok(viscousError > 2 && viscousError < freeError, JSON.stringify({ freeError, viscousError }));
  for (const result of [free, viscous]) assert.ok(result.after.error <= 2, JSON.stringify(result.after));
});

Then('maximum bounds are restored after drag inertia', { timeout: 30000 }, async function () {
  const result = await drag(this.page, [80, 20], 1, true);
  assert.ok(result.inertia.length > 0, 'Expected movement after releasing the drag');
  assert.ok(result.after.error <= 2, JSON.stringify(result.after));
});
