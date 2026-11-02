import './3d.js';

/** A raster TileLayer backed by a PMTiles archive; reuses the '3d' PMTiles reader. */
L.Layer.types.pmtiles = L.TileLayer.extend({
  _read:       L.Layer.types['3d'].prototype._read,
  _decompress: L.Layer.types['3d'].prototype._decompress,
  getHeader:   L.Layer.types['3d'].prototype.getHeader,
  getZxy:      L.Layer.types['3d'].prototype.getZxy,

  initialize(options) {
    L.TileLayer.prototype.initialize.call(this, options.url, options);
    this.url = new URL(options.url, document.baseURI).href;
    this._directories = new Map();
    this.on('tileunload', this._releaseTile, this);
    this.on('load tileunload', () => L.Layer.types['3d']._renderers.get(this._map)?.update());
    this.ready = Promise.resolve(this.options.archive || this).then(async archive => {
      const header = await archive.getHeader();
      this.options.archive = archive;
      this.header = header;
      if (this.options.maxNativeZoom === undefined) this.options.maxNativeZoom = header.maxZoom;
      this.fire('ready');
      return this;
    }).catch(error => {
      this.fire('error', { error });
      throw error;
    });
  },

  onAdd(map) {
    if (this.header) {
      L.TileLayer.prototype.onAdd.call(this, map);
      this._setTerrain3D(map._terrain3D);
    } else {
      this.ready = this.ready.then(layer => {
        if (this._map === map && map.hasLayer(this) && !this._container) {
          L.TileLayer.prototype.onAdd.call(this, map);
          this._setTerrain3D(map._terrain3D);
        }
        return layer;
      });
    }
  },

  onRemove(map) {
    this._setTerrain3D(null);
    if (this._container) L.TileLayer.prototype.onRemove.call(this, map);
  },

  setOpacity(opacity) {
    L.TileLayer.prototype.setOpacity.call(this, opacity);
    L.Layer.types['3d']._renderers.get(this._map)?.update();
    return this;
  },

  setZIndex(zIndex) {
    L.TileLayer.prototype.setZIndex.call(this, zIndex);
    L.Layer.types['3d']._renderers.get(this._map)?.update();
    return this;
  },

  createTile(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }
    if (typeof this.options.referrerPolicy === 'string') tile.referrerPolicy = this.options.referrerPolicy;
    tile.request = new AbortController();
    this.ready.then(() => {
      if (tile.request.signal.aborted) return;
      return this.options.archive.getZxy(coords.z, coords.x, coords.y, tile.request.signal);
    }).then(async result => {
      if (tile.request.signal.aborted) return;
      if (!result) throw new Error(`Tile ${coords.z}/${coords.x}/${coords.y} is not in the offline archive`);
      await new Promise((resolve, reject) => {
        const finish = error => {
          tile.request.signal.removeEventListener('abort', abort);
          tile.onload = tile.onerror = null;
          this._releaseURL(tile);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish();
        tile.request.signal.addEventListener('abort', abort, { once: true });
        tile.objectURL = URL.createObjectURL(new Blob([result.data]));
        tile.onload = () => finish();
        tile.onerror = () => finish(new Error(`Unable to decode tile ${coords.z}/${coords.x}/${coords.y}`));
        tile.src = tile.objectURL;
      });
      if (tile.request.signal.aborted) return;
      tile.done = true;
      this._registerTerrainTile(coords, tile);
      done(null, tile);
    }).catch(error => {
      if (tile.request.signal.aborted) return;
      tile.error = error.message;
      this._tileOnError(done, tile, error);
    });
    return tile;
  },

  _abortLoading() {
    // Requests can still be pending while an image with no src reports complete.
    for (const { coords, el } of Object.values(this._tiles)) {
      if (coords.z !== this._tileZoom) this._releaseTile({ tile: el });
    }
    L.TileLayer.prototype._abortLoading.call(this);
  },

  _setTerrain3D(terrain) {
    if (this._terrain3D === terrain) return;
    for (const { el } of Object.values(this._tiles || {})) this._terrain3D?.removeRasterTile(el);
    this._terrain3D = terrain || null;
    if (this._terrain3D) {
      for (const { coords, el } of Object.values(this._tiles || {})) {
        if (el.done) this._registerTerrainTile(coords, el);
      }
    }
  },

  _registerTerrainTile(coords, tile) {
    if (!this._terrain3D) return;
    const terrain = this._terrain3D;
    terrain.addRasterTile(this, coords, tile).catch(error => {
      if (this._terrain3D === terrain && tile.isConnected) this.fire('tileerror', { tile, coords, error });
    });
  },

  _releaseURL(tile) {
    if (tile.objectURL) {
      URL.revokeObjectURL(tile.objectURL);
      tile.objectURL = null;
    }
  },

  _releaseTile({ tile }) {
    this._terrain3D?.removeRasterTile(tile);
    tile.request.abort();
    this._releaseURL(tile);
  },
});
