/**
 * `new L.Layer({ source: { type, url, ...settings }, pane, attribution })`: layers with a `source`
 * are routed by src/3d/index.js, loaded on first use. Subclasses are unchanged.
 */

// Shared registry: type modules (src/3d/types) register here.
L.Layer.types = {};

let route;

// Core L.Layer has no initialize and init hooks get no arguments: keep the options for the hook.
L.Layer.include({
  initialize(options) { L.Util.setOptions(this, options); },
});

L.Layer.addInitHook(function () {
  const { options } = this;
  if (Object.getPrototypeOf(this) !== L.Layer.prototype || !options.source) return;
  if (route) return route(this, options);
  // Until the router loads: an empty stand-in that only remembers its map.
  Object.assign(this, { onAdd() {}, onRemove() {} });
  const pending = this.ready = import(`./3d/index.js`).then(module => {
    route = module.route;
    route(this, options);
    return this.ready === pending ? this : this.ready;
  });
});
