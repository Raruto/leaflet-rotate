import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonJS from '@rollup/plugin-commonjs';

let input = "src/index.js";
let output = {
  file: "dist/leaflet-rotate-src.js",
  format: "umd",
  sourcemap: true,
  name: "leaflet-rotate",
};

let plugins = [
  resolve(),
  commonJS({
    include: '../node_modules/**'
  })
];

export default [{
    input: input,
    output: output,
    plugins: plugins,
  },
  {
    input: input,
    output: Object.assign({}, output, {
      file: "dist/leaflet-rotate.js"
    }),
    plugins: plugins.concat(terser()),
  }
];
