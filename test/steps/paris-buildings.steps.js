import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';

const ring = (west, south, size = 0.0004) => [
  [west, south], [west + size, south], [west + size, south + size],
  [west, south + size], [west, south]
];

Given('the Paris buildings example is open with sample volumes', { timeout: 60000 }, async function () {
  this.buildingRequests = [];
  this.failBuildings = false;
  this.tooManyBuildings = false;
  await this.page.route('https://opendata.paris.fr/**', async route => {
    this.buildingRequests.push(route.request().url());
    if (this.failBuildings) {
      await route.fulfill({ status: 503, body: 'Unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    if (this.tooManyBuildings) {
      await route.fulfill({
        contentType: 'application/geo+json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ type: 'FeatureCollection', features: Array(5001).fill(null) })
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/geo+json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
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
        ]
      })
    });
  });
  await this.page.setViewportSize({ width: 800, height: 600 });
  await this.page.goto(`${this.baseUrl}/examples/leaflet-rotate-eiffel.html`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForFunction(() =>
    document.getElementById('buildings-status').textContent.startsWith('2 Paris building volumes loaded'),
  null, { timeout: 45000 });
});

Then('the building volumes preserve courtyards and elevated floors', async function () {
  const result = await this.page.evaluate(async () => {
    const THREE = await import('three');
    let tower, buildings;
    map.eachLayer(layer => {
      if (layer.renderer) tower = layer;
      if (layer.group) buildings = layer;
    });
    const mesh = buildings.group.children[0];
    mesh.updateMatrixWorld(true);
    const origin = map.options.crs.project(tower.location);
    const metres = Math.cos(tower.location.lat * Math.PI / 180);
    const hits = (lat, lon) => {
      const point = map.options.crs.project(new L.LatLng(lat, lon));
      const ray = new THREE.Raycaster(
        new THREE.Vector3((point.x - origin.x) * metres, 100, -(point.y - origin.y) * metres),
        new THREE.Vector3(0, -1, 0)
      );
      return ray.intersectObject(mesh).map(hit => hit.point.y);
    };
    const elevated = map.options.crs.project(new L.LatLng(48.8587, 2.2962));
    const underside = new THREE.Raycaster(
      new THREE.Vector3((elevated.x - origin.x) * metres, 0, -(elevated.y - origin.y) * metres),
      new THREE.Vector3(0, 1, 0)
    ).intersectObject(mesh).map(hit => hit.point.y);
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    return {
      holes: hits(48.8587, 2.2957),
      underside,
      roof: hits(48.85855, 2.29555),
      multipart: [hits(48.8587, 2.2962), hits(48.8587, 2.2967)],
      min: geometry.boundingBox.min.y,
      max: geometry.boundingBox.max.y,
      sharedScene: buildings.group.parent === tower.root,
      meshes: buildings.group.children.length,
      status: document.getElementById('buildings-status').textContent
    };
  });
  assert.deepEqual(result.holes, []);
  assert.ok(result.underside.some(height => Math.abs(height - 9) < 0.001));
  assert.ok(result.roof.some(height => Math.abs(height - 15) < 0.001));
  assert.ok(result.multipart.every(hits => hits.some(height => Math.abs(height - 15) < 0.001)));
  assert.ok(Math.abs(result.min) < 0.001);
  assert.ok(Math.abs(result.max - 15) < 0.001);
  assert.equal(result.sharedScene, true);
  assert.equal(result.meshes, 1);
  assert.match(result.status, /1 skipped/);
});

When('I move and toggle the Paris building volumes', { timeout: 60000 }, async function () {
  await this.page.evaluate(() => map.setView([48.85657, 2.33307], 16, { animate: false }));
  await this.page.waitForFunction(() =>
    document.getElementById('buildings-status').textContent.startsWith('2 Paris building volumes loaded'));
  await this.page.waitForTimeout(500);
  const requests = this.buildingRequests.length;
  assert.ok(requests >= 2);
  const viewport = new URL(this.buildingRequests[requests - 1]);
  this.lastBuildingQuery = viewport.searchParams.get('where');
  await this.page.getByRole('checkbox', { name: 'Eiffel Tower (3D)', exact: true }).uncheck();
  this.independentBuildings = await this.page.evaluate(() => {
    let tower, buildings;
    map.eachLayer(layer => {
      if (layer.renderer) tower = layer;
      if (layer.group) buildings = layer;
    });
    return !tower.model.parent && buildings.group.parent === tower.root;
  });
  await this.page.getByRole('checkbox', { name: 'Paris building volumes (3D)', exact: true }).uncheck();
  await this.page.evaluate(() => map.panBy([10, 10], { animate: false }));
  await this.page.waitForTimeout(500);
  this.noRequestsWhenDisabled = this.buildingRequests.length === requests;
  this.failBuildings = true;
  await this.page.getByRole('checkbox', { name: 'Paris building volumes (3D)', exact: true }).check();
  await this.page.getByRole('button', { name: 'Retry', exact: true }).last().waitFor({ state: 'visible' });
  this.failureText = await this.page.locator('#buildings-status').textContent();
  this.failBuildings = false;
  await this.page.locator('#buildings-retry').click();
  await this.page.waitForFunction(() =>
    document.getElementById('buildings-status').textContent.startsWith('2 Paris building volumes loaded'));
  this.recoveredBuildings = await this.page.locator('#buildings-retry').isHidden();
  this.tooManyBuildings = true;
  await this.page.evaluate(() => map.setBearing(map.getBearing() + 15));
  await this.page.waitForFunction(() =>
    document.getElementById('buildings-status').textContent.startsWith('More than 5,000'));
  this.noTruncatedBuildings = await this.page.evaluate(() => {
    let buildings;
    map.eachLayer(layer => { if (layer.group) buildings = layer; });
    return buildings.group.children.length === 0;
  });
  const beforeZoomOut = this.buildingRequests.length;
  await this.page.evaluate(() => map.setZoom(15, { animate: false }));
  await this.page.waitForFunction(() =>
    document.getElementById('buildings-status').textContent.startsWith('Zoom in'));
  this.noRequestsBelowMinimumZoom = this.buildingRequests.length === beforeZoomOut;
});

Then('building requests follow the viewport and recover from failures', function () {
  assert.match(this.lastBuildingQuery, /intersects\(geom,geom'POLYGON/);
  assert.equal(this.independentBuildings, true);
  assert.equal(this.noRequestsWhenDisabled, true);
  assert.match(this.failureText, /HTTP 503/);
  assert.equal(this.recoveredBuildings, true);
  assert.equal(this.noTruncatedBuildings, true);
  assert.equal(this.noRequestsBelowMinimumZoom, true);
});
