L.Rotate = {

    debug: function(map, options = {}) {

        this._map = map;

        document.head.insertAdjacentHTML('beforeend', `<style>
            .leaflet-rotate-info {
              width: 100%;
            }
            .leaflet-rotate-info td {
              width: 7em;
              overflow: hidden;
              max-width: 7em;
              text-overflow: ellipsis;
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
              border: 1px solid purple;
              z-index: 100;
            }
            div.pixelorigin {
              position:absolute;
              width:1px;
              height:1px;
              border: 1px solid cyan;
              z-index: 100;
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

        map.on('move rotate zoomend', this.updatePanePos);
        map.on('rotate zoomend load', this.updatePixelOrigin);
        map.on('moveend zoomend resetview rotate', this.displayCenter.bind(this));

        this.updatePixelOrigin.call(map);
        this.displayCenter.call(this);

        map.on('rotate', this.updatePivotDot);

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

    rotate: function(e) {
        return e.buttons !== 0 && this._map.setBearing(e.target.valueAsNumber);
    },

    updatePixelOrigin: function() {
        document.getElementById('ogx').innerHTML = this._pixelOrigin.x;
        document.getElementById('ogy').innerHTML = this._pixelOrigin.y;
        this.___rotatePixelOrigin.style.left = (-this._pixelOrigin.x - 1) + 'px';
        this.___rotatePixelOrigin.style.top = (-this._pixelOrigin.y - 1) + 'px';
    },

    updatePivotDot: function() {
        document.getElementById('pvx').innerHTML = this._pivot.x;
        document.getElementById('pvy').innerHTML = this._pivot.y;
        this.___rotatePivotDot.style.left = (this._pivot.x - 1) + 'px';
        this.___rotatePivotDot.style.top = (this._pivot.y - 1) + 'px';
    },

    updatePanePos: function() {
        var panePos = this._getMapPanePos();
        document.getElementById('pox').innerHTML = panePos.x;
        document.getElementById('poy').innerHTML = panePos.y;
    },

    rotateOneDegree: function() {
        var angle = document.getElementById('rho_input').valueAsNumber++;
        this.setBearing(angle < 360 ? angle : 0);
    },

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

    displayCenter: function() {
        var map = this._map;
        if (this.___centerMarker) {
            this.___centerMarker.remove();
        }
        this.___centerMarker = L.circleMarker(map.getCenter(), {
            radius: 0,
            color: 'green',
        }).addTo(map);

        if (this.___bounds) {
            this.___bounds.remove();
        }
        var padding = document.getElementById('pad_input').valueAsNumber;
        this.___bounds = L.rectangle(map.getBounds().pad(padding), {
            fill: false,
            lineCap: 'square',
            color: 'green',
            dashArray: '5, 10',
            weight: 2,
        }).addTo(map);
    },

    resetHeading: function(e) {
        if (e.heading !== null) {
            this.setBearing(e.heading);
        }
    },

    locate: function() {
        this._map.locate({
            setView: true,
            enableHighAccuracy: true
        });
    }

};
