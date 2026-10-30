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

When('I add image markers to a rotated map with preferCanvas', async function () {
  this.canvasMarkers = await this.page.evaluate(async () => {
    const element = document.createElement('div');
    element.style.cssText = 'height: 300px; width: 500px; margin-top: 40px';
    document.body.append(element);
    element.scrollIntoView();
    const canvasMap = window.canvasMap = new L.Map(element, {
      center: [55, 10], zoom: 6, rotate: true, bearing: 30, preferCanvas: true,
    });
    // 20x40 icon: red top half, blue bottom half, anchored at its bottom center
    const source = document.createElement('canvas');
    source.width = 20;
    source.height = 40;
    const sourceCtx = source.getContext('2d');
    sourceCtx.fillStyle = '#f00';
    sourceCtx.fillRect(0, 0, 20, 20);
    sourceCtx.fillStyle = '#00f';
    sourceCtx.fillRect(0, 20, 20, 20);
    const icon = new L.Icon({ iconUrl: source.toDataURL(), iconSize: [20, 40], iconAnchor: [10, 40], popupAnchor: [0, -40] });
    const marker = window.canvasMarker = new L.Marker([55, 10], { icon }).addTo(canvasMap).bindPopup('canvas popup');
    const divMarker = window.canvasDivMarker = new L.Marker([55.5, 10.5], { icon: new L.DivIcon({ html: 'div' }) }).addTo(canvasMap);
    const draggable = new L.Marker([54.5, 9.5], { icon, draggable: true }).addTo(canvasMap);

    await new Promise(resolve => (function wait() {
      marker._canvasIcon && marker._canvasIcon._getPart('icon') ? resolve() : requestAnimationFrame(wait);
    })());
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const renderer = marker._canvasIcon._renderer;
    renderer._ctx.globalAlpha = 0.1;
    renderer._redraw();
    const canvas = renderer._container;
    const ratio = canvas.width / parseFloat(canvas.style.width);
    const anchor = canvasMap.latLngToContainerPoint(marker.getLatLng());
    const sample = offset => {
      const layerPoint = anchor.add(offset).subtract(canvasMap._getMapPanePos());
      const pixel = layerPoint.subtract(renderer._bounds.min).multiplyBy(ratio);
      return Array.from(renderer._ctx.getImageData(Math.round(pixel.x), Math.round(pixel.y), 1, 1).data);
    };
    const rect = element.getBoundingClientRect();
    return {
      element: marker.getElement()?.tagName,
      domIcons: canvasMap.getPane('markerPane').querySelectorAll('img').length,
      divIcon: Boolean(divMarker.getElement()),
      draggable: Boolean(draggable._canvasIcon && draggable.dragging.enabled()),
      top: sample([0, -30]),
      bottom: sample([0, -10]),
      outside: sample([30, -20]),
      screen: [rect.left + anchor.x, rect.top + anchor.y - 20],
      halfOpacity: (() => {
        marker.setOpacity(0.5);
        renderer._redraw();
        const pixel = sample([0, -30]);
        marker.setOpacity(1);
        renderer._redraw();
        return pixel;
      })(),
    };
  });
});

Then('the image marker is drawn upright on the Canvas renderer', function () {
  const result = JSON.stringify(this.canvasMarkers);
  assert.equal(this.canvasMarkers.element, 'BUTTON', result);
  assert.equal(this.canvasMarkers.domIcons, 0, result);
  assert.equal(this.canvasMarkers.divIcon, true, result);
  assert.equal(this.canvasMarkers.draggable, true, result);
  assert.deepEqual(this.canvasMarkers.top, [255, 0, 0, 255], result);
  assert.deepEqual(this.canvasMarkers.bottom, [0, 0, 255, 255], result);
  assert.equal(this.canvasMarkers.outside[3], 0, result);
  assert.ok(Math.abs(this.canvasMarkers.halfOpacity[3] - 128) <= 1, result);
});

Then('clicking the drawn marker opens its popup', async function () {
  const [x, y] = this.canvasMarkers.screen;
  await this.page.mouse.click(x + 40, y);
  assert.equal(await this.page.evaluate(() => canvasMarker.isPopupOpen()), false);
  await this.page.mouse.click(x, y);
  assert.equal(await this.page.evaluate(() => canvasMarker.isPopupOpen()), true);
  const divCenter = await this.page.evaluate(() => {
    window.canvasDivClicks = 0;
    canvasMarker.closePopup();
    const point = canvasMap.latLngToContainerPoint(canvasMarker.getLatLng()).add([60, -20]);
    canvasDivMarker.setLatLng(canvasMap.containerPointToLatLng(point));
    canvasDivMarker.on('click', () => canvasDivClicks++);
    const rect = canvasDivMarker.getElement().getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  });
  await this.page.mouse.click(...divCenter);
  assert.equal(await this.page.evaluate(() => canvasDivClicks), 1, 'DOM markers stay clickable above the Canvas markers');
});

When('I pitch the Canvas marker map', async function () {
  this.canvasPitch = await this.page.evaluate(() => {
    const renderer = canvasMarker._canvasIcon._renderer;
    const samples = [];
    for (const pitch of [0, 30, 60]) {
      canvasMap.setPitch(pitch);
      canvasMap.setBearing(110 + pitch);
      canvasMap.panBy([10, -5], { animate: false });
      canvasMap.setZoom(6 + pitch / 30, { animate: false });
      const anchor = canvasMap.latLngToContainerPoint(canvasMarker.getLatLng());
      const ratio = renderer._container.width / parseFloat(renderer._container.style.width);
      const sample = offset => {
        const pixel = anchor.add(offset).subtract(canvasMap._getMapPanePos())
          .subtract(renderer._bounds.min).multiplyBy(ratio);
        return Array.from(renderer._ctx.getImageData(Math.round(pixel.x), Math.round(pixel.y), 1, 1).data);
      };
      samples.push({
        pitch, top: sample([0, -30]), bottom: sample([0, -10]),
        above: sample([0, -43]), side: sample([13, -20]),
        parent: renderer.getPane().parentNode === canvasMap.getPane('norotatePane'),
      });
    }
    return samples;
  });
  this.canvasMarkers.screen = await this.page.evaluate(() => {
    const point = canvasMap.latLngToContainerPoint(canvasMarker.getLatLng());
    const rect = canvasMap.getContainer().getBoundingClientRect();
    return [rect.left + point.x, rect.top + point.y - 20];
  });
});

Then('the Canvas icon stays upright with constant screen dimensions', function () {
  for (const sample of this.canvasPitch) {
    assert.deepEqual(sample.top, [255, 0, 0, 255], JSON.stringify(sample));
    assert.deepEqual(sample.bottom, [0, 0, 255, 255], JSON.stringify(sample));
    assert.equal(sample.above[3], 0, JSON.stringify(sample));
    assert.equal(sample.side[3], 0, JSON.stringify(sample));
    assert.equal(sample.parent, true);
  }
});

When('I move a map with Canvas markers and debug overlays', async function () {
  this.canvasDebugErrors = [];
  this.page.on('pageerror', error => this.canvasDebugErrors.push(error.message));
  await this.page.evaluate(() => {
    map.options.preferCanvas = true;
    L.Rotate.displayPixelBounds();
    map.setBearing(65);
    map.panBy([30, 20], { animate: false });
    map.setZoom(map.getZoom() + 1, { animate: false });
  });
});

Then('the debug overlays update without browser errors', async function () {
  const corners = await this.page.evaluate(() => L.Rotate.___corners.getLayers().map(marker => ({
    canvas: Boolean(marker._canvasIcon),
    element: Boolean(marker.getElement()),
    onMap: map.hasLayer(marker),
  })));
  assert.deepEqual(corners, Array.from({ length: 4 }, () => ({
    canvas: true, element: true, onMap: true,
  })));
  assert.deepEqual(this.canvasDebugErrors, []);
});

When('I drag a Canvas image marker using {word} at pitch {int}', async function (input, pitch) {
  this.canvasDragErrors = [];
  this.page.on('pageerror', error => this.canvasDragErrors.push(error.message));
  const start = await this.page.evaluate(async pitch => {
    const element = document.createElement('div');
    element.style.cssText = 'height: 300px; width: 500px; margin-top: 40px';
    document.body.append(element);
    element.scrollIntoView();
    const dragMap = window.dragMap = new L.Map(element, {
      center: [55, 10], zoom: 6, rotate: true, bearing: 65, preferCanvas: true,
    });
    dragMap.setPitch(pitch);
    const image = document.createElement('canvas');
    image.width = image.height = 30;
    image.getContext('2d').fillRect(0, 0, 30, 30);
    const icon = new L.Icon({ iconUrl: image.toDataURL(), iconSize: [30, 30], iconAnchor: [15, 15] });
    window.dragEvents = [];
    window.dragMarker = new L.Marker(dragMap.getCenter(), { icon, draggable: true }).addTo(dragMap)
      .bindPopup('drag popup')
      .on('movestart dragstart move drag moveend dragend click', e => {
        dragEvents.push({ type: e.type, target: e.target === dragMarker, distance: e.distance });
      });
    new L.CircleMarker(dragMap.getCenter(), {
      renderer: new L.Canvas(), interactive: false, radius: 5,
    }).addTo(dragMap);
    await new Promise(resolve => {
      const image = dragMarker._canvasIcon._images.icon;
      if (image.complete) resolve();
      else image.addEventListener('load', resolve, { once: true });
    });
    const anchor = dragMap.latLngToContainerPoint(dragMarker.getLatLng());
    window.dragStart = { center: dragMap.getCenter(), latlng: dragMarker.getLatLng(), anchor };
    const rect = element.getBoundingClientRect();
    return { x: rect.left + element.clientLeft + anchor.x, y: rect.top + element.clientTop + anchor.y };
  }, pitch);
  if (input === 'touch') {
    const cdp = await this.context.newCDPSession(this.page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 60, y: start.y + 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(start.x + 60, start.y + 30, { steps: 5 });
    await this.page.mouse.up();
  }
});

Then('the Canvas marker moves without panning the map or opening its popup', async function () {
  assert.deepEqual(this.canvasDragErrors, []);
  const result = await this.page.evaluate(() => ({
    canvas: Boolean(dragMarker._canvasIcon),
    element: Boolean(dragMarker.getElement()),
    delta: dragMap.latLngToContainerPoint(dragMarker.getLatLng()).subtract(dragStart.anchor),
    mapUnchanged: dragMap.getCenter().equals(dragStart.center),
    popup: dragMarker.isPopupOpen(),
    events: dragEvents,
  }));
  assert.equal(result.canvas, true);
  assert.equal(result.element, true);
  assert.ok(Math.abs(result.delta.x - 60) < 1 && Math.abs(result.delta.y - 30) < 1, JSON.stringify(result));
  assert.equal(result.mapUnchanged, true, JSON.stringify(result));
  assert.equal(result.popup, false);
  assert.deepEqual(result.events.slice(0, 2).map(e => e.type), ['movestart', 'dragstart']);
  assert.deepEqual(result.events.slice(-2).map(e => e.type), ['moveend', 'dragend']);
  assert.ok(result.events.every(e => e.target));
  assert.ok(result.events.some(e => e.type === 'drag'));
  assert.ok(Math.abs(result.events.at(-1).distance - Math.hypot(60, 30)) < 1);
});

Then('Canvas dragging supports runtime changes and auto-pan', async function () {
  const position = () => this.page.evaluate(() => {
    const point = dragMap.latLngToContainerPoint(dragMarker.getLatLng());
    const rect = dragMap.getContainer().getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  const drag = async (x, y) => {
    const point = await position();
    await this.page.mouse.move(point.x, point.y);
    await this.page.mouse.down();
    await this.page.mouse.move(point.x + x, point.y + y, { steps: 4 });
    await this.page.mouse.up();
  };
  await this.page.evaluate(() => {
    dragMarker.dragging.disable();
    window.disabledLatLng = dragMarker.getLatLng();
  });
  await drag(20, 10);
  assert.equal(await this.page.evaluate(() => dragMarker.getLatLng().equals(disabledLatLng)), true);

  await this.page.evaluate(() => {
    dragMarker.dragging.enable();
    dragMarker.options.autoPan = true;
    window.beforeAutoPan = dragMap.getCenter();
    dragMap.dragging.disable();
  });
  const point = await position();
  const edge = await this.page.evaluate(() => {
    const rect = dragMap.getContainer().getBoundingClientRect();
    return { x: rect.right - 5, y: rect.top + rect.height / 2 };
  });
  await this.page.mouse.move(point.x, point.y);
  await this.page.mouse.down();
  await this.page.mouse.move(edge.x, edge.y, { steps: 4 });
  await this.page.waitForFunction(() => !dragMap.getCenter().equals(beforeAutoPan));
  await this.page.mouse.up();
  assert.equal(await this.page.evaluate(() => dragMap.dragging.enabled()), false);

  const transitions = await this.page.evaluate(() => {
    const icon = dragMarker.getIcon();
    const previousLayer = dragMarker._canvasIcon;
    dragMarker.setIcon(new L.DivIcon({ html: 'drag' }));
    const dom = Boolean(dragMarker.getElement()) && dragMarker.dragging.enabled()
      && !dragMap.hasLayer(previousLayer);
    dragMarker.setIcon(icon);
    const canvas = dragMarker.getElement().tagName === 'BUTTON' && dragMarker.dragging.enabled();
    const oldHandler = dragMarker.dragging;
    dragMarker.remove();
    const detached = !dragMap.hasLayer(dragMarker) && !dragMarker._canvasIcon;
    dragMarker.addTo(dragMap);
    const readded = dragMarker.dragging !== oldHandler && dragMarker.dragging.enabled();
    return { dom, canvas, detached, readded };
  });
  assert.deepEqual(transitions, { dom: true, canvas: true, detached: true, readded: true });
  assert.deepEqual(this.canvasDragErrors, []);
});

When('I animate zoom with a Canvas marker and a vector reference', async function () {
  this.canvasZoomFrames = await this.page.evaluate(async () => {
    const element = document.createElement('div');
    element.style.cssText = 'height: 300px; width: 500px';
    document.body.append(element);
    const zoomMap = new L.Map(element, {
      center: [55, 10], zoom: 6, rotate: true, bearing: 35, preferCanvas: true,
    });
    const marker = new L.Marker([55.5, 11]).addTo(zoomMap);
    const reference = new L.CircleMarker(marker.getLatLng(), {
      radius: 3, renderer: new L.Canvas(),
    }).addTo(zoomMap);
    const runs = [];
    const finishZoom = zoomMap._onZoomTransitionEnd;
    zoomMap._onZoomTransitionEnd = () => {};
    for (const pitch of [0, 60]) {
      zoomMap.setView([55, 10], 6, { animate: false });
      zoomMap.setPitch(pitch);
      const frames = [];
      await new Promise(resolve => {
        zoomMap.once('zoomanim', resolve);
        zoomMap.setZoom(7, { animate: true });
      });
      const renderer = reference._renderer;
      getComputedStyle(renderer._container).transform;
      const animations = [
        ...renderer._container.getAnimations(),
        ...marker._canvasIcon._renderer._zoomProbe.getAnimations(),
      ];
      for (const animation of animations) { animation.pause(); }
      for (const time of [0, 50, 100, 150, 200, 249]) {
        for (const animation of animations) { animation.currentTime = time; }
        await new Promise(resolve => requestAnimationFrame(resolve));
        const transform = new DOMMatrix(getComputedStyle(renderer._container).transform);
        const local = reference._point.subtract(renderer._bounds.min);
        const point = new DOMPoint(local.x, local.y).matrixTransform(transform);
        const expected = zoomMap.rotatedPointToMapPanePoint(new L.Point(point.x, point.y));
        const actual = marker._canvasIcon._point;
        frames.push({ error: actual.distanceTo(expected), x: actual.x, y: actual.y });
      }
      finishZoom.call(zoomMap);
      runs.push({ pitch, frames });
    }
    zoomMap._onZoomTransitionEnd = finishZoom;
    zoomMap.remove();
    element.remove();
    return runs;
  });
});

Then('the Canvas marker tracks the reference throughout the zoom', function () {
  for (const run of this.canvasZoomFrames) {
    assert.ok(run.frames.length >= 2, JSON.stringify(run));
    const positions = new Set(run.frames.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`));
    assert.ok(positions.size >= 2, JSON.stringify(run));
    assert.ok(run.frames.every(p => p.error < 3), JSON.stringify(run));
  }
});

When('I project Canvas markers behind a highly pitched camera', async function () {
  this.behindCameraMarkers = await this.page.evaluate(() => {
    const element = document.createElement('div');
    element.style.cssText = 'height: 300px; width: 500px';
    document.body.append(element);
    const pitchedMap = new L.Map(element, {
      center: [55, 10], zoom: 6, rotate: true, bearing: 35, preferCanvas: true,
    });
    pitchedMap.setPitch(85);
    const result = [];
    for (const latlng of [[-60, -150], [-60, 150], [75, -150], [75, 150]]) {
      const marker = new L.Marker(latlng).addTo(pitchedMap);
      const sprite = marker._canvasIcon;
      const ground = pitchedMap.latLngToLayerPoint(marker.getLatLng());
      const m = pitchedMap._pitchTransform;
      if (m.m14 * ground.x + m.m24 * ground.y + m.m44 <= 0) {
        result.push({
          empty: sprite._empty(), hit: sprite._containsPoint(ground),
          hidden: marker.getElement().hidden,
        });
      }
    }
    pitchedMap.remove();
    element.remove();
    return result;
  });
});

Then('those markers are neither drawn nor interactive', function () {
  assert.ok(this.behindCameraMarkers.length > 0);
  for (const marker of this.behindCameraMarkers) {
    assert.deepEqual(marker, { empty: true, hit: false, hidden: true });
  }
});
