import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';

Then('the offline Paris trees render and recover after toggling', { timeout: 60000 }, async function () {
  const loaded = () => this.page.waitForFunction(() => {
    const tree = layers._layers.find(entry => entry.name === 'Trees').layer;
    const error = [...tree._areas.values()].find(area => area.error);
    if (error) throw new Error(error.error);
    return tree._inflight === 0 && [...tree._areas.values()].some(area => area.buildings > 0);
  }, null, { timeout: 45000 });
  await loaded();
  const result = await this.page.evaluate(() => {
    const tree = layers._layers.find(entry => entry.name === 'Trees').layer;
    const features = tree.root.children.flatMap(mesh => mesh.extras.featureFaces);
    const result = {
      count: features.length, inventory: features.every(f => f.id === f.properties.idbase),
      vertices: tree.root.children.every(mesh => [...mesh.geometry.attributes.position.data].every(Number.isFinite)),
      shared: tree.renderer === layers._layers.find(entry => entry.name === 'Buildings').layer.renderer,
    };
    window.treeRendererBefore = tree.renderer;
    window.treeMeshesBefore = [...tree.root.children];
    return result;
  });
  assert.ok(result.count > 0);
  assert.equal(result.inventory, true);
  assert.equal(result.vertices, true);
  assert.equal(result.shared, true);
  const control = this.page.getByRole('checkbox', { name: 'Trees', exact: true });
  await control.uncheck();
  assert.equal(await this.page.evaluate(() => {
    const tree = layers._layers.find(entry => entry.name === 'Trees').layer;
    return !tree._map && tree._areas.size === 0 && window.treeRendererBefore.canvas.isConnected;
  }), true);
  await control.check();
  await loaded();
  assert.equal(await this.page.evaluate(() => {
    const tree = layers._layers.find(entry => entry.name === 'Trees').layer;
    return tree.renderer === window.treeRendererBefore &&
      tree.root.children.every(mesh => !window.treeMeshesBefore.includes(mesh));
  }), true);
});

Then('tree points preserve dimensions, terrain elevation, picking and validation', async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer({ source: { type: '3d' } }).addTo(map);
    await nativeChecks.ready(layer);
    const center = map.getCenter(), zoom = 16;
    const tile = map.project(center, zoom).divideBy(256).floor();
    const style = { top: 20, trunkRadius: 0.5, crownRadius: 4, crownBottom: 7, color: 0x55863d };
    layer.options.featureStyle = feature => feature.properties.skip ? null : style;
    const feature = { type: 'Feature', id: 123, properties: { genre: 'Platanus' },
      geometry: { type: 'Point', coordinates: [center.lng, center.lat] } };
    const area = () => ({ coords: { z: zoom, x: tile.x, y: tile.y }, request: new AbortController() });
    const areas = [];
    const load = async (features, block = area()) => {
      areas.push(block);
      return nativeChecks.loadBlock(layer, block, features);
    };
    const previousTerrain = map._terrain3D;
    map._terrain3D = { _getElevation: () => 50 };
    const errors = [];
    layer.on('error', ({ error }) => errors.push(error.message));
    try {
      const round = await load([feature, { ...feature, properties: { skip: true } }]);
      const mesh = round.mesh;
      const positions = mesh.geometry.attributes.position.data;
      const normals = mesh.geometry.attributes.normal.data;
      const colors = mesh.geometry.attributes.color.data;
      const xs = [], ys = [], zs = [], trunkXs = [];
      for (let i = 0; i < positions.length; i += 3) {
        xs.push(positions[i]); ys.push(positions[i + 1]); zs.push(positions[i + 2]);
        if (positions[i + 1] === 50) trunkXs.push(positions[i]);
      }
      const bounds = [Math.min(...ys), Math.max(...ys), Math.max(...xs) - Math.min(...xs),
        Math.max(...zs) - Math.min(...zs), Math.max(...trunkXs) - Math.min(...trunkXs)];
      const normalLengths = [];
      for (let i = 0; i < normals.length; i += 3) normalLengths.push(Math.hypot(...normals.slice(i, i + 3)));
      layer._shared._updateWorldMatrix(layer.root, true);
      const intersections = nativeChecks.intersections(mesh, [0, 100, 0], [0, -1, 0], layer);
      const face = mesh.extras.featureFaces[0];
      const before = [...colors];
      layer._setHighlight({ ...face, mesh });
      layer._setHighlight(null);
      style.crownShape = 'cone';
      const cone = await load([feature]);
      const outside = await load([feature], { ...area(), coords: { z: zoom, x: tile.x + 1, y: tile.y } });
      style.trunkRadius = -1;
      const invalid = await load([feature]);
      return {
        bounds, unitNormals: normalLengths.every(n => Math.abs(n - 1) < 1e-6),
        finite: [...positions].every(Number.isFinite), picked: intersections.length > 0,
        topHit: intersections[0]?.[1], featureId: face.id, properties: face.properties,
        loaded: round.buildings, skipped: round.skipped, colorRestored: before.every((v, i) => v === colors[i]),
        coneVertices: cone.mesh.geometry.attributes.position.count,
        roundVertices: mesh.geometry.attributes.position.count, outside: outside.buildings,
        invalid: !invalid.mesh && !!invalid.error, errors,
      };
    } finally {
      map._terrain3D = previousTerrain;
      for (const block of areas) layer._releaseArea(block);
      layer.remove();
    }
  });
  assert.deepEqual(result.bounds, [50, 70, 8, 8, 1]);
  assert.equal(result.finite, true);
  assert.equal(result.unitNormals, true);
  assert.equal(result.picked, true);
  assert.ok(Math.abs(result.topHit - 70) < 1e-5);
  assert.equal(result.featureId, 123);
  assert.equal(result.properties.genre, 'Platanus');
  assert.equal(result.loaded, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.outside, 0);
  assert.equal(result.colorRestored, true);
  assert.ok(result.coneVertices < result.roundVertices);
  assert.equal(result.invalid, true);
  assert.deepEqual(result.errors, ['Invalid tree dimensions or crown shape']);
});

Then('tree inventory attributes control dimensions, crowns and tooltip estimates', async function () {
  const result = await this.page.evaluate(() => {
    const entry = layers._layers.find(entry => entry.name === 'Trees');
    const tree = entry.layer;
    const properties = { typeemplacement: 'Arbre', hauteurenm: 20, circonferenceencm: 185,
      genre: 'Platanus', espece: 'x hispanica', libellefrancais: '<img src=x onerror=alert(1)>',
      stadedeveloppement: 'Adulte', remarquable: 'OUI' };
    const style = p => tree.options.featureStyle({ properties: { ...properties, ...p } });
    const tooltip = tree.options.tooltipContent({ properties });
    const missing = tree.options.tooltipContent({ properties: { ...properties, hauteurenm: 0, circonferenceencm: null } });
    return {
      enabled: map.hasLayer(tree), source: tree.options.url,
      measured: style({}), conifer: style({ genre: 'Picea' }), palm: style({ genre: 'Phoenix' }),
      estimates: ['Jeune (arbre)', 'Jeune (arbre)Adulte', 'Adulte', 'Mature', null].map(stage =>
        style({ hauteurenm: 0, circonferenceencm: 0, stadedeveloppement: stage })),
      stump: style({ typeemplacement: 'Souche' }), empty: style({ typeemplacement: 'Emplacement libre' }),
      safe: tooltip.children.length === 0 && tooltip.textContent.includes('<img src=x'),
      tooltip: tooltip.textContent, missing: missing.textContent,
    };
  });
  assert.equal(result.enabled, true);
  assert.equal(result.source, 'data/paris-trees.pmtiles');
  assert.equal(result.measured.top, 20);
  assert.ok(Math.abs(result.measured.trunkRadius - 185 / (200 * Math.PI)) < 1e-10);
  assert.equal(result.measured.crownShape, 'round');
  assert.equal(result.conifer.crownShape, 'cone');
  assert.ok(result.conifer.crownRadius < result.measured.crownRadius);
  assert.ok(result.palm.crownBottom > result.measured.crownBottom);
  assert.deepEqual(result.estimates.map(s => s.top), [4, 8, 15, 20, 10]);
  assert.ok(result.estimates.every(s => s.trunkRadius === s.top / 80));
  assert.equal(result.stump, null);
  assert.equal(result.empty, null);
  assert.equal(result.safe, true);
  assert.match(result.tooltip, /20 m \(recorded\)/);
  assert.match(result.tooltip, /185 cm \(recorded\)/);
  assert.match(result.tooltip, /Remarkable tree/);
  assert.match(result.missing, /estimated from development stage/);
  assert.match(result.missing, /estimated from height/);
});
