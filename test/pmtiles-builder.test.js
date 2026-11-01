import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, mkdtemp, open, rename, rm, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { gzipSync, gunzipSync } from 'node:zlib';

const source = await readFile(new URL('../build/pmtiles.js', import.meta.url), 'utf8');
const downloadSource = source.slice(source.indexOf('async function download('), source.indexOf('// PMTiles v3 Hilbert'));
const helpers = source.slice(source.indexOf('function tileId('), source.indexOf('async function build('));
const buildSource = source.slice(source.indexOf('async function build('), source.indexOf('await mkdir(outDir'));

test('downloads retry missing/empty responses and reject permanent holes', async () => {
  for (const status of [404, 503, 200]) {
    let requests = 0;
    const download = new Function('fetch', 'sleep',
      `${downloadSource}; return download;`)(async () => {
      requests++;
      return { ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(0) };
    }, async () => {});
    await assert.rejects(download('fixture'), status === 200 ? /Empty tile response/ : new RegExp(`HTTP ${status}`));
    assert.equal(requests, 5);
  }
  let requests = 0;
  const download = new Function('fetch', 'sleep',
    `${downloadSource}; return download;`)(async () => {
    requests++;
    return { ok: requests > 1, status: requests > 1 ? 200 : 404,
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
  }, async () => {});
  assert.deepEqual(await download('fixture'), Buffer.from([1, 2]));
  assert.equal(requests, 2);
});

test('archives publish every expected tile; failures preserve the previous archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leaflet-pmtiles-builder-'));
  const outDir = pathToFileURL(`${directory}\\`);
  const tiles = [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]];
  const build = new Function('outDir', 'tilesIn', 'open', 'stat', 'gzipSync', 'createWriteStream',
    'createReadStream', 'pipeline', 'rename', 'rm', 'fileURLToPath', 'console',
    `${helpers}\n${buildSource}\nreturn build;`)(outDir, () => tiles, open, stat, gzipSync,
    createWriteStream, createReadStream, pipeline, rename, rm, fileURLToPath, { log() {} });
  const archive = { bbox: [-180, -85, 180, 85], minZoom: 1, maxZoom: 1, concurrency: 2,
    attribution: 'fixture', tileType: 0, tileCompression: 2,
    tile: async () => gzipSync('{"type":"FeatureCollection","features":[]}') };
  try {
    await build('fixture', archive);
    const file = new URL('paris-fixture.pmtiles', outDir);
    const original = await readFile(file);
    assert.equal(Number(original.readBigUInt64LE(72)), 4);
    const root = gunzipSync(original.subarray(127, 127 + Number(original.readBigUInt64LE(16))));
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
    const count = varint();
    assert.equal(count, 4);
    const ids = [];
    for (let i = 0, id = 0; i < count; i++) ids.push(id += varint());
    assert.deepEqual(ids, [1, 2, 3, 4], 'Exact Hilbert coverage, not just the tile count');
    const runs = Array.from({ length: count }, varint);
    const lengths = Array.from({ length: count }, varint);
    const offsets = [];
    for (let i = 0; i < count; i++) {
      const encoded = varint();
      offsets.push(encoded ? encoded - 1 : offsets[i - 1] + lengths[i - 1]);
    }
    assert.deepEqual(runs, [1, 1, 1, 1]);
    const dataStart = Number(original.readBigUInt64LE(56));
    for (let i = 0; i < count; i++) {
      const tile = original.subarray(dataStart + offsets[i], dataStart + offsets[i] + lengths[i]);
      assert.deepEqual(JSON.parse(gunzipSync(tile)), { type: 'FeatureCollection', features: [] });
    }
    assert.equal(original.length, Number(original.readBigUInt64LE(56)) + Number(original.readBigUInt64LE(64)));
    await assert.rejects(build('fixture', { ...archive, tile: async (z, x, y) =>
      x === 1 && y === 0 ? null : archive.tile() }), /archive incomplete; not published/);
    assert.deepEqual(await readFile(file), original);
    await assert.rejects(build('fixture', { ...archive, tile: async () => {
      throw new Error('HTTP 404');
    } }), /archive incomplete; not published/);
    assert.deepEqual(await readFile(file), original);
  } finally {
    for (const name of ['paris-fixture.pmtiles', 'paris-fixture.pmtiles.data', 'paris-fixture.pmtiles.part']) {
      await rm(join(directory, name), { force: true });
    }
    await rmdir(directory);
  }
});
