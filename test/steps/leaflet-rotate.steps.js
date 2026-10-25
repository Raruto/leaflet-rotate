import assert from 'node:assert/strict';
import { After, AfterAll, Before, BeforeAll, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import { startServer } from '../../build/server.js';

setDefaultTimeout(10000);

let server;
let browser;
let baseUrl;

BeforeAll(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

AfterAll({ timeout: 30000 }, async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

Before(async function () {
  this.context = await browser.newContext();
  await this.context.route(/.html$/, async route => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/https:\/\/unpkg\.com\/leaflet-rotate@(.*?)\//g, '../')
      .replace(/leaflet-rotate@(.*?)\//g, '../');
    await route.fulfill({ response, body, headers: response.headers() });
  });
  this.page = await this.context.newPage();
});

After(async function () {
  await this.context.close();
});

Given('the example page is open', async function () {
  await this.page.goto(`${baseUrl}/examples/leaflet-rotate.html`);
  await this.page.waitForLoadState('domcontentloaded');
});

Then('rotation is enabled on the map', async function () {
  const result = await this.page.evaluate(() => ({
    option: map.options.rotate,
    property: map._rotate,
    pane: map._rotatePane instanceof HTMLDivElement,
  }));
  assert.deepEqual(result, { option: true, property: true, pane: true });
});

When('I set the bearing to 10 and zoom in twice', async function () {
  this.bearings = await this.page.evaluate(() => {
    map.setBearing(10);
    const initial = map.getBearing();
    map.zoomIn();
    const firstZoom = map.getBearing();
    map.zoomIn();
    return [initial, firstZoom, map.getBearing()];
  });
});

When('I set the bearing to 10 and change the view twice', async function () {
  this.bearings = await this.page.evaluate(() => {
    map.setBearing(10);
    const initial = map.getBearing();
    map.setView({ lat: 50.5, lng: 30.5 }, 15, {});
    const firstView = map.getBearing();
    map.setView({ lat: 51.5, lng: 34.5 }, 17, {});
    return [initial, firstView, map.getBearing()];
  });
});

Then('the bearing remains 10', function () {
  assert.deepEqual(this.bearings, [10, 10, 10]);
});

When('I fit the same bounds twice', async function () {
  this.zooms = await this.page.evaluate(() => {
    const bounds = [[60.81123, 25.71632], [60.81028, 25.73166], [60.7997, 25.72892], [60.80061, 25.71362]];
    L.rectangle(bounds).addTo(map);
    map.setZoom(0, { animate: false });
    map.fitBounds(bounds, { animate: false });
    const first = map.getZoom();
    map.fitBounds(bounds, { animate: false });
    return [first, map.getZoom()];
  });
});

Then('the map zoom is 14 both times', function () {
  assert.deepEqual(this.zooms, [14, 14]);
});

When('I pan inside the Trondheim marker', async function () {
  this.markerBounds = await this.page.evaluate(() => {
    const marker = markers[4];
    const bounds = [];
    map.setBearing(50);
    map.setView(marker.getLatLng(), 30, { animate: false });
    bounds.push(map.getBounds());
    map.panBy([0, map._container.clientHeight / 2], { animate: false });
    bounds.push(map.getBounds());
    map.panBy([0, -marker.getElement().clientHeight], { animate: false });
    bounds.push(map.getBounds());
    map.panInside(marker.getLatLng());
    bounds.push(map.getBounds());
    map.panInside(marker.getLatLng());
    bounds.push(map.getBounds());
    marker.getElement().click();
    bounds.push(map.getBounds());
    return { autoPanOnFocus: marker.options.autoPanOnFocus, bounds };
  });
});

Then('panning inside keeps the expected bounds', function () {
  const { autoPanOnFocus, bounds } = this.markerBounds;
  assert.equal(autoPanOnFocus, true);
  const expected = [
    { _southWest: { lat: 63.40997749296754, lng: 10.409954421520982 }, _northEast: { lat: 63.41002250228354, lng: 10.410045638381689 } },
    { _southWest: { lat: 63.40997315210509, lng: 10.409965979159589 }, _northEast: { lat: 63.4100181614279, lng: 10.410057196020334 } },
    { _southWest: { lat: 63.409974140857145, lng: 10.40996334658635 }, _northEast: { lat: 63.410019150178414, lng: 10.410054563447094 } },
  ];
  for (let index = 0; index < expected.length; index++) {
    for (const corner of ['_southWest', '_northEast']) {
      for (const coordinate of ['lat', 'lng']) {
        assert.ok(Math.abs(bounds[index][corner][coordinate] - expected[index][corner][coordinate]) < 1e-6);
      }
    }
  }
  for (const index of [3, 4, 5]) {
    for (const corner of ['_southWest', '_northEast']) {
      for (const coordinate of ['lat', 'lng']) {
        assert.ok(Math.abs(bounds[index][corner][coordinate] - bounds[index - 1][corner][coordinate]) < 1e-6);
      }
    }
  }
});

Then('the draggable marker has one drag listener and one drag-end listener', async function () {
  const counts = await this.page.evaluate(() => {
    const marker = markers.find(item => item.dragging.enabled());
    if (!marker) throw new Error('No draggable marker on test page');
    return [
      marker.dragging._draggable._events.drag.length,
      marker.dragging._draggable._events.dragend.length,
    ];
  });
  assert.deepEqual(counts, [1, 1]);
});
