import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as esbuildBuild, context, transform } from 'esbuild';

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
const debugMinifiedOptions = {
  entryPoints: ['lib/debug.js'],
  outfile: 'lib/debug.min.js',
  minify: true,
  plugins: [{
    name: 'minify-debug-templates',
    setup(build) {
      build.onLoad({ filter: /[\\/]lib[\\/]debug\.js$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const style = source.match(/<style>([\s\S]*?)<\/style>/);
        if (!style) throw new Error(`Could not find debug stylesheet in ${path}`);

        const { code } = await transform(style[1], { loader: 'css', minify: true });
        const contents = source
          .replace(style[0], `<style>${code.trim()}</style>`)
          .replace(/`([^`]*<[^`]*?)`/gs, (template, html) => {
            if (html.includes('${')) return template;
            return `\`${html.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()}\``;
          });

        return {
          contents,
          loader: 'js',
          watchFiles: [path],
        };
      });
    },
  }],
};

export async function build({ watch = false } = {}) {
  await mkdir('dist', { recursive: true });

  if (!watch) {
    await Promise.all([
      esbuildBuild(options),
      esbuildBuild(minifiedOptions),
      esbuildBuild(debugMinifiedOptions),
    ]);
    return;
  }

  const builders = await Promise.all([
    context(options),
    context(minifiedOptions),
    context(debugMinifiedOptions),
  ]);
  await Promise.all(builders.map(builder => builder.watch()));
  return () => Promise.all(builders.map(builder => builder.dispose()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await build();
}
