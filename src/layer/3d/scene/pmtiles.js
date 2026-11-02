/** PMTiles v3 archive reader (range requests, directories, tiles). Mixed into L.Layer.types['3d']. */
export default {
  /**
   * PMTiles v3 range reader.
   * Supports uncompressed/gzip sections. Other compression methods fail explicitly.
   * Specification: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
   */
  /** Read exactly one archive range; reject changed archives rather than mix revisions. */
  async _read(offset, length, signal) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length <= 0 || !Number.isSafeInteger(offset + length)) {
      throw new Error('Invalid PMTiles byte range');
    }
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal,
    });
    if (!response.ok) throw new Error(`Unable to read PMTiles: HTTP ${response.status}`);
    const etag = response.headers.get('ETag');
    if (this._etag && etag !== this._etag) {
      throw new Error('PMTiles archive changed; recreate the layer');
    }
    if (etag) {
      this._etag = etag;
    }
    let data = await response.arrayBuffer();
    if (response.status === 200) {
      data = data.slice(offset, offset + length);
    } else if (response.status !== 206 || !response.headers.get('Content-Range')?.startsWith(`bytes ${offset}-${offset + length - 1}/`)) {
      throw new Error('Invalid PMTiles range response');
    }
    if (data.byteLength !== length) {
      throw new Error('Truncated PMTiles range');
    }
    return data;
  },

  async _decompress(data, compression) {
    if (compression === 1) return data;
    if (compression !== 2) throw new Error(`Unsupported PMTiles compression: ${compression}`);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  },

  /** Cache header initialization; failures remain visible to all callers. */
  getHeader() {
    return this._header ||= this._read(0, 127).then(data => {
      const view = new DataView(data);
      const header = {};
      ['rootDirectoryOffset', 'rootDirectoryLength', 'jsonMetadataOffset', 'jsonMetadataLength', 'leafDirectoryOffset', 'leafDirectoryLength', 'tileDataOffset', 'tileDataLength', 'numAddressedTiles', 'numTileEntries', 'numTileContents'].forEach((name, i) => { header[name] = Number(view.getBigUint64(8 + i * 8, true)); });
      ['clustered', 'internalCompression', 'tileCompression', 'tileType', 'minZoom', 'maxZoom'].forEach((name, i) => { header[name] = view.getUint8(96 + i); });
      ['minLon', 'minLat', 'maxLon', 'maxLat'].forEach((name, i) => { header[name] = view.getInt32(102 + i * 4, true) / 1e7; });
      header.centerZoom = view.getUint8(118);
      header.centerLon  = view.getInt32(119, true) / 1e7;
      header.centerLat  = view.getInt32(123, true) / 1e7;
      return header;
    });
  },

  /** Nearest directory entry at/before the Hilbert ID, then follow leaf pointers. */
  async getZxy(z, x, y, signal) {
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 26 ||
      x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid PMTiles tile coordinates');
    signal?.throwIfAborted();
    let tileId = (4 ** z - 1) / 3;
    const n = 2 ** z;
    // Same cumulative Hilbert ordering used by build/pmtiles.js.
    for (let s = n / 2; s >= 1; s /= 2) {
      const rx = (x & s) ? 1 : 0,
            ry = (y & s) ? 1 : 0;
      tileId += s * s * ((3 * rx) ^ ry);
      if (!ry) {
        if (rx) { x = n - 1 - x; y = n - 1 - y; }
        [x, y] = [y, x];
      }
    }
    const header = await this.getHeader();
    signal?.throwIfAborted();
    if (z < header.minZoom || z > header.maxZoom) return;
    let offset = header.rootDirectoryOffset, length = header.rootDirectoryLength;
    const visited = new Set();
    for (let depth = 0; depth < 4; depth++) {
      if (visited.has(offset)) {
        throw new Error('Cyclic PMTiles directory');
      }
      visited.add(offset);
      const key = `${offset}:${length}`;
      if (!this._directories.has(key)) {
        if (this._directories.size >= 32) {
          this._directories.delete(this._directories.keys().next().value);
        }
        const pending = this._read(offset, length)
          .then(data => this._decompress(data, header.internalCompression))
          .then(data => {
            const bytes = new Uint8Array(data);
            let cursor = 0;
            const varint = () => {
              let value = 0;
              for (let factor = 1; factor <= 2 ** 49; factor *= 128) {
                if (cursor >= bytes.length) throw new Error('Truncated PMTiles directory');
                const byte = bytes[cursor++];
                value += (byte & 127) * factor;
                if (!Number.isSafeInteger(value)) throw new Error('Invalid PMTiles directory integer');
                if (byte < 128) return value;
              }
              throw new Error('Invalid PMTiles directory integer');
            };
            const count = varint();
            if (count > (bytes.length - cursor) / 4) throw new Error('Invalid PMTiles directory count');
            const entries = [];
            let tileId = 0;
            for (let i = 0; i < count; i++) {
              tileId += varint();
              if (!Number.isSafeInteger(tileId) || (i && tileId <= entries[i - 1].tileId)) {
                throw new Error('Invalid PMTiles directory tile IDs');
              }
              entries.push({ tileId });
            }
            for (const entry of entries) entry.runLength = varint();
            for (const entry of entries) {
              entry.length = varint();
              if (!entry.length) throw new Error('Invalid PMTiles directory length');
            }
            entries.forEach((entry, i) => {
              const value = varint();
              if (!value && !i) throw new Error('Invalid PMTiles directory offset');
              entry.offset = value ? value - 1 : entries[i - 1].offset + entries[i - 1].length;
            });
            if (cursor !== bytes.length) throw new Error('Trailing PMTiles directory data');
            return entries;
          })
          .catch(error => {
            if (this._directories.get(key) === pending) this._directories.delete(key);
            throw error;
          });
        this._directories.set(key, pending);
      }
      const entries = await this._directories.get(key);
      signal?.throwIfAborted();
      let low = 0,
         high = entries.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (entries[mid].tileId <= tileId) low = mid + 1;
        else high = mid - 1;
      }
      const entry = entries[high];
      if (!entry) return;
      if (entry.runLength) {
        if (tileId - entry.tileId >= entry.runLength) return;
        if (entry.offset + entry.length > header.tileDataLength) throw new Error('PMTiles tile outside data section');
        const data = await this._decompress(await this._read(header.tileDataOffset + entry.offset, entry.length, signal), header.tileCompression);
        signal?.throwIfAborted();
        return { data };
      }
      if (entry.offset + entry.length > header.leafDirectoryLength) throw new Error('PMTiles directory outside leaf section');
      offset = header.leafDirectoryOffset + entry.offset;
      length = entry.length;
    }
    throw new Error('PMTiles directory depth exceeds four levels');
  },
};
