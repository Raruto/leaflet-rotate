L.Rotate = {

    debug: function(map, options = {}) {

        this._map = map;

        document.head.insertAdjacentHTML('beforeend', `<style>
            .leaflet-rotate-info {
              width: 100%;
            }
            .leaflet-rotate-info td {
              /* width: 7em; */
              overflow: hidden;
              /* max-width: 7em; */
              text-overflow: ellipsis;
              /* white-space: nowrap; */
            }
            .leaflet-rotate-info td:nth-of-type(3) {
              font-family: Monospace;
            }
            .leaflet-rotate-info th {
              text-align: left;
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
              border: 1px solid red;
              border-bottom: 1px red dashed;
              border-right: 1px red dashed;
              z-index: 100;
            }
            div.panebounds.rotate {
              position:absolute;
              width:800px;
              height:600px;
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

        map._container.insertAdjacentHTML('afterend', `<hr>
        <table class="leaflet-rotate-info">
          <tr>
            <td>
              <button onclick="L.Rotate._map.setBearing(0);" title="map.setBearing(0);"> 0</button>
              <button onclick="L.Rotate._map.setBearing(15);" title="map.setBearing(15);">15</button>
              <button onclick="L.Rotate._map.setBearing(30);" title="map.setBearing(30);">30</button>
              <button onclick="L.Rotate._map.setBearing(45);" title="map.setBearing(45);">45</button>
              <button onclick="L.Rotate._map.setBearing(60);" title="map.setBearing(60);">60</button>
              <button onclick="L.Rotate._map.setBearing(75);" title="map.setBearing(75);">75</button>
              <button onclick="L.Rotate._map.setBearing(90);" title="map.setBearing(90);">90</button>
              <button onclick="L.Rotate._map.setBearing(180);" title="map.setBearing(180);">180</button>
            </td>
            <td>
              <input title="increase/decrease rotation angle" type="range" min="0" max="360" step="1" value="0" name="rho" id='rho_input' /><span id='rho'></span>
            </td>
            <td>
              <input title="increase/decrease padding bounds" type="range" min="-0.25" max="0" value="0" step="0.01" name="pad" id='pad_input' />
            </td>
            <td>
              <button onclick="L.Rotate.randomRotateMarkers(L.Rotate._map);" title="markers.setRotation(Math.random() * Math.PI / 30 + 0.1)">Rotate Markers</button>
              <button onclick="L.Rotate.randomMarkers(L.Rotate._map, 100);" title="add 100 random markers to map">Add Markers</button>
            </td>
          </tr>
          <tr>
            <th>LatLng </th>
            <td id='llx'></td>
            <td id='lly'></td>
            <td class='long'>LatLng of mouse pointer</td>
          </tr>
          <tr>
            <th>Rel to pane </th>
            <td id='lyx'></td>
            <td id='lyy'></td>
            <td class='long'>Mouse pointer pixel coords relative to _rotatePane</td>
          </tr>
          <tr>
            <th>Rel to container</th>
            <td id='cnx'></td>
            <td id='cny'></td>
            <td class='long'>Mouse pointer coords relative to map &lt;div&gt;</td>
          </tr>
          <tr>
            <th>Pivot </th>
            <td id='pvx'></td>
            <td id='pvy'></td>
            <td class='long'>Last _rotationPane pivot pixel coords relative to _rotationPane</td>
          </tr>
          <tr>
            <th>Pane offset </th>
            <td id='pox'></td>
            <td id='poy'></td>
            <td class='long'>Pixel offset of _mapPane</td>
          </tr>
          <tr>
            <th>Pixel origin </th>
            <td id='ogx'></td>
            <td id='ogy'></td>
            <td class='long'>Negative pixel coords of the (0,0) CRS point relative to _rotatePane</td>
          </tr>
          <tr>
            <th>Pixel bounds </th>
            <td id='ogbx'></td>
            <td id='ogby'></td>
            <td class='long'>Bounds of the current map view in projected pixel coordinates {min, max}.</td>
          </tr>
        </table>`);

        map.___rotatePixelOrigin = L.DomUtil.create('div', 'pixelorigin', map._rotatePane);
        map.___rotatePivotDot = L.DomUtil.create('div', 'pivot', map._mapPane);

        L.DomUtil.create('div', 'panebounds rotate', map._rotatePane);
        L.DomUtil.create('div', 'panebounds main', map._mapPane);

        var rhoInput = document.getElementById('rho_input');
        var padInput = document.getElementById('pad_input');

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

        map.on('mousemove', this.logMouse);
        map.on('locationfound', this.resetHeading);

        if (options.log) {
            map.on('click movestart move moveend zoomstart zoomend locationfound locationerror locationfound', this.logEvent);
        }

        // window.setInterval(L.Rotate.rotateOneDegree.bind(map), 500);
        // window.setInterval(this.locate.bind(this), 10000);

    },

    logEvent: function(e) {
        console.log(e, e.type);
    },

    logMouse: function(e) {
        document.getElementById('llx').innerHTML = e.latlng.lng;
        document.getElementById('lly').innerHTML = e.latlng.lat;
        document.getElementById('lyx').innerHTML = e.layerPoint.x;
        document.getElementById('lyy').innerHTML = e.layerPoint.y;
        document.getElementById('cnx').innerHTML = e.containerPoint.x;
        document.getElementById('cny').innerHTML = e.containerPoint.y;
    },

    /**
     * Debug L.Map.setBearing()
     */
    rotate: function(e) {
        return e.buttons !== 0 && this._map.setBearing(e.target.valueAsNumber);
    },

    /**
     * Debug L.Map._pixelOrigin
     */
    updatePixelOrigin: function() {
      if (this._pixelOrigin) {
        document.getElementById('ogx').innerHTML = this._pixelOrigin.x;
        document.getElementById('ogy').innerHTML = this._pixelOrigin.y;
        this.___rotatePixelOrigin.style.left = (-this._pixelOrigin.x - 1) + 'px';
        this.___rotatePixelOrigin.style.top = (-this._pixelOrigin.y - 1) + 'px';
      }
    },

    /**
     * Debug L.Map._pivot
     */
    updatePivotDot: function() {
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
    updatePanePos: function() {
        var panePos = this._getMapPanePos();
        document.getElementById('pox').innerHTML = panePos.x;
        document.getElementById('poy').innerHTML = panePos.y;
    },

    /**
     * Debug L.Map.getBearing()
     */
    updateRhoInput: function() {
      document.getElementById('rho_input').value = this.getBearing();
    },

    /**
     * Debug L.Map.setBearing()
     */
    rotateOneDegree: function() {
        var angle = document.getElementById('rho_input').valueAsNumber++;
        this.setBearing(angle < 360 ? angle : 0);
    },

    /**
     * Debug L.Marker.setRotation()
     */
    randomRotateMarkers: function(map) {
        var markers = [],
            steps = [];

        for (var i in map._layers) {
            if (map._layers[i] instanceof L.Marker) {
                markers.push(map._layers[i]);
                steps.push(Math.random() * Math.PI / 30 + 0.1);
            }
        }

        function stepOn(steps_left) {
            for (var i = 0; i < markers.length; i++) {
                markers[i].setRotation(markers[i].options.rotation + steps[i]);
            }
            if (--steps_left) setTimeout(stepOn.bind(null, steps_left), 20);
        }

        stepOn(25);
    },

    /**
     * Debug L.Map.panInside()
     */
    randomMarkers: function(map, number) {
      var map = this._map;
      var populate = function() {
        // populate map with a cluster of random markers
        for (var i = 0; i < number; i++) {
          var bounds = map.getBounds();
          var southWest = bounds.getSouthWest();
          var northEast = bounds.getNorthEast();
          var lngSpan = northEast.lng - southWest.lng;
          var latSpan = northEast.lat - southWest.lat;
          var m = L.marker( L.latLng(southWest.lat + latSpan * Math.random(), southWest.lng + lngSpan * Math.random()) );
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
    displayCenter: function() {
        var map = this._map;
        if (this.___centerMarker) {
            this.___centerMarker.remove();
        }
        this.___centerMarker = L.circleMarker(map.getCenter(), {
            radius: 3,
            color: 'red',
        }).addTo(map).bindTooltip('<b>center</b>', { direction: 'right', permanent: true, });
        this.___centerMarker.getTooltip().getElement().setAttribute("tabindex", "-1");
    },

    /**
     * Debug L.Map.getCenter()
     */
    displayBounds: function() {
      var map = this._map;
      if (this.___bounds) {
        this.___bounds.remove();
      }

      var padding = document.getElementById('pad_input').valueAsNumber;
      var latLngBounds = map.getBounds().pad(padding)
      this.___bounds = L.rectangle(latLngBounds, {
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
    displayLayersBounds: function() {
      for (const flytopath of ['path', 'polygon', 'circle']) {
        if (!globalThis[flytopath]) {
          continue;
        } else if (this[`___${flytopath}bounds`]) {
          this[`___${flytopath}bounds`].remove();
        }
        let layer = globalThis[flytopath];
        let layerBounds = layer.getBounds();
        this[`___${flytopath}bounds`] = L.featureGroup([
          L.rectangle(layerBounds, {
            fill: false,
            lineCap: 'square',
            color: 'yellow',
            dashArray: '5, 10',
            weight: 1,
            opacity: 0.5
          }),
          L.marker(layerBounds.getNorthWest(), { scale: 0.5, rotation: -45 * L.DomUtil.DEG_TO_RAD, rotateWithView: true }).bindTooltip('<b>NW</b>', {direction: 'center'}),
          L.marker(layerBounds.getNorthEast(), { scale: 0.5, rotation: 45 * L.DomUtil.DEG_TO_RAD, rotateWithView: true }).bindTooltip('<b>NE</b>', {direction: 'center'}),
          L.marker(layerBounds.getSouthEast(), { scale: 0.5, rotation: 135 * L.DomUtil.DEG_TO_RAD, rotateWithView: true }).bindTooltip('<b>SE</b>', {direction: 'center'}),
          L.marker(layerBounds.getSouthWest(), { scale: 0.5, rotation: -135 * L.DomUtil.DEG_TO_RAD, rotateWithView: true }).bindTooltip('<b>SW</b>', {direction: 'center'}),
        ]).addTo(map).eachLayer(m => { if (m.getElement && m.getElement()) m.getElement().style.filter = 'hue-rotate(150deg)'; });
      }
    },

    /**
     * @TODO Debug L.Map.getPixelBounds()
     */
    displayPixelBounds: function() {
      var map = this._map;
      this.___corners     && this.___corners.remove();
      this.___pixelbounds && this.___pixelbounds.remove();

      const size = map.getSize();
      const rect = map._container.getBoundingClientRect();
      const pixelBounds = map.getPixelBounds();

      const TL = L.point(rect);
      const TR = L.point(rect).add(L.point(rect.width, 0));
      const BR = L.point(rect).add(L.point(rect.width, rect.height))
      const BL = L.point(rect).add(L.point(0, rect.height));

      const topLeft     = L.marker( map.containerPointToLatLng(TL), { title: 'Top Left corner', rotation: -45 * L.DomUtil.DEG_TO_RAD } );
      const topRight    = L.marker( map.containerPointToLatLng(TR), { title: 'Top Right corner', rotation: 45 * L.DomUtil.DEG_TO_RAD } );
      const bottomRight = L.marker( map.containerPointToLatLng(BR), { title: 'Bottom Right corner', rotation: 135 * L.DomUtil.DEG_TO_RAD } );
      const bottomLeft  = L.marker( map.containerPointToLatLng(BL), { title: 'Bottom Left corner', rotation: -135 * L.DomUtil.DEG_TO_RAD } );

      this.___corners = L.featureGroup([topLeft, topRight, bottomRight, bottomLeft]).addTo(map).eachLayer(marker => marker.getElement().style.filter = 'hue-rotate(150deg)');

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

      // const paddingTL = L.point(L.Marker.prototype.options.icon.options.iconAnchor || [0, 0]),
      //   paddingBR = L.point(L.Marker.prototype.options.icon.options.iconSize || [0, 0]).subtract(paddingTL),
      //   pixelBounds = L.bounds([ L.point(rect), L.point(rect).add(map.getSize()) ]),
      //   paddedBounds = L.latLngBounds([
      //     map.layerPointToLatLng(pixelBounds.min.add(paddingTL)),
      //     map.layerPointToLatLng(pixelBounds.max.subtract(paddingBR))
      //   ]);
      //   // paddedSize = paddedBounds.getSize();

      document.getElementById('ogbx').innerHTML = JSON.stringify(pixelBounds.min);
      document.getElementById('ogby').innerHTML = JSON.stringify(pixelBounds.max);
    },

    resetHeading: function(e) {
        if (e.heading !== null) {
            this.setBearing(e.heading);
        }
    },

    /**
     * Debug L.Map.locate()
     */
    locate: function() {
        this._map.locate({
            setView: true,
            enableHighAccuracy: true
        });
    }

};
