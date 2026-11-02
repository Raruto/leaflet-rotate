import assert from 'node:assert/strict';
import { After, AfterAll, Before, Given } from '@cucumber/cucumber';

// Shared by the 3D scenarios: coverage hooks, page checks and the example pages.
const coveredFunctions = new Map();

Before({ tags: '@3d-layer' }, async function () {
  if (process.env.COVERAGE_3D) {
    await this.page.coverage.startJSCoverage({ resetOnNavigation: false });
  }
});

After({ tags: '@3d-layer' }, async function () {
  if (!process.env.COVERAGE_3D) return;
  const entries = await this.page.coverage.stopJSCoverage();
  for (const entry of entries.filter(entry => entry.url.includes('/dist/3d/'))) {
    for (const fn of entry.functions) {
      const range = fn.ranges[0];
      if (!fn.functionName) continue;
      const key = `${entry.url}:${range.startOffset}:${range.endOffset}`;
      const previous = coveredFunctions.get(key);
      coveredFunctions.set(key, {
        name: fn.functionName,
        line: entry.source.slice(0, range.startOffset).split('\n').length,
        covered: Boolean(range.count || previous?.covered),
      });
    }
  }
});

AfterAll(function () {
  if (!process.env.COVERAGE_3D || !coveredFunctions.size) return;
  const functions = [...coveredFunctions.values()];
  const covered = functions.filter(fn => fn.covered).length;
  console.log(`Layer3D named-function coverage: ${covered}/${functions.length} (${(covered / functions.length * 100).toFixed(1)}%)`);
  console.log('Uncovered functions:', functions.filter(fn => !fn.covered).map(fn => `${fn.name}:${fn.line}`).join(', '));
});

export async function prepare3DChecks(page) {
  await page.evaluate(() => {
    window.nativeChecks = {
      group() {
        return {
          position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
          worldMatrix: Array.from(new DOMMatrix().toFloat64Array()), children: [], visible: true,
        };
      },
      mesh(layer, attributes, program = layer._createProgram({ vertexColors: true })) {
        return {
          ...nativeChecks.group(),
          gl: layer.renderer.gl,
          geometry: layer._createGeometry(layer.renderer.gl, Object.fromEntries(Object.entries(attributes)
            .map(([name, values]) => [name, { size: 3, data: new Float32Array(values) }]))),
          program, id: L.Layer.types['3d']._nextId++, renderOrder: 0, extras: {},
        };
      },
      ready(layer) {
        return new Promise((resolve, reject) => {
          const loaded = () => { cleanup(); resolve(layer); };
          const failed = ({ error }) => { cleanup(); reject(error); };
          const cleanup = () => {
            layer.off('ready', loaded);
            layer.off('error', failed);
          };
          layer.on('ready', loaded);
          layer.on('error', failed);
        });
      },
      async loadBlock(layer, area, features) {
        while (layer._inflight) await new Promise(requestAnimationFrame);
        const getZxy = layer.getZxy;
        layer.getZxy = async () => ({
          data: new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })),
        });
        layer._areas.set('fixture', area);
        try {
          layer._pump();
          while (layer._inflight) await new Promise(requestAnimationFrame);
          return area;
        } finally {
          layer.getZxy = getZxy;
          layer._areas.delete('fixture');
        }
      },
      bounds(root, backend) {
        backend._updateWorldMatrix(root, true);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        backend.traverse(root, mesh => {
          if (!mesh.geometry) return;
          const position = mesh.geometry.attributes.position;
          for (let i = 0; i < position.count; i++) {
            const offset = i * position.size;
            const transformed = new DOMPoint(position.data[offset], position.data[offset + 1], position.data[offset + 2], 1)
              .matrixTransform(new DOMMatrix(mesh.worldMatrix));
            const point = [transformed.x / transformed.w, transformed.y / transformed.w, transformed.z / transformed.w];
            for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], point[j]); max[j] = Math.max(max[j], point[j]); }
          }


        });
        return { min, max };
      },
      intersections(mesh, origin, direction, backend) {
        const camera = backend.camera, ray = structuredClone(backend.raycaster);
        backend.camera = {
          ...structuredClone(camera), position: [...origin],
          target: origin.map((v, i) => v + direction[i]), up: [0, 0, 1],
        };
        try {
          const rect = backend._map.getContainer().getBoundingClientRect();
          return backend.raycast({
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          }, [mesh], false).map(hit => hit.point);
        } finally {
          backend.camera = camera;
          backend.raycaster = ray;
        }
      },
    };
  });
}

Given('a map with the standalone 3D module and no dependency import map', async function () {
  this.oglRequests = [];
  this.threeRequests = [];
  this.page.on('request', request => {
    if (request.url().includes('unpkg.com/three@')) this.threeRequests.push(request.url());
    if (/unpkg\.com\/(ogl|earcut)@/.test(request.url())) this.oglRequests.push(request.url());
  });
  await this.page.route('**/test/standalone-3d.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css">
      <div id="first" style="width:400px;height:300px"></div>
      <div id="second" style="width:400px;height:300px"></div>
      <script src="https://unpkg.com/leaflet@${process.env.LEAFLET_VERSION === '2' ? '2.0.0-alpha.1/dist/leaflet-global-src.js' : '1.9/dist/leaflet-src.js'}"></script>
      <script>globalThis.L = globalThis.leaflet || globalThis.L;</script>
      <script src="../dist/leaflet-rotate-src.js"></script>
      <script>
        import('../dist/3d/types/terrain.js').then(() => window.test3d = { Layer3D: L.Layer.types['3d'], map: new L.Map('first', {
          center: [48.8582601, 2.29449985], zoom: 17, rotate: true, pitch: 45, bearing: 30
        }) });
      </script>`,
  }));
  await this.page.goto(`${this.baseUrl}/test/standalone-3d.html`);
  await prepare3DChecks(this.page);
  await this.page.waitForFunction(() => window.test3d);
  assert.deepEqual(this.threeRequests, []);
  assert.deepEqual(this.oglRequests, []);
  assert.equal(await this.page.evaluate(() => [...document.scripts].every(script => !script.type)), true);
  assert.equal(await this.page.evaluate(() => L.Layer.types['3d'].SceneRenderer), undefined);
});

const openEiffelExample = async function () {
  await this.page.setViewportSize({ width: 800, height: 600 });
  await this.page.goto(`${this.baseUrl}/examples/leaflet-rotate-3d.html`, { waitUntil: 'domcontentloaded' });
  await prepare3DChecks(this.page);
  await this.page.waitForFunction(() => window.map && typeof window.map.getPitch === 'function');
  await this.page.waitForFunction(() => layers._layers.some(entry => entry.name === 'Shadows'));
  await this.page.evaluate(() => Promise.all(layers._layers.map(({ layer }) => layer.ready)));
  // Test-only shortcuts; the example keeps its layers inside the layers control.
  await this.page.evaluate(() => {
    const named = name => layers._layers.find(entry => entry.name === name).layer;
    Object.assign(window, { sunlightOverlay: named('Shadows'), cruiseBoats: named('Bateaux-Mouches'), streetlights: named('Streetlights') });
  });
  await this.page.waitForFunction(() => sunlightOverlay.control);
  await this.page.waitForFunction(() => layers._layers.every(({ layer }) =>
    !(layer instanceof L.Layer.types['3d']) || (layer.root && (!layer.modelUrl || layer.model) &&
      (!layer.url || layer.header))));
  await this.page.evaluate(() => Promise.all(layers._layers
    .filter(({ layer }) => !(layer instanceof L.Layer.types['3d'])).map(({ layer }) => layer.ready)));
  const layout = await this.page.evaluate(() => {
    const rect = map.getContainer().getBoundingClientRect();
    return {
      width: rect.width, height: rect.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      preferCanvas: map.options.preferCanvas,
      classicScriptsOnly: [...document.scripts].every(script => !script.type),
      globalLibraries: typeof L.Layer.types['3d'] === 'function' && typeof L.Layer.types.pmtiles === 'function',
      vectorLayers: Object.values(map._layers).filter(layer => layer instanceof L.Path).length,
      backgrounds: [...document.querySelectorAll('.leaflet-control-layers-base label')].map(label => label.textContent.trim()),
      activeBackgrounds: layers._layers.filter(entry => !entry.overlay && map.hasLayer(entry.layer)).map(entry => entry.name),
      orthophotoUrl: layers._layers.find(entry => entry.name === 'Orthophoto IGN').layer.options.archive.url
    };
  });
  assert.equal(layout.width, layout.viewportWidth);
  assert.equal(layout.height, layout.viewportHeight);
  assert.equal(layout.preferCanvas, true);
  assert.equal(layout.classicScriptsOnly, true);
  assert.equal(layout.globalLibraries, true);
  assert.equal(layout.vectorLayers, 0);
  assert.deepEqual(layout.backgrounds, ['Empty', 'Plan IGN', 'Orthophoto IGN']);
  assert.deepEqual(layout.activeBackgrounds, ['Orthophoto IGN']);
  assert.match(layout.orthophotoUrl, /\/examples\/data\/paris-orthophotos\.pmtiles$/);
};

Given('the Eiffel Tower example page is open', { timeout: 60000 }, openEiffelExample);

// Real offline archives: terrain and orthophoto tiles exercise the GPU upload paths.
Given('the Eiffel Tower example page is open with its offline archives', { timeout: 60000 }, async function () {
  await this.context.unroute('**/dist/3d/types/*.js');
  await openEiffelExample.call(this);
});
