import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';

Given('a standalone pitched map is open', async function () {
  const leaflet = process.env.LEAFLET_VERSION === '2'
    ? '<script src="https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet-global-src.js"></script><script>globalThis.L = globalThis.leaflet;</script>'
    : '<script src="https://unpkg.com/leaflet@1.9/dist/leaflet-src.js"></script>';
  await this.page.goto(`${this.baseUrl}/test/index.html`);
  await this.page.setContent(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <base href="${this.baseUrl}/">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@${process.env.LEAFLET_VERSION === '2' ? '2.0.0-alpha.1' : '1.9'}/dist/leaflet.css">
        ${leaflet}
        <script src="dist/leaflet-rotate-src.js"></script>
      </head>
      <body>
        <div id="first" style="width:400px;height:300px"></div>
        <script>
          window.testPitch = { map: new L.Map('first', {
            center: [48.8582601, 2.29449985], zoom: 17, rotate: true, pitch: 45, bearing: 30,
          }) };
        </script>
      </body>
    </html>`);
  await this.page.waitForFunction(() => window.testPitch);
  assert.equal(await this.page.evaluate(() => L.Layer.types), undefined);
});

Then('raster perspective follows pitch on late and reattached layers', async function () {
  const result = await this.page.evaluate(() => {
    const map = testPitch.map, checks = [];
    const pane = map.createPane('lateRaster', map._rotatePane);
    const first = new L.GridLayer({ pane: 'lateRaster', updateWhenIdle: true }).addTo(map);
    const second = new L.GridLayer({ pane: 'lateRaster' }).addTo(map);
    const check = () => {
      const expected = 'preserve-3d';
      checks.push([map._rotatePane, pane, first._container, second._container]
        .every(el => el.style.transformStyle === expected));
      checks.push(getComputedStyle(map._mapPane).transformStyle === 'preserve-3d');
      checks.push([first, second].every(layer => Object.values(layer._levels)
        .every(level => getComputedStyle(level.el).transformStyle === 'flat')));
    };
    check();
    map.setPitch(0); check();
    first.remove();
    map.setPitch(75);
    first.addTo(map); check();
    map.setPitch(0); check();
    map.setPitch(45); check();
    first.remove(); second.remove();
    pane.remove();
    return checks;
  });
  assert.ok(result.every(Boolean), 'Late layers, custom panes and updateWhenIdle must follow pitch');
});


Then('pitched raster surfaces draw loaded tiles after rapid camera changes', { timeout: 30000 }, async function () {
  await this.page.addStyleTag({ content: '.leaflet-control { display: none; }' });
  const png = await this.page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 256, 256);
    return canvas.toDataURL().split(',')[1];
  });
  await this.page.route(/\/pitched-tile\.png/, async route => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
  });
  await this.page.evaluate(() => {
    const map = testPitch.map;
    map.getContainer().style.width = '1000px';
    map.getContainer().style.height = '731px';
    map.invalidateSize({ animate: false });
    map.setView([48.85478060234936, 2.28643600540333], 17, { animate: false });
    testPitch.tiles = new L.TileLayer('/pitched-tile.png?{z}/{x}/{y}', { maxNativeZoom: 17 }).addTo(map);
  });
  await this.page.waitForFunction(() => !testPitch.tiles.isLoading());
  await this.page.evaluate(() => {
    const map = testPitch.map, layer = testPitch.tiles, level = layer._levels[layer._tileZoom];
    map._setPitchAndBearing(60.5, 152.98861657457235);
    level.origin = new L.Point(16990718, 11542325);
    L.DomUtil.setTransform(level.el, new L.Point(-1816, 672), 1);
    for (const tile of Object.values(layer._tiles)) {
      L.DomUtil.setPosition(tile.el, new L.Point(tile.coords.x, tile.coords.y).scaleBy(layer.getTileSize()).subtract(level.origin));
    }
    map._pixelOrigin = new L.Point(16992534, 11541653);
    L.DomUtil.setPosition(map._mapPane, new L.Point(-670, 1433));
    map._setPitchTransform('matrix3d(-1.3127, 0.608476, 0.395287, -0.000360499, 0.373224, -1.19361, -0.775414, 0.000707172, -0.525431, -0.390956, 0.492424, -0.000449087, -2578.6, 2999.53, 2642.09, -1.40956)');
  });
  const checkPixels = async () => {
    await this.page.waitForFunction(() => !testPitch.map._animatingZoom &&
      !testPitch.map._bearingAnimationFrame && !testPitch.map._panAnim?._inProgress);
    await this.page.waitForTimeout(400);
    const image = await this.page.locator('#first').screenshot({ animations: 'disabled' });
    const missing = await this.page.evaluate(async base64 => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let missing = 0;
      for (let y = 120; y < 700; y += 80) {
        for (let x = 100; x < 950; x += 100) {
          const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
          if (g < 240 || r > 10 || b > 10) missing++;
        }
      }
      return missing;
    }, image.toString('base64'));
    assert.equal(missing, 0, 'Actual raster pixels must cover the ground, not just loaded DOM images');
  };
  await checkPixels();
  const checkMarker = async () => {
    const points = await this.page.evaluate(() => {
      const map = testPitch.map;
      const marker = new L.Marker(map.containerPointToLatLng([550, 390]), {
        icon: new L.DivIcon({ className: '', html: '<div style="width:30px;height:30px;background:#ff00ff"></div>', iconSize: [30, 30], iconAnchor: [15, 15] })
      }).addTo(map);
      marker.bindTooltip('<div style="width:30px;height:30px;background:#00ffff"></div>', {
        permanent: true, direction: 'right', opacity: 1
      });
      testPitch.visibleMarker = marker;
      const rect = marker.getTooltip().getElement().querySelector('div').getBoundingClientRect();
      const container = map.getContainer().getBoundingClientRect();
      return [map.latLngToContainerPoint(marker.getLatLng()), {
        x: rect.left - container.left + rect.width / 2, y: rect.top - container.top + rect.height / 2
      }];
    });
    await this.page.waitForTimeout(300);
    const image = await this.page.locator('#first').screenshot({ animations: 'disabled' });
    const colors = await this.page.evaluate(async ({ base64, points }) => {
      const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return points.map(point => [...ctx.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data]);
    }, { base64: image.toString('base64'), points });
    await this.page.evaluate(() => testPitch.visibleMarker.remove());
    const expected = [[255, 0, 255, 255], [0, 255, 255, 255]];
    assert.ok(colors.every((color, i) => color.every((channel, j) => Math.abs(channel - expected[i][j]) <= 32)),
      `Markers and permanent tooltips paint above the raster ground: ${JSON.stringify(colors)}`);
  };
  await checkMarker();
  await this.page.evaluate(async () => {
    const map = testPitch.map;
    for (let i = 0; i < 12; i++) {
      map.setPitch([20, 75, 45][i % 3], { animate: true, duration: .15 });
      map.setBearing(i * 61, { animate: true, duration: .15 });
      map.setZoomAround([400, 350], i % 2 ? 17 : 18);
      map.panBy([30, -20], { animate: true, duration: .1 });
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    await new Promise(resolve => setTimeout(resolve, 400));
    map.setPitch(45); map.setBearing(153);
    map.setView([48.85478060234936, 2.28643600540333], 17, { animate: false });
  });
  await this.page.waitForFunction(() => !testPitch.tiles.isLoading());
  await checkPixels();
  await checkMarker();
  await this.page.addStyleTag({ content: '.leaflet-control-rotate { display: block; }' });
  await this.page.locator('.leaflet-control-rotate a').click();
  await this.page.waitForFunction(() => testPitch.map.getPitch() === 0 && testPitch.map.getBearing() === 0);
  await this.page.waitForFunction(() => !testPitch.tiles.isLoading());
  await checkPixels();
  await checkMarker();
  const styles = await this.page.evaluate(() => {
    testPitch.map.setPitch(0);
    return [testPitch.map._mapPane, testPitch.map._rotatePane, testPitch.tiles._container, testPitch.tiles.getPane()]
      .map(el => el.style.transformStyle);
  });
  assert.deepEqual(styles, Array(4).fill('preserve-3d'), 'Compass reset preserves the ground context at pitch zero');
});


Then('pitched view resets preserve the ground perspective after accumulated pans', async function () {
  const result = await this.page.evaluate(async () => {
    const map = testPitch.map;
    map.getContainer().style.width = '1000px';
    map.getContainer().style.height = '731px';
    map.invalidateSize({ animate: false });
    const layer = new L.GridLayer({ maxNativeZoom: 17 }).addTo(map);
    map.setZoom(18, { animate: false });
    for (let i = 0; i < 5; i++) map.panBy([-250, -150], { animate: false });
    map._setPitchAndBearing(85, 46.43810536434438);
    const farBefore = map._getPitchFarY();
    await new Promise(resolve => {
      map.once('zoomend', resolve);
      map.setView([48.85826, 2.2945], 19);
    });
    const panRetained = map._getMapPanePos().x !== 0;
    map.setView([48.859, 2.294], 18, { animate: false });
    const target = new L.LatLng(48.859, 2.294), size = map.getSize(), screenCenter = size.divideBy(2);
    const center = map.project(target), angle = map.getBearing() * Math.PI / 180;
    const pitch = map.getPitch() * Math.PI / 180, perspective = size.y * 1.5;
    const errors = [];
    for (const [x, y] of [[-100, -100], [100, -100], [-100, 100], [100, 100]]) {
      const ll = map.unproject(center.add([x, y]));
      const rx = x * Math.cos(angle) - y * Math.sin(angle);
      const ry = x * Math.sin(angle) + y * Math.cos(angle);
      const scale = perspective / (perspective - ry * Math.sin(pitch));
      const expected = screenCenter.add([rx * scale, ry * Math.cos(pitch) * scale]);
      errors.push(map.latLngToContainerPoint(ll).distanceTo(expected));
    }
    const farAfter = map._getPitchFarY(), pane = map._getMapPanePos().clone();
    const centerError = map.latLngToContainerPoint(target).distanceTo(screenCenter);
    layer.remove();
    return { errors, farBefore, farAfter, pane, centerError, panRetained };
  });
  assert.equal(result.panRetained, true, 'Exercise animated zoom without resetting the accumulated pan');
  assert.deepEqual(result.pane, { x: 0, y: 0 });
  assert.ok(result.centerError < 1);
  assert.ok(Math.max(...result.errors) < 1, `Reset ground projection: ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.farAfter - result.farBefore) < 1, 'Resetting the view must not move the horizon');
});


Then('raster tiles remain aligned after panning before their first pitch change', async function () {
  const result = await this.page.evaluate(async () => {
    const map = testPitch.map;
    map.getContainer().style.width = '1000px';
    map.getContainer().style.height = '731px';
    map.invalidateSize({ animate: false });
    const layer = new L.GridLayer({ maxNativeZoom: 17 }).addTo(map);
    const firstRotation = !layer._rotateOrigin;
    map.setZoom(18, { animate: false });
    for (let i = 0; i < 5; i++) map.panBy([-250, -150], { animate: false });
    const center = map.getCenter();
    map._setPitchAndBearing(85, 46.43810536434438);
    await new Promise(resolve => setTimeout(resolve, 300));
    const errors = [];
    let missing = 0;
    const size = map.getSize(), farY = map._getPitchFarY(), level = layer._levels[layer._tileZoom];
    for (let y = Math.max(0, farY) + 10; y < size.y; y += 60) {
      for (let x = 20; x < size.x; x += 100) {
        const point = new L.Point(x, y), location = map.containerPointToLatLng(point);
        const projected = map.project(location, level.zoom);
        const coords = projected.divideBy(256).floor();
        if (!layer._tiles[`${coords.x}:${coords.y}:${level.zoom}`]) missing++;
        const position = projected.subtract(level.origin);
        const reference = document.createElement('div');
        reference.style.cssText = `position:absolute;width:0;height:0;left:${position.x}px;top:${position.y}px`;
        level.el.appendChild(reference);
        const rect = reference.getBoundingClientRect(), container = map.getContainer().getBoundingClientRect();
        errors.push(Math.hypot(rect.left - container.left - x, rect.top - container.top - y));
        reference.remove();
      }
    }
    const stableCenter = map.project(center).distanceTo(map.project(map.getCenter()));
    const pane = map._getMapPanePos();
    layer.remove();
    return { firstRotation, stableCenter, errors, missing, pane };
  });
  assert.equal(result.firstRotation, true, 'Exercise the first rotation after layer addition');
  assert.ok(Math.abs(result.pane.x) > 1000 && Math.abs(result.pane.y) > 700);
  assert.ok(result.stableCenter < 0.01);
  assert.equal(result.missing, 0, 'Visible ground tiles remain present');
  assert.ok(Math.max(...result.errors) < 2, `Rendered tile alignment: ${JSON.stringify(result)}`);
});
