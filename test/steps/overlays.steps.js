import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

Then('the label remains upright while following the map bearing', function () {
  const normalize = angle => ((angle % 360) + 360) % 360;
  for (const { labelAngle, roadAngle } of this.labelAngles) {
    assert.ok(labelAngle <= 90 || labelAngle >= 270, JSON.stringify(this.labelAngles));
    assert.ok(Math.abs(normalize(labelAngle - roadAngle + 90) % 180 - 90) < 1,
      JSON.stringify(this.labelAngles));
  }
  assert.deepEqual(this.labelAngles.map(({ labelAngle }) => Math.round(labelAngle)), [315, 0, 45, 315, 45]);
});

Then('the custom-pane GeoJSON stays aligned with its coordinates', function () {
  assert.equal(this.customPanePosition.parentIsRotated, true);
  assert.ok(Math.hypot(...this.customPanePosition.delta) < 2, JSON.stringify(this.customPanePosition));
});

Then('the Canvas renderer belongs to the rotating pane', function () {
  assert.equal(this.canvasPane.rotating, true);
  assert.equal(this.canvasPane.bearing, 35);
});

Then('the map rotates without invoking the removed control', function () {
  assert.equal(this.removedControl.bearing, 40);
  assert.equal(this.removedControl.attached, false);
});

Then('only the requested marker is draggable', function () {
  assert.deepEqual(this.markerDragStates, [false, true]);
});

Then('the click event reports the matching geographic coordinate', function () {
  assert.ok(this.mapClick.containerPoint.every((value, index) => Math.abs(value - 100) <= 1));
  assert.ok(Math.abs(this.mapClick.latlng.lat - this.mapClick.expected.lat) < 1e-7, JSON.stringify(this.mapClick));
  assert.ok(Math.abs(this.mapClick.latlng.lng - this.mapClick.expected.lng) < 1e-7, JSON.stringify(this.mapClick));
});

Then('the heat points remain aligned with their coordinates', function () {
  assert.equal(this.heatPointDeltas.length, 24);
  for (const { delta } of this.heatPointDeltas) {
    assert.ok(Math.hypot(...delta) < 1, JSON.stringify(this.heatPointDeltas));
  }
});

Then('the map center remains unchanged', function () {
  assert.equal(this.centerUnchanged, true);
});

Then('the path stays at its geographic coordinate', function () {
  for (const position of Object.values(this.pathPosition)) {
    assert.ok(Math.abs(position[0]) < 2, JSON.stringify(this.pathPosition));
    assert.ok(Math.abs(position[1]) < 2, JSON.stringify(this.pathPosition));
  }
});

Then('the marker and vector path stay at their geographic coordinates', function () {
  assert.equal(this.interactivePositions.moved, true, JSON.stringify(this.interactivePositions));
  for (const position of this.interactivePositions.positions) {
    assert.ok(Math.hypot(...position) < 3, JSON.stringify(this.interactivePositions));
  }
});

When('I rotate a label marker with the view', async function () {
  this.labelAngles = await this.page.evaluate(() => {
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(0);
    const label = new L.Marker([55, 10], {
      icon: new L.DivIcon({ className: 'road-label', html: 'Road name' }),
      rotation: 135 * (Math.PI / 180),
      rotateWithView: true,
      keepUpright: true,
    }).addTo(map);
    const center = map.latLngToContainerPoint(label.getLatLng());
    const direction = 135 * (Math.PI / 180);
    const road = new L.Polyline([
      map.containerPointToLatLng(center.subtract([20 * Math.cos(direction), 20 * Math.sin(direction)])),
      map.containerPointToLatLng(center.add([20 * Math.cos(direction), 20 * Math.sin(direction)])),
    ]).addTo(map);
    return [0, 45, 90, 180, 270].map(bearing => {
      map.setBearing(bearing);
      const transform = new DOMMatrix(getComputedStyle(label.getElement()).transform);
      const labelAngle = (Math.atan2(transform.b, transform.a) * (180 / Math.PI) + 360) % 360;
      const endpoints = road.getLatLngs().map(latlng => map.latLngToContainerPoint(latlng));
      const roadAngle = (Math.atan2(
        endpoints[1].y - endpoints[0].y,
        endpoints[1].x - endpoints[0].x,
      ) * (180 / Math.PI) + 360) % 360;
      return { labelAngle, roadAngle };
    });
  });
});

When('I add GeoJSON to a custom pane inside the rotate pane', async function () {
  this.customPanePosition = await this.page.evaluate(() => {
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(35);
    const pane = map.createPane('customGeoJsonPane', map.getPane('rotatePane'));
    const geoJson = new L.GeoJSON({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10, 55] },
      properties: {},
    }, {
      pane: 'customGeoJsonPane',
      pointToLayer: (feature, latlng) => new L.CircleMarker(latlng, { radius: 8 }),
    }).addTo(map);
    const element = geoJson.getLayers()[0].getElement();
    const bounds = element.getBBox();
    const screen = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      .matrixTransform(element.getScreenCTM());
    const rect = map.getContainer().getBoundingClientRect();
    const expected = map.latLngToContainerPoint([55, 10]);
    return {
      parentIsRotated: pane.parentNode === map.getPane('rotatePane'),
      delta: [screen.x - rect.left - expected.x, screen.y - rect.top - expected.y],
    };
  });
});

When('I render a Canvas vector layer on a rotated map', async function () {
  this.canvasPane = await this.page.evaluate(() => {
    map.setBearing(35);
    const renderer = new L.Canvas({ pane: 'overlayPane' });
    new L.CircleMarker([55, 10], { renderer, radius: 8 }).addTo(map);
    return {
      rotating: renderer._container.parentNode === map.getPane('overlayPane')
        && map.getPane('overlayPane').parentNode === map.getPane('rotatePane'),
      bearing: map.getBearing(),
    };
  });
});

When('I remove the rotate control and change the map bearing', async function () {
  this.removedControl = await this.page.evaluate(() => {
    const control = new L.Control.Rotate({ closeOnZeroBearing: false }).addTo(map);
    map.removeControl(control);
    map.setBearing(40);
    return { bearing: map.getBearing(), attached: Boolean(control._map) };
  });
});

When('I create default and draggable markers', async function () {
  this.markerDragStates = await this.page.evaluate(() => {
    const defaultMarker = new L.Marker([55, 10]).addTo(map);
    const draggableMarker = new L.Marker([55.1, 10.1], { draggable: true }).addTo(map);
    return [defaultMarker, draggableMarker].map(marker => marker.dragging.enabled());
  });
});

When('I click a rotated map at a known container point', async function () {
  this.mapClick = await this.page.evaluate(() => new Promise(resolve => {
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(35);
    const point = [100, 100];
    map.once('click', event => resolve({
      containerPoint: [event.containerPoint.x, event.containerPoint.y],
      latlng: event.latlng,
      expected: map.containerPointToLatLng(event.containerPoint),
    }));
    const rect = map.getContainer().getBoundingClientRect();
    map.getContainer().dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: rect.left + point[0],
      clientY: rect.top + point[1],
    }));
  }));
});

When('I focus a marker near the edge of a rotated map', async function () {
  this.centerUnchanged = await this.page.evaluate(() => {
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(30);
    const point = map.containerPointToLatLng([35, map.getSize().y / 2]);
    const marker = new L.Marker(point, { autoPanOnFocus: true }).addTo(map);
    const before = map.getCenter();
    marker.getElement().focus();
    return before.equals(map.getCenter());
  });
});

When('I drag between city markers and reset north before clicking Trondheim', { timeout: 30000 }, async function () {
  await this.page.evaluate(() => {
    map.options.inertia = false;
    map.setBearing(0);
    map.setView(places.Kyiv, 6, { animate: false });
    markers.forEach((marker, index) => { marker.getElement().id = `city-marker-${index}`; });
  });
  const rect = await this.page.locator('#map').boundingBox();
  await this.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 - 20);
  await this.page.keyboard.down('Control');
  await this.page.mouse.down();
  await this.page.mouse.move(rect.x + rect.width / 2 + 75, rect.y + rect.height / 2 - 20, { steps: 8 });
  await this.page.mouse.up();
  await this.page.keyboard.up('Control');
  assert.ok(await this.page.evaluate(() => map.getBearing() > 1 && map.getPitch() === 0));

  const waitForPan = () => this.page.waitForFunction(() => !map._panAnim || !map._panAnim._inProgress);
  const dragTo = async name => {
    for (let i = 0; i < 30; i++) {
      const point = await this.page.evaluate(name => {
        const point = map.latLngToContainerPoint(places[name]);
        return { x: point.x, y: point.y };
      }, name);
      const dx = Math.max(-rect.width / 4, Math.min(rect.width / 4, rect.width * 0.6 - point.x));
      const dy = Math.max(-rect.height / 4, Math.min(rect.height / 4, rect.height * 0.65 - point.y));
      if (Math.hypot(dx, dy) < 2) return;
      await this.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await this.page.mouse.down();
      await this.page.mouse.move(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2 + dy, { steps: 4 });
      await this.page.mouse.up();
    }
    throw new Error(`Could not drag to ${name}`);
  };
  for (const [index, name] of [[0, 'Kyiv'], [1, 'London']]) {
    await dragTo(name);
    await this.page.locator(`#city-marker-${index}`).click();
    await waitForPan();
    await this.page.locator('.leaflet-popup-close-button').click();
  }
  const resetCenter = await this.page.evaluate(() => map.project(map.getCenter()));
  await this.page.locator('.leaflet-control-rotate-toggle').click();
  await this.page.waitForFunction(() => map.getBearing() === 0 && !map._bearingAnimationFrame);
  this.cityPopup = await this.page.evaluate(before => ({
    resetMovement: map.project(map.getCenter()).distanceTo(new L.Point(before.x, before.y)),
  }), resetCenter);
  await dragTo('Trondheim');
  const before = await this.page.evaluate(() => map.project(map.getCenter()));
  // Use the pointer position, so a focus-induced jump cannot make Playwright chase the marker.
  const icon = await this.page.locator('#city-marker-4').boundingBox();
  await this.page.locator('#city-marker-4').focus();
  await waitForPan();
  this.cityPopup.focusMovement = await this.page.evaluate(before =>
    map.project(map.getCenter()).distanceTo(new L.Point(before.x, before.y)), before);
  await this.page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await waitForPan();
  Object.assign(this.cityPopup, await this.page.evaluate(before => {
    const popup = markers[4].getPopup();
    const rect = map.getContainer().getBoundingClientRect();
    const popupRect = popup.getElement()?.getBoundingClientRect();
    const center = map.project(map.getCenter());
    const viewportCenter = map.project(map.containerPointToLatLng(map.getSize().divideBy(2)));
    return {
      open: markers[4].isPopupOpen(),
      movement: center.distanceTo(new L.Point(before.x, before.y)),
      centerError: center.distanceTo(viewportCenter),
      inside: Boolean(popupRect && popupRect.left >= rect.left - 1 && popupRect.right <= rect.right + 1
        && popupRect.top >= rect.top - 1 && popupRect.bottom <= rect.bottom + 1),
      size: Math.max(map.getSize().x, map.getSize().y),
    };
  }, before));
});

Then('the Trondheim popup opens without jumping back to London', function () {
  assert.ok(this.cityPopup.resetMovement < 1, JSON.stringify(this.cityPopup));
  assert.ok(this.cityPopup.focusMovement < 1, JSON.stringify(this.cityPopup));
  assert.equal(this.cityPopup.open, true, JSON.stringify(this.cityPopup));
  assert.equal(this.cityPopup.inside, true, JSON.stringify(this.cityPopup));
  assert.ok(this.cityPopup.movement < this.cityPopup.size / 2, JSON.stringify(this.cityPopup));
  assert.ok(this.cityPopup.centerError < 1, JSON.stringify(this.cityPopup));
});

When('I keep padded points visible with rotation {word} and bearing {float}', async function (rotate, bearing) {
  this.paddedPans = await this.page.evaluate(({ rotate, bearing }) => {
    const element = document.createElement('div');
    element.style.cssText = 'width: 400px; height: 300px; margin-left: 100px';
    document.body.append(element);
    const testMap = new L.Map(element, {
      center: [55, 10], zoom: 6, rotate: rotate === 'true', bearing, rotateControl: false,
    });
    const results = [];
    for (const padding of [
      {},
      { padding: [20, 30] },
      { paddingTopLeft: new L.Point(35, 45), paddingBottomRight: new L.Point(25, 15) },
    ]) {
      const tl = padding.paddingTopLeft || new L.Point(...(padding.padding || [0, 0]));
      const br = padding.paddingBottomRight || new L.Point(...(padding.padding || [0, 0]));
      const min = tl, max = testMap.getSize().subtract(br);
      for (const point of [
        min.add([1, 1]), max.subtract([1, 1]),
        new L.Point(min.x - 80, 150), new L.Point(max.x + 80, 150),
        new L.Point(200, min.y - 80), new L.Point(200, max.y + 80),
        min.subtract([80, 80]), max.add([80, 80]),
      ]) {
        testMap.setView([55, 10], 6, { reset: true, animate: false });
        const latlng = testMap.containerPointToLatLng(point);
        // Measure the rendered center, avoiding the cached setView center before pixel rounding.
        const center = testMap.getSize().divideBy(2);
        const before = testMap.project(testMap.containerPointToLatLng(center));
        const expected = new L.Point(
          Math.max(min.x, Math.min(max.x, point.x)),
          Math.max(min.y, Math.min(max.y, point.y)),
        );
        const returnedMap = testMap.panInside(latlng, { ...padding, animate: false });
        const actual = testMap.latLngToContainerPoint(latlng);
        const after = testMap.project(testMap.containerPointToLatLng(center));
        results.push({
          point, expected, actual, rotate, bearing,
          chainable: returnedMap === testMap,
          movement: before.distanceTo(after),
          expectedMovement: point.distanceTo(expected),
          error: actual.distanceTo(expected),
        });
      }
    }
    testMap.remove();
    element.remove();
    return results;
  }, { rotate, bearing });
});

Then('panInside moves only enough to reach the padded viewport', function () {
  for (const result of this.paddedPans) {
    assert.equal(result.chainable, true, JSON.stringify(result));
    assert.ok(result.error < 1.5, JSON.stringify(result));
    assert.ok(Math.abs(result.movement - result.expectedMovement) < 1.5, JSON.stringify(result));
    if (result.expectedMovement === 0) {
      assert.equal(result.movement, 0, JSON.stringify(result));
    }
  }
});

When('I redraw a heat layer after rotating, panning, and zooming', async function () {
  await this.page.evaluate(() => {
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(35);
    L.HeatLayer = L.Layer.extend({
      initialize(latlngs) {
        this._latlngs = latlngs;
      },
      onAdd(map) {
        this._map = map;
        const size = map.getSize();
        this._heat = { _width: size.x, _height: size.y };
        this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer');
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        map.getPane('overlayPane').appendChild(this._canvas);
        L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint([0, 0]));
        map.on('moveend', this._reset, this);
        this._reset();
      },
      onRemove(map) {
        map.off('moveend', this._reset, this);
        L.DomUtil.remove(this._canvas);
      },
      _redraw() {
        this._drawnPoints = this._latlngs.map(latlng => this._map.latLngToContainerPoint(latlng));
      },
    });
    L.heatLayer = latlngs => new L.HeatLayer(latlngs);
    globalThis.HeatmapOverlay = L.Layer.extend({
      initialize(latlngs) {
        this._latlngs = latlngs;
        this._el = L.DomUtil.create('div', 'leaflet-heatmap-overlay');
      },
      onAdd(map) {
        this._map = map;
        map.getPane('overlayPane').appendChild(this._el);
        map.on('moveend', this._draw, this);
        this._draw();
      },
      onRemove(map) {
        map.off('moveend', this._draw, this);
        L.DomUtil.remove(this._el);
      },
      _draw() {
        this._update();
      },
      _update() {
        this._drawnPoints = this._latlngs.map(latlng => this._map.latLngToContainerPoint(latlng));
      },
    });
  });
  await this.page.addScriptTag({ url: `${this.baseUrl}/misc/leaflet-heat-rotate.js` });
  this.heatPointDeltas = await this.page.evaluate(async () => {
    const locations = [new L.LatLng(55.1, 10.1), new L.LatLng(54.9, 9.8), new L.LatLng(55.25, 10.3)];
    const layer = L.heatLayer(locations).addTo(map);
    const overlay = new HeatmapOverlay(locations).addTo(map);
    const deltas = [];
    const measure = heatLayer => {
      const origin = L.DomUtil.getPosition(heatLayer._canvas || heatLayer._el);
      const panePosition = map._getMapPanePos();
      for (let index = 0; index < locations.length; index++) {
        const actual = origin.add(heatLayer._drawnPoints[index]).add(panePosition);
        const expected = map.latLngToContainerPoint(locations[index]);
        deltas.push({
          delta: [actual.x - expected.x, actual.y - expected.y],
          origin: origin.toString(),
          pane: panePosition.toString(),
          point: heatLayer._drawnPoints[index].toString(),
          expected: expected.toString(),
        });
      }
    };
    const measureLayers = () => {
      measure(layer);
      measure(overlay);
      if (layer._canvas.parentNode !== map.getPane('norotatePane')
        || overlay._el.parentNode !== map.getPane('norotatePane')) {
        throw new Error('Heat layers must be rendered in the non-rotating pane');
      }
    };
    measureLayers();
    map.panBy([45, 25], { animate: false });
    measureLayers();
    await new Promise(resolve => {
      map.once('zoomend', resolve);
      map.setZoom(7);
    });
    measureLayers();
    map.setBearing(0);
    map.panBy([-25, 35], { animate: false });
    measureLayers();
    return deltas;
  });
});

When('I focus a point near the left edge of an offset map', async function () {
  this.centerUnchanged = await this.page.evaluate(() => {
    const container = map.getContainer();
    Object.assign(container.style, { width: '400px', height: '300px', marginLeft: '100px' });
    map.invalidateSize({ animate: false });
    map.setBearing(0);
    const before = map.getCenter();
    const point = map.containerPointToLatLng([5, map.getSize().y / 2]);
    map.panInside(point, { animate: false });
    return before.equals(map.getCenter());
  });
});

When('I zoom an SVG path near the latitude limit', async function () {
  this.pathPosition = await this.page.evaluate(() => {
    map.options.zoomAnimation = false;
    map.setView([85, 0], 5, { animate: false });
    map.setBearing(30);
    const location = new L.LatLng(85, 0);
    const path = new L.CircleMarker(location, { radius: 6 }).addTo(map);
    const pathPoint = () => {
      const element = path.getElement();
      const bounds = element.getBBox();
      const actual = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        .matrixTransform(element.getScreenCTM());
      const expected = map.latLngToContainerPoint(location);
      const rect = map.getContainer().getBoundingClientRect();
      return [actual.x - rect.left - expected.x, actual.y - rect.top - expected.y];
    };
    const initial = pathPoint();
    map.setZoom(7, { animate: false });
    const zoomed = pathPoint();
    map.setZoom(4, { animate: false });
    return { initial, zoomed, final: pathPoint() };
  });
});

When('I open a popup on a rotated map without zoom animation', async function () {
  this.popupPosition = await this.page.evaluate(() => {
    map.options.zoomAnimation = false;
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(30);
    const marker = new L.Marker([55, 10]).addTo(map).bindPopup('popup');
    marker.getElement().click();
    const popup = marker.getPopup();
    const tip = popup.getElement().querySelector('.leaflet-popup-tip-container');
    const tipRect = tip.getBoundingClientRect();
    const mapRect = map.getContainer().getBoundingClientRect();
    const actual = [tipRect.left + tipRect.width / 2 - mapRect.left, tipRect.bottom - mapRect.top];
    const expected = map.latLngToContainerPoint(marker.getLatLng())
      .add(popup._getAnchor()).add(popup.options.offset);
    return {
      delta: [actual[0] - expected.x, actual[1] - expected.y],
      bearing: map.getBearing(),
      actual,
      expected,
      anchor: popup._getAnchor(),
    };
  });
});

Then('the popup tip stays at the marker coordinate', function () {
  assert.ok(Math.abs(this.popupPosition.bearing - 30) < 1e-6);
  assert.ok(Math.hypot(...this.popupPosition.delta) < 2, JSON.stringify(this.popupPosition));
});

When('I open a popup near the edge of a rotated map', async function () {
  this.edgePopup = await this.page.evaluate(async () => {
    map.options.zoomAnimation = false;
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(30);
    map.on('move zoomend dragend locationfound locationerror', () => {});
    const edge = map.containerPointToLatLng([map.getSize().x - 10, map.getSize().y / 2]);
    const marker = new L.Marker(edge).addTo(map).bindPopup('edge popup');
    const oldCenter = map.project(map.getCenter(), map.getZoom());
    marker.openPopup();
    await new Promise(resolve => {
      if (!map._panAnim || !map._panAnim._inProgress) return resolve();
      map.once('moveend', resolve);
    });
    const rect = map.getContainer().getBoundingClientRect();
    const popupRect = marker.getPopup().getElement().getBoundingClientRect();
    const newCenter = map.project(map.getCenter(), map.getZoom());
    return {
      inside: popupRect.left >= rect.left - 1 && popupRect.right <= rect.right + 1
        && popupRect.top >= rect.top - 1 && popupRect.bottom <= rect.bottom + 1,
      movement: oldCenter.distanceTo(newCenter),
      width: map.getSize().x,
      height: map.getSize().y,
    };
  });
});

Then('the popup stays inside the map without a large jump', function () {
  assert.equal(this.edgePopup.inside, true, JSON.stringify(this.edgePopup));
  assert.ok(this.edgePopup.movement > 1, JSON.stringify(this.edgePopup));
  assert.ok(this.edgePopup.movement < Math.max(this.edgePopup.width, this.edgePopup.height) / 2,
    JSON.stringify(this.edgePopup));
});

When('I open a popup in a second rotated map with map listeners', async function () {
  this.secondaryPopup = await this.page.evaluate(() => {
    const element = document.createElement('div');
    element.id = 'secondary-map';
    element.style.cssText = 'height: 300px; width: 500px; margin-top: 40px';
    document.body.append(element);
    const secondMap = window.secondaryMap = new L.Map(element, {
      center: [55, 10], zoom: 6, rotate: true, bearing: 30,
    });
    const marker = new L.Marker([55.5, 10.5]).addTo(secondMap)
      .bindPopup('popup')
      .bindTooltip('tooltip', { permanent: true, direction: 'right' });
    marker.openTooltip();
    secondMap.on('move zoomend dragend locationfound locationerror', () => {});
    const center = secondMap.getCenter();
    const top = secondMap.getContainer().getBoundingClientRect().top;
    marker.getElement().click();
    const popup = marker.getPopup();
    const tip = popup.getElement().querySelector('.leaflet-popup-tip-container');
    const tipRect = tip.getBoundingClientRect();
    const mapRect = secondMap.getContainer().getBoundingClientRect();
    const actual = [tipRect.left + tipRect.width / 2 - mapRect.left, tipRect.bottom - mapRect.top];
    const expected = secondMap.latLngToContainerPoint(marker.getLatLng())
      .add(popup._getAnchor()).add(popup.options.offset);
    const tooltip = marker.getTooltip();
    const tooltipRect = tooltip.getElement().getBoundingClientRect();
    const tooltipOffset = tooltip.options.offset || new L.Point(0, 0);
    const tooltipPoint = secondMap.latLngToContainerPoint(marker.getLatLng()).add(tooltip._getAnchor()).add(tooltipOffset);
    const tooltipExpected = [
      tooltipPoint.x + parseFloat(getComputedStyle(tooltip.getElement()).marginLeft),
      tooltipPoint.y,
    ];
    const tooltipActual = [
      tooltipRect.left - mapRect.left,
      tooltipRect.top + tooltipRect.height / 2 - mapRect.top,
    ];
    return {
      centerUnchanged: center.equals(secondMap.getCenter()),
      delta: [actual[0] - expected.x, actual[1] - expected.y],
      tooltipDelta: [tooltipActual[0] - tooltipExpected[0], tooltipActual[1] - tooltipExpected[1]],
      mapTopDelta: mapRect.top - top,
    };
  });
});

Then('the second map center remains unchanged and its popup stays anchored', function () {
  assert.equal(this.secondaryPopup.centerUnchanged, true, JSON.stringify(this.secondaryPopup));
  assert.equal(this.secondaryPopup.mapTopDelta, 0, JSON.stringify(this.secondaryPopup));
  assert.ok(Math.hypot(...this.secondaryPopup.delta) < 2, JSON.stringify(this.secondaryPopup));
  assert.ok(Math.hypot(...this.secondaryPopup.tooltipDelta) < 2, JSON.stringify(this.secondaryPopup));
});

When('I add markers to a Canvas-preferred map at pitch {int}', async function (pitch) {
  this.domMarkers = await this.page.evaluate(pitch => {
    const container = document.createElement('div');
    container.style.cssText = 'height: 300px; width: 500px';
    document.body.appendChild(container);
    const map = new L.Map(container, {
      center: [55, 10], zoom: 6, rotate: true, bearing: 35, pitch, preferCanvas: true,
    });
    const marker = new L.Marker([55, 10], { draggable: true, rotation: Math.PI / 4 })
      .bindPopup('DOM popup', { autoPan: false }).addTo(map);
    const divMarker = new L.Marker([55.1, 10.1], { icon: new L.DivIcon({ html: 'Label' }) }).addTo(map);
    const vector = new L.CircleMarker([55.2, 10.2]).addTo(map);
    map.panBy([40, 20], { animate: false });
    marker.setLatLng([55.3, 10.3]).setOpacity(0.5);
    const element = marker.getElement();
    const transform = new DOMMatrix(getComputedStyle(element).transform);
    const position = L.DomUtil.getPosition(element).add(map._getMapPanePos());
    const expected = map.latLngToContainerPoint(marker.getLatLng());
    element.click();
    const result = {
      icon: element.tagName,
      iconPane: element.parentNode === map.getPane('markerPane'),
      shadow: marker._shadow.tagName,
      divIcon: divMarker.getElement().tagName,
      vectorCanvas: vector._renderer instanceof L.Canvas,
      aligned: position.distanceTo(expected) < 1,
      rotation: Math.abs(Math.atan2(transform.b, transform.a) - Math.PI / 4) < 1e-6,
      opacity: element.style.opacity,
      draggable: marker.dragging.enabled(),
      popup: marker.isPopupOpen(),
    };
    marker.remove();
    result.removed = !element.isConnected && !marker.getElement();
    return result;
  }, pitch);
});

Then('the markers use Leaflet DOM icons while vector paths use Canvas', function () {
  assert.deepEqual(this.domMarkers, {
    icon: 'IMG', iconPane: true, shadow: 'IMG', divIcon: 'DIV', vectorCanvas: true,
    aligned: true, rotation: true, opacity: '0.5', draggable: true, popup: true, removed: true,
  });
});
