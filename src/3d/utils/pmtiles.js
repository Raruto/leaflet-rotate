export async function decompress(data, compression) {
  if (compression === 1) return data;
  if (compression !== 2) throw new Error(`Unsupported PMTiles compression: ${compression}`);
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** Decode the PMTiles v3 header. */
export function decodeHeader(data) {
  const view = new DataView(data);
  const header = {};
  ['rootDirectoryOffset', 'rootDirectoryLength', 'jsonMetadataOffset', 'jsonMetadataLength', 'leafDirectoryOffset', 'leafDirectoryLength', 'tileDataOffset', 'tileDataLength', 'numAddressedTiles', 'numTileEntries', 'numTileContents'].forEach((name, i) => { header[name] = Number(view.getBigUint64(8 + i * 8, true)); });
  ['clustered', 'internalCompression', 'tileCompression', 'tileType', 'minZoom', 'maxZoom'].forEach((name, i) => { header[name] = view.getUint8(96 + i); });
  ['minLon', 'minLat', 'maxLon', 'maxLat'].forEach((name, i) => { header[name] = view.getInt32(102 + i * 4, true) / 1e7; });
  header.centerZoom = view.getUint8(118);
  header.centerLon  = view.getInt32(119, true) / 1e7;
  header.centerLat  = view.getInt32(123, true) / 1e7;
  return header;
}

/** Cumulative Hilbert ID for an archive tile. */
export function tileId(z, x, y) {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 26 ||
    x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid PMTiles tile coordinates');
  let id = (4 ** z - 1) / 3;
  const n = 2 ** z;
  // Same cumulative Hilbert ordering used by build/pmtiles.js.
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) ? 1 : 0,
          ry = (y & s) ? 1 : 0;
    id += s * s * ((3 * rx) ^ ry);
    if (!ry) {
      if (rx) { x = n - 1 - x; y = n - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return id;
}

/** Decode delta/varint directory columns, rejecting malformed entries. */
export function decodeDirectory(data) {
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
}
