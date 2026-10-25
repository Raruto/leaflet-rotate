import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

Then('the displayed bounds use the selected padding', function () {
  assert.equal(this.debugPadding.value, -0.01);
  assert.equal(this.debugPadding.refreshed, true);
  assert.equal(this.debugPadding.boundsMatch, true);
  assert.equal(this.debugPadding.centerMatches, true);
});

Then('exactly the selected base layer is visible', function () {
  assert.deepEqual(this.visibleBaseLayers, [['Empty'], ['Streets'], ['Satellite']]);
});

Then('the zoom returns to its starting level', function () {
  assert.equal(this.zoomAfterIn, this.startingZoom + 1);
  assert.equal(this.finalZoom, this.startingZoom);
});

Then('every example marker has a new rotation', function () {
  assert.equal(this.markerRotationsAfter.length, this.markerRotationsBefore.length);
  assert.ok(this.markerRotationsAfter.every((rotation, index) =>
    Number.isFinite(rotation) && rotation > this.markerRotationsBefore[index]));
});

Then('the map settles at {string} at zoom 10', function (place) {
  assert.ok(this.destination.distance < 1, `${place}: ${JSON.stringify(this.destination)}`);
  assert.ok(Math.abs(this.destination.zoom - 10) < 1e-6, JSON.stringify(this.destination));
});

When('I use the debugger rotation controls', async function () {
  this.debugBearings = [];
  for (const bearing of [0, 15, 30, 45, 60, 75, 90, 180]) {
    await this.page.getByRole('button', { name: String(bearing), exact: true }).click();
    this.debugBearings.push(await this.page.evaluate(() => ({
      map: map.getBearing(),
      slider: document.getElementById('rho_input').valueAsNumber,
      arrow: document.querySelector('.leaflet-control-rotate-arrow').style.transform,
    })));
  }

  const slider = this.page.locator('#rho_input');
  await slider.focus();
  await slider.press('ArrowRight');
  this.debugBearings.push(await this.page.evaluate(() => ({
    map: map.getBearing(),
    slider: document.getElementById('rho_input').valueAsNumber,
    arrow: document.querySelector('.leaflet-control-rotate-arrow').style.transform,
  })));
});

Then('every debugger rotation control matches the map bearing', function () {
  const expected = [0, 15, 30, 45, 60, 75, 90, 180, 181];
  assert.equal(this.debugBearings.length, expected.length);
  this.debugBearings.forEach((value, index) => {
    assert.ok(Math.abs(value.map - expected[index]) < 1e-6, JSON.stringify(value));
    assert.equal(value.slider, expected[index]);
    assert.equal(value.arrow, `rotate(${expected[index]}deg)`);
  });
});

When('I rotate a map with the default rotate control', async function () {
  this.rotateControlVisibility = await this.page.evaluate(() => {
    const container = document.createElement('div');
    container.style.cssText = 'width: 400px; height: 300px';
    document.body.append(container);
    const testMap = L.map(container, {
      center: [55, 10],
      zoom: 6,
      rotate: true,
      zoomControl: false,
    });
    const control = container.querySelector('.leaflet-control-rotate');
    const displayAtZero = getComputedStyle(control).display;
    testMap.setBearing(30);
    const displayWhenRotated = getComputedStyle(control).display;
    testMap.setBearing(0);
    const displayAfterReset = getComputedStyle(control).display;
    testMap.remove();
    container.remove();
    return [displayAtZero, displayWhenRotated, displayAfterReset];
  });
});

Then('the default rotate control visibility follows the bearing', function () {
  assert.deepEqual(this.rotateControlVisibility, ['none', 'block', 'none']);
});

When('I drag the rotate control', async function () {
  this.controlBearing = await this.page.evaluate(() => {
    map.setBearing(0);
    const link = map.rotateControl._link;
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 135, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 135, clientY: 100 }));
    return map.getBearing();
  });
});

Then('the map bearing follows the control drag', function () {
  assert.equal(this.controlBearing, 35);
});

When('I activate compass mode on a permission-based device', async function () {
  this.permissionRequests = await this.page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'DeviceOrientationEvent');
    window.permissionRequests = 0;
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: class {
        static requestPermission() {
          window.permissionRequests++;
          return Promise.resolve('denied');
        }
      },
    });
    const click = () => map.rotateControl._link.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    click();
    click();
    await Promise.resolve();
    if (descriptor) {
      Object.defineProperty(window, 'DeviceOrientationEvent', descriptor);
    } else {
      delete window.DeviceOrientationEvent;
    }
    return window.permissionRequests;
  });
});

Then('device-orientation permission is requested', function () {
  assert.equal(this.permissionRequests, 1);
});

When('I apply compass heading readings', async function () {
  this.compassReadings = await this.page.evaluate(async () => {
    const compass = map.compassBearing;
    const previousOrientation = window.orientation;
    const setOrientation = value => Object.defineProperty(window, 'orientation', {
      configurable: true,
      value,
    });

    map.setBearing(0);
    compass._onDeviceOrientation({ alpha: 40, absolute: true });
    const absolute = map.getBearing();

    setOrientation(90);
    compass._onDeviceOrientation({ alpha: 40, absolute: false });
    const relative = map.getBearing();

    setOrientation(0);
    compass._onDeviceOrientation({ webkitCompassHeading: 30, absolute: false });
    const ios = map.getBearing();

    compass._onDeviceOrientation({ alpha: null, absolute: true });
    const unavailable = map.getBearing();

    const absoluteEventDescriptor = Object.getOwnPropertyDescriptor(window, 'ondeviceorientationabsolute');
    Object.defineProperty(window, 'ondeviceorientationabsolute', {
      configurable: true,
      value: null,
    });
    const container = document.createElement('div');
    container.style.cssText = 'width: 400px; height: 300px';
    document.body.append(container);
    const absoluteMap = L.map(container, {
      center: [55, 10],
      zoom: 6,
      rotate: true,
      compassBearing: true,
      rotateControl: false,
      zoomControl: false,
    });
    const selectedEvent = absoluteMap.compassBearing.__deviceOrientationEvent;
    const event = new Event('deviceorientationabsolute');
    Object.defineProperties(event, {
      alpha: { value: 60 },
      absolute: { value: true },
    });
    window.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 150));
    const absoluteEventBearing = absoluteMap.getBearing();
    absoluteMap.remove();
    container.remove();
    if (absoluteEventDescriptor) {
      Object.defineProperty(window, 'ondeviceorientationabsolute', absoluteEventDescriptor);
    } else {
      delete window.ondeviceorientationabsolute;
    }

    if (previousOrientation === undefined) {
      delete window.orientation;
    } else {
      setOrientation(previousOrientation);
    }
    return { absolute, relative, ios, unavailable, selectedEvent, absoluteEventBearing };
  });
});

Then('valid compass readings update bearing and invalid readings are ignored', function () {
  const { absolute, relative, ios, unavailable, selectedEvent, absoluteEventBearing } = this.compassReadings;
  assert.deepEqual({ absolute, relative, ios, unavailable, selectedEvent }, {
    absolute: 40,
    relative: 310,
    ios: 330,
    unavailable: 330,
    selectedEvent: 'deviceorientationabsolute',
  });
  assert.ok(Math.abs(absoluteEventBearing - 60) < 1e-6);
});

When('I change the debugger bounds padding from the keyboard', async function () {
  await this.page.evaluate(() => {
    map.setView([55, 10], 6, { animate: false });
    map.setBearing(30);
    window.previousDebugBounds = L.Rotate.___bounds;
  });
  const slider = this.page.locator('#pad_input');
  await slider.focus();
  await slider.press('ArrowLeft');
  this.debugPadding = await this.page.evaluate(() => ({
    value: document.getElementById('pad_input').valueAsNumber,
    refreshed: window.previousDebugBounds !== L.Rotate.___bounds,
    boundsMatch: L.Rotate.___bounds.getBounds().equals(map.getBounds().pad(
      document.getElementById('pad_input').valueAsNumber,
    )),
    centerMatches: L.Rotate.___centerMarker.getLatLng().equals(map.getCenter()),
  }));
});

When('I inspect debugger geometry after resizing and moving the map', async function () {
  await this.page.evaluate(() => {
    Object.assign(map.getContainer().style, {
      width: '420px',
      height: '280px',
      margin: '80px 0 0 90px',
    });
    map.invalidateSize({ animate: false });
    map.setView([48, 8], 5, { animate: false });
    map.setBearing(30);
    map.panBy([20, 15], { animate: false });
    map.setZoom(6, { animate: false });
    window.debugMouseEvent = null;
    map.once('mousemove', event => {
      window.debugMouseEvent = {
        latlng: [event.latlng.lng, event.latlng.lat],
        layerPoint: [event.layerPoint.x, event.layerPoint.y],
        containerPoint: [event.containerPoint.x, event.containerPoint.y],
      };
    });
  });

  const bounds = await this.page.locator('#map').boundingBox();
  await this.page.mouse.move(bounds.x + 80, bounds.y + 60);
  await this.page.waitForFunction(() => window.debugMouseEvent !== null);
  this.debugGeometry = await this.page.evaluate(() => {
    const read = id => Number(document.getElementById(id).textContent);
    const size = map.getSize();
    const corners = L.Rotate.___corners.getLayers();
    const targets = [[0, 0], [size.x, 0], [size.x, size.y], [0, size.y]];
    const cornerDeltas = corners.map((marker, index) => {
      const point = map.latLngToContainerPoint(marker.getLatLng());
      return [point.x - targets[index][0], point.y - targets[index][1]];
    });
    const pixelBounds = map.getPixelBounds();
    const debugMin = JSON.parse(document.getElementById('ogbx').textContent);
    const debugMax = JSON.parse(document.getElementById('ogby').textContent);
    return {
      size: [size.x, size.y],
      paneSizes: ['.panebounds.rotate', '.panebounds.main'].map(selector => {
        const element = map.getContainer().querySelector(selector);
        return [parseFloat(element.style.width), parseFloat(element.style.height)];
      }),
      corners: cornerDeltas,
      pivot: [read('pvx') - map._pivot.x, read('pvy') - map._pivot.y],
      paneOffset: [
        read('pox') - map._getMapPanePos().x,
        read('poy') - map._getMapPanePos().y,
      ],
      pixelOrigin: [read('ogx') - map._pixelOrigin.x, read('ogy') - map._pixelOrigin.y],
      pixelBounds: [
        debugMin.x - pixelBounds.min.x,
        debugMin.y - pixelBounds.min.y,
        debugMax.x - pixelBounds.max.x,
        debugMax.y - pixelBounds.max.y,
      ],
      pointer: [
        read('llx') - window.debugMouseEvent.latlng[0],
        read('lly') - window.debugMouseEvent.latlng[1],
        read('lyx') - window.debugMouseEvent.layerPoint[0],
        read('lyy') - window.debugMouseEvent.layerPoint[1],
        read('cnx') - window.debugMouseEvent.containerPoint[0],
        read('cny') - window.debugMouseEvent.containerPoint[1],
      ],
    };
  });
});

Then('the debugger reports the current map geometry', function () {
  const { size, paneSizes, corners, pivot, paneOffset, pixelOrigin, pixelBounds, pointer } = this.debugGeometry;
  assert.deepEqual(paneSizes, [size, size]);
  for (const delta of [...corners, pivot, paneOffset, pixelOrigin, pixelBounds, pointer]) {
    assert.ok(delta.every(value => Math.abs(value) < 1), JSON.stringify(this.debugGeometry));
  }
});

When('I switch between the example base layers', async function () {
  this.visibleBaseLayers = [];
  for (const name of ['Empty', 'Streets', 'Satellite']) {
    await this.page.getByRole('radio', { name, exact: true }).check();
    this.visibleBaseLayers.push(await this.page.evaluate(() => layers._layers
      .filter(entry => !entry.overlay && map.hasLayer(entry.layer))
      .map(entry => entry.name)));
  }
});

When('I use the example zoom controls', async function () {
  this.startingZoom = await this.page.evaluate(() => map.getZoom());
  await this.page.getByRole('button', { name: 'Zoom in' }).click();
  await this.page.waitForFunction(zoom =>
    map.getZoom() === zoom + 1 && !map._animatingZoom, this.startingZoom);
  this.zoomAfterIn = await this.page.evaluate(() => map.getZoom());
  await this.page.getByRole('button', { name: 'Zoom out' }).click();
  await this.page.waitForFunction(zoom =>
    map.getZoom() === zoom && !map._animatingZoom, this.startingZoom);
  this.finalZoom = await this.page.evaluate(() => map.getZoom());
});

When('I rotate the example markers from the debugger', async function () {
  this.markerRotationsBefore = await this.page.evaluate(() => markers.map(marker => marker.options.rotation));
  await this.page.getByRole('button', { name: 'Rotate Markers' }).click();
  await this.page.waitForTimeout(600);
  this.markerRotationsAfter = await this.page.evaluate(() => markers.map(marker => marker.options.rotation));
});

When('I select {string} from the example page', async function (place) {
  await this.page.getByRole('button', { name: place, exact: true }).click();
  await this.page.waitForFunction(name =>
    map.getZoom() === 10 && map.getCenter().distanceTo(L.latLng(places[name])) < 1, place);
  this.destination = await this.page.evaluate(name => ({
    distance: map.getCenter().distanceTo(L.latLng(places[name])),
    zoom: map.getZoom(),
  }), place);
});

When('I fit the {string} bounds from the example page', async function (layerName) {
  await this.page.getByRole('button', { name: layerName.toUpperCase(), exact: true }).click();
  await this.page.waitForFunction(name => map.getBounds().contains(window[name].getBounds()), layerName);
  this.fittedBounds = await this.page.evaluate(name => {
    const layer = window[name];
    const bounds = layer.getBounds();
    return map.getBounds().contains(bounds);
  }, layerName);
});

When('I fit the rectangle from the example page', async function () {
  await this.page.getByRole('button', { name: 'RECTANGLE', exact: true }).click();
  await this.page.waitForFunction(() => map.getZoom() > 0 && map.getBounds().contains(rectangle.getBounds()));
  this.rectangleZoom = await this.page.evaluate(() => map.getZoom());
});
