import { decodeHeader, decodeDirectory, decompress, tileId } from '../utils/pmtiles.js';

/**
 * PMTiles v3 range reader.
 * Supports uncompressed/gzip sections. Other compression methods fail explicitly.
 * Specification: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */
/** Read exactly one archive range; reject changed archives rather than mix revisions. */
export async function read(backend, offset, length, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
    offset < 0 || length <= 0 || !Number.isSafeInteger(offset + length)) {
    throw new Error('Invalid PMTiles byte range');
  }
  const response = await fetch(backend.url, {
    headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal,
  });
  if (!response.ok) throw new Error(`Unable to read PMTiles: HTTP ${response.status}`);
  const etag = response.headers.get('ETag');
  if (backend._etag && etag !== backend._etag) {
    throw new Error('PMTiles archive changed; recreate the layer');
  }
  if (etag) {
    backend._etag = etag;
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
}

/** Cache header initialization; failures remain visible to all callers. */
export function getHeader(backend) {
  return backend._header ||= backend._read(0, 127).then(decodeHeader);
}

/** Nearest directory entry at/before the Hilbert ID, then follow leaf pointers. */
export async function getZxy(backend, z, x, y, signal) {
  const id = tileId(z, x, y);
  signal?.throwIfAborted();
  const header = await backend.getHeader();
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
    if (!backend._directories.has(key)) {
      if (backend._directories.size >= 32) {
        backend._directories.delete(backend._directories.keys().next().value);
      }
      const pending = backend._read(offset, length)
        .then(data => decompress(data, header.internalCompression))
        .then(decodeDirectory)
        .catch(error => {
          if (backend._directories.get(key) === pending) backend._directories.delete(key);
          throw error;
        });
      backend._directories.set(key, pending);
    }
    const entries = await backend._directories.get(key);
    signal?.throwIfAborted();
    let low = 0,
       high = entries.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (entries[mid].tileId <= id) low = mid + 1;
      else high = mid - 1;
    }
    const entry = entries[high];
    if (!entry) return;
    if (entry.runLength) {
      if (id - entry.tileId >= entry.runLength) return;
      if (entry.offset + entry.length > header.tileDataLength) throw new Error('PMTiles tile outside data section');
      const data = await decompress(await backend._read(header.tileDataOffset + entry.offset, entry.length, signal), header.tileCompression);
      signal?.throwIfAborted();
      return { data };
    }
    if (entry.offset + entry.length > header.leafDirectoryLength) throw new Error('PMTiles directory outside leaf section');
    offset = header.leafDirectoryOffset + entry.offset;
    length = entry.length;
  }
  throw new Error('PMTiles directory depth exceeds four levels');
}
