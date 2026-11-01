import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { After, AfterAll, Before, Given, Then, When } from '@cucumber/cucumber';

const coveredFunctions = new Map();

Then('roof imagery follows raster loading, background changes and renderer ownership', { timeout: 30000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map, zoom = 17;
    const boundary = map.project(map.getCenter(), zoom).divideBy(256).floor().multiplyBy(256);
    map.setView(map.unproject(boundary, zoom), zoom, { animate: false });
    map.setPitch(0); map.setBearing(0);
    const owner = new L.Layer3D().addTo(map);
    const layer = new L.Layer3D({ roofTexture: true }).addTo(map);
    await Promise.all([nativeChecks.ready(owner), nativeChecks.ready(layer)]);
    const ring = [[-60, -60], [60, -60], [60, 60], [-60, 60], [-60, -60]]
      .map(offset => map.unproject(boundary.add(offset), zoom)).map(p => [p.lng, p.lat]);
    const area = { coords: { z: zoom, x: boundary.x / 256 - 1, y: boundary.y / 256 - 1 }, request: new AbortController() };
    layer.options.featureStyle = () => ({ top: 20, color: 0x00ff00 });
    await nativeChecks.loadBlock(layer, area, [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }]);
    const mesh = area.mesh;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    const image = async color => {
      context.fillStyle = color; context.fillRect(0, 0, 256, 256);
      return (await fetch(canvas.toDataURL())).arrayBuffer();
    };
    const red = await image('#ff0000'), blue = await image('#0000ff');
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const archive = swapped => ({
      getHeader: async () => ({ minZoom: zoom, maxZoom: zoom }),
      getZxy: async (z, x) => {
        await pending;
        return { data: (x % 2 === 0) !== swapped ? red : blue };
      },
    });
    const first = new L.PMTilesLayer('roof-first.pmtiles', { archive: archive(false) });
    const second = new L.PMTilesLayer('roof-second.pmtiles', { archive: archive(true) });
    const sample = (offset, height) => {
      layer._shared._render();
      const crs = map.options.crs;
      const origin = crs.project(layer.location);
      const point = crs.project(map.unproject(boundary.add(offset), zoom));
      const metres = Math.cos(layer.location.lat * Math.PI / 180);
      const projected = new DOMPoint((point.x - origin.x) * metres, height, -(point.y - origin.y) * metres, 1)
        .matrixTransform(new DOMMatrix(layer.root.worldMatrix))
        .matrixTransform(new DOMMatrix(layer.camera.projectionViewMatrix));
      const gl = layer.renderer.gl, pixel = new Uint8Array(4);
      gl.readPixels(Math.floor((projected.x / projected.w + 1) * gl.canvas.width / 2),
        Math.floor((projected.y / projected.w + 1) * gl.canvas.height / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    const roof = () => [[-30, 0], [30, 0]].map(offset => sample(offset, 20));
    const loaded = async raster => {
      await raster.ready;
      const deadline = performance.now() + 5000;
      while (!Object.values(raster._tiles).length || Object.values(raster._tiles).some(t => !t.el.done)) {
        if (performance.now() > deadline) throw new Error('Roof imagery did not load');
        await new Promise(requestAnimationFrame);
      }
    };
    try {
      first.addTo(map);
      const before = roof();
      release();
      await loaded(first);
      const textured = roof();
      const texture = layer._shared._roofRaster.texture.texture;
      const signature = layer._shared._roofRaster.signature;
      roof();
      const reused = signature === layer._shared._roofRaster.signature && texture === layer._shared._roofRaster.texture.texture;
      const boundaryX = boundary.x / 256;
      const westRed = (boundaryX - 1) % 2 === 0;
      map.setPitch(55); map.setBearing(35);
      const rotated = roof();
      const wall = sample([0, 60], 10);
      layer._setHighlight({ mesh, ...mesh.extras.featureFaces[0] });
      const highlighted = roof();
      layer._setHighlight(null);
      map.setPitch(0); map.setBearing(0);
      first.remove();
      const empty = roof();
      second.addTo(map);
      await loaded(second);
      const switched = roof();
      first.addTo(map);
      await loaded(first);
      first.setZIndex(2);
      const stacked = roof();
      second.setZIndex(3);
      const reordered = roof();
      first.remove();
      map.setZoom(18, { animate: false });
      await loaded(second);
      const zoomed = roof();
      map.panBy([20, 10], { animate: false });
      await loaded(second);
      const panned = roof();
      owner.remove();
      const transferred = roof();
      const sameTexture = layer._shared === layer && layer._roofRaster.texture.texture === texture;
      second.setOpacity(0);
      const transparent = roof();
      second.setOpacity(1);
      const restored = roof();
      return { before, textured, westRed, rotated, wall, highlighted, empty, switched, stacked, reordered, zoomed, panned, transferred,
        transparent, restored, reused, sameTexture };
    } finally {
      release(); first.remove(); second.remove();
      layer._releaseArea(area); layer.remove(); owner.remove();
    }
  });
  const green = pixel => pixel[1] > 100 && pixel[0] < 5 && pixel[2] < 5 && pixel[3] === 255;
  for (const name of ['before', 'empty', 'transparent']) assert.ok(result[name].every(green), `${name}: ${result[name]}`);
  const imagery = (pixels, swapped) => pixels.forEach((pixel, i) => {
    const red = (i === 0 ? result.westRed : !result.westRed) !== swapped;
    assert.ok(pixel[red ? 0 : 2] > 100 && pixel[red ? 2 : 0] < 5 && pixel[1] < 5, JSON.stringify({ pixel, red }));
  });
  imagery(result.textured, false); imagery(result.rotated, false);
  imagery(result.stacked, false);
  for (const name of ['switched', 'reordered', 'zoomed', 'panned', 'transferred', 'restored']) imagery(result[name], true);
  assert.ok(green(result.wall), `Walls retain their style: ${result.wall}`);
  assert.ok(result.highlighted.every(pixel => pixel[1] > pixel[0] && pixel[2] > pixel[0]), 'Highlight overrides imagery');
  assert.equal(result.reused, true);
  assert.equal(result.sameTexture, true);
});

Then('terrain enabled {string} raster loading preserves imagery, elevations and removal', { timeout: 30000 }, async function (order) {
  const result = await this.page.evaluate(async order => {
    const map = test3d.map;
    const zoom = 14, center = map.project(map.getCenter(), zoom);
    const coords = center.divideBy(256).floor();
    const nw = map.unproject(coords.subtract([1, 1]).multiplyBy(256), zoom);
    const se = map.unproject(coords.add([2, 2]).multiplyBy(256), zoom);
    const header = {
      minZoom: zoom, maxZoom: zoom, tileType: 0,
      minLon: nw.lng, maxLat: nw.lat, maxLon: se.lng - 1e-7, minLat: se.lat + 1e-7,
    };
    const height = point => 40 + (point.x - center.x) * 0.04 + (point.y - center.y) * 0.02;
    const corners = [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]
      .map(offset => map.unproject(center.add(offset), zoom)).map(p => [p.lng, p.lat]);
    const feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [corners] } };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 128, 256, 128);
    const image = await (await fetch(canvas.toDataURL())).arrayBuffer();
    const getHeader = L.PMTilesLayer.prototype.getHeader;
    const getZxy = L.PMTilesLayer.prototype.getZxy;
    const buildingHeader = L.Layer3D.prototype.getHeader;
    const buildingTile = L.Layer3D.prototype.getZxy;
    let release;
    let pending = new Promise(resolve => { release = resolve; });
    L.PMTilesLayer.prototype.getHeader = function () {
      return this.url.endsWith('/fixture-terrain.pmtiles') ? Promise.resolve(header) : getHeader.call(this);
    };
    L.PMTilesLayer.prototype.getZxy = async function (z, x, y, signal) {
      if (!this.url.endsWith('/fixture-terrain.pmtiles')) return getZxy.call(this, z, x, y, signal);
      await pending;
      signal.throwIfAborted();
      const values = new Float32Array(256 * 256);
      for (let row = 0; row < 256; row++) {
        for (let column = 0; column < 256; column++) {
          values[row * 256 + column] = height(new L.Point(x * 256 + column + 0.5, y * 256 + row + 0.5));
        }
      }
      return { data: values.buffer };
    };
    L.Layer3D.prototype.getHeader = async () => header;
    L.Layer3D.prototype.getZxy = async () => ({
      data: new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features: [feature] })),
    });
    const wait = async condition => {
      const deadline = performance.now() + 12000;
      while (!condition()) {
        if (performance.now() > deadline) throw new Error(`Terrain fixture did not settle: ${JSON.stringify({
          meshes: terrain._rasterTiles.size, tiles: Object.values(raster._tiles).length,
          loaded: Object.values(raster._tiles).filter(t => t.el.done).length, inflight: buildings._inflight,
        })}`);
        await new Promise(requestAnimationFrame);
      }
    };
    const terrain = new L.TerrainLayer({ source: 'fixture-terrain.pmtiles' });
    const raster = new L.PMTilesLayer('fixture-raster.pmtiles', {
      archive: { getHeader: async () => ({ ...header, tileType: 2 }), getZxy: async () => ({ data: image }) },
    });
    const buildings = new L.Layer3D({ source: 'fixture-buildings.pmtiles', roofTexture: true,
      featureStyle: () => ({ top: 15 }) }).addTo(map);
    const modelLocation = map.unproject(center.add([20, 20]), zoom);
    const model = new L.Layer3D({ center: [modelLocation.lat, modelLocation.lng] }).addTo(map);
    const errors = [];
    terrain.on('error', ({ error }) => errors.push(error.message));
    raster.on('tileerror', ({ error }) => errors.push(error.message));
    buildings.on('error', ({ error }) => errors.push(error.message));
    try {
      await Promise.all([nativeChecks.ready(buildings), nativeChecks.ready(model)]);
      if (order === 'before') terrain.addTo(map);
      raster.addTo(map);
      await raster.ready;
      await wait(() => Object.values(raster._tiles).length > 0 && Object.values(raster._tiles).every(t => t.el.done));
      if (order === 'after') terrain.addTo(map);
      const initiallyFlat = Object.values(raster._tiles).every(t => t.el.style.visibility !== 'hidden');
      terrain._terrainTiles.set(`${coords.x}/${coords.y}`, new Float32Array(256 * 256).fill(250));
      buildings._shared._render();
      const partialElevation = terrain._getElevation(map.getCenter());
      const partialCameraY = buildings.camera.target[1];
      terrain._terrainTiles.delete(`${coords.x}/${coords.y}`);
      release();
      await terrain._terrainPromise;
      const settled = () => terrain._rasterTiles.size === Object.values(raster._tiles).length &&
        buildings._inflight === 0 && [...buildings._areas.values()].every(area => area.done);
      await wait(settled);
      let elevationError = 0, deformation = 0, buildingError = 0, uvError = 0;
      for (const [tile, mesh] of terrain._rasterTiles) {
        const tileCoords = Object.values(raster._tiles).find(t => t.el === tile).coords;
        const positions = mesh.geometry.attributes.position.data;
        const uv = mesh.geometry.attributes.uv.data;
        for (let row = 0; row <= 64; row++) {
          for (let column = 0; column <= 64; column++) {
            const i = row * 65 + column;
            const expected = height(new L.Point((tileCoords.x + column / 64) * 256, (tileCoords.y + row / 64) * 256));
            elevationError = Math.max(elevationError, Math.abs(positions[i * 3 + 1] + terrain.root.position[1] - expected));
            uvError = Math.max(uvError, Math.abs(uv[i * 2 + 1] - row / 64));
          }
        }
        deformation = Math.max(deformation, Math.abs(positions[1] - positions[positions.length - 2]));
      }
      for (const area of buildings._areas.values()) {
        if (!area.mesh) continue;
        const positions = area.mesh.geometry.attributes.position.data;
        const crsOrigin = map.options.crs.project(buildings.location);
        const metres = Math.cos(buildings.location.lat * Math.PI / 180);
        for (let i = 0; i < positions.length; i += 3) {
          const latlng = map.options.crs.unproject(new L.Point(
            crsOrigin.x + positions[i] / metres, crsOrigin.y - positions[i + 2] / metres));
          const ground = height(map.project(latlng, zoom));
          const aboveGround = positions[i + 1] + buildings.root.position[1] - ground;
          buildingError = Math.max(buildingError, Math.min(Math.abs(aboveGround), Math.abs(aboveGround - 15)));
        }
      }
      const modelError = Math.abs(model.root.position[1] - height(map.project(model.location, zoom)));
      map.setPitch(0); map.setBearing(0);
      buildings._shared._render();
      const roofMesh = [...buildings._areas.values()].find(area => area.mesh).mesh;
      const roofPositions = roofMesh.geometry.attributes.position.data;
      const roofCenter = [0, 1, 2].map(axis =>
        (roofPositions[axis] + roofPositions[3 + axis] + roofPositions[6 + axis]) / 3);
      const roofWorld = new DOMPoint(...roofCenter, 1).matrixTransform(new DOMMatrix(roofMesh.worldMatrix));
      const roofUv = roofWorld.matrixTransform(new DOMMatrix(buildings._shared._roofRaster.matrix));
      const roofProjected = roofWorld.matrixTransform(new DOMMatrix(buildings.camera.projectionViewMatrix));
      const roofGl = buildings.renderer.gl, roofPixel = new Uint8Array(4);
      roofGl.readPixels(Math.floor((roofProjected.x / roofProjected.w + 1) * roofGl.canvas.width / 2),
        Math.floor((roofProjected.y / roofProjected.w + 1) * roofGl.canvas.height / 2),
        1, 1, roofGl.RGBA, roofGl.UNSIGNED_BYTE, roofPixel);
      const atlas = buildings._shared._roofRaster.texture.image;
      const roofImagePixel = [...atlas.getContext('2d').getImageData(
        Math.floor(roofUv.x * atlas.width), Math.floor(roofUv.z * atlas.height), 1, 1).data];
      map.setView(map.unproject(coords.add([0.5, 0.5]).multiplyBy(256), zoom), zoom, { animate: false });
      map.setPitch(0); map.setBearing(0);
      await wait(settled);
      buildings._shared._render();
      const tile = Object.values(raster._tiles).find(t => t.coords.x === coords.x && t.coords.y === coords.y);
      const mesh = terrain._rasterTiles.get(tile.el);
      const pixels = [16, 48].map(row => {
        const i = (row * 65 + 32) * 3;
        const position = mesh.geometry.attributes.position.data;
        const projected = new DOMPoint(position[i], position[i + 1], position[i + 2], 1)
          .matrixTransform(new DOMMatrix(mesh.worldMatrix))
          .matrixTransform(new DOMMatrix(buildings.camera.projectionViewMatrix));
        const gl = buildings.renderer.gl;
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor((projected.x / projected.w + 1) / 2 * gl.canvas.width),
          Math.floor((projected.y / projected.w + 1) / 2 * gl.canvas.height),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      });
      let cameraError = 0, projectionError = 0;
      for (const pitch of [0, 45, 83, 85]) {
        map.setPitch(pitch);
        map.setBearing(pitch * 2);
        map.panBy([12, 8], { animate: false });
        buildings._shared._render();
        const camera = buildings.camera;
        const distance = Math.hypot(...camera.position.map((v, i) => v - camera.target[i]));
        cameraError = Math.max(cameraError, Math.abs(
          camera.position[1] - camera.target[1] - Math.cos(pitch * Math.PI / 180) * distance));
        const projected = new DOMPoint(...camera.target, 1).matrixTransform(new DOMMatrix(camera.projectionViewMatrix));
        projectionError = Math.max(projectionError, Math.abs(projected.x / projected.w), Math.abs(projected.y / projected.w));
      }
      await wait(settled);
      const hidden = Object.values(raster._tiles).every(t => t.el.style.visibility === 'hidden');
      terrain.remove();
      const restored = !map._terrain3D && terrain._rasterTiles.size === 0 &&
        Object.values(raster._tiles).every(t => t.el.style.visibility !== 'hidden') && model.root.position[1] === 0;
      // Remove while elevation requests are pending; their callbacks must not hide restored tiles.
      pending = new Promise(resolve => { release = resolve; });
      terrain.addTo(map);
      const cancelledLoad = terrain._terrainPromise;
      terrain.remove();
      release();
      await cancelledLoad;
      await new Promise(requestAnimationFrame);
      const cancelled = terrain._rasterTiles.size === 0 &&
        Object.values(raster._tiles).every(t => t.el.style.visibility !== 'hidden');
      terrain.addTo(map);
      await terrain._terrainPromise;
      await wait(settled);
      return { initiallyFlat, hidden, restored, cancelled, reattached: terrain._rasterTiles.size > 0,
        elevationError, deformation, buildingError, modelError, uvError, cameraError, projectionError,
        partialElevation, partialCameraY, pixels,
        roofPixel: [...roofPixel], roofImagePixel, errors };
    } finally {
      release();
      raster.remove(); terrain.remove(); buildings.remove(); model.remove();
      L.PMTilesLayer.prototype.getHeader = getHeader;
      L.PMTilesLayer.prototype.getZxy = getZxy;
      L.Layer3D.prototype.getHeader = buildingHeader;
      L.Layer3D.prototype.getZxy = buildingTile;
    }
  }, order);
  for (const name of ['initiallyFlat', 'hidden', 'restored', 'cancelled', 'reattached']) assert.equal(result[name], true, name);
  assert.equal(result.partialElevation, null, 'Do not expose elevations from partially loaded DEM tiles');
  assert.equal(result.partialCameraY, 0, 'Keep the camera aligned while DEM tiles are loading');
  assert.ok(result.deformation > 10, 'Raster vertices must have measurable elevation differences');
  assert.deepEqual(result.pixels, [[255, 0, 0, 255], [0, 0, 255, 255]], 'Rendered imagery must retain north/south orientation');
  const roofChannel = result.roofImagePixel[0] > result.roofImagePixel[2] ? 0 : 2;
  assert.ok(result.roofPixel[roofChannel] > 100 && result.roofPixel[2 - roofChannel] < 5 &&
    result.roofPixel[1] < 5, `Terrain-relative roof samples its map image: ${result.roofPixel}`);
  for (const name of ['elevationError', 'buildingError', 'modelError', 'uvError', 'cameraError', 'projectionError']) {
    assert.ok(result[name] < 0.001, `${name}: ${result[name]}`);
  }
  assert.deepEqual(result.errors, []);
});

Then('cancelled building downloads recover without errors or stale meshes', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer3D({ source: 'paris-buildings.pmtiles' }).addTo(map);
    await nativeChecks.ready(layer);
    const idle = async () => {
      const deadline = performance.now() + 3000;
      while (layer._inflight) {
        if (performance.now() > deadline) throw new Error('Building request slots were not released');
        await new Promise(requestAnimationFrame);
      }
    };
    await idle();
    let errors = 0, active = 0, maximum = 0, aborted = 0;
    let hold = true;
    const requests = [];
    layer.on('error', () => errors++);
    layer.getZxy = async (z, x, y, signal) => {
      requests.push(`${x}/${y}`);
      active++;
      maximum = Math.max(maximum, active);
      try {
        if (hold) await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted++;
            reject(signal.reason);
          }, { once: true });
        });
        return { data: new TextEncoder().encode('{"type":"FeatureCollection","features":[]}') };
      } finally {
        active--;
      }
    };
    const home = map.getCenter();
    map.setView([48.85657, 2.39], 17, { animate: false });
    const pending = [...layer._areas.values()].filter(area => area.started && !area.done);
    const started = active;
    hold = false;
    map.setView(home, 17, { animate: false });
    await idle();
    const recovered = layer._areas.size > 0 && [...layer._areas.values()].every(area => area.done && !area.error);
    const noStale = pending.every(area => area.request.signal.aborted && !area.mesh && !area.done);
    hold = true;
    map.setView([48.85657, 2.39], 17, { animate: false });
    const beforeRemoval = requests.length;
    layer.remove();
    await idle();
    const stopped = requests.length === beforeRemoval && active === 0 && layer._areas.size === 0;
    hold = false;
    layer.addTo(map);
    await idle();
    const reloaded = requests.length > beforeRemoval && [...layer._areas.values()].every(area => area.done);
    layer.remove();
    return { started, maximum, aborted, errors, recovered, noStale, stopped, reloaded };
  });
  assert.equal(result.started, 2, 'Cancel requests while both loading slots are occupied');
  assert.equal(result.maximum, 2);
  assert.equal(result.aborted, 4, 'Pan and removal each cancel two pending requests');
  assert.equal(result.errors, 0, 'Expected AbortErrors are not loading failures');
  for (const name of ['recovered', 'noStale', 'stopped', 'reloaded']) assert.equal(result[name], true, name);
});

Then('raster perspective follows pitch on late and reattached layers', async function () {
  const result = await this.page.evaluate(() => {
    const map = test3d.map, checks = [];
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
    const map = test3d.map;
    map.getContainer().style.width = '1000px';
    map.getContainer().style.height = '731px';
    map.invalidateSize({ animate: false });
    map.setView([48.85478060234936, 2.28643600540333], 17, { animate: false });
    test3d.tiles = new L.TileLayer('/pitched-tile.png?{z}/{x}/{y}', { maxNativeZoom: 17 }).addTo(map);
  });
  await this.page.waitForFunction(() => !test3d.tiles.isLoading());
  await this.page.evaluate(() => {
    const map = test3d.map, layer = test3d.tiles, level = layer._levels[layer._tileZoom];
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
    await this.page.waitForTimeout(400);
    const image = await this.page.locator('#first').screenshot();
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
      const map = test3d.map;
      const marker = new L.Marker(map.containerPointToLatLng([550, 390]), {
        icon: new L.DivIcon({ className: '', html: '<div style="width:30px;height:30px;background:#ff00ff"></div>', iconSize: [30, 30], iconAnchor: [15, 15] })
      }).addTo(map);
      marker.bindTooltip('<div style="width:30px;height:30px;background:#00ffff"></div>', {
        permanent: true, direction: 'right', opacity: 1
      });
      test3d.visibleMarker = marker;
      const rect = marker.getTooltip().getElement().querySelector('div').getBoundingClientRect();
      const container = map.getContainer().getBoundingClientRect();
      return [map.latLngToContainerPoint(marker.getLatLng()), {
        x: rect.left - container.left + rect.width / 2, y: rect.top - container.top + rect.height / 2
      }];
    });
    await this.page.waitForTimeout(300);
    const image = await this.page.locator('#first').screenshot();
    const colors = await this.page.evaluate(async ({ base64, points }) => {
      const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return points.map(point => [...ctx.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data]);
    }, { base64: image.toString('base64'), points });
    await this.page.evaluate(() => test3d.visibleMarker.remove());
    const expected = [[255, 0, 255, 255], [0, 255, 255, 255]];
    assert.ok(colors.every((color, i) => color.every((channel, j) => Math.abs(channel - expected[i][j]) <= 32)),
      `Markers and permanent tooltips paint above the raster ground: ${JSON.stringify(colors)}`);
  };
  await checkMarker();
  await this.page.evaluate(async () => {
    const map = test3d.map;
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
  await this.page.waitForFunction(() => !test3d.tiles.isLoading());
  await checkPixels();
  await checkMarker();
  await this.page.addStyleTag({ content: '.leaflet-control-rotate { display: block; }' });
  await this.page.locator('.leaflet-control-rotate a').click();
  await this.page.waitForFunction(() => test3d.map.getPitch() === 0 && test3d.map.getBearing() === 0);
  await this.page.waitForFunction(() => !test3d.tiles.isLoading());
  await checkPixels();
  await checkMarker();
  const styles = await this.page.evaluate(() => {
    test3d.map.setPitch(0);
    return [test3d.map._mapPane, test3d.map._rotatePane, test3d.tiles._container, test3d.tiles.getPane()]
      .map(el => el.style.transformStyle);
  });
  assert.deepEqual(styles, Array(4).fill('preserve-3d'), 'Compass reset preserves the ground context at pitch zero');
});

Then('the Paris example keeps navigation inside the building archive', async function () {
  const result = await this.page.evaluate(async () => {
    const bounds = map.options.maxBounds;
    const checks = [];
    for (const [pitch, bearing] of [[0, 0], [45, 90], [85, 270]]) {
      map.setPitch(pitch);
      map.setBearing(bearing);
      for (const location of [[48.91892, 1.99112], [48.7, 2.6]]) {
        map.setView(location, 17, { animate: false });
        await new Promise(resolve => setTimeout(resolve, 400));
        checks.push({ valid: bounds.contains(map.getCenter()), pitch, center: map.getCenter() });
      }
      map.setZoom(1, { animate: false });
      await new Promise(resolve => setTimeout(resolve, 400));
      checks.push({ valid: map.getZoom() === map.options.minZoom && bounds.contains(map.getCenter()),
        pitch, center: map.getCenter(), zoom: map.getZoom() });
    }
    return { checks, viscosity: map.options.maxBoundsViscosity };
  });
  assert.ok(result.checks.every(check => check.valid), JSON.stringify(result));
  assert.equal(result.viscosity, 1);
});

Then('raster zoom transitions stay paused between WebGL frames and resume on removal', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const tiles = new L.TileLayer('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=').addTo(map);
    const first = new L.Layer3D().addTo(map), second = new L.Layer3D().addTo(map);
    await Promise.all([first, second].map(nativeChecks.ready));
    let samples = 0, frozen = true, transferred = false, resumed = false;
    const render = first._render;
    first._render = function () {
      render.call(this);
      if (!map._animatingZoom || !this._zoomTransitions?.size) return;
      const animation = this._zoomTransitions.keys().next().value;
      const time = animation.currentTime;
      const before = getComputedStyle(animation.effect.target).transform;
      const deadline = performance.now() + 40;
      while (performance.now() < deadline) { /* Simulate a slow WebGL frame. */ }
      frozen &&= animation.currentTime === time && animation.playState === 'paused' &&
        getComputedStyle(animation.effect.target).transform === before;
      samples++;
    };
    await new Promise(resolve => {
      map.once('zoomend', resolve);
      map.setZoomAround(map.getSize().divideBy(2), 18, { animate: true });
    });
    const cleaned = !first._zoomTransitions;
    first._render = render;
    await new Promise(resolve => setTimeout(resolve, 300));
    const moved = new Promise(resolve => map.once('zoomend', resolve));
    map.setZoomAround(map.getSize().divideBy(2), 17, { animate: true });
    const deadline = performance.now() + 2000;
    while (!first._zoomTransitions?.size) {
      if (performance.now() > deadline) throw new Error('Expected an active synchronized raster zoom transition');
      await new Promise(requestAnimationFrame);
    }
    const transitions = first._zoomTransitions;
    first.remove();
    transferred = second._zoomTransitions === transitions;
    second.remove();
    resumed = [...transitions.keys()].every(animation => animation.playState !== 'paused');
    await moved;
    tiles.remove();
    return { samples, frozen, cleaned, transferred, resumed };
  });
  assert.ok(result.samples > 0, 'Exercise actual CSS zoom transitions');
  for (const name of ['frozen', 'cleaned', 'transferred', 'resumed']) assert.equal(result[name], true, name);
});

Then('pitched view resets preserve the ground perspective after accumulated pans', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
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
    const map = test3d.map;
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

Then('building blocks cover pitched views and retain overlapping areas', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer3D({ source: 'paris-buildings.pmtiles' }).addTo(map);
    await nativeChecks.ready(layer);
    const idle = async () => { while (layer._inflight) await new Promise(requestAnimationFrame); };
    await idle();
    let requests = 0;
    layer.getZxy = async () => { requests++; return undefined; };
    const checks = [];
    const verify = async change => {
      const previous = new Map(layer._areas), before = requests;
      change();
      await idle();
      const bounds = map.getBounds(), z = layer.header.minZoom;
      const nw = map.project(bounds.getNorthWest(), z).divideBy(256).floor();
      const se = map.project(bounds.getSouthEast(), z).divideBy(256).floor();
      const archiveNW = map.project([layer.header.maxLat, layer.header.minLon], z).divideBy(256).floor();
      const archiveSE = map.project([layer.header.minLat, layer.header.maxLon], z).divideBy(256).floor();
      let missing = 0;
      for (let x = Math.max(nw.x, archiveNW.x); x <= Math.min(se.x, archiveSE.x); x++) {
        for (let y = Math.max(nw.y, archiveNW.y); y <= Math.min(se.y, archiveSE.y); y++) {
          if (!layer._areas.get(`${x}/${y}`)?.done) missing++;
        }
      }
      const retained = [...layer._areas].every(([key, area]) => !previous.has(key) || previous.get(key) === area);
      const added = [...layer._areas.keys()].filter(key => !previous.has(key)).length;
      checks.push({ missing, retained, requests: requests - before, added, count: layer._areas.size,
        clipped: [...layer._areas.values()].every(({ coords }) =>
          coords.x >= archiveNW.x && coords.x <= archiveSE.x &&
          coords.y >= archiveNW.y && coords.y <= archiveSE.y) });
    };
    await verify(() => map.setPitch(75));
    await verify(() => map.setBearing(270));
    await verify(() => map.setBearing(90));
    await verify(() => {
      map.getContainer().style.width = '1000px';
      map.getContainer().style.height = '600px';
      map.invalidateSize({ animate: false });
    });
    await verify(() => map.setZoom(16, { animate: false }));
    await verify(() => map.setView([48.85657, 2.33307], 16, { animate: false }));
    await verify(() => map.fire('moveend'));
    layer.remove();
    return checks;
  });
  assert.ok(result.some(check => check.count > 9), 'Pitched views must load beyond the former 3x3 limit');
  for (const check of result) {
    assert.equal(check.missing, 0, `Every visible archive block is loaded: ${JSON.stringify(result)}`);
    assert.equal(check.retained, true, 'Overlapping blocks retain their geometry');
    assert.equal(check.clipped, true, 'Coverage stays inside the archive');
    assert.equal(check.requests, check.added, 'Only new blocks are requested');
  }
});

Then('the native PMTiles methods handle directories, compression and failures', async function () {
  await this.context.unroute('**/misc/3DLayer.js');
  await this.context.unroute('**/misc/PMTilesLayer.js');
  await this.page.evaluate(() => { delete L.PMTilesLayer; delete L.Layer3D; });
  await this.page.addScriptTag({ url: `${this.baseUrl}/misc/3DLayer.js` });
  await this.page.addScriptTag({ url: `${this.baseUrl}/misc/PMTilesLayer.js` });
  const exposesReaderClass = await this.page.evaluate(() => 'PMTiles' in L);
  assert.equal(exposesReaderClass, false, 'PMTiles methods belong to their consuming layers');
  const directory = entries => {
    const bytes = [];
    const write = value => {
      do {
        const byte = value % 128;
        value = Math.floor(value / 128);
        bytes.push(byte | (value ? 128 : 0));
      } while (value);
    };
    write(entries.length);
    let previous = 0;
    for (const entry of entries) { write(entry.id - previous); previous = entry.id; }
    for (const entry of entries) write(entry.run);
    for (const entry of entries) write(entry.length);
    entries.forEach((entry, i) => write(i && entry.offset === entries[i - 1].offset + entries[i - 1].length
      ? 0 : entry.offset + 1));
    return gzipSync(Buffer.from(bytes));
  };
  const first = gzipSync('first'), second = gzipSync('second');
  const leaf = directory([{ id: 1, run: 2, length: first.length, offset: 0 },
    { id: 4, run: 1, length: second.length, offset: first.length }]);
  const root = directory([{ id: 1, run: 0, length: leaf.length, offset: 0 }]);
  const header = Buffer.alloc(127);
  header.write('PMTiles'); header[7] = 3;
  const u64 = (offset, value) => header.writeBigUInt64LE(BigInt(value), offset);
  u64(8, 127); u64(16, root.length);
  u64(40, 127 + root.length); u64(48, leaf.length);
  u64(56, 127 + root.length + leaf.length); u64(64, first.length + second.length);
  header[97] = header[98] = 2; header[99] = 1; header[100] = header[101] = 1;
  const archive = Buffer.concat([header, root, leaf, first, second]);
  const plainRoot = gunzipSync(directory([{ id: 1, run: 2, length: 5, offset: 0 },
    { id: 4, run: 1, length: 6, offset: 5 }]));
  const plainHeader = Buffer.from(header);
  plainHeader[97] = plainHeader[98] = 1;
  plainHeader.writeBigUInt64LE(BigInt(plainRoot.length), 16);
  plainHeader.writeBigUInt64LE(BigInt(127 + plainRoot.length), 56);
  plainHeader.writeBigUInt64LE(11n, 64);
  const plainArchive = Buffer.concat([plainHeader, plainRoot, Buffer.from('firstsecond')]);
  const requests = [];
  await this.page.route('**/fixture.pmtiles*', async route => {
    const request = route.request();
    const [start, end] = request.headers().range.match(/\d+/g).map(Number);
    requests.push({ start, end });
    let bytes = archive;
    const url = new URL(request.url());
    if (url.searchParams.has('plain')) bytes = plainArchive;
    if (url.searchParams.has('version')) {
      bytes = Buffer.from(archive); bytes[7] = 2;
    }
    if (url.searchParams.has('compression')) {
      bytes = Buffer.from(archive); bytes[97] = 3;
    }
    if (url.searchParams.has('http')) return route.fulfill({ status: 503, body: '' });
    if (url.searchParams.has('directory') && start === 127) {
      const bad = Buffer.from([0x80]);
      return route.fulfill({ status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${archive.length}`, ETag: '"original"' },
        body: Buffer.concat([bad, Buffer.alloc(end - start)]) });
    }
    const full = url.searchParams.has('full');
    const truncated = url.searchParams.has('truncated');
    await route.fulfill({
      status: full ? 200 : 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        ETag: url.searchParams.has('changed') && start > 0 ? '"new"' : '"original"' },
      body: full ? bytes : bytes.subarray(start, truncated ? end : end + 1),
    });
  });
  const result = await this.page.evaluate(async () => {
    const archive = new L.PMTilesLayer('fixture.pmtiles');
    await archive.ready;
    const header = archive.header;
    const read = async (x, y) => {
      const tile = await archive.getZxy(1, x, y);
      return tile && new TextDecoder().decode(tile.data);
    };
    const tiles = await Promise.all([read(0, 0), read(0, 1), read(1, 1), read(1, 0)]);
    const abort = new AbortController(); abort.abort();
    const cancelled = await archive.getZxy(1, 0, 0, abort.signal).then(() => false, error => error.name === 'AbortError');
    const errors = [];
    for (const query of ['version', 'compression', 'http', 'truncated', 'changed']) {
      const reader = new L.PMTilesLayer(`fixture.pmtiles?${query}`);
      errors.push(await reader.ready.then(() => reader.getZxy(1, 0, 0))
        .then(() => '', error => error.message));
    }
    const invalid = await archive.getZxy(1, 2, 0).then(() => false, error => error.message === 'Invalid PMTiles tile coordinates');
    const full = new L.PMTilesLayer('fixture.pmtiles?full');
    await full.ready;
    const fullTile = await full.getZxy(1, 1, 0);
    const plain = new L.PMTilesLayer('fixture.pmtiles?plain');
    await plain.ready;
    const plainTile = await plain.getZxy(1, 1, 0);
    const badDirectory = new L.PMTilesLayer('fixture.pmtiles?directory');
    const directoryError = await badDirectory.ready.then(() => badDirectory.getZxy(1, 0, 0))
      .then(() => false, error => error instanceof Error);
    return { tiles, cancelled, invalid, zoom: [header.minZoom, header.maxZoom], errors,
      full: new TextDecoder().decode(fullTile.data), plain: new TextDecoder().decode(plainTile.data),
      badDirectory: directoryError };
  });
  assert.deepEqual(result.tiles, ['first', 'first', undefined, 'second']);
  assert.deepEqual(result.zoom, [1, 1]);
  assert.equal(result.cancelled, true);
  assert.equal(result.invalid, true);
  assert.equal(result.full, 'second');
  assert.equal(result.plain, 'second');
  assert.equal(result.badDirectory, true);
  assert.deepEqual(result.errors, ['Expected a PMTiles v3 archive', 'Unsupported PMTiles compression: 3',
    'Unable to read PMTiles: HTTP 503', 'Truncated PMTiles range', 'PMTiles archive changed; recreate the layer']);
  assert.equal(requests.filter(request => request.start === 127).length, 5, 'One root request per reader');
  const real = await this.page.evaluate(async () => {
    const buildings = new L.Layer3D({ source: '../examples/data/paris-buildings.pmtiles' });
    await nativeChecks.ready(buildings);
    const header = buildings.header;
    const point = test3d.map.project(new L.LatLng(48.85826, 2.2945), header.minZoom).divideBy(256).floor();
    const tile = await buildings.getZxy(header.minZoom, point.x, point.y);
    const collection = JSON.parse(new TextDecoder().decode(tile.data));
    const raster = new L.PMTilesLayer('../examples/data/paris-orthophotos.pmtiles');
    await raster.ready;
    const rasterHeader = raster.header;
    const rasterPoint = test3d.map.project(new L.LatLng(48.85826, 2.2945), rasterHeader.maxZoom).divideBy(256).floor();
    const image = await raster.getZxy(rasterHeader.maxZoom, rasterPoint.x, rasterPoint.y);
    const bitmap = await createImageBitmap(new Blob([image.data]));
    return { type: collection.type, count: collection.features.length, width: bitmap.width };
  });
  assert.equal(real.type, 'FeatureCollection');
  assert.ok(real.count > 0);
  assert.equal(real.width, 256);
});

Before({ tags: '@3d-layer' }, async function () {
  if (process.env.COVERAGE_3D) {
    await this.page.coverage.startJSCoverage({ resetOnNavigation: false });
  }
});

After({ tags: '@3d-layer' }, async function () {
  if (!process.env.COVERAGE_3D) return;
  const entries = await this.page.coverage.stopJSCoverage();
  for (const entry of entries.filter(entry => entry.url.endsWith('/misc/3DLayer.js'))) {
    for (const fn of entry.functions) {
      const range = fn.ranges[0];
      if (!fn.functionName) continue;
      const key = `${range.startOffset}:${range.endOffset}`;
      const previous = coveredFunctions.get(key);
      coveredFunctions.set(key, {
        name: fn.functionName,
        line: entry.source.slice(0, range.startOffset).split('\n').length,
        covered: Boolean(range.count || previous?.covered),
      });
    }
  }
});

AfterAll(function () {
  if (!process.env.COVERAGE_3D || !coveredFunctions.size) return;
  const functions = [...coveredFunctions.values()];
  const covered = functions.filter(fn => fn.covered).length;
  console.log(`Layer3D named-function coverage: ${covered}/${functions.length} (${(covered / functions.length * 100).toFixed(1)}%)`);
  console.log('Uncovered functions:', functions.filter(fn => !fn.covered).map(fn => `${fn.name}:${fn.line}`).join(', '));
});

Then('configured models preserve external assets and can be detached and reattached', async function () {
  const png = await this.page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#808080'; context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL().split(',')[1];
  });
  const vertices = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const description = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'vertices.bin', byteLength: 60 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 },
      { bufferView: 1, componentType: 5126, type: 'VEC2', count: 3 }],
    images: [{ uri: 'texture.png' }], textures: [{ source: 0 }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [0.6, 0.3, 0.1, 1], metallicFactor: 0.5,
        roughnessFactor: 0.4, baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } },
      emissiveTexture: { index: 0 }, emissiveFactor: [0.1, 0.2, 0.3],
      occlusionTexture: { index: 0, strength: 0.6 },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }],
  };
  await this.page.route('**/manual/model.gltf', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(description),
  }));
  await this.page.route('**/manual/vertices.bin', route => route.fulfill({
    body: Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(new Float32Array([0, 0, 1, 0, 0.5, 1]).buffer)]),
    contentType: 'application/octet-stream',
  }));
  await this.page.route('**/manual/texture.png', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(png, 'base64'),
  }));
  const result = await this.page.evaluate(async () => {
    const url = new URL('manual/model.gltf', document.baseURI).href;
    const layer = new L.Layer3D({ model: url });
    let ready = false;
    const loaded = nativeChecks.ready(layer).then(() => { ready = true; });
    await new Promise(requestAnimationFrame);
    const waitsForMap = !ready && !layer.model && !layer.renderer;
    layer.addTo(test3d.map);
    await loaded;
    const model = layer.model;
    let mesh;
    layer.traverse(model, node => { if (node.geometry) mesh = node; });
    const style = mesh.program._layerMaterial, gl = layer.renderer.gl;
    const attached = model.parent === layer.root && !('ready' in layer);
    const maps = style.baseTexture.internalFormat === gl.SRGB8_ALPHA8 &&
      style.metalTexture.internalFormat === gl.RGBA &&
      style.baseTexture === style.emissiveTexture && style.metalTexture === style.occlusionTexture &&
      style.baseTexture !== style.metalTexture;
    const factors = style.color.join() === '0.6,0.3,0.1' && style.metallic === 0.5 &&
      style.roughness === 0.4 && style.occlusionStrength === 0.6;
    const normals = [...mesh.geometry.attributes.normal.data].join() === '0,0,1,0,0,1,0,0,1';
    layer.add(model);
    layer._shared._render();
    const uploaded = style.baseTexture.uploaded === style.baseTexture.image &&
      style.metalTexture.uploaded === style.metalTexture.image;
    const program = mesh.program;
    layer.remove(model);
    const retained = !model.parent && mesh.program === program && gl.isProgram(program.program);
    layer.add(model);
    const reattached = model.parent === layer.root;
    layer.remove();
    return { waitsForMap, attached, maps, factors, normals, uploaded, retained, reattached };
  });
  for (const [name, value] of Object.entries(result)) {
    assert.equal(value, true, name);
  }
  delete description.meshes[0].primitives[0].attributes.TEXCOORD_0;
  await this.page.route('**/manual/no-uv.gltf', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(description),
  }));
  const missingUV = await this.page.evaluate(async () => {
    const layer = new L.Layer3D({ model: 'manual/no-uv.gltf' }).addTo(test3d.map);
    let programs = 0;
    const createProgram = layer._createProgram;
    layer._createProgram = function (...args) { programs++; return createProgram.apply(this, args); };
    const error = await nativeChecks.ready(layer).then(() => null, error => error);
    const result = error?.message === 'Textured model mesh requires UV coordinates' &&
      programs === 0 && !layer.model && layer.root.children.length === 0;
    layer.remove();
    return result;
  });
  assert.equal(missingUV, true, 'Missing UVs are rejected before allocating mesh resources');
});

Then('DOM tooltip content stays inside the map without interpreting text as HTML', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map, container = map.getContainer();
    container.style.cursor = 'crosshair';
    const node = document.createElement('div');
    node.textContent = '<img src=x onerror=alert(1)>';
    const layer = new L.Layer3D({ tooltipContent: () => node }).addTo(map);
    await nativeChecks.ready(layer);
    const rect = container.getBoundingClientRect();
    const feature = { id: 'dom', model: {}, properties: {} };
    layer._findFeature = () => feature;
    container.dispatchEvent(new MouseEvent('mousemove', {
      clientX: rect.right - 2, clientY: rect.bottom - 2,
    }));
    const tooltip = layer._tooltip;
    const bounds = tooltip.getBoundingClientRect();
    const contained = bounds.left >= rect.left && bounds.right <= rect.right &&
      bounds.top >= rect.top && bounds.bottom <= rect.bottom;
    const literal = tooltip.firstChild === node && !tooltip.querySelector('img') &&
      tooltip.textContent === '<img src=x onerror=alert(1)>';
    const shown = !tooltip.hidden && container.style.cursor === 'pointer';
    layer._findFeature = () => null;
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left, clientY: rect.top }));
    const restored = tooltip.hidden && container.style.cursor === 'crosshair' && !layer.hoveredFeature;
    layer.remove();
    const cleaned = !tooltip.isConnected && container.style.cursor === 'crosshair';
    container.style.cursor = '';
    return { contained, literal, shown, restored, cleaned };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

Then('layer-owned objects preserve values and visibility without engine classes', async function () {
  const result = await this.page.evaluate(async () => {
    const layer = new L.Layer3D();
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
    const noEngine = !('Native' in L.Layer3D) && !('Native' in layer) && !('loadModel' in layer) &&
      objects.every(object => object.constructor === Object) &&
      Object.getPrototypeOf(layer.camera.position) === Array.prototype &&
      Object.getPrototypeOf(mesh.worldMatrix) === Array.prototype &&
      objects.every(object => Object.getPrototypeOf(object) === Object.prototype &&
        Object.values(object).every(value => typeof value !== 'function')) &&
      !Object.keys(L.Layer3D.prototype).some(name => /Methods|Prototype/.test(name));
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

Then('a source block with {string} reports {string} without attaching a mesh', async function (invalid, message) {
  const result = await this.page.evaluate(async invalid => {
    const layer = new L.Layer3D().addTo(test3d.map);
    await nativeChecks.ready(layer);
    layer.options.featureStyle = () => ({ top: 10 });
    const anchor = layer.location, west = anchor.lng, south = anchor.lat;
    let geometry = { type: 'Polygon', coordinates: [[[west, south]]] };
    if (invalid === 'geometry') geometry = { type: 'Point', coordinates: [west, south] };
    if (invalid === 'coordinates') geometry = { type: 'Polygon', coordinates: [[['bad', south]]] };
    if (invalid === 'empty polygon') geometry = { type: 'MultiPolygon', coordinates: [
      [[[west, south], [west + 0.001, south], [west, south + 0.001], [west, south]]], [],
    ] };
    const data = invalid === 'collection' ? { type: 'Feature', properties: {} }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
    layer.getZxy = async () => ({ data: new TextEncoder().encode(JSON.stringify(data)) });
    const point = test3d.map.project(anchor, 16).divideBy(256).floor();
    const area = { coords: { z: 16, x: point.x, y: point.y }, request: new AbortController() };
    const errors = [];
    layer.on('error', event => errors.push(event.error.message));
    layer._areas.set('invalid-fixture', area);
    layer._pump();
    while (layer._inflight) await new Promise(requestAnimationFrame);
    const result = { error: area.error, events: errors, attached: layer.root.children.length, done: Boolean(area.done) };
    layer.remove();
    return result;
  }, invalid);
  assert.equal(result.error, message);
  assert.deepEqual(result.events, [message]);
  assert.equal(result.attached, 0);
  assert.equal(result.done, false);
});

async function prepare3DChecks(page) {
  await page.evaluate(() => {
    window.nativeChecks = {
      group() {
        return {
          position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
          worldMatrix: Array.from(new DOMMatrix().toFloat64Array()), children: [], visible: true,
        };
      },
      mesh(layer, attributes, program = layer._createProgram({ vertexColors: true })) {
        return {
          ...nativeChecks.group(),
          gl: layer.renderer.gl,
          geometry: layer._createGeometry(layer.renderer.gl, Object.fromEntries(Object.entries(attributes)
            .map(([name, values]) => [name, { size: 3, data: new Float32Array(values) }]))),
          program, id: L.Layer3D._nextId++, renderOrder: 0, extras: {},
        };
      },
      ready(layer) {
        return new Promise((resolve, reject) => {
          const loaded = () => { cleanup(); resolve(layer); };
          const failed = ({ error }) => { cleanup(); reject(error); };
          const cleanup = () => {
            layer.off('ready', loaded);
            layer.off('error', failed);
          };
          layer.on('ready', loaded);
          layer.on('error', failed);
        });
      },
      async loadBlock(layer, area, features) {
        while (layer._inflight) await new Promise(requestAnimationFrame);
        const getZxy = layer.getZxy;
        layer.getZxy = async () => ({
          data: new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })),
        });
        layer._areas.set('fixture', area);
        try {
          layer._pump();
          while (layer._inflight) await new Promise(requestAnimationFrame);
          return area;
        } finally {
          layer.getZxy = getZxy;
          layer._areas.delete('fixture');
        }
      },
      bounds(root, backend) {
        backend._updateWorldMatrix(root, true);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        backend.traverse(root, mesh => {
          if (!mesh.geometry) return;
          const position = mesh.geometry.attributes.position;
          for (let i = 0; i < position.count; i++) {
            const offset = i * position.size;
            const transformed = new DOMPoint(position.data[offset], position.data[offset + 1], position.data[offset + 2], 1)
              .matrixTransform(new DOMMatrix(mesh.worldMatrix));
            const point = [transformed.x / transformed.w, transformed.y / transformed.w, transformed.z / transformed.w];
            for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], point[j]); max[j] = Math.max(max[j], point[j]); }
          }


        });
        return { min, max };
      },
      intersections(mesh, origin, direction, backend) {
        const camera = backend.camera, ray = structuredClone(backend.raycaster);
        backend.camera = {
          ...structuredClone(camera), position: [...origin],
          target: origin.map((v, i) => v + direction[i]), up: [0, 0, 1],
        };
        try {
          const rect = backend._map.getContainer().getBoundingClientRect();
          return backend.raycast({
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          }, [mesh], false).map(hit => hit.point);
        } finally {
          backend.camera = camera;
          backend.raycaster = ray;
        }
      },
    };
  });
}

Then('native triangulation and glTF decoding preserve geometry without library requests', async function () {
  await this.page.route('**/accessors.gltf?*', route => route.fulfill({
    contentType: 'application/json', body: new URL(route.request().url()).searchParams.get('fixture'),
  }));
  const result = await this.page.evaluate(async () => {
    const layer = new L.Layer3D().addTo(test3d.map);
    await nativeChecks.ready(layer);
    const square = (x, y, size) => [{ x, y }, { x: x + size, y },
      { x: x + size, y: y + size }, { x, y: y + size }];
    const shapes = [
      [square(0, 0, 10), [square(1, 1, 2), square(6, 6, 2)], 92],
      [[{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 },
        { x: 2, y: 6 }, { x: 0, y: 6 }], [], 20],
      [[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 },
        { x: 6, y: 6 }, { x: 0, y: 6 }], [], 36],
    ];
    let triangulated = true;
    for (const [contour, holes, expected] of shapes) {
      for (const reverse of [false, true]) {
        const outer = reverse ? [...contour].reverse() : contour;
        const inner = reverse ? holes.map(hole => [...hole].reverse()) : holes;
        const points = [outer, ...inner].flat();
        const triangles = layer.triangulate(outer, inner);
        const area = triangles.reduce((sum, [a, b, c]) => {
          const [p, q, r] = [points[a], points[b], points[c]];
          return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
        }, 0);
        if (Math.abs(area - expected) > 1e-8) triangulated = false;
      }
    }
    let invalidRejected = false;
    try { layer.triangulate([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }]); }
    catch (error) { invalidRejected = error instanceof Error; }
    // Interleaved positions, normalized byte normals, and a sparse position override.
    const buffer = new ArrayBuffer(72);
    new Float32Array(buffer, 0, 12).set([0, 0, 0, 99, 1, 0, 0, 99, 0, 1, 0, 99]);
    new Uint8Array(buffer, 48, 9).set([0, 0, 255, 0, 0, 255, 0, 0, 255]);
    new Uint8Array(buffer, 57, 1)[0] = 1;
    new Float32Array(buffer, 60, 3).set([2, 0, 0]);
    const description = {
      buffers: [{ binary: buffer }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48, byteStride: 16 },
        { buffer: 0, byteOffset: 48, byteLength: 9 }, { buffer: 0, byteOffset: 57, byteLength: 1 },
        { buffer: 0, byteOffset: 60, byteLength: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3,
        sparse: { count: 1, indices: { bufferView: 2, componentType: 5121 }, values: { bufferView: 3 } } },
      { bufferView: 1, componentType: 5121, type: 'VEC3', count: 3, normalized: true }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
      materials: [], nodes: [{ mesh: 0, translation: [1, 2, 3] }, { mesh: 0, translation: [4, 5, 6] }],
      scenes: [{ nodes: [0, 1] }], scene: 0,
    };
    description.asset = { version: '2.0' };
    description.buffers = [{
      byteLength: buffer.byteLength,
      uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`,
    }];
    const url = new URL('accessors.gltf', document.baseURI);
    url.searchParams.set('fixture', JSON.stringify(description));
    const configured = new L.Layer3D({ model: url.href }).addTo(test3d.map);
    await nativeChecks.ready(configured);
    const model = configured.model;
    const [first, second] = model.children.map(node => node.children[0]);
    const decoded = [...first.geometry.attributes.position.data].join() === '0,0,0,2,0,0,0,1,0' &&
      [...first.geometry.attributes.normal.data].join() === '0,0,1,0,0,1,0,0,1' &&
      first !== second && first.geometry !== second.geometry;
    layer._updateWorldMatrix(first.parent);
    layer._updateWorldMatrix(second.parent);
    const transformed = (() => {
      const point = new DOMPoint(2, 0, 0, 1).matrixTransform(new DOMMatrix(first.worldMatrix));
      return [point.x / point.w, point.y / point.w, point.z / point.w].join() === '3,2,3';
    })();
    for (const mesh of [first, second]) {
      for (const attribute of Object.values(mesh.geometry.attributes)) mesh.geometry.gl.deleteBuffer(attribute.buffer);
      layer._removeProgram(mesh.program);
    }
    configured.remove();
    layer.remove();
    return { triangulated, invalidRejected, decoded, transformed };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
  assert.deepEqual(this.oglRequests, []);
  assert.deepEqual(this.threeRequests, []);
});

Then('3D click reports the picked object without changing the map view', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    map.options.zoomAnimation = false;
    map.options.maxZoom = 24;
    const origin = new L.Layer3D().addTo(map);
    const far = new L.Layer3D({ center: [48.85835, 2.29465], tooltipContent: () => 'Far' }).addTo(map);
    const near = new L.Layer3D({ center: [48.85835, 2.29465], tooltipContent: () => 'Near' }).addTo(map);
    await Promise.all([origin, far, near].map(nativeChecks.ready));
    for (const [layer, height] of [[far, 0], [near, 20]]) {
      layer.model = nativeChecks.group();
      layer.model.id = height ? 'near' : 'far';
      const mesh = nativeChecks.mesh(layer, {
        position: [-60, height, -60, 0, height, 60, 60, height, -60],
        normal: [0, 1, 0, 0, 1, 0, 0, 1, 0],
        color: [1, 0, 0, 1, 0, 0, 1, 0, 0],
      });
      near.setParent(mesh, layer.model);
      layer.add(layer.model);
    }
    origin.remove();
    const container = map.getContainer();
    const position = () => {
      near._shared._render();
      const world = new DOMPoint(0, 20, 0, 1).matrixTransform(new DOMMatrix(near.root.worldMatrix));
      const point = world.matrixTransform(new DOMMatrix(near.camera.projectionViewMatrix));
      const x = point.x / point.w, y = point.y / point.w;
      const rect = container.getBoundingClientRect();
      return { clientX: rect.left + (x + 1) * rect.width / 2,
        clientY: rect.top + (1 - y) * rect.height / 2 };
    };
    let nearClicks = 0, farClicks = 0;
    near.on('featureclick', ({ feature }) => { if (feature) nearClicks++; });
    far.on('featureclick', ({ feature }) => { if (feature) farClicks++; });
    const click = position();
    const event = new MouseEvent('click', click);
    const firstZoom = map.getZoom();
    const firstCenter = map.getCenter();
    let movements = 0;
    const onMove = () => movements++;
    map.on('movestart zoomstart', onMove);
    container.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    const unchanged = map.getZoom() === firstZoom && map.getCenter().equals(firstCenter) && movements === 0;
    const diagnostic = { zoom: map.getZoom(), center: map.getCenter(), nearClicks, farClicks };
    const sharedPicking = nearClicks === 1 && farClicks === 1;
    container.dispatchEvent(new MouseEvent('click', position()));
    const repeatedClickStable = map.getZoom() === firstZoom && map.getCenter().equals(firstCenter) && movements === 0;
    const tooltipShown = !near._tooltip.hidden && near._tooltip.textContent === 'Near';
    const center = map.getCenter();
    container.dispatchEvent(new MouseEvent('click', { clientX: -1000, clientY: -1000 }));
    const emptyUnchanged = map.getZoom() === firstZoom && map.getCenter().equals(center);
    let zoomStable = true;
    diagnostic.poses = [];
    const pickedMesh = near.model.children[0];
    near._findFeature = () => ({ model: near.model, mesh: pickedMesh });
    near.raycast = () => [{ object: pickedMesh }];
    for (const [pitch, bearing] of [[0, 0], [45, 90], [75, 270], [85, 180]]) {
      map.setPitch(pitch);
      map.setBearing(bearing);
      map.setView(near.location, 22, { animate: false });
      const zoom = map.getZoom(), center = map.getCenter();
      movements = 0;
      near._onClick(new MouseEvent('click', position()));
      diagnostic.poses.push({ pitch, bearing, zoom, center });
      zoomStable &&= map.getPitch() === pitch && Math.abs(map.getBearing() - bearing) < 1e-8;
      near._onClick(new MouseEvent('click', position()));
      zoomStable &&= map.getZoom() === zoom &&
        map.getCenter().equals(center) && movements === 0;
    }
    map.off('movestart zoomstart', onMove);
    near.remove();
    far.remove();
    origin.remove();
    return { checks: { unchanged, sharedPicking, repeatedClickStable, emptyUnchanged,
      tooltipShown, zoomStable }, diagnostic };
  });
  for (const [name, value] of Object.entries(result.checks)) assert.equal(value, true, `${name}: ${JSON.stringify(result.diagnostic)}`);
});

Then('a 3D layer creates and cleans up its own hover tooltip', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer3D({
      source: 'paris-buildings.pmtiles',
      featureStyle: () => ({ top: 10 }),
      tooltipContent: feature => `Height: ${feature.properties.height} m`,
    }).addTo(map);
    await nativeChecks.ready(layer);
    const container = map.getContainer();
    container.style.cursor = 'crosshair';
    const tooltip = container.querySelector('.leaflet-3d-tooltip');
    const created = tooltip.parentElement === container && tooltip.hidden &&
      tooltip.getAttribute('role') === 'tooltip' && tooltip.getAttribute('aria-live') === 'polite';
    const rect = container.getBoundingClientRect();
    const position = { clientX: rect.left + 20, clientY: rect.top + 20 };
    const mesh = nativeChecks.mesh(layer, {
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
    const other = new L.Layer3D({
      center: [map.getCenter().lat, map.getCenter().lng],
      source: 'paris-buildings.pmtiles', featureStyle: () => ({ top: 10 }),
      tooltipContent: () => 'Other feature',
    }).addTo(map);
    await nativeChecks.ready(other);
    layer._showFeature(feature, position);
    other._showFeature(feature, position);
    layer.remove();
    const sharedCursor = container.style.cursor === 'pointer' && !other._tooltip.hidden;
    other.remove();
    const removed = !tooltip.isConnected && !container.querySelector('.leaflet-3d-tooltip') &&
      container.style.cursor === 'crosshair';
    layer.addTo(map);
    const restored = container.querySelector('.leaflet-3d-tooltip');
    const recreated = restored !== tooltip && restored.hidden;
    layer._showFeature(feature, position);
    layer.remove();
    const restoredCursor = container.style.cursor === 'crosshair';
    for (const attribute of Object.values(mesh.geometry.attributes)) mesh.geometry.gl.deleteBuffer(attribute.buffer);
    layer._removeProgram(mesh.program);
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
    const explicit = new L.Layer3D({ center });
    await nativeChecks.ready(explicit);
    center[0] = 0;
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
    await nativeChecks.ready(layer);
    const geometry = nativeChecks.bounds(layer.model, layer);
    const centered = layer.location.equals([48.8582601, 2.29449985]);
    const attached = layer.model.parent === layer.root;
    const rotation = layer.model.rotation[1];
    const scale = [...layer.model.scale];
    const attribution = map.attributionControl.getContainer().textContent.includes('Test model attribution');
    layer._shared._render();
    let texturedMeshes = 0, transparentMeshes = 0;
    layer.traverse(layer.model, mesh => {
      if (!mesh.program) return;
      const style = mesh.program._layerMaterial;
      if (style.baseTexture) {
        if (!mesh.geometry.attributes.uv || !style.baseTexture.image.width) {
          throw new Error('Model texture or UVs are missing');
        }
        texturedMeshes++;
      }
      if (style.alphaMode === 'BLEND' && mesh.program.transparent && !mesh.program.depthWrite) transparentMeshes++;
    });
    const gl = layer.renderer.gl;
    const drawGeometry = layer._drawGeometry;
    const pixels = () => {
      layer._shared._render();
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    const texturedPixels = pixels();
    const textures = new Map();
    layer.traverse(layer.model, mesh => {
      const texture = mesh.program?.uniforms.baseTexture?.value;
      if (!texture || textures.has(texture)) return;
      textures.set(texture, texture.image);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      canvas.getContext('2d').fillStyle = 'white';
      canvas.getContext('2d').fillRect(0, 0, 1, 1);
      texture.image = canvas;
      texture.needsUpdate = true;
    });
    const plainPixels = pixels();
    for (const [texture, image] of textures) { texture.image = image; texture.needsUpdate = true; }
    layer._shared._render();
    let changedPixels = 0;
    for (let i = 0; i < texturedPixels.length; i += 4) {
      if (Math.abs(texturedPixels[i] - plainPixels[i]) +
          Math.abs(texturedPixels[i + 1] - plainPixels[i + 1]) +
          Math.abs(texturedPixels[i + 2] - plainPixels[i + 2]) > 10) changedPixels++;
    }
    const realisticMaterials = texturedMeshes > 0 && transparentMeshes > 0 && changedPixels > 100;
    const programs = new Map();
    const passes = new Map();
    let linearTextures = true;
    layer.traverse(layer.model, mesh => {
      if (!mesh.program) return;
      programs.set(mesh, mesh.program);
      const style = { ...mesh.program._layerMaterial, alphaMode: 'BLEND' };
      mesh.program = layer._createProgram(style);
      if (style.baseTexture && gl.SRGB8_ALPHA8 && style.baseTexture.internalFormat !== gl.SRGB8_ALPHA8) {
        linearTextures = false;
      }
    });
    layer._drawGeometry = function (geometry, program, mode) {
      if (program.transparent) {
        if (!passes.has(geometry)) passes.set(geometry, []);
        passes.get(geometry).push(program.cullFace);
      }
      return drawGeometry.call(this, geometry, program, mode);
    };
    layer._shared._render();
    const list = [];
    const useProgram = layer._useProgram;
    layer._useProgram = function (program) {
      const mesh = [...programs.keys()].find(mesh => mesh.program === program);
      if (mesh && !list.includes(mesh)) list.push(mesh);
      return useProgram.call(this, program);
    };
    passes.clear();
    layer._shared._render();
    layer._useProgram = useProgram;
    const depths = list.map(mesh => {
      const world = new DOMPoint(...mesh.geometry.bounds.center, 1).matrixTransform(new DOMMatrix(mesh.worldMatrix));
      const point = world.matrixTransform(new DOMMatrix(layer.camera.projectionViewMatrix));
      return point.z / point.w;
    });
    const transparentOrder = depths.length > 1 && depths.every((depth, i) =>
      !i || depths[i - 1] >= depth) && Math.max(...depths) > Math.min(...depths);
    const doubleSidedPasses = passes.size > 0 && [...passes].every(([geometry, faces]) => {
      const mesh = [...programs.keys()].find(mesh => mesh.geometry === geometry);
      return faces.length === 2 && faces[0] === gl.FRONT && faces[1] === gl.BACK &&
        !mesh.program.depthWrite && mesh.program.cullFace === null;
    });
    layer._drawGeometry = drawGeometry;
    for (const [mesh, program] of programs) {
      layer._removeProgram(mesh.program);
      mesh.program = program;
    }
    layer._shared._render();
    const probe = nativeChecks.mesh(layer, {
      position: [-1, -1, 0.5, 1, -1, 0.5, 0, 1, 0.5, -1, -1, 0, 1, -1, 0, 0, 1, 0],
      normal: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      color: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    }, layer._createProgram({ vertexColors: true, alphaMode: 'MASK' }));
    const probeCamera = structuredClone(layer.camera);
    probeCamera.position.splice(0, 3, 0, 0, 3);
    probeCamera.target.splice(0, 3, 0, 0, 0);
    const sample = () => {
      layer._updateWorldMatrix(probe);
      layer._updateCamera(probeCamera);
      const modelView = new DOMMatrix(probeCamera.viewMatrix).multiply(new DOMMatrix(probe.worldMatrix)).toFloat64Array();
      const inverse = new DOMMatrix(modelView).inverse().toFloat64Array();
      Object.assign(probe.program.uniforms, {
        modelViewMatrix: { value: modelView }, projectionMatrix: { value: probeCamera.projectionMatrix },
        normalMatrix: { value: [inverse[0], inverse[4], inverse[8], inverse[1], inverse[5], inverse[9],
          inverse[2], inverse[6], inverse[10]] },
      });
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      layer._useProgram(probe.program);
      layer._drawGeometry(probe.geometry, probe.program, gl.TRIANGLES);
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    const firstPixel = sample();
    for (const attribute of Object.values(probe.geometry.attributes)) {
      const first = attribute.data.slice(0, 9);
      attribute.data.copyWithin(0, 9);
      attribute.data.set(first, 9);
      attribute.needsUpdate = true;
    }
    const secondPixel = sample();
    const depthOrderIndependent = firstPixel.every((value, index) => value === secondPixel[index]) &&
      firstPixel[0] > firstPixel[2] && firstPixel[3] === 255;
    for (const attribute of Object.values(probe.geometry.attributes)) probe.geometry.gl.deleteBuffer(attribute.buffer);
    layer._removeProgram(probe.program);
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    let position;
    layer.traverse(layer.model, object => {
      if (position || !object.geometry) return;
      const vertices = object.geometry.attributes.position;
      for (let i = 0; i < Math.min(vertices.count, 90); i++) {
        const offset = i * vertices.size;
        const world = new DOMPoint(vertices.data[offset], vertices.data[offset + 1], vertices.data[offset + 2], 1)
          .matrixTransform(new DOMMatrix(object.worldMatrix));
        const point = world.matrixTransform(new DOMMatrix(layer.camera.projectionViewMatrix));
        const x = point.x / point.w, y = point.y / point.w;
        if (Math.abs(x) >= 1 || Math.abs(y) >= 1) continue;
        const candidate = { clientX: Math.floor(rect.left + (x + 1) * rect.width / 2),
          clientY: Math.floor(rect.top + (1 - y) * rect.height / 2) };
        if (layer._findFeature(candidate)?.model === layer.model) {
          position = candidate;
          break;
        }
      }
    });
    if (!position) throw new Error('No visible model mesh was picked');
    const hit = layer._findFeature(position);
    const material = hit.mesh.program;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    const tooltip = layer._tooltip;
    const modelTooltip = !tooltip.hidden && tooltip.textContent === 'Eiffel Tower' &&
      container.style.cursor === 'pointer' && layer.hoveredFeature.mesh === hit.mesh &&
      hit.mesh.program === material && !layer.highlightedFeature;
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
    const tooltipRecreated = layer._tooltip !== tooltip && layer._tooltip.hidden;
    layer._shared._render();
    const restoredHit = layer._findFeature(position);
    const restoredGPU = restoredHit?.model === layer.model &&
      restoredHit.mesh.geometry.gl === layer.renderer.gl &&
      restoredHit.mesh.program.gl === layer.renderer.gl;
    let restoredTextures = true;
    layer.traverse(layer.model, mesh => {
      const texture = mesh.program?.uniforms.baseTexture?.value;
      if (texture && texture.gl !== layer.renderer.gl) restoredTextures = false;
    });
    layer.remove();
    return { centered, attached, rotation, scale, attribution, attributionRemoved, retained,
      modelTooltip, hoverOnly, tooltipRemoved, tooltipRecreated, restoredGPU, restoredTextures, realisticMaterials,
      depthOrderIndependent, linearTextures, transparentOrder, doubleSidedPasses,
      height: geometry.max[1] - geometry.min[1] };
  });
  assert.ok(result.height > 299 && result.height < 301);
  assert.equal(result.rotation, 0.8);
  assert.deepEqual(result.scale, [1.02, 1, 1.01]);
  for (const name of ['centered', 'attached', 'attribution', 'attributionRemoved', 'retained',
    'modelTooltip', 'hoverOnly', 'tooltipRemoved', 'tooltipRecreated', 'restoredGPU',
    'restoredTextures', 'realisticMaterials', 'depthOrderIndependent', 'linearTextures',
    'transparentOrder', 'doubleSidedPasses']) {
    assert.equal(result[name], true, name);
  }
  assert.deepEqual(this.threeRequests, []);
  assert.deepEqual(this.oglRequests, []);
});

Given('a map with the standalone 3D module and no dependency import map', async function () {
  this.oglRequests = [];
  this.threeRequests = [];
  this.page.on('request', request => {
    if (request.url().includes('unpkg.com/three@')) this.threeRequests.push(request.url());
    if (/unpkg\.com\/(ogl|earcut)@/.test(request.url())) this.oglRequests.push(request.url());
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
  await prepare3DChecks(this.page);
  await this.page.waitForFunction(() => window.test3d);
  assert.deepEqual(this.threeRequests, []);
  assert.deepEqual(this.oglRequests, []);
  assert.equal(await this.page.evaluate(() => [...document.scripts].every(script => !script.type)), true);
  assert.equal(await this.page.evaluate(() => L.Layer3D.SceneRenderer), undefined);
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
      L.Layer3D._renderers.get(map) === first &&
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
    first._animateZoom();
    first.remove();
    await new Promise(requestAnimationFrame);
    const retained = second.renderer === renderer && renderer.gl.canvas.isConnected && disposals === 0 &&
      second._shared === second && L.Layer3D._renderers.get(map) === second &&
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

Then('an unavailable WebGL context emits an error without leaving a canvas', async function () {
  const result = await this.page.evaluate(async () => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
    const layer = new test3d.Layer3D().addTo(test3d.map);
    let emitted;
    layer.on('error', event => { emitted = event.error; });
    const error = await nativeChecks.ready(layer).then(() => null, error => error);
    HTMLCanvasElement.prototype.getContext = getContext;
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
  await prepare3DChecks(this.page);
  await this.page.waitForFunction(() => window.map && typeof window.map.getPitch === 'function');
  await this.page.waitForFunction(() => layers._layers.every(({ layer }) =>
    !(layer instanceof L.Layer3D) || (layer.root && (!layer.options.model || layer.model) &&
      (!layer.options.source || layer.header))));
  await this.page.evaluate(() => Promise.all(layers._layers
    .filter(({ layer }) => !(layer instanceof L.Layer3D)).map(({ layer }) => layer.ready)));
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

When('I load a configured 3D model with {string}', async function (failure) {
  let body, status = 200;
  if (failure === 'HTTP error') { status = 404; body = 'Not found'; }
  else if (failure === 'unsupported glTF') {
    body = JSON.stringify({ asset: { version: '2.0' }, animations: [{}] });
  } else {
    body = Buffer.alloc(24);
    body.writeUInt32LE(0x46546c67, 0);
    body.writeUInt32LE(2, 4);
    body.writeUInt32LE(24, 8);
    body.writeUInt32LE(32, 12);
    body.writeUInt32LE(0x4e4f534a, 16);
  }
  await this.page.route('**/test/invalid-model.glb', route => route.fulfill({
    status, body, contentType: 'application/octet-stream',
  }));
  this.invalid3d = await this.page.evaluate(async () => {
    const layer = new L.Layer3D({ model: 'invalid-model.glb' }).addTo(test3d.map);
    let emitted;
    layer.on('error', event => { emitted = event.error; });
    const error = await nativeChecks.ready(layer).then(() => null, error => error);
    const result = { rejected: error instanceof Error, sameError: error === emitted,
      message: error?.message, noGeometry: !layer.model && layer.root.children.length === 0 };
    layer.remove();
    return { ...result, removed: !test3d.map.hasLayer(layer),
      noCanvas: !document.querySelector('.leaflet-3d') };
  });
});

Then('3D initialization emits {string} as an error', function (message) {
  assert.equal(this.invalid3d.rejected, true);
  assert.equal(this.invalid3d.sameError, true);
  assert.equal(this.invalid3d.message, message);
  assert.equal(this.invalid3d.removed, true);
  assert.equal(this.invalid3d.noCanvas, true);
});

Then('the failed model has no attached geometry', function () {
  assert.equal(this.invalid3d.noGeometry, true);
});

Then('building style for {int} storeys, {int} floors and ground {int} is {string}',
  async function (storeys, floors, ground, expected) {
    const result = await this.page.evaluate(({ storeys, floors, ground }) => {
      const layer = layers._layers.find(entry => entry.layer instanceof L.Layer3D &&
        !(entry.layer instanceof L.TerrainLayer) && entry.layer.options.source).layer;
      const feature = { properties: { h_et_max: storeys, nb_pl: floors, b_rdc: ground } };
      const style = layer.options.featureStyle(feature);
      return style === null ? null : {
        heights: `${style.top}/${style.bottom}`,
        color: layer.color(style.color),
        text: layer.options.tooltipContent(feature).textContent,
      };
    }, { storeys, floors, ground });
    if (expected === 'skip') { assert.equal(result, null); return; }
    assert.equal(result.heights, expected);
    assert.ok(Object.values(result.color).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(result.text.includes(`Estimated height: ${expected.split('/')[0]} m`));
    assert.ok(result.text.includes(`${storeys} storeys`));
    assert.equal(result.text.includes('elevated ground floor'), ground === 0);
  });

When('I select the {string} background in the 3D example', async function (background) {
  await this.page.evaluate(() => {
    const overlays = layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer3D &&
      !(entry.layer instanceof L.TerrainLayer))
      .map(entry => entry.layer);
    window.exampleSceneBefore = {
      overlays, renderer: overlays[0].renderer, canvas: overlays[0].renderer.gl.canvas,
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
    const overlays = layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer3D &&
      !(entry.layer instanceof L.TerrainLayer))
      .map(entry => entry.layer);
    const tower = overlays.find(layer => layer.model);
    return {
      enabled: overlays.length === 2 && overlays.every(layer => map.hasLayer(layer)),
      shared: overlays.every(layer => layer.renderer === before.renderer),
      canvas: document.querySelectorAll('.leaflet-3d').length === 1 &&
        before.canvas.isConnected && tower.renderer.gl.canvas === before.canvas,
      model: tower.model === before.model && tower.model.parent === tower.root,
      camera: map.getCenter().equals(before.center) && map.getZoom() === before.zoom &&
        map.getBearing() === before.bearing && map.getPitch() === before.pitch,
    };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
});

When('I disable and restore the 3D overlays through the layer control', async function () {
  const towerControl = this.page.getByRole('checkbox', { name: 'Eiffel Tower (3D)', exact: true });
  const buildingsControl = this.page.getByRole('checkbox', { name: 'Paris buildings (3D)', exact: true });
  await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    window.exampleOverlayBefore = { tower, model: tower.model, canvas: tower.renderer.gl.canvas };
  });
  await towerControl.uncheck();
  const towerDisabled = await this.page.evaluate(() => {
    const before = window.exampleOverlayBefore;
    const buildings = layers._layers.find(entry => entry.layer instanceof L.Layer3D &&
      !(entry.layer instanceof L.TerrainLayer) && entry.layer.options.source).layer;
    return !map.hasLayer(before.tower) && map.hasLayer(buildings) &&
      before.canvas.isConnected && buildings.renderer.gl.canvas === before.canvas &&
      !map.attributionControl.getContainer().textContent.includes('CC0 model:') &&
      !before.tower._tooltip;
  });
  await buildingsControl.uncheck();
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
      tower.renderer.gl.canvas !== before.canvas && tower.renderer.gl.canvas.isConnected &&
      map.attributionControl.getContainer().textContent.includes('CC0 model:') &&
      tower._tooltip.hidden;
  });
  await buildingsControl.check();
  const bothRestored = await this.page.evaluate(() => {
    const overlays = layers._layers.filter(entry => entry.overlay && entry.layer instanceof L.Layer3D &&
      !(entry.layer instanceof L.TerrainLayer))
      .map(entry => entry.layer);
    return overlays.every(layer => map.hasLayer(layer)) &&
      overlays[0].renderer === overlays[1].renderer &&
      document.querySelectorAll('.leaflet-3d').length === 1;
  });
  this.exampleOverlayChecks = { towerDisabled, allDisabled, towerRestored, bothRestored };
});

Then('the 3D canvas and model attribution follow the enabled overlays', function () {
  for (const [name, value] of Object.entries(this.exampleOverlayChecks)) assert.equal(value, true, name);
});

When('I hover and click the Eiffel Tower in the 3D example', { timeout: 60000 }, async function () {
  const target = await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    tower._shared._render();
    const rect = map.getContainer().getBoundingClientRect();
    let target;
    tower.traverse(tower.model, mesh => {
      if (target || !mesh.geometry) return;
      const { position, index } = mesh.geometry.attributes;
      const count = index?.count || position.count;
      for (let i = 0; i < count; i += 3) {
        const point = [0, 0, 0];
        for (let j = 0; j < 3; j++) {
          const offset = (index ? index.data[i + j] : i + j) * position.size;
          for (let axis = 0; axis < 3; axis++) point[axis] += position.data[offset + axis];
        }
        const world = new DOMPoint(...point.map(v => v / 3), 1).matrixTransform(new DOMMatrix(mesh.worldMatrix));
        const projected = world.matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const x = projected.x / projected.w, y = projected.y / projected.w;
        if (Math.abs(x) > 0.7 || Math.abs(y) > 0.7) continue;
        const candidate = {
          x: Math.round(rect.left + (x + 1) * rect.width / 2),
          y: Math.round(rect.top + (1 - y) * rect.height / 2),
        };
        const event = { clientX: candidate.x, clientY: candidate.y };
        const hit = tower._findFeature(event);
        if (hit?.model !== tower.model ||
            tower.raycast(event, tower.scene.children, true)[0]?.object !== hit.mesh) continue;
        const crs = map.options.crs;
        const origin = crs.project(tower._shared._sceneOrigin);
        const metres = Math.cos(tower._shared._sceneOrigin.lat * Math.PI / 180);
        target = { ...candidate, center: crs.unproject(new L.Point(
          origin.x + hit.point[0] / metres, origin.y - hit.point[2] / metres)),
        zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        break;
      }
    });
    if (!target) throw new Error('No visible tower triangle available for a mouse click');
    return target;
  });
  await this.page.mouse.move(target.x, target.y);
  await this.page.waitForFunction(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return tower._tooltip && !tower._tooltip.hidden &&
      tower.hoveredFeature?.model === tower.model;
  });
  this.exampleTowerHover = await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return { text: tower._tooltip.textContent, role: tower._tooltip.getAttribute('role'),
      cursor: map.getContainer().style.cursor };
  });
  const beforeClick = await this.page.evaluate(() => {
    window.exampleClickMovements = 0;
    map.on('movestart zoomstart', () => window.exampleClickMovements++);
    return map.getCenter();
  });
  await this.page.mouse.click(target.x, target.y);
  await this.page.evaluate(() => new Promise(requestAnimationFrame));
  this.exampleTowerZoom = await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return { zoom: map.getZoom(), center: map.getCenter(), movements: window.exampleClickMovements,
      clicked: tower.hoveredFeature?.model === tower.model,
      bearing: map.getBearing(), pitch: map.getPitch(),
      canvases: document.querySelectorAll('.leaflet-3d').length };
  });
  this.exampleTowerCenter = beforeClick;
  this.exampleTowerTarget = target;
  await this.page.mouse.move(810, 610);
  await this.page.waitForFunction(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return tower._tooltip.hidden && !tower.hoveredFeature &&
      map.getContainer().style.cursor !== 'pointer';
  });
});

Then('the tower information is shown without moving the map or pinning the tooltip', function () {
  const hover = this.exampleTowerHover;
  for (const text of ['Eiffel Tower', '330 m', '300 m structure', '1889', 'Gustave Eiffel', 'Champ de Mars']) {
    assert.ok(hover.text.includes(text), text);
  }
  assert.equal(hover.role, 'tooltip');
  assert.equal(hover.cursor, 'pointer');
  const zoom = this.exampleTowerZoom, target = this.exampleTowerTarget;
  assert.equal(zoom.zoom, target.zoom, 'Clicking does not change the zoom');
  assert.deepEqual(zoom.center, this.exampleTowerCenter, 'Clicking does not move the map');
  assert.equal(zoom.movements, 0);
  assert.equal(zoom.clicked, true);
  assert.equal(zoom.bearing, target.bearing);
  assert.equal(zoom.pitch, target.pitch);
  assert.equal(zoom.canvases, 1);
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
    const backend = tower;
    const bounds = nativeChecks.bounds(eiffel.model, backend);
    const height = bounds.max[1] - bounds.min[1];
    let meshes = 0;
    backend.traverse(eiffel.model, object => { if (object.geometry) meshes++; });
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
        const clip = new DOMPoint(x, 0, z, 1).matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        const actual = new L.Point((ndcX + 1) * size.x / 2, (1 - ndcY) * size.y / 2);
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
        const transformed = new DOMPoint(...foot.local, 1).matrixTransform(new DOMMatrix(eiffel.model.worldMatrix));
        const world = [transformed.x / transformed.w, transformed.y / transformed.w, transformed.z / transformed.w];
        const geographic = map.unproject(map.project(tower.location).add([world[0] * scale, world[2] * scale]), zoom);
        footprintErrors.push(geographic.distanceTo(new L.LatLng(...foot.latlng)));
        const point = map.project(new L.LatLng(...foot.latlng), baseLayer._tileZoom).subtract(level.origin);
        probe.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
        const ground = probe.getBoundingClientRect();
        const expected = new L.Point(ground.x - rect.x - borderX, ground.y - rect.y - borderY);
        const clip = new DOMPoint(...world, 1).matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        const actual = new L.Point((ndcX + 1) * size.x / 2, (1 - ndcY) * size.y / 2);
        tileErrors.push(actual.distanceTo(expected));
      }
      probe.remove();
    }

    const zoomErrors = [];
    let animatedFrames = 0;
    let hiddenFrames = 0;
    const shared = tower._shared;
    const render = shared._render;
    shared._render = function (...args) {
      render.apply(this, args);
      if (!map._animatingZoom) return;
      animatedFrames++;
      if (this.renderer.gl.canvas.hidden) hiddenFrames++;
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
        const clip = new DOMPoint(x, 0, z, 1).matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        const actual = new L.Point((ndcX + 1) * size.x / 2, (1 - ndcY) * size.y / 2);
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
    shared._render = render;

    map.setView(tower.location, 17, { animate: false });
    map.setPitch(60);
    map.setBearing(30);
    await new Promise(requestAnimationFrame);
    const renderer = tower.renderer;
    const gl = renderer.gl;
    tower._shared._render();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visiblePixels = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]) visiblePixels++;
    }
    const clickThrough = getComputedStyle(renderer.gl.canvas).pointerEvents === 'none';
    map.removeLayer(tower);
    const sharedCanvasRemains = document.querySelector('.leaflet-3d') === eiffel.renderer.gl.canvas;
    map.removeLayer(eiffel);
    const other3d = [];
    map.eachLayer(layer => { if (layer instanceof L.Layer3D) other3d.push(layer); });
    other3d.forEach(layer => layer.remove());
    const removed = !document.querySelector('.leaflet-3d');
    tower.addTo(map);
    eiffel.addTo(map);
    other3d.forEach(layer => layer.addTo(map));
    return {
      height, meshes, errors, footprintErrors, tileErrors, zoomErrors, animatedFrames, hiddenFrames,
      visiblePixels, clickThrough, removed, sharedCanvasRemains,
      restored: tower.renderer.width === map.getSize().x && tower.renderer.height === map.getSize().y,
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
  await prepare3DChecks(this.page);
  await this.page.waitForFunction(() => layers._layers.every(({ layer }) =>
    !(layer instanceof L.Layer3D) || (layer.root && (!layer.options.model || layer.model) &&
      (!layer.options.source || layer.header))));
  await this.page.evaluate(() => Promise.all(layers._layers
    .filter(({ layer }) => !(layer instanceof L.Layer3D)).map(({ layer }) => layer.ready)));
  await this.page.waitForFunction(() => {
    const buildings = Object.values(map._layers).find(layer => layer.group);
    const error = buildings && [...buildings._areas.values()].find(area => area.error);
    if (error) throw new Error(error.error);
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
    const backend = tower;
    const mesh = buildings.group.children[0];
    backend._updateWorldMatrix(mesh, true);
    const origin = map.options.crs.project(tower.location);
    const metres = Math.cos(tower.location.lat * Math.PI / 180);
    const hits = (lat, lon) => {
      const point = map.options.crs.project(new L.LatLng(lat, lon));
      return nativeChecks.intersections(mesh,
        [(point.x - origin.x) * metres, 100, -(point.y - origin.y) * metres],
        [0, -1, 0], backend).map(point => point[1]);
    };
    const elevated = map.options.crs.project(new L.LatLng(48.8587, 2.2962));
    const underside = nativeChecks.intersections(mesh,
      [(elevated.x - origin.x) * metres, 0, -(elevated.y - origin.y) * metres],
      [0, 1, 0], backend).map(point => point[1]);
    const geometry = mesh.geometry;
    backend._computeBounds(geometry);
    return {
      holes: hits(48.8587, 2.2957),
      underside,
      roof: hits(48.85855, 2.29555),
      multipart: [hits(48.8587, 2.2962), hits(48.8587, 2.2967)],
      min: geometry.bounds.min[1],
      max: geometry.bounds.max[1],
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
      content = await nativeChecks.loadBlock(buildings, area, [{ ...feature, id: 'custom-volume',
        properties: { height: 22 } }]);
      const geometry = content.mesh.geometry;
      L.Layer3D.prototype._computeBounds(geometry);
      buildings.options.featureStyle = () => ({ top: 3, bottom: 4 });
      const invalid = await nativeChecks.loadBlock(buildings, { coords, request: new AbortController() }, [feature]);
      const error = invalid.error;
      return { top: geometry.bounds.max[1], bottom: geometry.bounds.min[1],
        color: Array.from(geometry.attributes.color.data.slice(0, 3)),
        id: content.mesh.extras.featureFaces[0].id, error };
    } finally {
      buildings.options.featureStyle = original;
      buildings._releaseArea(content);
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
    const backend = tower;
    buildings.featureEvents = [];
    buildings.on('featurehover featureclick', event => {
      buildings.featureEvents.push({ type: event.type, id: event.feature?.id });
    });
    const range = buildings.group.children[0].extras.featureFaces[0];
    const origin = map.options.crs.project(tower.location);
    const point = map.options.crs.project(new L.LatLng(48.85855, 2.29555));
    const world = new DOMPoint((point.x - origin.x) * Math.cos(tower.location.lat * Math.PI / 180),
      15, -(point.y - origin.y) * Math.cos(tower.location.lat * Math.PI / 180), 1)
      .matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
    const x = world.x / world.w, y = world.y / world.w;
    const rect = map.getContainer().getBoundingClientRect();
    const position = {
      clientX: rect.left + (x + 1) * rect.width / 2,
      clientY: rect.top + (1 - y) * rect.height / 2
    };
    const before = Array.from(
      buildings.group.children[0].geometry.attributes.color.data.slice(range.vertexStart * 3, range.vertexStart * 3 + 3)
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
        buildings.group.children[0].geometry.attributes.color.data.slice(vertexStart * 3, vertexStart * 3 + 3)
      ),
      highlighted: buildings.highlightedFeature?.vertexStart,
      hovered: buildings.hoveredFeature?.vertexStart
    };
  }, interaction.vertexStart);
  this.hoverHighlight = highlightedColor.color.some((value, index) => value !== interaction.before[index]);
  const viewBeforeClick = await this.page.evaluate(() => ({
    center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch()
  }));
  await this.page.mouse.click(interaction.position.clientX, interaction.position.clientY);
  await this.page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(await this.page.evaluate(() => ({
    center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch()
  })), viewBeforeClick, 'Clicking a building must not change the map view');
  await this.page.evaluate(() => {
    for (const type of ['mouseout', 'mouseleave']) {
      map.getContainer().dispatchEvent(new MouseEvent(type, { relatedTarget: document.body }));
    }
  });
  this.clickCleared = await this.page.evaluate(() => {
      let buildings;
      map.eachLayer(layer => { if (layer.group) buildings = layer; });
      return buildings._tooltip.hidden && !buildings.hoveredFeature && !buildings.highlightedFeature &&
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
    const buildings = layers._layers.find(entry => entry.layer instanceof L.Layer3D &&
      !(entry.layer instanceof L.TerrainLayer) && entry.layer.options.source).layer;
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
  const away = () => this.page.evaluate(() => map.setView([48.85657, 2.39], 16, { animate: false }));
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
      buildings.renderer.gl.canvas.isConnected && buildings.group.children.length === 1;
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
  this.expandedForCameraChanges = this.buildingRequests.length > requestsBeforeCameraChanges;
  this.areaBudget = await this.page.evaluate(() => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    const z = buildings.header.minZoom;
    const nw = map.project([buildings.header.maxLat, buildings.header.minLon], z).divideBy(256).floor();
    const se = map.project([buildings.header.minLat, buildings.header.maxLon], z).divideBy(256).floor();
    return { areas: buildings._areas.size, inflight: buildings._inflight,
      maximum: (se.x - nw.x + 1) * (se.y - nw.y + 1) };
  });
  this.cancelledConstruction = await this.page.evaluate(async feature => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    const point = map.project(new L.LatLng(48.8585, 2.2955), buildings.header.minZoom).divideBy(256).floor();
    const area = { coords: { z: buildings.header.minZoom, x: point.x, y: point.y }, request: new AbortController() };
    const before = buildings.root.children.length;
    requestAnimationFrame(() => area.request.abort());
    await nativeChecks.loadBlock(buildings, area, Array(10000).fill(feature));
    return !area.done && !area.mesh && buildings.root.children.length === before;
  }, this.sampleBuildings[0]);
});

Then('3D coverage follows the viewport, releases distant volumes, and recovers from failures', function () {
  assert.equal(this.lastBuildingTile.z, 16);
  assert.equal(this.releasedAfterPan, true);
  assert.equal(this.reloadedOnReturn, true);
  assert.equal(this.independentBuildings, true);
  assert.equal(this.noRequestsWhenDisabled, true);
  assert.match(this.failureText, /HTTP 503/);
  assert.equal(this.recoveredBuildings, true);
  assert.equal(this.retainedAtLowZoom, true);
  assert.equal(this.expandedForCameraChanges, true);
  assert.ok(this.areaBudget.areas > 9 && this.areaBudget.areas <= this.areaBudget.maximum);
  assert.ok(this.areaBudget.inflight <= 2);
  assert.ok(this.maxBuildingConcurrency <= 2, `Concurrent archive requests: ${this.maxBuildingConcurrency}`);
  assert.equal(this.cancelledConstruction, true);
});
