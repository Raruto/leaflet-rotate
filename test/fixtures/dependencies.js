import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = new URL('../../node_modules/.cache/browser-test-dependencies/', import.meta.url);
const files = new Map();
for (const version of ['1.9.4', '2.0.0-beta.3']) {
  const scripts = version.startsWith('2.') ? ['leaflet-global.js', 'leaflet.js'] : ['leaflet-src.js'];
  for (const file of [...scripts, 'leaflet.css',
    ...(!version.startsWith('2.') ? ['images/marker-icon.png', 'images/marker-icon-2x.png',
      'images/marker-shadow.png', 'images/layers.png', 'images/layers-2x.png'] : [])]) {
    files.set(`https://unpkg.com/leaflet@${version}/dist/${file}`, new URL(`leaflet-${version}/${file}`, directory));
  }
}
files.set('https://raruto.github.io/img/view-on-github.png', new URL('view-on-github.png', directory));

export function dependencyFile(url) {
  const file = files.get(url.replace('leaflet@1.9/', 'leaflet@1.9.4/'));
  return file && fileURLToPath(file);
}

export async function prepareDependencies(dependencies = files) {
  const signal = AbortSignal.timeout(30000);
  await Promise.all([...dependencies].map(async ([url, file]) => {
    console.log(`Downloading test dependency: ${url}`);
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Test dependency ${url}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) throw new Error(`Test dependency ${url}: empty response`);
    await mkdir(new URL('.', file), { recursive: true });
    await writeFile(file, body);
  }));
}
