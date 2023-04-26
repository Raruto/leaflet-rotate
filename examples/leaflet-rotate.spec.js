/**
 * examples/leaflet-rotate.html
 */

import * as assert from 'uvu/assert';
import { suite } from '../test/setup/http_server.js';

const test = suite('examples/leaflet-rotate.html');

test('rotate enabled', async ({ page }) => {
    const { option, property, pane }  = await page.evaluate(() => new Promise(resolve => {
      resolve({
        option: map.options.rotate,
        property: map._rotate,
        pane: map._rotatePane instanceof HTMLDivElement
      });
    }));
    assert.is(option, true);
    assert.is(property, true);
    assert.is(pane, true);
});

test('set bearing and zoom in/out', async ({ page }) => {
  const { bearing_0, bearing_1, bearing_2 } = await page.evaluate(() => new Promise(resolve => {
    let bearing_0, bearing_1, bearing_2;
    map.setBearing(10); bearing_0 = map.getBearing();
    map.zoomIn();       bearing_1 = map.getBearing();
    map.zoomIn();       bearing_2 = map.getBearing();
    resolve({ bearing_0, bearing_1, bearing_2 });
  }));
  assert.is(bearing_0, 10);
  assert.is(bearing_1, 10);
  assert.is(bearing_2, 10);
});

/**
 * @see https://github.com/Raruto/leaflet-rotate/issues/25
 */
test('fit bounds zoom', async ({ page }) => {
  const { zoom_1, zoom_2 } = await page.evaluate(() => new Promise(resolve => {
    let zoom_1, zoom_2;
    const bounds = [[60.81123, 25.71632], [60.81028, 25.73166], [60.7997, 25.72892], [60.80061, 25.71362]];
    // 1. draw a small rectangle on map
    L.rectangle(bounds).addTo(map);
    // 2. set a zoom level really far away from that bounds
    map.setZoom(0, {animate: false});
    // 3. trigger the bug
    map.fitBounds(bounds, { animate: false }); zoom_1 = map.getZoom();
    map.fitBounds(bounds, { animate: false }); zoom_2 = map.getZoom();
    resolve({ zoom_1, zoom_2 });
  }));
  assert.is(zoom_1, 14);
  assert.is(zoom_2, 14);
});

/**
 * @see https://github.com/Raruto/leaflet-rotate/issues/28
 */
test('pan inside marker', async ({ page }) => {
  const { autoPanOnFocus, bounds_0, bounds_1, bounds_2, bounds_3, bounds_4, bounds_5 } = await page.evaluate(() => new Promise(resolve => {
    let bounds_0, bounds_1, bounds_2, bounds_3, bounds_4, bounds_5;

    // ref: https://github.com/Raruto/leaflet-rotate/blob/580362a2e308d955d9eb082697dc042f82e3da0f/test/index.html#L122-L135
    // markers[4] is 'Trondheim': [63.41, 10.41]
    const { autoPanOnFocus } = markers[4].options;

    map.setBearing(50);

    // Play a bit with various center positions
    map.setView(markers[4].getLatLng(), 30, { animate: false });               bounds_0 = map.getBounds();
    map.panBy([0, map._container.clientHeight/2], { animate: false });         bounds_1 = map.getBounds();
    map.panBy([0, -markers[4].getElement().clientHeight], { animate: false }); bounds_2 = map.getBounds();

    // Try to run this multiple times to check an unexpected behavior
    map.panInside(markers[4].getLatLng());                                     bounds_3 = map.getBounds();
    map.panInside(markers[4].getLatLng());                                     bounds_4 = map.getBounds();
    markers[4].getElement().click();                                           bounds_5 = map.getBounds();

    resolve({ autoPanOnFocus, bounds_0, bounds_1, bounds_2, bounds_3, bounds_4, bounds_5 })

  }));

  assert.is(autoPanOnFocus, true);

  assert.snapshot(
    JSON.stringify(bounds_0),
    JSON.stringify({ _southWest: { lat: 63.40997749296754, lng: 10.409954421520982 }, _northEast: { lat: 63.41002250228354, lng: 10.410045638381689 } })
  );

  assert.snapshot(
    JSON.stringify(bounds_1),
    JSON.stringify({ _southWest: { lat: 63.40997315210509, lng: 10.409965979159589 }, _northEast: { lat: 63.4100181614279, lng: 10.410057196020334 } })
  );

  assert.snapshot(
    JSON.stringify(bounds_2),
    JSON.stringify({ _southWest: { lat: 63.409974140857145, lng: 10.40996334658635 }, _northEast: { lat: 63.410019150178414, lng: 10.410054563447094 } })
  );

  assert.snapshot(JSON.stringify(bounds_2), JSON.stringify(bounds_3));
  assert.snapshot(JSON.stringify(bounds_3), JSON.stringify(bounds_4));
  assert.snapshot(JSON.stringify(bounds_4), JSON.stringify(bounds_5));

});

test.run();