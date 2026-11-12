import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Then } from '@cucumber/cucumber';
import { prepareDependencies } from '../fixtures/dependencies.js';

Then('browser dependencies are downloaded again without falling back to old files', async function () {
  const directory = await mkdtemp(join(tmpdir(), 'leaflet-rotate-dependencies-'));
  const file = pathToFileURL(join(directory, 'dependency.js'));
  const dependencies = new Map([['https://unpkg.com/test-dependency.js', file]]);
  const fetchNode = globalThis.fetch;
  let requests = 0;
  let status = 200;
  let body = 'first download';
  globalThis.fetch = async () => {
    requests++;
    return new Response(body, { status });
  };
  try {
    await prepareDependencies(dependencies);
    body = 'second download';
    await prepareDependencies(dependencies);
    assert.equal(requests, 2);
    assert.equal(await readFile(file, 'utf8'), body);
    status = 503;
    await assert.rejects(prepareDependencies(dependencies), /HTTP 503/);
    status = 200;
    body = '';
    await assert.rejects(prepareDependencies(dependencies), /empty response/);
    globalThis.fetch = async () => { throw new Error('Network unavailable'); };
    await assert.rejects(prepareDependencies(dependencies), /Network unavailable/);
  } finally {
    globalThis.fetch = fetchNode;
    await rm(directory, { recursive: true, force: true });
  }
});
