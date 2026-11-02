import { atmosphere, moonPosition, solarPosition } from '../utils/sun.js';

function installSunlight(map) {
  const L = globalThis.L;
  const control = new L.Control({ position: 'bottomright' });
  control.live = true;
  let date, slider, output, enabled, status, timer;
  const originalSky = map.getContainer().style.getPropertyValue('--leaflet-sky-background');
  const sunDisc = L.DomUtil.create('div', 'sunlight-sun');
  const moonDisc = L.DomUtil.create('div', 'sunlight-moon');
  sunDisc.setAttribute('role', 'img'); sunDisc.setAttribute('aria-label', 'Sun');
  moonDisc.setAttribute('role', 'img'); moonDisc.setAttribute('aria-label', 'Moon');
  const updateSky = () => {
    const sun = map._sunlight, sky = map._pitchSky;
    if (sun) map.getContainer().style.setProperty('--leaflet-sky-background', sun.background);
    else if (originalSky) map.getContainer().style.setProperty('--leaflet-sky-background', originalSky);
    else map.getContainer().style.removeProperty('--leaflet-sky-background');
    const size = map.getSize(), pitch = map.getPitch() * Math.PI / 180, bearing = map.getBearing() * Math.PI / 180;
    for (const [disc, body] of [[sunDisc, sun], [moonDisc, sun?.moon]]) {
      disc.hidden = true;
      if (!sky || !body || body.altitude <= 0 || !sun) continue;
      if (disc.parentNode !== sky) sky.append(disc);
      const [x, y, z] = body.direction;
      const right = x * Math.cos(bearing) - z * Math.sin(bearing);
      const up = -x * Math.sin(bearing) * Math.cos(pitch) + y * Math.sin(pitch) - z * Math.cos(bearing) * Math.cos(pitch);
      const forward = -x * Math.sin(bearing) * Math.sin(pitch) - y * Math.cos(pitch) - z * Math.cos(bearing) * Math.sin(pitch);
      if (forward <= 0) continue;
      const left = size.x / 2 + size.y * 1.5 * right / forward;
      const top = size.y / 2 - size.y * 1.5 * up / forward;
      disc.hidden = left < 0 || left > size.x || top < 0 || top > sky.clientHeight || sky.style.display === 'none';
      disc.style.left = `${left}px`; disc.style.top = `${top}px`;
    }
  };
  const render = () => L.Layer.types['3d']?._renderers.get(map)?.update();
  const update = () => {
    try {
      if (control.live) control.time = new Date();
      const time = control.time.toISOString();
      date.value = time.slice(0, 10);
      slider.value = String(control.time.getUTCHours() * 60 + control.time.getUTCMinutes());
      output.textContent = `${time.slice(11, 16)} UTC${control.live ? ' · now' : ''}`;
      if (!enabled.checked) {
        delete map._sunlight;
        status.textContent = 'Simulation off';
      } else {
        const center = map.getCenter();
        const sun = map._sunlight = solarPosition(control.time, center.lat, center.lng);
        Object.assign(sun, atmosphere(sun.altitude));
        sun.moon = moonPosition(control.time, center.lat, center.lng);
        status.textContent = sun.altitude <= 0 ? 'Night · no direct sunlight' :
          sun.altitude < 3 ? 'Low sun · shadows paused' : `Sun altitude ${sun.altitude.toFixed(1)}°`;
      }
      map.fire('simulationtimechange', { time: new Date(control.time), live: control.live });
      updateSky(); render();
    } catch (error) {
      delete map._sunlight;
      updateSky();
      render();
      status.textContent = `Error: ${error.message}`;
      console.error('Solar simulation', error);
    }
  };
  const selectTime = () => {
    control.live = false;
    if (!date.value || !date.validity.valid) {
      control.time = new Date(NaN);
      map.fire('simulationtimechange', { time: null, live: false });
      delete map._sunlight;
      updateSky();
      render();
      status.textContent = 'Error: choose a valid solar date';
      return;
    }
    control.time = new Date(`${date.value}T00:00:00Z`);
    control.time.setUTCMinutes(Number(slider.value));
    update();
  };
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'sunlight-control leaflet-bar');
    const heading = document.createElement('label');
    enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = true;
    heading.append(enabled, document.createTextNode(' Shadows'));
    date = document.createElement('input');
    date.type = 'date';
    date.setAttribute('aria-label', 'Solar date (UTC)');
    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '1439'; slider.step = '1';
    slider.setAttribute('aria-label', 'Time of day (UTC)');
    output = document.createElement('output');
    output.setAttribute('aria-live', 'off');
    const now = document.createElement('button');
    now.type = 'button'; now.textContent = 'Now';
    now.onclick = () => { control.live = true; update(); };
    const timeRow = document.createElement('div');
    timeRow.className = 'sunlight-time';
    timeRow.append(output, now);
    status = document.createElement('div');
    status.className = 'sunlight-status';
    status.setAttribute('role', 'status');
    const note = document.createElement('small');
    note.textContent = 'Indicative · loaded geometry only. Streetlight illumination is estimated, not measured lux.';
    container.append(heading, date, slider, timeRow, status, note);
    slider.oninput = selectTime;
    date.onchange = selectTime;
    enabled.onchange = update;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    update();
    timer = setInterval(() => { if (control.live) update(); }, 60000);
    map.on('moveend', update);
    map.on('move rotate pitch resize', updateSky);
    return container;
  };
  control.onRemove = () => {
    clearInterval(timer);
    map.fire('simulationtimechange', { time: null, live: false });
    map.off('moveend', update);
    map.off('move rotate pitch resize', updateSky);
    delete map._sunlight;
    updateSky();
    sunDisc.remove(); moonDisc.remove();
    render();
  };
  control.addTo(map);
  const container = control.getContainer();
  container.parentNode.insertBefore(container, container.parentNode.firstChild);
  return control;
}

// Sun/moon clock control and sky colours; the control is created on first add (`layer.control`).
L.Layer.types.sunlight = L.Layer.extend({
  onAdd(map) {
    this.control = this.control || installSunlight(map);
    if (!this.control._map) this.control.addTo(map);
  },
  onRemove() {
    this.control.remove();
  },
});
