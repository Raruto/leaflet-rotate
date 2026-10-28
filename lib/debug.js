(function() {
  const L = Object.isExtensible(globalThis.L) ? globalThis.L : Object.assign({}, globalThis.L);
  globalThis.L = L;
  L.Rotate = {

    debug(map, options = {}) {

        this._map = map;

        document.head.insertAdjacentHTML('beforeend', `<style>
            .leaflet-rotate-tools {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: 4px 16px;
              margin-bottom: 6px;
            }
            .leaflet-rotate-tools input, .leaflet-rotate-tools button {
              vertical-align: middle;
            }
            .leaflet-rotate-info {
              border-collapse: collapse;
            }
            .leaflet-rotate-info td, .leaflet-rotate-info th {
              padding: 1px 12px 1px 0;
              text-align: left;
              white-space: nowrap;
              vertical-align: top;
            }
            .leaflet-rotate-info td:nth-of-type(1), .leaflet-rotate-info td:nth-of-type(2) {
              font-family: monospace;
              min-width: 12ch;
            }
            .leaflet-rotate-info tr[title] {
              cursor: help;
            }
            div.crosshair {
              position:absolute;
              width:1px;
              height:1px;
              border: 1px solid green;
              z-index: 100;
              left: 50%;
              right: 50%;
            }
            div.pivot {
              position:absolute;
              width:1px;
              height:1px;
              border: 5px solid yellow;
              border-radius: 100%;
              z-index: 1000;
            }
            div.pixelorigin {
              position: absolute;
              width: 1px;
              height: 1px;
              border: 5px solid yellow;
              border-radius: 100%;
              z-index: 1000;
            }
            div.pivot:before {
              left: -1.5em;
              bottom: -2em;
              position: absolute;
              content: 'PIVOT';
              color: yellow;
            }
            div.pixelorigin:before {
              left: -1.75em;
              top: -2em;
              position: absolute;
              content: 'ORIGIN';
              color: yellow;
            }
            div.panebounds.main {
              position:absolute;
              width:800px;
              height:600px;
              box-sizing: border-box;
              border: 1px solid red;
              border-bottom: 1px red dashed;
              border-right: 1px red dashed;
              z-index: 100;
            }
            div.panebounds.rotate {
              position:absolute;
              width:800px;
              height:600px;
              box-sizing: border-box;
              border: 1px solid purple;
              border-bottom: 1px purple dashed;
              border-right: 1px purple dashed;
              z-index: 100;
            }
            div.crosshair.c1 {
              left:calc(50% - 5px);
              top:50%;
              height: 0;
              width: 10px;
            }
            div.crosshair.c2 {
              left:50%;
              top:calc(50% - 5px);
              width: 0;
              height: 10px;
            }
            #rho_input {
              vertical-align: middle;
            }
            .panebounds:before {
              padding: 1ch;
            }
            .panebounds.rotate:before {
              float: right;
              content: 'ROTATED';
            }
            .panebounds.main:before {
              float: left;
              content: 'MAIN';
            }
          </style>`);

        map._container.insertAdjacentHTML('afterbegin',
            `<div class="crosshair c1"></div><div class="crosshair c2"></div>`
        );

        const html = `
        <div class="leaflet-rotate-tools">
          <span>Bearing
            ${[0, 15, 30, 45, 60, 75, 90, 180].map(b => `<button onclick="L.Rotate._map.setBearing(${b});" title="map.setBearing(${b});">${b}</button>`).join('')}
            <input title="increase/decrease rotation angle" type="range" min="0" max="360" step="1" value="0" name="rho" id='rho_input' /><span id='rho'></span>
          </span>
          <label>Bounds padding <input title="increase/decrease padding bounds" type="range" min="-0.25" max="0" value="0" step="0.01" name="pad" id='pad_input' /></label>
          <span>Markers
            <button onclick="L.Rotate.randomRotateMarkers(L.Rotate._map);" title="markers.setRotation(Math.random() * Math.PI / 30 + 0.1)">Rotate</button>
            <button onclick="L.Rotate.randomMarkers(L.Rotate._map, 100);" title="add 100 random markers to map">Add 100</button>
          </span>
        </div>
        <table class="leaflet-rotate-info">
          <tr><th></th><th>x / lng</th><th>y / lat</th></tr>
          ${[
            ['LatLng', 'LatLng of mouse pointer', 'llx', 'lly'],
            ['Rel to pane', 'Mouse pointer pixel coords relative to _rotatePane', 'lyx', 'lyy'],
            ['Rel to container', 'Mouse pointer coords relative to map <div>', 'cnx', 'cny'],
            ['Pivot', 'Last _rotationPane pivot pixel coords relative to _rotationPane', 'pvx', 'pvy'],
            ['Pane offset', 'Pixel offset of _mapPane', 'pox', 'poy'],
            ['Pixel origin', 'Negative pixel coords of the (0,0) CRS point relative to _rotatePane', 'ogx', 'ogy'],
            ['Pixel bounds (min / max)', 'Bounds of the current map view in projected pixel coordinates {min, max}', 'ogbx', 'ogby'],
          ].map(([label, title, x, y]) => `<tr title="${title.replace('<', '&lt;').replace('>', '&gt;')}"><th>${label}</th><td id='${x}'></td><td id='${y}'></td></tr>`).join('')}
        </table>`;
        if (options.container) {
            options.container.insertAdjacentHTML('beforeend', `<details open><summary>Debug</summary>${html}</details>`);
        } else {
            map._container.insertAdjacentHTML('afterend', '<hr>' + html);
        }

        map.___rotatePixelOrigin = L.DomUtil.create('div', 'pixelorigin', map._rotatePane);
        map.___rotatePivotDot = L.DomUtil.create('div', 'pivot', map._mapPane);

        this.___rotateBounds = L.DomUtil.create('div', 'panebounds rotate', map._rotatePane);
        this.___mainBounds = L.DomUtil.create('div', 'panebounds main', map._mapPane);
        this.updatePaneBounds();

        const rhoInput = document.getElementById('rho_input');
        const padInput = document.getElementById('pad_input');

        rhoInput.addEventListener('change', L.Rotate.rotate.bind(this));
        rhoInput.addEventListener('mousemove', L.Rotate.rotate.bind(this));

        padInput.addEventListener('change', L.Rotate.displayCenter.bind(this));
        padInput.addEventListener('mousemove', L.Rotate.displayCenter.bind(this));
        padInput.addEventListener('change', L.Rotate.displayBounds.bind(this));
        padInput.addEventListener('mousemove', L.Rotate.displayBounds.bind(this));
        padInput.addEventListener('change', L.Rotate.displayLayersBounds.bind(this));
        padInput.addEventListener('mousemove', L.Rotate.displayLayersBounds.bind(this));
        padInput.addEventListener('change', L.Rotate.displayPixelBounds.bind(this));
        padInput.addEventListener('mousemove', L.Rotate.displayPixelBounds.bind(this));

        map.on('move rotate zoomend', this.updatePanePos);
        map.on('resize', this.updatePaneBounds.bind(this));
        map.on('rotate zoomend load', this.updatePixelOrigin);
        map.on('rotate', this.updateRhoInput);
        map.on('rotate', this.updatePivotDot);
        map.on('moveend zoomend resetview rotate', this.displayCenter.bind(this));
        map.on('moveend zoomend resetview rotate', this.displayBounds.bind(this));
        map.on('moveend zoomend resetview rotate', this.displayLayersBounds.bind(this));
        map.on('moveend zoomend resetview rotate', this.displayPixelBounds.bind(this));

        this.updatePixelOrigin.call(map);
        this.updateRhoInput.call(map);
        this.updatePivotDot.call(map);
        this.displayCenter.call(this);
        this.displayBounds.call(this);
        this.displayLayersBounds.call(this);
        this.displayPixelBounds.call(this);

        if (L.Browser.mobile) {
            map.compassBearing.enable();
        }

        if (L.version.startsWith('2.')) {
            const container = map.getContainer();
            container.addEventListener('mousemove', function(e) {
                const rect = container.getBoundingClientRect(),
                    containerPoint = new L.Point(
                        e.clientX - rect.left - container.clientLeft,
                        e.clientY - rect.top - container.clientTop
                    );
                L.Rotate.logMouse.call(map, {
                    latlng: map.containerPointToLatLng(containerPoint),
                    layerPoint: map.containerPointToLayerPoint(containerPoint),
                    containerPoint: containerPoint
                });
            });
        } else {
            map.on('mousemove', this.logMouse);
        }
        map.on('locationfound', this.resetHeading);

        if (options.log) {
            map.on('click movestart move moveend zoomstart zoomend locationfound locationerror locationfound', this.logEvent);
        }

        // window.setInterval(L.Rotate.rotateOneDegree.bind(map), 500);
        // window.setInterval(this.locate.bind(this), 10000);

    },

    logEvent(e) {
        console.log(e, e.type);
    },

    logMouse(e) {
        const fmt = (n, d) => +n.toFixed(d);
        document.getElementById('llx').innerHTML = fmt(e.latlng.lng, 6);
        document.getElementById('lly').innerHTML = fmt(e.latlng.lat, 6);
        document.getElementById('lyx').innerHTML = fmt(e.layerPoint.x, 1);
        document.getElementById('lyy').innerHTML = fmt(e.layerPoint.y, 1);
        document.getElementById('cnx').innerHTML = fmt(e.containerPoint.x, 1);
        document.getElementById('cny').innerHTML = fmt(e.containerPoint.y, 1);
    },

    /**
     * Debug L.Map.setBearing()
     */
    rotate(e) {
        return (e.type !== 'mousemove' || e.buttons !== 0) && this._map.setBearing(e.target.valueAsNumber);
    },

    updatePaneBounds() {
      const size = this._map.getSize();
      for (const bounds of [this.___rotateBounds, this.___mainBounds]) {
        bounds.style.width = size.x + 'px';
        bounds.style.height = size.y + 'px';
      }
    },

    /**
     * Debug L.Map._pixelOrigin
     */
    updatePixelOrigin() {
      if (this._pixelOrigin) {
        document.getElementById('ogx').innerHTML = +this._pixelOrigin.x.toFixed(1);
        document.getElementById('ogy').innerHTML = +this._pixelOrigin.y.toFixed(1);
        this.___rotatePixelOrigin.style.left = (-this._pixelOrigin.x - 1) + 'px';
        this.___rotatePixelOrigin.style.top = (-this._pixelOrigin.y - 1) + 'px';
      }
    },

    /**
     * Debug L.Map._pivot
     */
    updatePivotDot() {
      if (this._pivot) {
        document.getElementById('pvx').innerHTML = this._pivot.x;
        document.getElementById('pvy').innerHTML = this._pivot.y;
        this.___rotatePivotDot.style.left = (this._pivot.x - 1) + 'px';
        this.___rotatePivotDot.style.top = (this._pivot.y - 1) + 'px';
      }
    },

    /**
     * Debug L.Map._getMapPanePos()
     */
    updatePanePos() {
        const panePos = this._getMapPanePos();
        document.getElementById('pox').innerHTML = panePos.x;
        document.getElementById('poy').innerHTML = panePos.y;
    },

    /**
     * Debug L.Map.getBearing()
     */
    updateRhoInput() {
      document.getElementById('rho_input').value = this.getBearing();
    },

    /**
     * Debug L.Map.setBearing()
     */
    rotateOneDegree() {
        const angle = document.getElementById('rho_input').valueAsNumber++;
        this.setBearing(angle < 360 ? angle : 0);
    },

    /**
     * Debug L.Marker.setRotation()
     */
    randomRotateMarkers(map) {
        const markers = [],
            steps = [];

        for (const i in map._layers) {
            if (map._layers[i] instanceof L.Marker) {
                markers.push(map._layers[i]);
                steps.push(Math.random() * Math.PI / 30 + 0.1);
            }
        }

        function stepOn(steps_left) {
            for (let i = 0; i < markers.length; i++) {
                markers[i].setRotation(markers[i].options.rotation + steps[i]);
            }
            if (--steps_left) setTimeout(stepOn.bind(null, steps_left), 20);
        }

        stepOn(25);
    },

    /**
     * Debug L.Map.panInside()
     */
    randomMarkers(map, number) {
      map = this._map;
      const populate = function() {
        // populate map with a cluster of random markers
        for (let i = 0; i < number; i++) {
          const bounds = map.getBounds();
          const southWest = bounds.getSouthWest();
          const northEast = bounds.getNorthEast();
          const lngSpan = northEast.lng - southWest.lng;
          const latSpan = northEast.lat - southWest.lat;
          const m = new L.Marker(new L.LatLng(southWest.lat + latSpan * Math.random(), southWest.lng + lngSpan * Math.random()));
          // m.addTo(L.Rotate._map);
          L.Rotate.___cluster.addLayer(m);
        }
      }
      if (!this.___cluster) {
        // import and initialize "leaflet.markercluster" plugin
        this.___cluster = import("https://unpkg.com/leaflet.markercluster@1.4.1/src/index.js")
          .then(m => {
            document.head.insertAdjacentHTML('beforeend', `
              <!-- Leaflet-MarkerCluster -->
              <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css">
              <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css">
            `);
            Object.assign(globalThis.L, m);
            this.___cluster = L.markerClusterGroup({
              spiderfyOnMaxZoom: false,
              showCoverageOnHover: false,
              zoomToBoundsOnClick: false
            })
            .on('clusterclick', (a) => a.layer.spiderfy())
            .addTo(map);
            populate();
          });
      } else if (typeof L.markerClusterGroup === 'function') {
        populate();
      }
    },

    /**
     * Debug L.Map.getCenter()
     */
    displayCenter() {
        const map = this._map;
        if (this.___centerMarker) {
            this.___centerMarker.remove();
        }
        this.___centerMarker = new L.CircleMarker(map.getCenter(), {
            radius: 3,
            color: 'red',
        }).addTo(map).bindTooltip('<b>center</b>', { direction: 'right', permanent: true, });
        this.___centerMarker.getTooltip().getElement().setAttribute("tabindex", "-1");
    },

    /**
     * Debug L.Map.getCenter()
     */
    displayBounds() {
      const map = this._map;
      if (this.___bounds) {
        this.___bounds.remove();
      }

      const padding = document.getElementById('pad_input').valueAsNumber;
      const latLngBounds = map.getBounds().pad(padding)
      this.___bounds = new L.Rectangle(latLngBounds, {
          fill: false,
          lineCap: 'square',
          color: 'yellow',
          dashArray: '5, 10',
          weight: 2,
          // pane: 'norotatePane',
      }).addTo(map);
    },

    /**
     * DEBUG: map.flyToBounds(path.getBounds())
     */
    displayLayersBounds() {
      for (const flytopath of ['path', 'polygon', 'circle']) {
        if (!globalThis[flytopath]) {
          continue;
        } else if (this[`___${flytopath}bounds`]) {
          this[`___${flytopath}bounds`].remove();
        }
        const layer = globalThis[flytopath];
        const layerBounds = layer.getBounds();
        this[`___${flytopath}bounds`] = new L.FeatureGroup([
          new L.Rectangle(layerBounds, {
            fill: false,
            lineCap: 'square',
            color: 'yellow',
            dashArray: '5, 10',
            weight: 1,
            opacity: 0.5
          }),
          new L.Marker(layerBounds.getNorthWest(), { scale: 0.5, rotation: -45 * (Math.PI / 180), rotateWithView: true }).bindTooltip('<b>NW</b>', {direction: 'center'}),
          new L.Marker(layerBounds.getNorthEast(), { scale: 0.5, rotation: 45 * (Math.PI / 180), rotateWithView: true }).bindTooltip('<b>NE</b>', {direction: 'center'}),
          new L.Marker(layerBounds.getSouthEast(), { scale: 0.5, rotation: 135 * (Math.PI / 180), rotateWithView: true }).bindTooltip('<b>SE</b>', {direction: 'center'}),
          new L.Marker(layerBounds.getSouthWest(), { scale: 0.5, rotation: -135 * (Math.PI / 180), rotateWithView: true }).bindTooltip('<b>SW</b>', {direction: 'center'}),
        ]).addTo(map).eachLayer(m => { if (m.getElement && m.getElement()) m.getElement().style.filter = 'hue-rotate(150deg)'; });
      }
    },

    /**
     * @TODO Debug L.Map.getPixelBounds()
     */
    displayPixelBounds() {
      const map = this._map;
      this.___corners     && this.___corners.remove();
      this.___pixelbounds && this.___pixelbounds.remove();

      const size = map.getSize();
      const pixelBounds = map.getPixelBounds();

      const TL = new L.Point(0, 0);
      const TR = new L.Point(size.x, 0);
      const BR = new L.Point(size.x, size.y);
      const BL = new L.Point(0, size.y);
      const topLeft     = new L.Marker(map.containerPointToLatLng(TL), { title: 'Top Left corner', rotation: -45 * (Math.PI / 180) });
      const topRight    = new L.Marker(map.containerPointToLatLng(TR), { title: 'Top Right corner', rotation: 45 * (Math.PI / 180) });
      const bottomRight = new L.Marker(map.containerPointToLatLng(BR), { title: 'Bottom Right corner', rotation: 135 * (Math.PI / 180) });
      const bottomLeft  = new L.Marker(map.containerPointToLatLng(BL), { title: 'Bottom Left corner', rotation: -135 * (Math.PI / 180) });
      this.___corners = new L.FeatureGroup([topLeft, topRight, bottomRight, bottomLeft]).addTo(map).eachLayer(marker => marker.getElement().style.filter = 'hue-rotate(150deg)');

      // L.polyline([
      //   [topLeft.getLatLng(), topRight.getLatLng()],
      //   [topRight.getLatLng(), bottomRight.getLatLng()],
      //   [bottomRight.getLatLng(), bottomLeft.getLatLng()],
      //   [bottomLeft.getLatLng(), topLeft.getLatLng()],
      // ], {
      //   lineCap: 'square',
      //   dashArray: '5, 1, 5',
      //   color: 'yellow',
      //   weight: 2,
      // }).addTo(this.___corners);

      // this.___latLngBounds = L.latLngBounds([
      //   // map.containerPointToLatLng(TL),
      //   //map.containerPointToLatLng(BR)
      //   topLeft.getLatLng(),
      //   topRight.getLatLng(),
      //   bottomRight.getLatLng(),
      //   bottomLeft.getLatLng(),
      // ]);

      // this.___pixelbounds = L.rectangle(this.___latLngPixelBounds, {
      //   fill: false,
      //   lineCap: 'square',
      //   dashArray: '5, 1, 5',
      //   color: 'yellow',
      //   weight: 2,
      //   pane: 'norotatePane',
      // }).addTo(map);
      

      // this.___latLngPixelBounds = L.latLngBounds([
      //     map.layerPointToLatLng([0, 0]),                     // topleft
      //     map.layerPointToLatLng([size.x, 0]),           // topright 
      //     map.layerPointToLatLng([size.x, size.y]), // bottomright
      //     map.layerPointToLatLng([0, size.y]),           // bottomleft
      // ]);

      // const paddingTL = new L.Point(L.Marker.prototype.options.icon.options.iconAnchor || [0, 0]),
      //   paddingBR = new L.Point(L.Marker.prototype.options.icon.options.iconSize || [0, 0]).subtract(paddingTL),
      //   pixelBounds = new L.Bounds([new L.Point(rect), new L.Point(rect).add(map.getSize()) ]),
      //   paddedBounds = L.latLngBounds([
      //     map.layerPointToLatLng(pixelBounds.min.add(paddingTL)),
      //     map.layerPointToLatLng(pixelBounds.max.subtract(paddingBR))
      //   ]);
      //   // paddedSize = paddedBounds.getSize();

      const xy = p => `${+p.x.toFixed(1)}, ${+p.y.toFixed(1)}`;
      document.getElementById('ogbx').innerHTML = xy(pixelBounds.min);
      document.getElementById('ogby').innerHTML = xy(pixelBounds.max);
    },

    resetHeading(e) {
        if (e.heading !== null) {
            this.setBearing(e.heading);
        }
    },

    /**
     * Debug L.Map.locate()
     */
    locate() {
        this._map.locate({
            setView: true,
            enableHighAccuracy: true
        });
    }

  };
})();
