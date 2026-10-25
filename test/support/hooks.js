import assert from 'node:assert/strict';
import { After, AfterAll, Before, BeforeAll, Given, setDefaultTimeout } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import { startServer } from '../../build/server.js';

setDefaultTimeout(10000);

let server;
let browser;
let baseUrl;

BeforeAll(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

AfterAll({ timeout: 30000 }, async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

Before(async function () {
  this.baseUrl = baseUrl;
  this.context = await browser.newContext();
  await this.context.route(/.html$/, async route => {
    const response = await route.fetch();
    const version = process.env.LEAFLET_VERSION;
    let body = (await response.text())
      .replace(/https:\/\/unpkg\.com\/leaflet-rotate@(.*?)\//g, '../')
      .replace(/leaflet-rotate@(.*?)\//g, '../')
      .replace(/\bconst (map|esri|osm|markers|path|circle|polygon|rectangle) =/g, 'const $1 = window.$1 =');
    if (version === '2') {
      body = body
        .replace('<script src="https://unpkg.com/leaflet@1.9/dist/leaflet-src.js"></script>', `<script>
          globalThis.__leafletLoading = import('https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js').then(async leaflet => {
            globalThis.L = Object.assign({}, leaflet);
            for (const src of ['../dist/leaflet-rotate-src.js', '../misc/route.js', '../misc/places.js', '../misc/loremIpsum.js', '../lib/debug.js']) {
              await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = () => reject(new Error(\`Could not load \${src}\`));
                document.head.appendChild(script);
              });
            }
          });
        </script>`)
        .replace(/<script src="\.\.\/(?:dist|misc|lib)\/[^"]+"><\/script>/g, '')
        .replace(/<script>\s*(const esri[\s\S]*?L\.Rotate\.debug\(map\);\s*)<\/script>/, '<script>globalThis.__leafletLoading.then(() => {$1});</script>')
        .replace('https://unpkg.com/leaflet@1.9/dist/leaflet.css', 'https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css');
    }
    await route.fulfill({ response, body, headers: response.headers() });
  });
  this.page = await this.context.newPage();
});

After(async function () {
  await this.context.close();
});

Given('the example page is open', async function () {
  const version = process.env.LEAFLET_VERSION;
  await this.page.goto(`${baseUrl}/examples/leaflet-rotate.html`);
  await this.page.waitForLoadState('domcontentloaded');
  await this.page.waitForFunction(() => window.map && window.path && typeof window.map.getBearing === 'function');

  const result = await this.page.evaluate(() => {
    const domUtilTest = document.createElement('div');
    L.DomUtil.setPosition(domUtilTest, new L.Point(10, 20), Math.PI / 2, new L.Point(10, 20));
    const testMarker = new L.Marker([55, 10], { rotation: Math.PI / 4 }).addTo(map);
    const compatibility = {
      bearing: map.getBearing(),
      rotatePane: map._rotatePane instanceof HTMLElement,
      markerOnMap: testMarker._map === map,
      pathOnMap: path._map === map,
      markerTransform: testMarker.getElement().style.transform,
      domUtilTransform: domUtilTest.style.transform,
      pluginVersion: L.version,
    };
    testMarker.remove();
    return compatibility;
  });
  assert.ok(Math.abs(result.bearing - 30) < 1e-9, JSON.stringify(result));
  assert.equal(result.rotatePane, true);
  assert.equal(result.markerOnMap, true);
  assert.equal(result.pathOnMap, true);
  assert.match(result.markerTransform, /rotate\(0\.785/);
  assert.match(result.domUtilTransform, /rotate\(1\.570/);
  assert.match(result.pluginVersion, version === '2' ? /^2\.0\.0-alpha/ : /^1\.9/);
});
