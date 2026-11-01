// Builds the offline PMTiles archives used by examples/leaflet-rotate-3d-layer.html.
// Usage: npm run pmtiles -- [--bbox=west,south,east,north] [--minzoom=11] [--maxzoom=17] [--only=buildings,orthophotos,plan-ign,terrain]
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync, inflateSync } from 'node:zlib';

const { values: args } = parseArgs({
  options: {
    bbox: { type: 'string', default: '2.15,48.75,2.55,48.95' },
    minzoom: { type: 'string', default: '11' },
    maxzoom: { type: 'string', default: '17' },
    only: { type: 'string', default: 'buildings,orthophotos,plan-ign,terrain' },
  },
});
const rasterBbox = args.bbox.split(',').map(Number);
const minZoom = Number(args.minzoom);
const maxZoom = Number(args.maxzoom);
if (rasterBbox.length !== 4 || rasterBbox.some(Number.isNaN) || !(minZoom >= 0 && minZoom <= maxZoom && maxZoom <= 19)) {
  throw new Error('Invalid --bbox, --minzoom, or --maxzoom');
}
const parisBbox = [2.2424, 48.8162, 2.416, 48.9022];
const outDir = new URL('../examples/data/', import.meta.url);
const ignUrl = (layer, format) => (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${format}&TILEMATRIXSET=PM_0_19&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
const ignAttribution = 'IGN — Licence Ouverte Etalab 2.0';
const terrainZoom = 14;
const terrainSourceTiles = new Map();

const archives = {
  buildings: {
    tileType: 0, // GeoJSON FeatureCollection per zoom 16 tile, same payload as the online API
    tileCompression: 2,
    bbox: parisBbox,
    minZoom: 16,
    maxZoom: 16,
    concurrency: 2,
    attribution: 'Ville de Paris — ODbL',
    async tile(z, x, y) {
      const [west, south, east, north] = tileBounds(z, x, y);
      const footprint = [[west, south], [east, south], [east, north], [west, north], [west, south]]
        .map(([lng, lat]) => `${lng} ${lat}`).join(',');
      const url = new URL('https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/volumesbatisparis/exports/geojson');
      url.search = new URLSearchParams({
        select: 'geom,h_et_max,nb_pl,b_rdc,objectid',
        where: `intersects(geom,geom'POLYGON((${footprint}))')`,
      });
      const data = JSON.parse(await download(url));
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`Invalid GeoJSON for ${z}/${x}/${y}`);
      return gzipSync(JSON.stringify(data));
    },
  },
  orthophotos: {
    tileType: 3,
    tileCompression: 1,
    bbox: rasterBbox,
    minZoom,
    maxZoom,
    concurrency: 4,
    attribution: ignAttribution,
    tile: (z, x, y) => download(ignUrl('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')(z, x, y)),
  },
  'plan-ign': {
    tileType: 2,
    tileCompression: 1,
    bbox: rasterBbox,
    minZoom,
    maxZoom,
    concurrency: 4,
    attribution: ignAttribution,
    tile: (z, x, y) => download(ignUrl('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png')(z, x, y)),
  },
  terrain: {
    tileType: 0,
    tileCompression: 2,
    bbox: parisBbox,
    minZoom: terrainZoom,
    maxZoom: terrainZoom,
    concurrency: 2,
    attribution: ignAttribution,
    metadata: { format: 'float32-le', source: 'IGN RGE ALTI', tileSize: 256 },
    tile: buildTerrainTile,
  },
};

function lngToX(lng, z) {
  return Math.min(2 ** z - 1, Math.floor((lng + 180) / 360 * 2 ** z));
}

function latToY(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.min(2 ** z - 1, Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * 2 ** z));
}

// Same clipping as the example: tile bounds clamped to the Paris dataset extent.
function tileBounds(z, x, y) {
  const lng = x => x / 2 ** z * 360 - 180;
  const lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
  return [
    Math.max(lng(x), parisBbox[0]),
    Math.max(lat(y + 1), parisBbox[1]),
    Math.min(lng(x + 1), parisBbox[2]),
    Math.min(lat(y), parisBbox[3]),
  ];
}

function tilesIn([west, south, east, north], minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    for (let x = lngToX(west, z); x <= lngToX(east, z); x++) {
      for (let y = latToY(north, z); y <= latToY(south, z); y++) tiles.push([z, x, y]);
    }
  }
  return tiles;
}

async function getTerrainSourceTile(x, y) {
  const key = `${x}/${y}`;
  if (!terrainSourceTiles.has(key)) {
    const url = new URL('https://data.geopf.fr/wmts');
    for (const [name, value] of Object.entries({
      SERVICE: 'WMTS',
      REQUEST: 'GetTile',
      VERSION: '1.0.0',
      LAYER: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
      STYLE: 'normal',
      FORMAT: 'image/x-bil;bits=32',
      TILEMATRIXSET: 'WGS84G_6_14',
      TILEMATRIX: terrainZoom,
      TILEROW: y,
      TILECOL: x,
    })) url.searchParams.set(name, value);
    terrainSourceTiles.set(key, download(url).then(data => {
      if (data.length !== 256 * 256 * 4) data = inflateSync(data);
      if (data.length !== 256 * 256 * 4) throw new Error(`Invalid IGN elevation tile ${key}`);
      return data;
    }).catch(error => {
      terrainSourceTiles.delete(key);
      throw error;
    }));
  }
  return terrainSourceTiles.get(key);
}

async function buildTerrainTile(z, x, y) {
  const toLatLng = (pixelX, pixelY) => {
    const scale = 256 * 2 ** z;
    const lng = pixelX / scale * 360 - 180;
    const mercatorY = Math.PI * (1 - 2 * pixelY / scale);
    return [lng, Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI];
  };
  const sourceX = lng => Math.floor((lng + 180) / 360 * 2 ** (terrainZoom + 1));
  const sourceY = lat => Math.floor((90 - lat) / 180 * 2 ** terrainZoom);
  const corners = [
    toLatLng(x * 256, y * 256),
    toLatLng((x + 1) * 256, (y + 1) * 256),
  ];
  const minX = Math.max(0, Math.min(...corners.map(([lng]) => sourceX(lng))) - 1);
  const maxX = Math.min(2 ** (terrainZoom + 1) - 1, Math.max(...corners.map(([lng]) => sourceX(lng))) + 1);
  const minY = Math.max(0, Math.min(...corners.map(([, lat]) => sourceY(lat))) - 1);
  const maxY = Math.min(2 ** terrainZoom - 1, Math.max(...corners.map(([, lat]) => sourceY(lat))) + 1);
  const sources = new Map();
  await Promise.all(Array.from({ length: maxX - minX + 1 }, (_, column) =>
    Array.from({ length: maxY - minY + 1 }, (_, row) => {
      const sx = minX + column, sy = minY + row;
      return getTerrainSourceTile(sx, sy).then(data =>
        sources.set(`${sx}/${sy}`, new DataView(data.buffer, data.byteOffset, data.byteLength)));
    })
  ).flat());

  const sample = (lng, lat) => {
    const px = (lng + 180) / 360 * 2 ** (terrainZoom + 1) * 256 - 0.5;
    const py = (90 - lat) / 180 * 2 ** terrainZoom * 256 - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const fx = px - x0, fy = py - y0;
    const at = (ix, iy) => {
      const sx = Math.floor(ix / 256), sy = Math.floor(iy / 256);
      const data = sources.get(`${sx}/${sy}`);
      if (!data) return -9999;
      return data.getFloat32(((iy - sy * 256) * 256 + ix - sx * 256) * 4, true);
    };
    const values = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
    if (values.some(value => !Number.isFinite(value) || value <= -1000)) return -9999;
    const north = values[0] * (1 - fx) + values[1] * fx;
    const south = values[2] * (1 - fx) + values[3] * fx;
    return north * (1 - fy) + south * fy;
  };

  const output = Buffer.allocUnsafe(256 * 256 * 4);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let validSamples = 0;
  for (let row = 0; row < 256; row++) {
    for (let column = 0; column < 256; column++) {
      const [lng, lat] = toLatLng(x * 256 + column + 0.5, y * 256 + row + 0.5);
      const elevation = sample(lng, lat);
      if (elevation > -1000) validSamples++;
      view.setFloat32((row * 256 + column) * 4, elevation, true);
    }
  }
  if (!validSamples) throw new Error(`No IGN elevation data in ${z}/${x}/${y}`);
  return gzipSync(output);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': 'leaflet-rotate offline example builder' } });
    } catch (error) {
      if (attempt === 5) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) {
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length) return data;
      if (attempt === 5) throw new Error(`Empty tile response for ${url}`);
    } else if ((response.status !== 404 && response.status !== 429 && response.status < 500) || attempt === 5) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    await sleep(1000 * 2 ** attempt);
  }
}

// PMTiles v3 Hilbert tile id.
function tileId(z, x, y) {
  let id = (4 ** z - 1) / 3;
  const n = 2 ** z;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) ? 1 : 0;
    const ry = (y & s) ? 1 : 0;
    id += s * s * ((3 * rx) ^ ry);
    if (!ry) {
      if (rx) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return id;
}

function serializeDirectory(entries) {
  const bytes = [];
  const varint = value => {
    while (value >= 0x80) {
      bytes.push((value % 0x80) | 0x80);
      value = Math.floor(value / 0x80);
    }
    bytes.push(value);
  };
  varint(entries.length);
  let lastId = 0;
  for (const entry of entries) {
    varint(entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (const entry of entries) varint(entry.runLength);
  for (const entry of entries) varint(entry.length);
  entries.forEach((entry, i) => {
    const previous = entries[i - 1];
    varint(previous && entry.offset === previous.offset + previous.length ? 0 : entry.offset + 1);
  });
  return gzipSync(Buffer.from(bytes));
}

function buildDirectories(entries) {
  const maxRoot = 16384 - 127;
  const root = serializeDirectory(entries);
  if (root.length <= maxRoot) return { root, leaves: Buffer.alloc(0) };
  for (let size = 4096; ; size *= 2) {
    const leaves = [];
    const rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = serializeDirectory(entries.slice(i, i + size));
      rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      leaves.push(leaf);
      offset += leaf.length;
    }
    const root = serializeDirectory(rootEntries);
    if (root.length <= maxRoot) return { root, leaves: Buffer.concat(leaves) };
  }
}

async function build(name, archive) {
  const tiles = tilesIn(archive.bbox, archive.minZoom, archive.maxZoom);
  const file = new URL(`paris-${name}.pmtiles`, outDir);
  const dataFile = new URL(`paris-${name}.pmtiles.data`, outDir);
  console.log(`${name}: ${tiles.length} tiles, zoom ${archive.minZoom}-${archive.maxZoom}`);

  // ponytail: no resume, an interrupted run starts over; add a tile cache if runs get long.
  const data = await open(dataFile, 'w');
  const entries = [];
  let dataLength = 0;
  let done = 0;
  let next = 0;
  try {
    const workers = await Promise.allSettled(Array.from({ length: archive.concurrency }, async () => {
      while (next < tiles.length) {
        const [z, x, y] = tiles[next++];
        const tile = await archive.tile(z, x, y);
        if (!tile?.length) throw new Error(`${name}: missing tile ${z}/${x}/${y}`);
        const offset = dataLength;
        dataLength += tile.length;
        let written = 0;
        while (written < tile.length) {
          const { bytesWritten } = await data.write(tile, written, tile.length - written, offset + written);
          if (!bytesWritten) throw new Error(`${name}: unable to write tile ${z}/${x}/${y}`);
          written += bytesWritten;
        }
        entries.push({ tileId: tileId(z, x, y), offset, length: tile.length, runLength: 1 });
        if (++done % 100 === 0 || done === tiles.length) console.log(`${name}: ${done}/${tiles.length}`);
      }
    }));
    const failed = workers.filter(worker => worker.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(worker => worker.reason),
      `${name}: archive incomplete; not published (${failed.length} failed workers)`);
  } finally {
    await data.close();
  }

  entries.sort((a, b) => a.tileId - b.tileId);
  const expectedIds = tiles.map(([z, x, y]) => tileId(z, x, y)).sort((a, b) => a - b);
  if (entries.length !== expectedIds.length || entries.some((entry, i) => entry.tileId !== expectedIds[i]) ||
    (await stat(dataFile)).size !== dataLength) {
    throw new Error(`${name}: tile coverage or data length verification failed; archive not published`);
  }
  const { root, leaves } = buildDirectories(entries);
  const metadata = gzipSync(JSON.stringify({
    name: `paris-${name}`, attribution: archive.attribution, ...archive.metadata,
  }));
  const header = Buffer.alloc(127);
  const u64 = (offset, value) => header.writeBigUInt64LE(BigInt(value), offset);
  const e7 = (offset, value) => header.writeInt32LE(Math.round(value * 1e7), offset);
  const [west, south, east, north] = archive.bbox;
  header.write('PMTiles', 0);
  header[7] = 3;
  u64(8, 127);
  u64(16, root.length);
  u64(24, 127 + root.length);
  u64(32, metadata.length);
  u64(40, 127 + root.length + metadata.length);
  u64(48, leaves.length);
  u64(56, 127 + root.length + metadata.length + leaves.length);
  u64(64, dataLength);
  u64(72, entries.length);
  u64(80, entries.length);
  u64(88, entries.length);
  header[96] = 0;
  header[97] = 2;
  header[98] = archive.tileCompression;
  header[99] = archive.tileType;
  header[100] = archive.minZoom;
  header[101] = archive.maxZoom;
  e7(102, west);
  e7(106, south);
  e7(110, east);
  e7(114, north);
  header[118] = archive.maxZoom;
  e7(119, (west + east) / 2);
  e7(123, (south + north) / 2);

  const partial = new URL(`paris-${name}.pmtiles.part`, outDir);
  const output = createWriteStream(partial);
  output.write(Buffer.concat([header, root, metadata, leaves]));
  await pipeline(createReadStream(dataFile), output);
  if ((await stat(partial)).size !== 127 + root.length + metadata.length + leaves.length + dataLength) {
    throw new Error(`${name}: truncated archive; not published`);
  }
  await rename(partial, file);
  await rm(dataFile);
  console.log(`${name}: wrote ${entries.length} tiles to ${fileURLToPath(file)}`);
}

await mkdir(outDir, { recursive: true });
for (const name of args.only.split(',')) {
  if (!archives[name]) throw new Error(`Unknown archive "${name}"`);
  await build(name, archives[name]);
}
