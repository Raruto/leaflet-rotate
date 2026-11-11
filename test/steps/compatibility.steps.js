import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';

Given('the plugin is loaded as an ES module from {string}', { timeout: 30000 }, async function (entry) {
  const version = process.env.LEAFLET_VERSION === '2' ? '2.0.0-beta.3' : '1.9.4';
  const script = process.env.LEAFLET_VERSION === '2' ? 'leaflet-global.js' : 'leaflet-src.js';
  await this.page.route('**/test/modules.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@${version}/dist/leaflet.css">
      <script src="https://unpkg.com/leaflet@${version}/dist/${script}"></script>
      </head><body><div id="map" style="width:800px;height:600px"></div>
      <script type="module">
        const L = globalThis.L;
        const coreSetPosition = L.DomUtil.setPosition;
        const { DomUtil, RotateControl } = await import('../${entry}');
        const map = new L.Map('map', {center:[55,10], zoom:6, rotate:true, bearing:30, pitch:40});
        const marker = new L.Marker([55.1,10.1], {rotation:Math.PI/2}).addTo(map);
        const point = new L.Point(12,34), element = document.createElement('div');
        DomUtil.setPosition(element, point, Math.PI/2, point);
        const rotatedPosition = L.DomUtil.getPosition(element);
        L.DomUtil.setPosition(element, new L.Point(56,78));
        const nativePosition = DomUtil.getPosition(element);
        const location = new L.LatLng(55.2,10.2);
        const roundtrip = map.containerPointToLatLng(map.latLngToContainerPoint(location));
        window.moduleResult = {
          version: L.version, hasGlobal: !!globalThis.L,
          coreUnchanged: coreSetPosition === L.DomUtil.setPosition,
          bearing: map.getBearing(), pitch: map.getPitch(),
          control: map.rotateControl instanceof RotateControl,
          baseControlPosition: new L.Control().getPosition(),
          markerTransform: marker.getElement().style.transform,
          popupAnchor: marker._getPopupAnchor(),
          tooltipAnchor: marker._getTooltipAnchor(),
          roundtripError: map.project(location).distanceTo(map.project(roundtrip)),
          rotatedPosition, nativePosition,
        };
        map.remove();
      </script></body></html>`,
  }));
  this.moduleErrors = [];
  this.page.on('pageerror', error => this.moduleErrors.push(error.message));
  await this.page.goto(`${this.baseUrl}/test/modules.html`);
  await this.page.waitForFunction(() => window.moduleResult);
});

Then('rotation, pitch and DOM positioning work with a global Leaflet namespace', async function () {
  assert.deepEqual(this.moduleErrors, []);
  const result = await this.page.evaluate(() => moduleResult);
  assert.equal(result.hasGlobal, true);
  if (process.env.LEAFLET_VERSION === '2') assert.equal(result.coreUnchanged, true);
  assert.ok(Math.abs(result.bearing - 30) < 1e-9);
  assert.ok(Math.abs(result.pitch - 40) < 1e-9);
  assert.equal(result.control, true);
  assert.equal(result.baseControlPosition, 'topright');
  assert.match(result.markerTransform, /rotate\(1\.570/);
  assert.deepEqual(result.popupAnchor, [1, -34]);
  assert.deepEqual(result.tooltipAnchor, [16, -28]);
  assert.ok(result.roundtripError < 1, JSON.stringify(result));
  assert.deepEqual(result.rotatedPosition, { x: 12, y: 34 });
  assert.deepEqual(result.nativePosition, { x: 56, y: 78 });
});

Then('the pinch zoom handler controls only the shared zoom gesture', async function () {
  const result = await this.page.evaluate(() => {
    const handler = L.version.startsWith('2.') ? map.pinchZoom : map.touchZoom;
    handler.disable();
    const disabled = !map.touchGestures.zoom;
    const rotateEnabled = map.touchGestures.rotate;
    const pitchEnabled = map.touchGestures.pitch;
    handler.enable();
    return { disabled, enabled: map.touchGestures.zoom, rotateEnabled, pitchEnabled,
      shared: map.touchGestures.enabled() };
  });
  assert.deepEqual(result, { disabled: true, enabled: true, rotateEnabled: true, pitchEnabled: true, shared: true });
});
