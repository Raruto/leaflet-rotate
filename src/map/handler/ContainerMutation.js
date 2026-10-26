/**
 * Calls `invalidateSize()` when the map container's inline style changes.
 * 
 * @typedef L.Map.ContainerMutation
 * @property {boolean} [trackContainerMutation=false] Observe inline style changes on the map container.
 * 
 * @since leaflet-rotate (v0.1.0)
 */

/**
 * @TODO check again this file after leaflet v1.9.3 (eg. L.Browser.mutation).
 * Mutation Observer support will likely be added by default in next releases.
 */

L.Map.mergeOptions({

    /**
     * Whether the map uses mutation observers to
     * detect changes in its container and trigger
     * `invalidateSize`. Disabled by default due to
     * support not being available in all web browsers.
     *
     * @type {Boolean}
     * 
     * @since leaflet-rotate (v0.1.0)
     * 
     * @see https://developer.mozilla.org/docs/Web/API/MutationObserver
     */
    trackContainerMutation: false

});

L.Map.ContainerMutation = L.Handler.extend({

    /**
     * Start observing the map container's style attribute.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    addHooks() {
        // if (!L.Browser.mutation) { return; }
        if (!this._observer) {
            this._observer = new MutationObserver(L.Util.bind(this._map.invalidateSize, this._map));
        }
        this._observer.observe(this._map.getContainer(), {
            childList: false,
            attributes: true,
            characterData: false,
            subtree: false,
            attributeFilter: ['style']
        });
    },

    /**
     * Stop observing container mutations.
     * 
     * @since leaflet-rotate (v0.1.0)
     */
    removeHooks() {
        // if (!L.Browser.mutation) { return; }
        this._observer.disconnect();
    },

});

/**
 * Add Container mutation handler to L.Map (disabled unless `trackContainerMutation` is set).
 * 
 * @property {L.Map.ContainerMutation} trackContainerMutation
 * 
 * @since leaflet-rotate (v0.1.0)
 */
L.Map.addInitHook('addHandler', 'trackContainerMutation', L.Map.ContainerMutation);
