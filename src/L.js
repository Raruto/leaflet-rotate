const Leaflet = globalThis.L;

// Leaflet 2 exports read-only module namespaces; keep plugin overrides local.
export const L = {
    ...Leaflet,
    DomUtil: Leaflet.version.startsWith('1.') ? Leaflet.DomUtil : { ...Leaflet.DomUtil },
};
