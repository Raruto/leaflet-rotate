import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import { prepare3DChecks } from '../../support/3d.js';

Then('cancelled building downloads recover without errors or stale meshes', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer({ source: { type: '3d', url: 'paris-buildings.pmtiles' } }).addTo(map);
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

Then('building blocks cover pitched views and retain overlapping areas', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer({ source: { type: '3d', url: 'paris-buildings.pmtiles' } }).addTo(map);
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

Then('a source block with {string} reports {string} without attaching a mesh', async function (invalid, message) {
  const result = await this.page.evaluate(async invalid => {
    const layer = new L.Layer({ source: { type: '3d' } }).addTo(test3d.map);
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

Then('building style for {int} storeys, {int} floors and ground {int} is {string}',
  async function (storeys, floors, ground, expected) {
    const result = await this.page.evaluate(({ storeys, floors, ground }) => {
      const layer = layers._layers.find(entry => entry.layer instanceof L.Layer.types['3d'] &&
        !(entry.layer instanceof L.Layer.types.terrain) && entry.layer.url).layer;
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
  await this.page.goto(`${this.baseUrl}/examples/leaflet-rotate-3d.html`, { waitUntil: 'domcontentloaded' });
  await prepare3DChecks(this.page);
  await this.page.evaluate(() => Promise.all(layers._layers.map(({ layer }) => layer.ready)));
  await this.page.waitForFunction(() => layers._layers.every(({ layer }) =>
    !(layer instanceof L.Layer.types['3d']) || (layer.root && (!layer.modelUrl || layer.model) &&
      (!layer.url || layer.header))));
  await this.page.evaluate(() => Promise.all(layers._layers
    .filter(({ layer }) => !(layer instanceof L.Layer.types['3d'])).map(({ layer }) => layer.ready)));
  await this.page.waitForFunction(() => {
    const buildings = layers._layers.find(entry => entry.name === 'Buildings').layer;
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
      if (layer.model) tower = layer;
      if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer;
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
        Object.values(map._layers).filter(layer => layer instanceof L.Layer.types['3d'])
          .every(layer => layer.renderer === buildings.renderer),
      true3DLayer: buildings instanceof L.Layer.types['3d'] && !(buildings instanceof L.GridLayer),
      noSubclass: buildings.constructor === L.Layer.types['3d'],
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
    const buildings = layers._layers.find(entry => entry.name === 'Buildings').layer;
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
      L.Layer.types['3d'].prototype._computeBounds(geometry);
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
      if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer;
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
    const before = buildings.group.children[0].highlight ?? null;
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
    map.eachLayer(layer => { if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer; });
    return {
      highlight: buildings.group.children[0].highlight,
      highlighted: buildings.highlightedFeature?.vertexStart,
      hovered: buildings.hoveredFeature?.vertexStart
    };
  }, interaction.vertexStart);
  this.hoverHighlight = interaction.before === null &&
    highlightedColor.highlight?.[0] === interaction.vertexStart;
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
      map.eachLayer(layer => { if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer; });
      return buildings._tooltip.hidden && !buildings.hoveredFeature && !buildings.highlightedFeature &&
        map.getContainer().style.cursor !== 'pointer';
    });
  assert.equal(this.hoverHighlight, true, JSON.stringify({ interaction, highlightedColor }));
  assert.equal(this.clickCleared, true);
  const events = await this.page.evaluate(() => {
    const buildings = layers._layers.find(entry => entry.name === 'Buildings').layer;
    return buildings.featureEvents;
  });
  assert.ok(events.some(event => event.type === 'featurehover' && event.id));
  assert.ok(events.some(event => event.type === 'featureclick' && event.id));
});

When('I move and toggle the Paris building volumes', { timeout: 60000 }, async function () {
  const status = text => this.page.waitForFunction(text => {
    const buildings = layers._layers.find(entry => entry.layer instanceof L.Layer.types['3d'] &&
      !(entry.layer instanceof L.Layer.types.terrain) && entry.layer.url).layer;
    if (buildings._inflight || !buildings._areas.size) return false;
    const areas = [...buildings._areas.values()];
    if (text === 'Unable to load') return areas.some(area => area.error);
    if (areas.some(area => !area.done)) return false;
    const loaded = areas.reduce((sum, area) => sum + (area.buildings || 0), 0);
    return loaded === (text === '2 Paris building volumes loaded' ? 2 : 0);
  }, text);
  const meshes = () => this.page.evaluate(() => {
    let buildings;
    map.eachLayer(layer => { if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer; });
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

  await this.page.getByRole('checkbox', { name: 'Eiffel Tower', exact: true }).uncheck();
  this.independentBuildings = await this.page.evaluate(() => {
    let eiffel, buildings;
    map.eachLayer(layer => {
      if (layer.model) eiffel = layer;
      if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer;
    });
    return !eiffel && buildings.group.parent === buildings.scene &&
      buildings.renderer.canvas.isConnected && buildings.group.children.length === 1;
  });

  await this.page.getByRole('checkbox', { name: 'Buildings', exact: true }).uncheck();
  await this.page.waitForTimeout(100);
  const requestsWhenDisabled = this.buildingRequests.length;
  await this.page.evaluate(() => map.panBy([10, 10], { animate: false }));
  await this.page.waitForTimeout(500);
  this.noRequestsWhenDisabled = this.buildingRequests.length === requestsWhenDisabled;

  this.failBuildings = true;
  await this.page.getByRole('checkbox', { name: 'Buildings', exact: true }).check();
  await status('Unable to load');
  this.failureText = await this.page.evaluate(() => {
    const buildings = layers._layers.find(entry => entry.name === 'Buildings').layer;
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
    map.eachLayer(layer => { if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer; });
    const z = buildings.header.minZoom;
    const nw = map.project([buildings.header.maxLat, buildings.header.minLon], z).divideBy(256).floor();
    const se = map.project([buildings.header.minLat, buildings.header.maxLon], z).divideBy(256).floor();
    return { areas: buildings._areas.size, inflight: buildings._inflight,
      maximum: (se.x - nw.x + 1) * (se.y - nw.y + 1) };
  });
  this.cancelledConstruction = await this.page.evaluate(async feature => {
    let buildings;
    map.eachLayer(layer => { if (layer.options.url?.endsWith('paris-buildings.pmtiles')) buildings = layer; });
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
