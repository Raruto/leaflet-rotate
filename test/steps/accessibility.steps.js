import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';

When('I focus and activate a Canvas marker with the keyboard', async function () {
  await this.page.evaluate(() => {
    map.options.preferCanvas = true;
    window.accessibleMarker = new L.Marker(map.getCenter(), {
      title: 'Accessible station', autoPanOnFocus: false,
    }).bindPopup('Station information', { autoPan: false }).bindTooltip('Station tooltip').addTo(map);
    window.accessibleClicks = 0;
    accessibleMarker.on('click', () => accessibleClicks++);
  });
  const marker = this.page.getByRole('button', { name: 'Accessible station', exact: true });
  await marker.focus();
  await this.page.keyboard.press('Shift+Tab');
  await this.page.keyboard.press('Tab');
  assert.equal(await marker.evaluate(el => el === document.activeElement), true);
  assert.equal(await marker.evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await this.page.evaluate(() => accessibleMarker.isTooltipOpen()), true);
  assert.ok(await marker.getAttribute('aria-describedby'));
  await marker.press('Enter');
  assert.equal(await this.page.evaluate(() => accessibleMarker.isPopupOpen()), true);
  assert.equal(await marker.getAttribute('aria-expanded'), 'true');
  await marker.focus();
  await marker.press('Space');
  assert.equal(await this.page.evaluate(() => accessibleMarker.isPopupOpen()), false);
  assert.equal(await this.page.evaluate(() => accessibleClicks), 2);
  await this.page.evaluate(() => {
    map.stop();
    accessibleMarker.getElement().blur();
    accessibleMarker.unbindPopup();
    accessibleMarker.setLatLng(map.containerPointToLatLng([-100, map.getSize().y / 2]));
    window.beforeAccessibleFocus = map.getCenter();
  });
  await marker.focus();
  assert.equal(await this.page.evaluate(() => map.getCenter().equals(beforeAccessibleFocus)), true);
  await this.page.evaluate(() => {
    accessibleMarker.getElement().blur();
    accessibleMarker.options.autoPanOnFocus = true;
  });
  await marker.focus();
  await this.page.waitForFunction(() =>
    !map.getCenter().equals(beforeAccessibleFocus)
    && map.getBounds().contains(accessibleMarker.getLatLng()));
  await this.page.evaluate(() => {
    accessibleMarker.bindPopup('Station information').openPopup();
  });
});

Then('its accessible button supports names, focus, popups and cleanup', async function () {
  const result = await this.page.evaluate(() => {
    const disabled = new L.Marker(map.getCenter(), { keyboard: false }).addTo(map);
    const passive = new L.Marker(map.getCenter(), { interactive: false }).addTo(map);
    const alt = new L.Marker(map.getCenter(), { alt: 'Alternate station name' }).addTo(map);
    const element = accessibleMarker.getElement();
    element.focus();
    map.setBearing(65);
    map.setPitch(45);
    accessibleMarker.options.scale = -1;
    accessibleMarker.update();
    const position = L.DomUtil.getPosition(element);
    const expected = map.latLngToContainerPoint(accessibleMarker.getLatLng());
    const mapPosition = map._getMapPanePos();
    const result = {
      disabled: Boolean(disabled.getElement()), passive: Boolean(passive.getElement()),
      alt: alt.getElement().getAttribute('aria-label'),
      unfocusedIdle: !alt.getElement().style.transform,
      canvas: Boolean(accessibleMarker._canvasIcon),
      popupTarget: element.getAttribute('aria-controls') === accessibleMarker.getPopup().getElement().id,
      aligned: position.add(mapPosition).distanceTo(expected) < 1,
      mirrored: element.style.transform.includes('scale(-1)'),
    };
    accessibleMarker.setIcon(new L.DivIcon({ html: 'Station' }));
    result.oldButtonRemoved = !element.isConnected;
    accessibleMarker.remove();
    alt.remove();
    disabled.remove();
    passive.remove();
    result.removed = !accessibleMarker.getElement();
    return result;
  });
  assert.deepEqual(result, {
    disabled: false, passive: false, alt: 'Alternate station name', unfocusedIdle: true,
    canvas: true, popupTarget: true, oldButtonRemoved: true, removed: true,
    aligned: true, mirrored: true,
  });
});
