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

When('I set the map pitch to 45 degrees', async function () {
  this.pitchProjection = await this.page.evaluate(() => {
    const location = new L.LatLng(54, 12);
    map.setView(new L.LatLng(55, 10), 5, { animate: false });
    const flat = map.latLngToContainerPoint(location);
    map.setPitch(90);
    const maxPitch = map.getPitch();
    map.setPitch(45);
    const layerPoint = map.latLngToLayerPoint(location),
      pitched = map.layerPointToContainerPoint(layerPoint),
      roundTripPoint = map.containerPointToLayerPoint(pitched),
      centerPoint = map.latLngToContainerPoint(map.getCenter()),
      size = map.getSize();

    return {
      pitch: map.getPitch(),
      maxPitch,
      bearing: map.getBearing(),
      flat,
      pitched,
      layerPoint,
      roundTripPoint,
      centerPoint,
      size,
      transform: map._rotatePane.style.transform,
    };
  });
});

Then('map coordinates stay consistent with the pitched view', function () {
  const { pitch, maxPitch, bearing, flat, pitched, layerPoint, roundTripPoint, centerPoint, size, transform } = this.pitchProjection;
  assert.equal(pitch, 45);
  assert.equal(maxPitch, 85);
  assert.ok(Math.abs(bearing - 30) < 1e-9);
  assert.match(transform, /rotateX\(45deg\)/);
  assert.ok(Math.abs(Number(transform.match(/perspective\(([\d.]+)px\)/)[1]) - size.y * 1.5) < 1);
  assert.ok(Math.abs(flat.y - pitched.y) > 0.1);
  const details = JSON.stringify({ flat, pitched, layerPoint, roundTripPoint, centerPoint, size });
  assert.ok(Math.abs(roundTripPoint.x - layerPoint.x) < 1e-6, details);
  assert.ok(Math.abs(roundTripPoint.y - layerPoint.y) < 1e-6, details);
  assert.ok(Math.abs(centerPoint.x - size.x / 2) < 1, details);
  assert.ok(Math.abs(centerPoint.y - size.y / 2) < 1, details);
});

When('I change pitch and bearing with Ctrl-drag', async function () {
  await this.page.evaluate(() => {
    map.setPitch(0);
    map.setBearing(0);
  });
  const bounds = await this.page.locator('#map').boundingBox();
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    panePos = await this.page.evaluate(() => {
      const pos = map._getMapPanePos();
      return [pos.x, pos.y];
    });
  await this.page.keyboard.down('Control');
  await this.page.mouse.move(start.x, start.y);
  await this.page.mouse.down();
  await this.page.mouse.move(start.x + 80, start.y - 80, { steps: 4 });
  await this.page.mouse.up();
  await this.page.keyboard.up('Control');
  this.ctrlPitchDrag = await this.page.evaluate(() => {
    const pane = map._getMapPanePos();
    return {
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      finalPanePos: [pane.x, pane.y],
    };
  });
  this.ctrlPitchDrag.panePos = panePos;
});

Then('pitch and bearing change without moving the map pane', function () {
  assert.equal(this.ctrlPitchDrag.pitch, 40);
  assert.equal(this.ctrlPitchDrag.bearing, 64);
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(this.ctrlPitchDrag.panePos[i] - this.ctrlPitchDrag.finalPanePos[i]) < 0.01);
  }
});

When('I drag the pitched map', async function () {
  const dragStart = await this.page.evaluate(() => {
    map.setBearing(30);
    map.setPitch(45);
    map.setView(new L.LatLng(55, 10), 5, { animate: false });
    const location = new L.LatLng(55, 10),
      marker = new L.CircleMarker(location, { radius: 8 }).addTo(map),
      pin = new L.Marker(location, {
        icon: new L.DivIcon({ className: '', html: 'x', iconSize: [4, 4], iconAnchor: [2, 2] }),
      }).addTo(map),
      element = marker.getElement(),
      pinElement = pin.getElement(),
      container = map.getContainer(),
      rect = container.getBoundingClientRect(),
      start = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const vectorScreenPoint = () => {
      const bounds = element.getBoundingClientRect();
      return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
    };
    const before = vectorScreenPoint(),
      pinBoundsBefore = pinElement.getBoundingClientRect(),
      pinBefore = [pinBoundsBefore.left + pinBoundsBefore.width / 2, pinBoundsBefore.top + pinBoundsBefore.height / 2];
    window.__pitchPanTest = { element, pinElement, vectorScreenPoint, before, pinBefore, rect };
    return start;
  });
  await this.page.mouse.move(dragStart[0], dragStart[1]);
  await this.page.mouse.down();
  await this.page.mouse.move(dragStart[0] + 70, dragStart[1] + 35, { steps: 4 });
  await this.page.mouse.up();
  this.pitchedDrag = await this.page.evaluate(() => {
    const { pinElement, vectorScreenPoint } = window.__pitchPanTest,
      after = vectorScreenPoint(),
      pinBoundsAfter = pinElement.getBoundingClientRect(),
      pinAfter = [pinBoundsAfter.left + pinBoundsAfter.width / 2, pinBoundsAfter.top + pinBoundsAfter.height / 2],
      container = map.getContainer().getBoundingClientRect(),
      expected = map.latLngToContainerPoint(new L.LatLng(55, 10));
    return {
      vector: [after[0] - container.left, after[1] - container.top],
      expected: [expected.x, expected.y],
      vectorError: Math.hypot(after[0] - container.left - expected.x, after[1] - container.top - expected.y),
      pinError: Math.hypot(pinAfter[0] - container.left - expected.x, pinAfter[1] - container.top - expected.y),
    };
  });
  this.repeatedPitchPanErrors = [];
  for (let i = 0; i < 2; i++) {
    const bounds = await this.page.locator('#map').boundingBox(),
      center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await this.page.mouse.move(center.x, center.y);
    await this.page.mouse.down();
    await this.page.mouse.move(center.x + 40, center.y + 20, { steps: 3 });
    await this.page.mouse.up();
    this.repeatedPitchPanErrors.push(await this.page.evaluate(() => {
      const { element, pinElement } = window.__pitchPanTest,
        bounds = element.getBoundingClientRect(),
        vector = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
        pinBounds = pinElement.getBoundingClientRect(),
        pin = [pinBounds.left + pinBounds.width / 2, pinBounds.top + pinBounds.height / 2],
        container = map.getContainer().getBoundingClientRect(),
        expected = map.latLngToContainerPoint(new L.LatLng(55, 10));
      return [
        Math.hypot(vector[0] - container.left - expected.x, vector[1] - container.top - expected.y),
        Math.hypot(pin[0] - container.left - expected.x, pin[1] - container.top - expected.y),
      ];
    }));
  }
  await this.page.evaluate(() => { delete window.__pitchPanTest; });
});

Then('vector layers stay aligned with their map coordinates', function () {
  if (this.vectorAlignment) {
    assert.ok(this.zoomAfterOffCenter > 5, 'Off-center wheel zoom did not run');
    assert.ok(
      this.pitchTransformError < 0.1,
      `Pitch changed the projected map pane by ${this.pitchTransformError}px`
    );
    const centerDistance = Math.hypot(
      this.centerBeforeCtrlDrag[0] - this.centerAfterCtrlDrag[0],
      this.centerBeforeCtrlDrag[1] - this.centerAfterCtrlDrag[1]
    );
    assert.ok(centerDistance < 0.01, `Map center moved ${centerDistance} projected pixels`);
    for (const layer of this.vectorAlignment) {
      const error = Math.hypot(layer.actual[0] - layer.expected[0], layer.actual[1] - layer.expected[1]);
      assert.ok(error < 2, `${layer.name} is ${error}px from its geographic position: ${JSON.stringify(layer)}`);
    }
    return;
  }
  assert.ok(this.pitchedDrag.vectorError < 2, JSON.stringify(this.pitchedDrag));
  assert.ok(this.pitchedDrag.pinError < 2, JSON.stringify(this.pitchedDrag));
  for (const errors of this.repeatedPitchPanErrors) {
    assert.ok(errors[0] < 2 && errors[1] < 2, JSON.stringify(this.repeatedPitchPanErrors));
  }
});

When('I pan a highly pitched map in several directions', { timeout: 30000 }, async function () {
  this.pitchPanErrors = [];
  this.page.on('pageerror', error => this.pitchPanErrors.push(error.message));
  await this.page.evaluate(() => {
    map.setView([50, 5], 5, { animate: false });
    map.setBearing(45);
    map.setPitch(70);
    map.options.inertia = false;
    const size = map.getSize(),
      locations = [[0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65]]
        .map(([x, y]) => map.containerPointToLatLng([size.x * x, size.y * y])),
      marker = new L.Marker(locations[0]).addTo(map),
      vector = new L.CircleMarker(locations[0], { radius: 4 }).addTo(map),
      bounds = element => {
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      };
    window.__pitchRelease = {
      locations,
      resets: 0,
      measure: () => ({
        points: locations.map(ll => map.latLngToContainerPoint(ll)),
        marker: bounds(marker.getElement()),
        vector: bounds(vector.getElement()),
      }),
    };
    map.on('viewreset', () => window.__pitchRelease.resets++);
  });
  this.pitchReleases = [];
  for (const [dx, dy] of [[0, -60], [-60, 0], [30, 50], [30, 10]]) {
    const bounds = await this.page.locator('#map').boundingBox(),
      x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx, y + dy, { steps: 10 });
    const before = await this.page.evaluate(() => window.__pitchRelease.measure());
    await this.page.mouse.up();
    await this.page.waitForTimeout(50);
    this.pitchReleases.push(await this.page.evaluate(before => {
      const state = window.__pitchRelease,
        after = state.measure(),
        center = map.project(map.getCenter()),
        size = map.getSize(),
        bearing = map.getBearing() * Math.PI / 180,
        pitch = map.getPitch() * Math.PI / 180,
        perspective = size.y * 1.5,
        projectionErrors = state.locations.map(ll => {
          const point = map.project(ll).subtract(center),
            x = point.x * Math.cos(bearing) - point.y * Math.sin(bearing),
            y = point.x * Math.sin(bearing) + point.y * Math.cos(bearing),
            scale = perspective / (perspective - y * Math.sin(pitch)),
            actual = map.latLngToContainerPoint(ll);
          return Math.hypot(actual.x - size.x / 2 - x * scale, actual.y - size.y / 2 - y * Math.cos(pitch) * scale);
        });
      return { before, after, resets: state.resets, projectionErrors };
    }, before));
  }
  this.pitchPanToError = await this.page.evaluate(() => {
    const center = map.getCenter(),
      target = new L.LatLng(center.lat + 0.1, center.lng + 0.1);
    map.panTo(target, { animate: false });
    return map.latLngToContainerPoint(target).distanceTo(map.getSize().divideBy(2));
  });
});

Then('releasing the map does not jump or reset its layers', function () {
  assert.deepEqual(this.pitchPanErrors, [], 'Pitched dragging must not throw JavaScript errors');
  assert.ok(this.pitchPanToError < 1.5, `panTo missed its target by ${this.pitchPanToError}px`);
  for (const result of this.pitchReleases) {
    assert.equal(result.resets, 0, 'Releasing a pan must not reset the view or reload its tiles');
    for (let i = 0; i < result.before.points.length; i++) {
      const before = result.before.points[i], after = result.after.points[i];
      assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 0.1, JSON.stringify(result));
    }
    for (const layer of ['marker', 'vector']) {
      assert.ok(result.before[layer].every((value, i) => Math.abs(value - result.after[layer][i]) < 0.1), JSON.stringify(result));
    }
    assert.ok(result.projectionErrors.every(error => error < 1.5), JSON.stringify(result));
  }
});

When('I zoom off-center then rotate the map', async function () {
  await this.page.evaluate(() => {
    map.setView(new L.LatLng(55, 10), 5, { animate: false });
    map.setBearing(30);
    map.setPitch(0);
  });
  const mapBounds = await this.page.locator('#map').boundingBox(),
    zoomPoint = { x: mapBounds.x + mapBounds.width * 0.9, y: mapBounds.y + mapBounds.height * 0.1 };
  await this.page.mouse.move(zoomPoint.x, zoomPoint.y);
  await this.page.mouse.wheel(0, -480);
  await this.page.waitForTimeout(500);

  const positions = await this.page.evaluate(() => {
    const location = map.containerPointToLatLng([600, 170]),
      marker = new L.Marker(location, {
        icon: new L.DivIcon({ className: '', html: 'x', iconSize: [8, 8], iconAnchor: [4, 4] }),
      }).addTo(map),
      circle = new L.CircleMarker(location, { radius: 5 }).addTo(map),
      measure = () => {
        const expected = map.latLngToContainerPoint(location),
          container = map.getContainer().getBoundingClientRect(),
          vectorBounds = circle.getElement().getBoundingClientRect(),
          markerBounds = marker.getElement().getBoundingClientRect();
        return [
          {
            name: 'vector',
            expected: [expected.x, expected.y],
            actual: [vectorBounds.left + vectorBounds.width / 2 - container.left, vectorBounds.top + vectorBounds.height / 2 - container.top],
          },
          {
            name: 'marker',
            expected: [expected.x, expected.y],
            actual: [markerBounds.left + markerBounds.width / 2 - container.left, markerBounds.top + markerBounds.height / 2 - container.top],
          },
        ];
      };

    const positions = [measure()];
    const pane = map._rotatePane,
      pivot = map._getPixelCenter(),
      size = map.getSize(),
      beforeTransform = new DOMMatrix(getComputedStyle(pane).transform),
      testPoints = [[0, 0], [size.x, 0], [0, size.y], [size.x, size.y]]
        .map(([x, y]) => ({
          x,
          y,
          point: new DOMPoint(x, y).matrixTransform(beforeTransform),
        }));
    map.setPitch(1);
    const afterTransform = new DOMMatrix(getComputedStyle(pane).transform),
      pitch = Math.PI / 180,
      perspective = size.y * 1.5;
    const pitchTransformError = Math.max(...testPoints.map(({ x: pointX, y: pointY, point }) => {
      const x = point.x / point.w - pivot.x,
        y = point.y / point.w - pivot.y,
        factor = perspective / (perspective - y * Math.sin(pitch)),
        expectedX = pivot.x + x * factor,
        expectedY = pivot.y + y * Math.cos(pitch) * factor,
        actual = new DOMPoint(pointX, pointY).matrixTransform(afterTransform);
      return Math.hypot(actual.x / actual.w - expectedX, actual.y / actual.w - expectedY);
    }));
    positions.push(measure());
    map.setBearing(50);
    positions.push(measure());
    map.setPitch(35);
    positions.push(measure());
    map.panBy([50, 25], { animate: false });
    positions.push(measure());
    window.__rotateAlignment = { marker, circle, measure };
    const center = map.project(map.getCenter());
    return {
      positions: positions.flatMap((position, index) => position.map(layer => ({ ...layer, step: index }))),
      centerBeforeCtrlDrag: [center.x, center.y],
      zoomAfterOffCenter: map.getZoom(),
      pitchTransformError,
    };
  });
  const bounds = await this.page.locator('#map').boundingBox(),
    start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await this.page.keyboard.down('Control');
  await this.page.mouse.move(start.x, start.y);
  await this.page.mouse.down();
  await this.page.mouse.move(start.x + 24, start.y - 18, { steps: 3 });
  await this.page.mouse.up();
  await this.page.keyboard.up('Control');
  const afterCtrlDrag = await this.page.evaluate(() => {
    const positions = window.__rotateAlignment.measure();
    const center = map.project(map.getCenter());
    window.__rotateAlignment.marker.remove();
    window.__rotateAlignment.circle.remove();
    delete window.__rotateAlignment;
    return {
      positions: positions.map(layer => ({ ...layer, step: 'Ctrl-drag' })),
      center: [center.x, center.y],
    };
  });
  this.vectorAlignment = [...positions.positions, ...afterCtrlDrag.positions];
  this.centerBeforeCtrlDrag = positions.centerBeforeCtrlDrag;
  this.centerAfterCtrlDrag = afterCtrlDrag.center;
  this.zoomAfterOffCenter = positions.zoomAfterOffCenter;
  this.pitchTransformError = positions.pitchTransformError;
});

When('I pan the map then Ctrl-drag', async function () {
  await this.page.evaluate(() => {
    map.setView(new L.LatLng(55, 10), 5, { animate: false });
    map.setBearing(30);
    map.setPitch(0);
  });
  const bounds = await this.page.locator('#map').boundingBox();
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await this.page.mouse.move(x, y);
  await this.page.mouse.down();
  await this.page.mouse.move(x + 70, y + 35, { steps: 4 });
  await this.page.mouse.up();
  await this.page.waitForTimeout(400);
  this.centerBeforeCtrlDrag = await this.page.evaluate(() => {
    const center = map.project(map.getCenter()),
      pane = map._getMapPanePos();
    return { point: [center.x, center.y], pane: [pane.x, pane.y] };
  });

  await this.page.keyboard.down('Control');
  await this.page.mouse.move(x + 70, y + 35);
  await this.page.mouse.down();
  await this.page.mouse.move(x + 90, y + 20, { steps: 3 });
  await this.page.mouse.up();
  await this.page.keyboard.up('Control');
  this.centerAfterCtrlDrag = await this.page.evaluate(() => {
    const center = map.project(map.getCenter()),
      pane = map._getMapPanePos();
    return {
      point: [center.x, center.y],
      pane: [pane.x, pane.y],
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  });
});

Then('the map center stays stable during Ctrl-drag', function () {
  const distance = Math.hypot(
    this.centerBeforeCtrlDrag.point[0] - this.centerAfterCtrlDrag.point[0],
    this.centerBeforeCtrlDrag.point[1] - this.centerAfterCtrlDrag.point[1]
  );
  assert.ok(distance < 0.01, `Map center moved ${distance} projected pixels: ${JSON.stringify({
    before: this.centerBeforeCtrlDrag,
    after: this.centerAfterCtrlDrag,
  })}`);
});

When('I Ctrl-drag while a wheel zoom is pending', async function () {
  await this.page.evaluate(() => {
    map.setView(new L.LatLng(55, 10), 5, { animate: false });
    map.setBearing(0);
    map.setPitch(0);
    map.options.wheelDebounceTime = 500;
  });
  const bounds = await this.page.locator('#map').boundingBox();
  const zoomPoint = { x: bounds.x + bounds.width * 0.9, y: bounds.y + bounds.height * 0.1 },
    dragPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await this.page.mouse.move(zoomPoint.x, zoomPoint.y);
  await this.page.mouse.wheel(0, -120);
  this.pendingZoomBeforeDrag = await this.page.evaluate(() => ({
    zoom: map.getZoom(),
    center: map.project(map.getCenter()),
  }));

  await this.page.keyboard.down('Control');
  await this.page.mouse.move(dragPoint.x, dragPoint.y);
  await this.page.mouse.down();
  await this.page.mouse.move(dragPoint.x + 20, dragPoint.y - 15);
  await this.page.waitForTimeout(600);
  this.pendingZoomAfterDrag = await this.page.evaluate(() => ({
    zoom: map.getZoom(),
    center: map.project(map.getCenter()),
  }));
  await this.page.mouse.up();
  await this.page.keyboard.up('Control');
});

Then('the pending wheel zoom does not move the map', function () {
  assert.equal(this.pendingZoomAfterDrag.zoom, this.pendingZoomBeforeDrag.zoom);
  const distance = Math.hypot(
    this.pendingZoomBeforeDrag.center.x - this.pendingZoomAfterDrag.center.x,
    this.pendingZoomBeforeDrag.center.y - this.pendingZoomAfterDrag.center.y
  );
  assert.ok(distance < 0.01, `Map center moved ${distance} projected pixels`);
});

When('I fit the same bounds twice', async function () {
  this.zooms = await this.page.evaluate(() => {
    const bounds = [[60.81123, 25.71632], [60.81028, 25.73166], [60.7997, 25.72892], [60.80061, 25.71362]];
    new L.Rectangle(bounds).addTo(map);
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
    const location = new L.LatLng(55.1, 10.1);
    const path = new L.CircleMarker(location, { radius: 8 }).addTo(map);
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

When('I animate a zoom from a low level on a rotated map', async function () {
  this.lowZoomJump = await this.page.evaluate(async () => {
    const style = document.createElement('style');
    style.textContent = '*{transition:none!important}';
    document.head.appendChild(style);
    map.setView([50, 5], 1, { animate: false });
    map.setBearing(30);
    await new Promise(resolve => setTimeout(resolve, 300));
    const element = circle.getElement(),
      center = () => {
        const bounds = element.getBoundingClientRect();
        return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
      };
    map.setZoom(3);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animated = center();
    await new Promise(resolve => setTimeout(resolve, 500));
    const settled = center();
    style.remove();
    return Math.hypot(animated[0] - settled[0], animated[1] - settled[1]);
  });
});

Then('vector layers do not jump at the end of the zoom animation', function () {
  assert.ok(this.lowZoomJump < 3, `Vector layer jumped ${this.lowZoomJump}px`);
});

When('I zoom around an off-center point on a pitched map', async function () {
  this.zoomAroundDrift = await this.page.evaluate(async () => {
    map.setView([50, 5], 6, { animate: false });
    map.setBearing(30);
    map.setPitch(60);
    const size = map.getSize(),
      point = new L.Point(size.x * 0.1, size.y * 0.9),
      latlng = map.containerPointToLatLng(point);
    map.setZoomAround(point, 7, { animate: false });
    const drift = map.latLngToContainerPoint(latlng).distanceTo(point);
    let animated = false;
    map.once('zoomanim', () => animated = true);
    map.setZoomAround(new L.Point(size.x * 0.85, size.y * 0.15), 8);
    await new Promise(resolve => setTimeout(resolve, 400));
    return { drift, animated };
  });
});

Then('the point under the cursor stays in place', function () {
  assert.ok(this.zoomAroundDrift.drift < 2, `Point under the cursor moved ${this.zoomAroundDrift.drift}px`);
  assert.equal(this.zoomAroundDrift.animated, true, 'Zoom toward the horizon was not animated');
});

When('I right-drag horizontally below the map center', async function () {
  await this.page.evaluate(() => {
    map.setPitch(0);
    map.setBearing(0);
    window.__contextMenus = 0;
    map.on('contextmenu', () => window.__contextMenus++);
  });
  const bounds = await this.page.locator('#map').boundingBox(),
    start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 + 50 };
  await this.page.mouse.move(start.x, start.y);
  await this.page.mouse.down({ button: 'right' });
  await this.page.mouse.move(start.x + 50, start.y, { steps: 5 });
  await this.page.mouse.up({ button: 'right' });
  await this.page.locator('#map').dispatchEvent('contextmenu', { button: 2, clientX: start.x + 50, clientY: start.y });
  this.rightDrag = await this.page.evaluate(() => ({
    bearing: map.getBearing(),
    contextMenus: window.__contextMenus,
  }));
});

Then('the map rotates counterclockwise without opening the context menu', function () {
  assert.ok(Math.abs(this.rightDrag.bearing - 320) < 1e-6, JSON.stringify(this.rightDrag));
  assert.equal(this.rightDrag.contextMenus, 0);
});

When('a context menu event fires immediately on right-button press', async function () {
  this.earlyContextMenu = await this.page.evaluate(() => {
    let contextMenus = 0;
    map.on('contextmenu', () => contextMenus++);
    const pointer = L.version.startsWith('2.');
    const Event = pointer ? PointerEvent : MouseEvent;
    map.getContainer().dispatchEvent(new Event(pointer ? 'pointerdown' : 'mousedown', {
      button: 2, buttons: 2, bubbles: true, cancelable: true,
    }));
    const menu = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
    map.getContainer().dispatchEvent(menu);
    document.dispatchEvent(new Event(pointer ? 'pointerup' : 'mouseup', { button: 2 }));
    return { prevented: menu.defaultPrevented, contextMenus };
  });
});

Then('the early context menu is suppressed', function () {
  assert.deepEqual(this.earlyContextMenu, { prevented: true, contextMenus: 0 });
});

When('I look at a high zoom map with a high pitch', async function () {
  this.highPitch = await this.page.evaluate(async () => {
    const results = [];
    for (const pitch of [70, 85]) {
      map.setView([51.45, -0.26], 18, { animate: false });
      map.setBearing(30);
      map.setPitch(pitch);
      await new Promise(resolve => setTimeout(resolve, 300));
      const layer = Object.values(map._layers).find(l => l._tiles && l._map && l._tileZoom !== undefined),
        tileSize = layer.getTileSize(),
        size = map.getSize(),
        farY = map._getPitchFarY();
      let missing = 0;
      for (let x = 0; x <= size.x; x += size.x / 8) {
        for (let y = Math.max(0, farY + 2); y <= size.y; y += size.y / 8) {
          const tile = map.project(map.containerPointToLatLng([x, y]), layer._tileZoom).unscaleBy(tileSize).floor();
          if (!layer._tiles[`${tile.x}:${tile.y}:${layer._tileZoom}`]) missing++;
        }
      }
      const bounds = map.getBounds(), center = map.getCenter(), canvas = path._renderer._container;
      results.push({
        pitch,
        farY,
        missing,
        tiles: Object.keys(layer._tiles).length,
        canvas: [canvas.width, canvas.height],
        boundsContainCenter: bounds.contains(center),
        sky: map._pitchSky && map._pitchSky.style.display !== 'none',
      });
    }
    return results;
  });
});

Then('tile loading stays bounded and covers the visible map', function () {
  for (const result of this.highPitch) {
    const details = JSON.stringify(result);
    assert.equal(result.missing, 0, details);
    assert.ok(result.tiles < 300, details);
    assert.ok(Math.max(...result.canvas) < 5000, details);
    assert.equal(result.boundsContainCenter, true, details);
    assert.ok(result.farY > 0, details);
    assert.equal(result.sky, true, details);
  }
});

When('I pan, zoom and change the pitch of a rotated map', async function () {
  const page = this.page;
  const setup = ([bearing, pitch]) => {
    window.__tileErr = () => {
      const layer = Object.values(map._layers).find(l => l._tiles && l._map && l._level),
        level = layer._level,
        point = new L.Point(150, 200),
        ref = document.createElement('div'),
        origin = map.project(map.containerPointToLatLng(point), level.zoom).round().subtract(level.origin);
      ref.style.cssText = `position:absolute;width:0;height:0;left:${origin.x}px;top:${origin.y}px`;
      level.el.appendChild(ref);
      const rect = ref.getBoundingClientRect(), container = map.getContainer().getBoundingClientRect();
      ref.remove();
      return Math.hypot(rect.left - container.left - point.x, rect.top - container.top - point.y);
    };
    map.setView([51.45, -0.26], 10, { animate: false });
    map.setBearing(bearing);
    map.setPitch(pitch);
    map.panBy([60, 60], { animate: false });
  };
  const box = await page.locator('#map').boundingBox();
  this.tileAlignment = [];
  for (const view of [[30, 30], [30, 0]]) {
    await page.evaluate(setup, view);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
    for (const delta of [-200, 200]) {
      const zoomEnd = page.evaluate(() => new Promise(resolve => { map.once('zoomend', () => resolve()); setTimeout(resolve, 2000); }));
      await page.mouse.wheel(0, delta);
      await zoomEnd;
      await page.waitForTimeout(500);
      this.tileAlignment.push({ view, delta, error: await page.evaluate(() => window.__tileErr()) });
    }
  }
  this.tileAlignment.push(await page.evaluate(async () => {
    map.setView([51.45, -0.26], 10, { animate: false });
    map.setPitch(85);
    map.setView([51.45, -0.26], 10, { animate: false });
    const centerError = map.project(map.getCenter()).distanceTo(map.project([51.45, -0.26]));
    map.setPitch(0);
    map.setBearing(30);
    await new Promise(resolve => setTimeout(resolve, 300));
    return { view: 'pitch 85 to 0', centerError, error: window.__tileErr() };
  }));
});

Then('the map is centered and the tiles stay aligned with the map coordinates', function () {
  for (const result of this.tileAlignment) {
    assert.ok(result.error < 3, JSON.stringify(this.tileAlignment));
    assert.ok(!(result.centerError > 2), JSON.stringify(this.tileAlignment));
  }
});