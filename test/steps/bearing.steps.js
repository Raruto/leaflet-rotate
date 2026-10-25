import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

Then('rotation is enabled on the map', async function () {
  const result = await this.page.evaluate(() => ({
    option: map.options.rotate,
    property: map._rotate,
    pane: map._rotatePane instanceof HTMLDivElement,
  }));
  assert.deepEqual(result, { option: true, property: true, pane: true });
});

Then('the map view contains the {string} bounds', function (layerName) {
  assert.equal(this.fittedBounds, true, `${layerName} bounds were not fitted`);
});

Then('the rectangle is fitted at zoom 14', function () {
  assert.equal(this.rectangleZoom, 14);
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

When('I animate the bearing to 90 degrees', async function () {
  this.animatedBearings = await this.page.evaluate(() => new Promise(resolve => {
    const bearings = [];
    const onRotate = () => {
      const bearing = map.getBearing();
      bearings.push(bearing);
      if (Math.abs(bearing - 90) < 1e-6) {
        map.off('rotate', onRotate);
        map.setBearing(15);
        map.compassBearing._onDeviceOrientation({ alpha: null, absolute: true });
        resolve({ bearings, afterUnavailableHeading: map.getBearing() });
      }
    };

    map.setBearing(0);
    map.on('rotate', onRotate);
    map.setBearing(90, { animate: true, duration: 0.15, easeLinearity: 0.25 });
  }));
});

Then('the bearing reaches 90 degrees gradually', function () {
  assert.ok(this.animatedBearings.bearings.length > 1);
  assert.ok(this.animatedBearings.bearings.some(bearing => bearing > 0 && bearing < 90));
  assert.equal(this.animatedBearings.bearings.at(-1), 90);
  assert.ok(Math.abs(this.animatedBearings.afterUnavailableHeading - 15) < 1e-6);
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

When('I rotate and zoom two fingers over a vector path', async function () {
  this.gesturePathPositions = await this.page.evaluate(() => {
    map.options.zoomAnimation = true;
    map.setView([55, 10], 6, { animate: false });
    const location = L.latLng(55.1, 10.1);
    const path = L.circleMarker(location, { radius: 8 }).addTo(map);
    const container = map.getContainer();
    const center = map.getSize().divideBy(2);
    const initial = map.getBearing(),
      initialZoom = map.getZoom();
    const touches = (radius, angle) => {
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      return [-1, 1].map((sign, identifier) => new Touch({
        identifier,
        target: container,
        clientX: container.getBoundingClientRect().left + center.x + sign * dx,
        clientY: container.getBoundingClientRect().top + center.y + sign * dy,
      }));
    };
    const dispatch = (type, activeTouches) => {
      const event = new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: activeTouches, targetTouches: activeTouches, changedTouches: activeTouches,
      });
      (type === 'touchstart' ? container : document).dispatchEvent(event);
    };
    const measure = () => {
      const element = path.getElement();
      const bounds = element.getBBox();
      const screen = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        .matrixTransform(element.getScreenCTM());
      const rect = container.getBoundingClientRect();
      const expected = map.latLngToContainerPoint(location);
      return [screen.x - rect.left - expected.x, screen.y - rect.top - expected.y];
    };

    dispatch('touchstart', touches(40, 0));
    dispatch('touchmove', touches(60, Math.PI / 6));
    const during = measure();
    const bearingDuring = map.getBearing(),
      zoomDuring = map.getZoom();
    dispatch('touchend', []);
    map.setBearing(initial);
    return {
      delta: during,
      bearingChange: Math.abs(bearingDuring - initial),
      zoomChange: zoomDuring - initialZoom,
    };
  });
});

When('I disable touch rotation and rotate two fingers', async function () {
  this.bearings = await this.page.evaluate(() => {
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const touches = (x1, y1, x2, y2) => [
      new Touch({ identifier: 1, target: container, clientX: centerX + x1, clientY: centerY + y1 }),
      new Touch({ identifier: 2, target: container, clientX: centerX + x2, clientY: centerY + y2 }),
    ];
    const dispatch = (target, type, activeTouches, changedTouches = activeTouches) => {
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: activeTouches,
        targetTouches: activeTouches,
        changedTouches,
      }));
    };

    map.touchRotate.disable();
    const before = map.getBearing();
    dispatch(container, 'touchstart', touches(-30, 0, 30, 0));
    dispatch(document, 'touchmove', touches(0, -30, 0, 30));
    dispatch(document, 'touchend', [], touches(0, -30, 0, 30));
    return [before, map.getBearing(), map.touchGestures.rotate];
  });
});

Then('its drag callbacks match the marker and pointer coordinates', function () {
  assert.equal(this.markerPosition.moved, true, JSON.stringify(this.markerPosition));
  assert.ok(Math.hypot(...this.markerPosition.delta) < 2, JSON.stringify(this.markerPosition));
  assert.ok(this.markerPosition.callbacks.length > 1, JSON.stringify(this.markerPosition));
  const lastCallback = this.markerPosition.callbacks.at(-1);
  assert.ok(Math.abs(this.markerPosition.marker.lat - lastCallback[0]) < 1e-7, JSON.stringify(this.markerPosition));
  assert.ok(Math.abs(this.markerPosition.marker.lng - lastCallback[1]) < 1e-7, JSON.stringify(this.markerPosition));
});
