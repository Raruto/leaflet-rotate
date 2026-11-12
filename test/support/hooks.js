import assert from 'node:assert/strict';
import { After, AfterAll, Before, BeforeAll, Given, setDefaultTimeout, setDefinitionFunctionWrapper } from '@cucumber/cucumber';
import { chromium, firefox } from 'playwright';
import { startServer } from '../../build/server.js';
import { scenarioTimeout, withScenarioBudget } from './scenario-budget.js';
import { dependencyFile } from '../fixtures/dependencies.js';

setDefaultTimeout(scenarioTimeout);
setDefinitionFunctionWrapper(withScenarioBudget);

const scenarioTimings = [];

Before(function () {
  this.scenarioStarted = performance.now();
});

After({ wrapperOptions: { cleanup: true } }, function ({ pickle, result }) {
  scenarioTimings.push({
    name: pickle.name, status: result.status,
    seconds: (performance.now() - this.scenarioStarted) / 1000,
  });
});

let server;
let browser;
let baseUrl;

BeforeAll({ timeout: 60000 }, async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const testBrowser = process.env.TEST_BROWSER;
  const [engine, options] = testBrowser === 'firefox'
    // Windows throttles requestAnimationFrame in windows it considers occluded.
    ? [firefox, { firefoxUserPrefs: { 'widget.windows.window_occlusion_tracking.enabled': false } }]
    : [chromium, testBrowser === 'chrome' || testBrowser === 'msedge' ? { channel: testBrowser } : {}];
  browser = await engine.launch(options);
});

AfterAll({ timeout: 60000 }, async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await browser.close();
});

AfterAll(function () {
  console.log('\nSlowest scenarios (including setup and cleanup):');
  for (const timing of scenarioTimings.sort((a, b) => b.seconds - a.seconds).slice(0, 10)) {
    console.log(`${timing.seconds.toFixed(2)}s [${timing.status}] ${timing.name}`);
  }
});

// @unit scenarios run in Node only and need no browser page.
Before({ tags: 'not @unit' }, async function () {
  this.baseUrl = baseUrl;
  this.unexpectedRequests = [];
  this.context = await browser.newContext({ serviceWorkers: 'block' });
  await this.context.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$))/i, route => {
    const url = route.request().url();
    const file = dependencyFile(url);
    if (file) return route.fulfill({ path: file });
    if (/^https?:\/\/(?:server\.arcgisonline\.com|(?:[abc]\.)?tile\.openstreetmap\.org)\//.test(url)) {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' });
    }
    this.unexpectedRequests.push(url);
    return route.abort('blockedbyclient');
  });
  await this.context.addInitScript(() => {
    const pointers = new Map();
    window.dispatchTouches = (target, type, touches, changedTouches = touches) => {
      if (!L.version.startsWith('2.')) {
        target.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches,
        }));
        return;
      }
      const container = map.getContainer();
      const dispatch = (type, touch) => container.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: 'touch', pointerId: touch.identifier + 1,
        clientX: touch.clientX, clientY: touch.clientY, button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      }));
      if (type === 'touchend') {
        for (const [id, touch] of pointers) {
          if (!touches.some(touch => touch.identifier === id)) {
            dispatch('pointerup', touch);
            pointers.delete(id);
          }
        }
      } else {
        for (const touch of touches) {
          pointers.set(touch.identifier, touch);
          dispatch(type === 'touchstart' ? 'pointerdown' : 'pointermove', touch);
        }
      }
    };
  });
  await this.context.route(url => url.origin === baseUrl && url.pathname.endsWith('.html'), async route => {
    const response = await route.fetch();
    const version = process.env.LEAFLET_VERSION;
    let body = (await response.text())
      .replace(/https:\/\/unpkg\.com\/leaflet-rotate@(.*?)\//g, '../')
      .replace(/leaflet-rotate@(.*?)\//g, '../')
      .replace(/\bconst (map|esri|osm|layers|markers|path|circle|polygon|rectangle) =/g, 'const $1 = window.$1 =');
    if (version === '2') {
      body = body
        .replace(
          '<script src="https://unpkg.com/leaflet@1.9/dist/leaflet-src.js"></script>',
          '<script src="https://unpkg.com/leaflet@2.0.0-beta.3/dist/leaflet-global.js"></script>'
        )
        .replace(
          '"leaflet": "https://unpkg.com/leaflet@1.9/dist/leaflet-src.js"',
          '"leaflet": "https://unpkg.com/leaflet@2.0.0-beta.3/dist/leaflet.js"'
        )
        .replace('https://unpkg.com/leaflet@1.9/dist/leaflet.css', 'https://unpkg.com/leaflet@2.0.0-beta.3/dist/leaflet.css');
    }
    await route.fulfill({ response, body, headers: response.headers() });
  });
  this.page = await this.context.newPage();
});

After({ tags: 'not @unit', wrapperOptions: { cleanup: true } }, async function () {
  if (this.context) await this.context.close();
  assert.deepEqual(this.unexpectedRequests, [], 'External browser requests must have a downloaded dependency or a tile fixture');
});

Given('the example page is open', { timeout: 30000 }, async function () {
  const version = process.env.LEAFLET_VERSION;
  await this.page.goto(`${baseUrl}/examples/leaflet-rotate.html`, { waitUntil: 'domcontentloaded' });
  await this.page.waitForFunction(() => window.map && window.path && typeof window.map.getBearing === 'function');

  const result = await this.page.evaluate(() => {
    const domUtilTest = document.createElement('div');
    leafletRotate.DomUtil.setPosition(domUtilTest, new L.Point(10, 20), Math.PI / 2, new L.Point(10, 20));
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
  assert.match(result.pluginVersion, version === '2' ? /^2\.0\.0-beta/ : /^1\.9/);
});
