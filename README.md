# leaflet-rotate

[![NPM version](https://img.shields.io/npm/v/leaflet-rotate.svg?color=red)](https://www.npmjs.com/package/leaflet-rotate)
[![License](https://img.shields.io/badge/license-GPL%203-blue.svg?style=flat)](LICENSE)

A Leaflet plugin that allows to add rotation functionality to map tiles

_For a working example see the following [demo](https://raruto.github.io/leaflet-rotate/examples/leaflet-rotate.html)_

<p align="center">
    <a href="https://raruto.github.io/leaflet-rotate/examples/leaflet-rotate.html"><img src="https://raruto.github.io/img/leaflet-rotate.png" alt="Leaflet rotate viewer" /></a>
</p>

---

<blockquote>
    <p align="center">
        <em>Initially based on the <a href="https://github.com/Leaflet/Leaflet/tree/rotate">work</a> of <strong>Iván Sánchez Ortega</strong> (see: <a href="https://github.com/Leaflet/Leaflet/issues/268">#268</a>)</em>
    </p>
</blockquote>

### How to use

Load Leaflet first, then the plugin. For example, using the published CDN build:

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-rotate@0.5.2/dist/leaflet-rotate.js"></script>
```

Or if you want to test it with [`2.0.0-alpha.1`](https://github.com/Leaflet/Leaflet/releases/tag/v2.0.0-alpha.1):

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet-global-src.js"></script>
<script>globalThis.L = globalThis.leaflet;</script>
<script src="https://unpkg.com/leaflet-rotate@0.5.2/dist/leaflet-rotate.js"></script>
```

Now, you can enable rotation in the map options. Bearing and pitch values are in degrees:

```js
const map = L.map('map', {
    rotate: true,
    bearing: 30,
    pitch: 20,
    rotateControl: true,
});

map.setBearing(90);
map.setPitch(35);
console.log(map.getBearing(), map.getPitch());
```

#### Map options

| Option | Default | Description |
| --- | --- | --- |
| `rotate` | `false` | Enables map rotation and pitch. |
| `bearing` | `0` | Initial map bearing, in degrees. |
| `pitch` | `0` | Initial map pitch, in degrees (clamped to `0`–`85`). |
| `pitchMaxDistance` | `3` | Far plane for pitched maps, in multiples of the map height: farther areas (and anything beyond the horizon) are not loaded and are covered by the `.leaflet-pitch-sky` element. Lower values load fewer tiles. |
| `rotateControl` | `true` | Adds the rotation control. Set to `false` to hide it, or pass options such as `{ closeOnZeroBearing: false }`. |
| `shiftKeyRotate` | `true` | Enables bearing changes with Shift + mouse wheel. |
| `pitchDrag` | `true` | Enables bearing and pitch changes with Ctrl + mouse drag or right-button drag. |
| `touchRotate` | `false` | Enables rotation with a two-finger touch gesture. |
| `touchPitch` | `false` | Enables pitch changes by dragging two fingers vertically. |
| `compassBearing` | `false` | Makes the bearing follow the device compass. On iOS, enable it from a user gesture (e.g. `map.compassBearing.enable()` in a button click) so that the orientation permission can be requested. |

#### Map methods and events

| API | Description |
| --- | --- |
| `map.setBearing(degrees, options?)` | Sets the bearing. Use `{ animate: true, duration: 0.5 }` for an animated change; `duration` is in seconds. |
| `map.getBearing()` | Returns the current bearing in degrees. |
| `map.setPitch(degrees, options?)` | Sets the pitch, clamped to `0`–`85` degrees. Accepts the same animation options as `setBearing`. |
| `map.getPitch()` | Returns the current pitch in degrees. |
| `map.resetNorth(options?)` | Animates the bearing back to `0` (pass `{ animate: false }` to skip the animation). |
| `map.resetNorthPitch(options?)` | Animates both bearing and pitch back to `0`. |
| `rotate` event | Fired when the bearing changes. |
| `pitch` event | Fired when the pitch changes. |

Pitched pans retain their final ground transform. When `setView` resets the map pane (including non-animated zooms), perspective is rebuilt before calculating the new pixel origin, preserving the camera and horizon.

#### Rotation control

The control is available as `L.Control.Rotate` or `L.control.rotate(options)`. Click it to reset bearing and pitch (`map.resetNorthPitch()`), drag it horizontally to rotate and vertically to change the pitch. The map option `rotateControl` adds it automatically.

| Option | Default | Description |
| --- | --- | --- |
| `position` | `'topleft'` | Leaflet control position. |
| `closeOnZeroBearing` | `true` | Hides the control when both bearing and pitch are zero. |
| `visualizePitch` | `true` | Tilts the icon with the pitch; when `false`, clicking only resets the bearing and dragging only rotates. |

#### Marker options

| Option / method | Description |
| --- | --- |
| `rotation` | Marker icon rotation in radians. |
| `rotateWithView` | Rotates the icon with the map bearing. |
| `keepUpright` | With `rotateWithView: true`, flips the icon as needed to keep it readable while preserving line alignment. |
| `scale` | Optional scale applied to the marker icon. |
| `marker.setRotation(radians)` | Updates the marker's icon rotation. |

With `preferCanvas: true` on the map, markers using an image `L.Icon` are drawn (with their shadow) on a dedicated screen-space Canvas instead of `<img>` elements. Icons remain upright and keep their pixel dimensions when the map is rotated or pitched, just like DOM markers; their geographic anchors still follow the map. Marker rotation options also apply. Popups, tooltips, pointer events and dragging (mouse, touch or pen) keep working, including `marker.dragging.enable()` / `disable()`, drag events and `autoPan`. `DivIcon` markers still use the DOM. Canvas markers use the dedicated marker renderer rather than a vector `renderer` option.

With `keyboard: true` (the Leaflet default) and `interactive: true`, each Canvas marker has a lightweight DOM button returned by `getElement()`. Its accessible name uses `title`, then `alt`, then “Marker”; provide a meaningful name such as `{ title: 'London station' }`. Tab focuses the marker with a visible outline; Enter or Space triggers its normal click/popup behavior. Focus opens its tooltip and respects `autoPanOnFocus`. Markers behind the camera are hidden from assistive technology. `keyboard: false` or `interactive: false` omits this button. Rendering remains on Canvas, but keyboard accessibility adds one DOM element per marker (only the focused one is repositioned during pan/zoom/rotation, so per-frame cost stays constant); pointer dragging does not provide keyboard repositioning.

Canvas marker positions follow Leaflet's zoom-transition timing without scaling the icons. At high pitch, markers behind the camera are excluded from drawing and hit testing.

---

### Build Guide

Within your local development environment:

```shell
git clone git@github.com:Raruto/leaflet-rotate.git
cd ./leaflet-rotate

npm i         # install dependencies
npm run dev   # start dev server at: http://localhost:8080
npm run build # generate "dist" files (once)
npm run test  # build and run browser tests
```

After that you can start developing inside the `src` and `test` folders (eg. open "http://localhost:8080/test" in your browser to preview changes).

#### Offline Paris 3D example

The [3D example](examples/leaflet-rotate-3d-layer.html) loads local archives from `examples/data/`.
Build all archives with `node build/pmtiles.js`, or just the tree inventory with:

```shell
node build/pmtiles.js --only=trees
```

The tree archive contains the [Ville de Paris tree inventory](https://opendata.paris.fr/explore/dataset/les-arbres/)
(ODbL), including its peripheral parks. It is not a census of all trees or woodland.
The switchable **Paris trees (3D)** layer uses recorded height (metres) and trunk circumference
(centimetres, converted to radius), with schematic crowns based on genus. Missing/implausible
measurements use development-stage height estimates (4/8/15/20 m for young/young-adult/adult/mature,
10 m otherwise) and a trunk radius of height/80. Tooltips distinguish measurements from estimates;
crown dimensions are always estimates. Empty planting locations and stumps are not rendered.
Trees share the 3D renderer, terrain elevation, picking and hover tooltips with the other overlays.

#### Sunlight and shadows

The always-visible **Sunlight & shadows** control is at the top left of the 3D example.
It starts enabled at the current time and updates every minute until you adjust the date or time.
Drag the time slider to preview any minute of the selected **UTC** day; changing the date
also switches to manual time. **Now** returns to the current date/time and resumes the clock.
The checkbox disables the simulation and restores the original lighting.
The sky blends between blue daylight, warm twilight and dark night; terrain imagery,
buildings and trees receive matching warm/cool illumination. Sun and moon discs move
with the selected time and map orientation. They appear only above the horizon and
inside the view: increase pitch and look towards their direction to see them.
Lunar positions use an approximate geocentric orbit (no parallax/refraction); discs are
exaggerated for visibility and the moon does not simulate its phase.

Solar simulation uses the selected UTC date/time and map centre to calculate solar altitude
and azimuth. A shared 2048-pixel directional depth map casts shadows from loaded buildings,
trees and models onto the 3D scene, including terrain imagery.
At night direct light is disabled; below 3 degrees altitude shadows are disabled to avoid unstable
near-horizon projections. This is indicative, not a thermal/irradiance study: heights/crowns may be
estimated, unloaded objects cannot cast shadows, transparency cutouts cast as solid triangles,
and clouds/atmospheric refraction are not modelled. Orthophotos retain their original baked lighting.
Turn the simulation off to restore the original illumination.

#### Streetlights and Eiffel Tower night lighting

The **Paris streetlights (night)** overlay is enabled by default and loads
`examples/data/paris-streetlights.pmtiles`, built from the
[Ville de Paris / Cielis public lighting inventory](https://opendata.paris.fr/explore/dataset/eclairage-public/)
(ODbL). Rebuild it with `node build/pmtiles.js --only=streetlights`.
The archive retains each lamp, including lamps sharing the same support, and records the
source update/retrieval timestamps in its metadata. It is an inventory snapshot, not live status.

Bulb height follows recorded support height; colour follows recorded Kelvin, and indicative
ground reach uses support height and luminous flux: `1.5 * height * sqrt(lumens / 10000)`,
clamped to 6–22 m. Missing/implausible values assume 6 m, 6000 lm and 3000 K (2000 K for sodium).
Tooltips distinguish recorded/assumed values and retain the source's operating-regime label.
Local lights illuminate the terrain and nearby buildings, trees and models using surface normals,
inverse-square distance falloff and a smooth range cutoff. A cached spatial grid evaluates only
nearby lamps, without limiting the number per cell. They blend in between solar altitudes +3 and -6 degrees.
Switch the layer off to compare the city without artificial lighting.
Schematic grey poles and lamp heads remain visible during daylight (and with solar simulation off).
Poles are drawn only for inventory categories Candélabre, Mât and Porte LAC RATP, once per support;
wall-mounted fixtures do not get an invented pole. Height follows the recorded/assumed support height,
while diameter and head shape are illustrative. Gallery/service-gallery fixtures, explicitly underground
street labels (tunnel, souterrain, sous-sol/sous-passage), and negative support heights are excluded
from both rendering and local illumination. Ground-mounted outdoor lamps are not treated as underground.

This is approximate local lighting, **not measured lux, coverage guarantees or a calibrated
photometric simulation**: lamps do not cast obstacle shadows or model luminaire aiming/distribution,
dimming, faults or switching schedules. Light can therefore pass through walls or tree crowns.
Electrical wattage is retained but is not treated as luminous output.
The Eiffel Tower model has sparse individual warm-white luminous points on its structure during
simulated night, not a uniformly emissive golden material. This is not a reproduction of the actual
sparkling show or its operating schedule.
Disabling solar simulation switches off both artificial-light effects and restores original materials.

#### Scheduled Seine cruises

The default-enabled **Seine tourist boats (scheduled)** overlay shows schematic 3D sightseeing
boats following the [Bateaux-Mouches route and timetable](https://www.bateaux-mouches.fr/fr/croisiere/informations).
It shares the date/time slider, moves continuously in **Now** mode, and interprets departures in
**Europe/Paris** local time, including daylight saving (the slider still displays UTC).
Disabling sunlight does not disable the boat schedule.
A cyan dashed trace shows the same route on the water, including outside service hours;
it shares the boat overlay toggle and terrain/camera projection.
The trace is an informational overlay, drawn above terrain and bridges for readability;
boats retain normal depth occlusion.

Published departures are every 30 minutes from 10:00 to 21:30 April–October, and every
45 minutes from 10:15 to 21:30 November–March, with an extra 22:00 departure on October Saturdays.
Each trip lasts an estimated hour: Alma → northern branch past the Louvre → Île Saint-Louis →
southern branch past Notre-Dame → Eiffel Tower/Bir-Hakeim → Alma. Outside these trips no boats
are shown; this is not a 24-hour service.

Positions are **estimates, not live GPS**: the route is approximate, speed is constant, and boat
models do not represent individual vessels. The water surface is fixed at an illustrative 27.15 m NGF,
independent of riverbed elevation. School-holiday extras, lunch/dinner services, cancellations,
traffic, bridge clearance, floods and changing river levels are not modelled.

---

**Side notes:**

Be aware that this library overrides notable parts of leaflet core via the [L.Class.include()](https://leafletjs.com/examples/extending/extending-1-classes.html) function in order to make the rotate feature usable as a standalone plug-in.

Initial changes to this project have been apported by comparing the following branches: [https://github.com/Leaflet/Leaflet/compare/main...fnicollet:rotate-master](https://github.com/Leaflet/Leaflet/compare/main...fnicollet:rotate-master) (ref: [bac6c7d](https://github.com/fnicollet/Leaflet/tree/4ab6342f74516e7087dcd2ae786c721f36addf9e))

---

**Compatibile with:**
[![Leaflet 1.9.4 compatible!](https://img.shields.io/badge/Leaflet-1.9.4-1EB300.svg?style=flat)](http://leafletjs.com/reference.html) [![Leaflet 2.x compatible!](https://img.shields.io/badge/Leaflet-2.0.0--alpha.1-1EB300.svg?style=flat)](http://leafletjs.com/reference.html)

**Contributors:** [IvanSanchez](https://github.com/IvanSanchez), [Fnicollet](https://github.com/fnicollet/Leaflet/tree/rotate-master), [Hyperknot](https://github.com/hyperknot), [Raruto](https://github.com/Raruto/leaflet-rotate)
