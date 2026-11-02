import { atmosphere, moonPosition, solarPosition, projectCelestialBody } from '../utils/sun.js';
import { underEntry } from '../utils/control.js';

function installSunlight(map) {
  const L = globalThis.L;
  const control = new L.Control({ position: 'bottomright' });
  control.live = true;
  let date, slider, output, status, timer;
  const originalSky = map.getContainer().style.getPropertyValue('--leaflet-sky-background');
  const disc = 'position:absolute;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;';
  const sunDisc = L.DomUtil.create('div', 'sunlight-sun');
  const moonDisc = L.DomUtil.create('div', 'sunlight-moon');
  sunDisc.style.cssText = disc + 'background:#fff3bd;box-shadow:0 0 18px 7px #ffd27699;';
  moonDisc.style.cssText = disc + 'background:#dce5f2;box-shadow:0 0 10px 2px #cbdcff55;';
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
      const point = projectCelestialBody(body.direction, size, pitch, bearing);
      if (!point) continue;
      const { left, top } = point;
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
      const center = map.getCenter();
      const sun = map._sunlight = solarPosition(control.time, center.lat, center.lng);
      Object.assign(sun, atmosphere(sun.altitude));
      sun.moon = moonPosition(control.time, center.lat, center.lng);
      status.textContent = sun.altitude <= 0 ? 'Night · no direct sunlight' :
        sun.altitude < 3 ? 'Low sun · shadows paused' : `Sun altitude ${sun.altitude.toFixed(1)}°`;
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
    const container = L.DomUtil.create('div', 'sunlight-control');
    container.style.cssText = 'color:#222;width:min(200px,calc(100vw - 60px));font:12px/1.4 sans-serif;';
    date = document.createElement('input');
    date.type = 'date';
    date.style.cssText = 'width:100%;box-sizing:border-box;';
    date.setAttribute('aria-label', 'Solar date (UTC)');
    slider = document.createElement('input');
    slider.type = 'range';
    slider.style.cssText = 'width:100%;box-sizing:border-box;margin:10px 0 4px;cursor:pointer;';
    slider.min = '0'; slider.max = '1439'; slider.step = '1';
    slider.setAttribute('aria-label', 'Time of day (UTC)');
    output = document.createElement('output');
    output.style.cssText = 'font-weight:bold;font-variant-numeric:tabular-nums;';
    output.setAttribute('aria-live', 'off');
    const now = document.createElement('button');
    now.type = 'button'; now.textContent = 'Now';
    now.onclick = () => { control.live = true; update(); };
    const timeRow = document.createElement('div');
    timeRow.className = 'sunlight-time';
    timeRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    timeRow.append(output, now);
    status = document.createElement('div');
    status.className = 'sunlight-status';
    status.style.marginTop = '5px';
    status.setAttribute('role', 'status');
    const note = document.createElement('small');
    note.style.color = '#555';
    note.textContent = 'Indicative · loaded geometry only. Streetlight illumination is estimated, not measured lux.';
    container.append(date, slider, timeRow, status, note);
    slider.oninput = selectTime;
    date.onchange = selectTime;
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
  return control;
}

// Sun/moon clock control and sky colours; the control is created on first add (`layer.control`).
L.Layer.types.sunlight = L.Layer.extend({
  onAdd(map) {
    this.control = this.control || installSunlight(map);
    if (!this.control._map) this.control.addTo(map);
    // Shown under this layer's entry in the layers control; a standalone control without one.
    const container = this.control.getContainer(), nested = underEntry(this, container);
    container.classList.toggle('leaflet-control', !nested);
    container.classList.toggle('leaflet-bar', !nested);
    Object.assign(container.style, nested
      ? { background: '', padding: '2px 0 6px 20px', margin: '0' }
      : { background: '#fff', padding: '8px', margin: '' });
  },
  onRemove() {
    this.control.remove();
  },
});
