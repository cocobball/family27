import { getModuleData, setModuleData, patchModuleData, ensureModule } from "./dashboardStore.js";

export function createCtxFactory({ eventBus, sharedState, windowActions, moduleDef }) {
  const store = {
    getModuleData: (id, def) => getModuleData(id, def),
    setModuleData: (id, v) => setModuleData(id, v),
    patchModuleData: (id, p) => patchModuleData(id, p),
    ensureModule: (id, def) => ensureModule(id, def),
    get: (defVal) => getModuleData(moduleDef.id, defVal),
    set: (val) => setModuleData(moduleDef.id, val),
    patch: (partial) => patchModuleData(moduleDef.id, partial),
  };

  return function buildCtx(windowId) {
    return {
      store,
      eventBus,
      sharedState,
      window: { id: windowId, moduleId: moduleDef.id },
      actions: windowActions,
    };
  };
}
