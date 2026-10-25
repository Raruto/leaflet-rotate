import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

Then('the zoom transition ends before the gesture ends', function () {
  assert.ok(this.zoomEndsDuringGesture > 0);
});

Then('the vector path remains aligned during the gesture', function () {
  assert.ok(this.gesturePathPositions.bearingChange > 1, JSON.stringify(this.gesturePathPositions));
  assert.ok(this.gesturePathPositions.zoomChange > 0, JSON.stringify(this.gesturePathPositions));
  assert.ok(Math.hypot(...this.gesturePathPositions.delta) < 2, JSON.stringify(this.gesturePathPositions));
});

Then('the map bearing remains unchanged', function () {
  assert.equal(this.bearings[1], this.bearings[0]);
  assert.equal(this.bearings[2], false);
});

When('I move a two-finger pinch gesture', async function () {
  this.zoomEndsDuringGesture = await this.page.evaluate(() => {
    const container = map.getContainer();
    const gestures = map.touchGestures;
    const wasZoomEnabled = gestures.zoom;
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const touches = (offsetX, offsetY) => [
      new Touch({ identifier: 1, target: container, clientX: centerX - offsetX, clientY: centerY - offsetY }),
      new Touch({ identifier: 2, target: container, clientX: centerX + offsetX, clientY: centerY + offsetY }),
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
    let zoomEnds = 0;
    const onZoomEnd = () => zoomEnds++;

    gestures.zoom = true;
    map.on('zoomend', onZoomEnd);
    const startTouches = touches(30, 0);
    dispatch(container, 'touchstart', startTouches);
    dispatch(document, 'touchmove', touches(40, 30));
    const result = zoomEnds;
    dispatch(document, 'touchend', [], touches(40, 30));
    map.off('zoomend', onZoomEnd);
    gestures.zoom = wasZoomEnabled;
    return result;
  });
});

When('I drag a constrained marker on a rotated map', async function () {
  await this.page.evaluate(() => {
    map.options.zoomAnimation = false;
    map.setMaxBounds([[-89.98155760646617, -180], [89.99346179538875, 180]]);
    map.setView([23.1799, 113.4103], 15, { animate: false });
    map.setBearing(30);
    map.setZoom(16, { animate: false });
    window.dragMarker = new L.Marker([23.1799, 113.4103], { draggable: true }).addTo(map);
    window.dragMarkerStart = window.dragMarker.getLatLng();
    window.dragCallbackLatLngs = [];
    window.dragMarker.on('drag dragend', event => {
      window.dragCallbackLatLngs.push([event.latlng.lat, event.latlng.lng]);
    });
  });

  const box = await this.page.locator('.leaflet-marker-icon').last().boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height - 5 };
  const end = { x: start.x + 80, y: start.y + 40 };
  const markerOffset = await this.page.evaluate(({ x, y }) => {
    const rect = map.getContainer().getBoundingClientRect();
    const markerPoint = map.latLngToContainerPoint(window.dragMarker.getLatLng());
    return [x - rect.left - markerPoint.x, y - rect.top - markerPoint.y];
  }, start);
  await this.page.mouse.move(start.x, start.y);
  await this.page.mouse.down();
  await this.page.mouse.move(end.x, end.y, { steps: 8 });
  await this.page.mouse.up();

  this.markerPosition = await this.page.evaluate(({ x, y, markerOffset }) => {
    const rect = map.getContainer().getBoundingClientRect();
    const pointerPosition = map.containerPointToLatLng([x - rect.left, y - rect.top]);
    const markerPosition = map.latLngToContainerPoint(window.dragMarker.getLatLng());
    const expected = [x - rect.left - markerOffset[0], y - rect.top - markerOffset[1]];
    return {
      delta: [markerPosition.x - expected[0], markerPosition.y - expected[1]],
      moved: !window.dragMarkerStart.equals(window.dragMarker.getLatLng()),
      marker: window.dragMarker.getLatLng(),
      pointer: pointerPosition,
      callbacks: window.dragCallbackLatLngs,
    };
  }, { ...end, markerOffset });
});

When('I drag a map with interactive layers while rotated', async function () {
  await this.page.evaluate(() => {
    map.options.zoomAnimation = false;
    map.setView([55, 10], 6, { animate: false });
    const marker = new L.Marker([55.1, 10.1]).addTo(map);
    const path = new L.CircleMarker([55.2, 10.2], { radius: 8 }).addTo(map);
    map.setBearing(35);
    window.interactiveLayers = { marker, path };
  });

  const bounds = await this.page.locator('#map').boundingBox();
  const start = { x: bounds.x + bounds.width * 0.8, y: bounds.y + bounds.height * 0.5 };
  const end = { x: start.x - 75, y: start.y + 45 };
  await this.page.mouse.move(start.x, start.y);
  await this.page.mouse.down();
  await this.page.mouse.move(end.x, end.y, { steps: 8 });
  await this.page.mouse.up();

  this.interactivePositions = await this.page.evaluate(() => {
    const { marker, path } = window.interactiveLayers;
    const measure = () => {
      const markerElement = marker.getElement();
      const markerRect = markerElement.getBoundingClientRect();
      const mapRect = map.getContainer().getBoundingClientRect();
      const markerScreen = [markerRect.left + markerRect.width / 2 - mapRect.left, markerRect.bottom - mapRect.top];
      const markerExpected = map.latLngToContainerPoint(marker.getLatLng());
      const pathElement = path.getElement();
      const pathBounds = pathElement.getBBox();
      const pathScreen = new DOMPoint(pathBounds.x + pathBounds.width / 2, pathBounds.y + pathBounds.height / 2)
        .matrixTransform(pathElement.getScreenCTM());
      const pathExpected = map.latLngToContainerPoint(path.getLatLng());
      return [
        markerScreen[0] - markerExpected.x,
        markerScreen[1] - markerExpected.y,
        pathScreen.x - mapRect.left - pathExpected.x,
        pathScreen.y - mapRect.top - pathExpected.y,
      ];
    };
    const moved = !map.getCenter().equals(new L.LatLng(55, 10));
    const positions = [measure()];
    map.setBearing(0);
    positions.push(measure());
    map.setBearing(35);
    positions.push(measure());
    return { positions, moved };
  });
});
