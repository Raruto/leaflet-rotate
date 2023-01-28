/**
 * Triggers `invalidateResize` when the map's DOM container mutates.
 * 
 * @typedef L.Map.ContainerMutation
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
     * @see https://developer.mozilla.org/docs/Web/API/MutationObserver
     */
    trackContainerMutation: false

});

L.Map.ContainerMutation = L.Handler.extend({

    addHooks: function() {
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

    removeHooks: function() {
        // if (!L.Browser.mutation) { return; }
        this._observer.disconnect();
    },

});

/**
 * Add Container mutation handler to L.Map (disabled unless `trackContainerMutation` is set).
 * 
 * @property {L.Map.ContainerMutation} trackContainerMutation
 */
L.Map.addInitHook('addHandler', 'trackContainerMutation', L.Map.ContainerMutation);
