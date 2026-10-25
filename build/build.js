import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as esbuildBuild, context } from 'esbuild';

const options = {
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  globalName: 'leafletRotate',
  sourcemap: true,
  outdir: 'dist',
  entryNames: 'leaflet-rotate-src',
};
const minifiedOptions = { ...options, entryNames: 'leaflet-rotate', minify: true };

export async function build({ watch = false } = {}) {
  await mkdir('dist', { recursive: true });

  if (!watch) {
    await Promise.all([esbuildBuild(options), esbuildBuild(minifiedOptions)]);
    return;
  }

  const builders = await Promise.all([context(options), context(minifiedOptions)]);
  await Promise.all(builders.map(builder => builder.watch()));
  return () => Promise.all(builders.map(builder => builder.dispose()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await build();
}
