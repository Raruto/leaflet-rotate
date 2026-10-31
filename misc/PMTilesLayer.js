/**
 * A raster TileLayer backed by a PMTiles archive.
 */
L.PMTilesLayer = L.TileLayer.extend({
    initialize(url, options) {
        L.TileLayer.prototype.initialize.call(this, url, options);
        this.on('tileunload', this._releaseTile, this);
        this.ready = (this.options.archive
            ? Promise.resolve(this.options.archive)
            : import('https://unpkg.com/pmtiles@4.5.0/dist/esm/index.js?module').then(({ PMTiles }) => new PMTiles(new URL(url, document.baseURI).href))
        ).then(async archive => {
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
        } else {
            this.ready = this.ready.then(layer => {
                if (this._map === map && map.hasLayer(this) && !this._container) {
                    L.TileLayer.prototype.onAdd.call(this, map);
                }
                return layer;
            });
        }
    },

    onRemove(map) {
        if (this._container) L.TileLayer.prototype.onRemove.call(this, map);
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

    _releaseURL(tile) {
        if (tile.objectURL) {
            URL.revokeObjectURL(tile.objectURL);
            tile.objectURL = null;
        }
    },

    _releaseTile({ tile }) {
        tile.request.abort();
        this._releaseURL(tile);
    },
});