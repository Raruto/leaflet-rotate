# leaflet-rotate

[![NPM version](https://img.shields.io/npm/v/leaflet-rotate.svg?color=red)](https://www.npmjs.com/package/leaflet-rotate)
[![License](https://img.shields.io/badge/license-GPL%203-blue.svg?style=flat)](LICENSE)

A Leaflet plugin that allows to add rotation functionality to map tiles

_For a working example see the following [demo](https://raruto.github.io/leaflet-rotate/examples/leaflet-rotate.html)_

<p align="center">
    <a href="https://raruto.github.io/leaflet-rotate/examples/leaflet-rotate.html"><img src="https://raruto.github.io/img/leaflet-rotate.png" alt="Leaflet rotate viewer" /></a>
</p>

---

<blockquote>
    <p align="center">
        <em>Initially based on the <a href="https://github.com/Leaflet/Leaflet/tree/rotate">work</a> of <strong>Iván Sánchez Ortega</strong> (see: <a href="https://github.com/Leaflet/Leaflet/issues/268">#268</a>)</em>
    </p>
</blockquote>

### Build Guide

Within your local development environment:

```shell
git clone git@github.com:Raruto/leaflet-rotate.git
cd ./leaflet-rotate

npm i         # install dependencies
npm run dev   # start dev server at: http://localhost:8080
npm run build # generate "dist" files (once)
npm run test  # test all "*.spec.js" files (once)
```

After that you can start developing inside the `src` and `test` folders (eg. open "http://localhost:8080/test" in your browser to preview changes).

---

**Side notes:**

Be aware that this library overrides notable parts of leaflet core via the [L.Class.include()](https://leafletjs.com/examples/extending/extending-1-classes.html) function in order to make the rotate feature usable as a standalone plug-in.

Initial changes to this project have been apported by comparing the following branches: [https://github.com/Leaflet/Leaflet/compare/main...fnicollet:rotate-master](https://github.com/Leaflet/Leaflet/compare/main...fnicollet:rotate-master) (ref: [bac6c7d](https://github.com/fnicollet/Leaflet/tree/4ab6342f74516e7087dcd2ae786c721f36addf9e))

---

**Compatibile with:**
[![Leaflet 1.x compatible!](https://img.shields.io/badge/Leaflet-1.9-1EB300.svg?style=flat)](http://leafletjs.com/reference.html)

**Contributors:** [IvanSanchez](https://github.com/IvanSanchez), [Fnicollet](https://github.com/fnicollet/Leaflet/tree/rotate-master), [Hyperknot](https://github.com/hyperknot), [Raruto](https://github.com/Raruto/leaflet-rotate)
