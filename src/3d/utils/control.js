/**
 * Keeps `element` right under `layer`'s entry in the map's layers control while the layer is on the map.
 * Returns false when no layers control lists the layer.
 */
export function underEntry(layer, element) {
  const map = layer._map;
  const place = () => {
    const input = [...map.getContainer().querySelectorAll('.leaflet-control-layers-selector')]
      .find(input => input.layerId === globalThis.L.Util.stamp(layer));
    input?.closest('label').after(element);
    return Boolean(input);
  };
  // Leaflet rebuilds the list after 'layeradd'/'layerremove' (on the layer's own 'add'/'remove'): re-place afterwards.
  const replace = () => queueMicrotask(() => map.hasLayer(layer) && place());
  map.on('layeradd layerremove', replace);
  layer.once('remove', () => { map.off('layeradd layerremove', replace); element.remove(); });
  return place();
}
