window.__ModuleLoader__.load({
  id: 'tintin-bundle',
  factory: () => ({
    name: 'tintin-bundle',
    inject: [],
    apply() {
      // P0-V3 probe: proves this client module executed inside the workbench
      // renderer and that same-origin host routing answers it.
      fetch('/tintin/ping')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(
          (j) => console.info('[tintin] host ping ok', j),
          (e) => console.error('[tintin] host ping fail', e),
        )
    },
  }),
})
