import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';

Then('roof imagery follows raster loading, background changes and renderer ownership', { timeout: 30000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map, zoom = 17;
    const boundary = map.project(map.getCenter(), zoom).divideBy(256).floor().multiplyBy(256);
    map.setView(map.unproject(boundary, zoom), zoom, { animate: false });
    map.setPitch(0); map.setBearing(0);
    const owner = new L.Layer({ source: { type: '3d' } }).addTo(map);
    const layer = new L.Layer({ source: { type: '3d', roofTexture: true } }).addTo(map);
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
    const first = new L.Layer({ source: { type: 'pmtiles', url: 'roof-first.pmtiles', archive: archive(false) } });
    const second = new L.Layer({ source: { type: 'pmtiles', url: 'roof-second.pmtiles', archive: archive(true) } });
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
    const getHeader = L.Layer.types.pmtiles.prototype.getHeader;
    const getZxy = L.Layer.types.pmtiles.prototype.getZxy;
    const buildingHeader = L.Layer.types['3d'].prototype.getHeader;
    const buildingTile = L.Layer.types['3d'].prototype.getZxy;
    let release;
    let pending = new Promise(resolve => { release = resolve; });
    L.Layer.types.pmtiles.prototype.getHeader = function () {
      return this.url.endsWith('/fixture-terrain.pmtiles') ? Promise.resolve(header) : getHeader.call(this);
    };
    L.Layer.types.pmtiles.prototype.getZxy = async function (z, x, y, signal) {
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
    L.Layer.types['3d'].prototype.getHeader = async () => header;
    L.Layer.types['3d'].prototype.getZxy = async () => ({
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
    const terrain = new L.Layer({ source: { type: 'terrain', url: 'fixture-terrain.pmtiles' } });
    const raster = new L.Layer({ source: { type: 'pmtiles', url: 'fixture-raster.pmtiles',
      archive: { getHeader: async () => ({ ...header, tileType: 2 }), getZxy: async () => ({ data: image }) } } });
    const buildings = new L.Layer({ source: { type: '3d', url: 'fixture-buildings.pmtiles', roofTexture: true,
      featureStyle: () => ({ top: 15 }) } }).addTo(map);
    const modelLocation = map.unproject(center.add([20, 20]), zoom);
    const model = new L.Layer({ source: { type: '3d', center: [modelLocation.lat, modelLocation.lng] } }).addTo(map);
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
      L.Layer.types.pmtiles.prototype.getHeader = getHeader;
      L.Layer.types.pmtiles.prototype.getZxy = getZxy;
      L.Layer.types['3d'].prototype.getHeader = buildingHeader;
      L.Layer.types['3d'].prototype.getZxy = buildingTile;
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

Then('raster zoom transitions stay paused between WebGPU frames and resume on removal', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const tiles = new L.TileLayer('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=').addTo(map);
    const first = new L.Layer({ source: { type: '3d' } }).addTo(map), second = new L.Layer({ source: { type: '3d' } }).addTo(map);
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
      while (performance.now() < deadline) { /* Simulate a slow WebGPU frame. */ }
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
