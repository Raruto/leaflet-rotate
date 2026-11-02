import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { After, Given, Then, When } from '@cucumber/cucumber';

// build/pmtiles.js is a script, not a module: the scenarios slice out the functions they exercise.
const source = await readFile(new URL('../../build/pmtiles.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const indexPointTiles = new Function(`${slice('function indexPointTiles(', '// Same clipping')}; return indexPointTiles;`)();
const downloader = fetch => new Function('fetch', 'sleep',
  `${slice('async function download(', '// PMTiles v3 Hilbert')}; return download;`)(fetch, async () => {});
const builder = outDir => new Function('outDir', 'tilesIn', 'open', 'stat', 'gzipSync', 'createWriteStream',
  'createReadStream', 'pipeline', 'rename', 'rm', 'fileURLToPath', 'console',
  `${slice('function tileId(', 'async function build(')}\n${slice('async function build(', 'await mkdir(outDir')}\nreturn build;`)(
  outDir, () => [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]], open, stat, gzipSync,
  createWriteStream, createReadStream, pipeline, rename, rm, fileURLToPath, { log() {} });

const point = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });

Given('two trees on either side of a zoom 16 tile boundary', function () {
  const tree = (id, coordinates) => point(coordinates, { idbase: id, hauteurenm: 20, circonferenceencm: 185, genre: 'Platanus' });
  this.data = { type: 'FeatureCollection', features: [tree(1, [0, 0]), tree(2, [-0.001, 0])] };
});

When('the trees are indexed into zoom 16 tiles', function () {
  this.tiles = indexPointTiles(this.data, 16, [-1, -1, 1, 1]);
});

Then('each tree is in exactly one tile with its id and properties', function () {
  const [east, west] = this.data.features;
  assert.equal(this.tiles.size, 2);
  assert.deepEqual(this.tiles.get('32768/32768'), [east]);
  assert.deepEqual(this.tiles.get('32767/32768'), [west]);
  assert.equal(east.id, 1);
  assert.equal(east.properties.circonferenceencm, 185);
});

Then('indexing fails for invalid GeoJSON, invalid coordinates and points outside the archive', function () {
  const [tree] = this.data.features;
  assert.throws(() => indexPointTiles({}, 16, [-1, -1, 1, 1]), /Invalid tree GeoJSON/);
  assert.throws(() => indexPointTiles({ ...this.data, features: [{ ...tree, geometry: { type: 'Point', coordinates: [NaN, 0] } }] },
    16, [-1, -1, 1, 1]), /Invalid tree coordinates/);
  assert.throws(() => indexPointTiles(this.data, 16, [2, 2, 3, 3]), /outside archive bounds/);
});

Given('two streetlights at the same position', function () {
  const lamp = foyer => point([2.29, 48.85], { foyer, cod_ouvrag: 'shared', support_hauteur: '7.0',
    lampe_flux: '13165.0', lampe_temperature_couleur: '2700.0' });
  this.data = { type: 'FeatureCollection', features: [lamp('one'), lamp('two')] };
});

When('the streetlights are indexed into zoom 16 tiles', function () {
  this.points = [...indexPointTiles(this.data, 16, [2.2, 48.7, 2.5, 49], 'foyer', 'streetlight').values()].flat();
});

Then('both lamps are kept with their ids and photometric records', function () {
  assert.deepEqual(this.points.map(p => p.id), ['one', 'two']);
  assert.equal(this.points[0].properties.lampe_flux, '13165.0');
  assert.equal(this.points[0].properties.lampe_temperature_couleur, '2700.0');
});

Then('a download answered with HTTP {int} fails with {string} after {int} attempts', async function (status, error, attempts) {
  let requests = 0;
  const download = downloader(async () => {
    requests++;
    return { ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  await assert.rejects(download('fixture'), new RegExp(error));
  assert.equal(requests, attempts);
});

Then('a download answered with HTTP {int} once then 200 returns the tile after {int} attempts', async function (status, attempts) {
  let requests = 0;
  const download = downloader(async () => {
    requests++;
    return { ok: requests > 1, status: requests > 1 ? 200 : status, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
  });
  assert.deepEqual(await download('fixture'), Buffer.from([1, 2]));
  assert.equal(requests, attempts);
});

const emptyTile = async () => gzipSync('{"type":"FeatureCollection","features":[]}');
const archive = { bbox: [-180, -85, 180, 85], minZoom: 1, maxZoom: 1, concurrency: 2,
  attribution: 'fixture', tileType: 0, tileCompression: 2, tile: emptyTile };

Given('a 4-tile archive has been built', async function () {
  this.directory = await mkdtemp(join(tmpdir(), 'leaflet-pmtiles-builder-'));
  this.build = builder(pathToFileURL(`${this.directory}\\`));
  await this.build('fixture', archive);
  this.archive = await readFile(join(this.directory, 'paris-fixture.pmtiles'));
});

After({ tags: '@unit' }, async function () {
  if (this.directory) await rm(this.directory, { recursive: true, force: true });
});

Then('its directory lists Hilbert tiles 1 to 4 with their data', function () {
  const file = this.archive, int = offset => Number(file.readBigUInt64LE(offset));
  assert.equal(int(72), 4);
  const root = gunzipSync(file.subarray(127, 127 + int(16)));
  let cursor = 0;
  const varint = () => {
    let value = 0, shift = 0, byte;
    do {
      byte = root[cursor++];
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  };
  const count = varint(), ids = [];
  assert.equal(count, 4);
  for (let i = 0, id = 0; i < count; i++) ids.push(id += varint());
  assert.deepEqual(ids, [1, 2, 3, 4], 'Exact Hilbert coverage, not just the tile count');
  const runs = Array.from({ length: count }, varint), lengths = Array.from({ length: count }, varint), offsets = [];
  for (let i = 0; i < count; i++) {
    const encoded = varint();
    offsets.push(encoded ? encoded - 1 : offsets[i - 1] + lengths[i - 1]);
  }
  assert.deepEqual(runs, [1, 1, 1, 1]);
  const dataStart = int(56);
  for (let i = 0; i < count; i++) {
    const tile = file.subarray(dataStart + offsets[i], dataStart + offsets[i] + lengths[i]);
    assert.deepEqual(JSON.parse(gunzipSync(tile)), { type: 'FeatureCollection', features: [] });
  }
  assert.equal(file.length, dataStart + int(64));
});

const failedBuilds = {
  'missing a tile': async (z, x, y) => x === 1 && y === 0 ? null : emptyTile(),
  'with failing downloads': async () => { throw new Error('HTTP 404'); },
};

Then(/^a build (missing a tile|with failing downloads) is not published and keeps the previous archive$/, async function (failure) {
  await assert.rejects(this.build('fixture', { ...archive, tile: failedBuilds[failure] }), /archive incomplete; not published/);
  assert.deepEqual(await readFile(join(this.directory, 'paris-fixture.pmtiles')), this.archive);
});
