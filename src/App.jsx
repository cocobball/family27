import React, { useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "./ui/ErrorBoundary.jsx";
import SystemBar from "./ui/SystemBar.jsx";
import DesktopSurface from "./ui/DesktopSurface.jsx";
import PopupOverlay from "./ui/PopupOverlay.jsx";
import GlobalSettings from "./ui/GlobalSettings.jsx";

import { createEventBus } from "./core/eventBus.js";
import { createSharedState } from "./core/sharedState.js";
import { applyThemeVars } from "./core/themes.js";
import { loadDb, saveDb, createEmptyDb, DB_KEY } from "./core/dashboardStore.js";
import { STARTER_ENABLED, createWindowForModule, createDefaultLayout } from "./core/layoutDefaults.js";
import { loadModules } from "./core/moduleLoader.js";
import { installKioskOskFocusFix } from "./kiosk/oskFocusFix.js";

installKioskOskFocusFix();

// ✅ NEW: backend-backed module state (generic for all modules)
import {
  getCachedModule,
  setCachedModule,
  hasHydrated,
  hydrateModuleFromServer,
  saveModuleToServer,
} from "./core/backendStore.js";

function hasAnyWindows(db) {
  return !!(db?.layout?.windows && Object.keys(db.layout.windows).length);
}
function hasAnyEnabled(db) {
  const vis = db?.layout?.moduleVisibility ?? {};
  return Object.values(vis).some(Boolean);
}

function pruneMissingModuleWindows(db, moduleList) {
  const known = new Set((moduleList || []).map((m) => m.id));

  // remove windows for modules we no longer have
  const wins = db.layout.windows ?? {};
  for (const [winId, w] of Object.entries(wins)) {
    if (!w?.moduleId || !known.has(w.moduleId)) {
      delete wins[winId];
    }
  }

  // clean column orders so they don't reference deleted windows
  const cols = db.layout.columns ?? {};
  for (const col of Object.values(cols)) {
    col.order = (col.order ?? []).filter((id) => !!wins[id]);
  }
}

export default function App() {
  // Core singletons (no heavy providers)
  const eventBus = useMemo(() => createEventBus(), []);
  const sharedState = useMemo(() => createSharedState({ selectedDate: new Date().toISOString().slice(0, 10) }), []);

  // Module discovery + validation + dep ordering
  const { list: moduleList, failed: failedModules } = useMemo(() => loadModules(), []);
  const modulesById = useMemo(() => {
    const map = {};
    for (const m of moduleList) map[m.id] = m;
    return map;
  }, [moduleList]);

  // DB state as a simple "refresh token"
  const [tick, setTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [popupWinId, setPopupWinId] = useState(null);
  const [moduleSettingsWinId, setModuleSettingsWinId] = useState(null);

  // ---- Boot sequence (MANDATORY) ----
  const db = useMemo(() => {
    const loaded = loadDb();
    const next = bootstrapDb(loaded, moduleList);
    // Ensure storage is updated if bootstrap changed things
    saveDb(next);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Apply theme at render time
  useMemo(() => {
    applyThemeVars(db.theme?.id);
  }, [db.theme?.id]);

  // Derived window maps
  const windowsById = db.layout.windows ?? {};
  const hiddenWindows = useMemo(() => {
    return Object.values(windowsById).filter((w) => w.hidden);
  }, [windowsById]);

  const moduleVisibility = db.layout.moduleVisibility ?? {};

  const getModuleDef = useCallback((moduleId) => modulesById[moduleId], [modulesById]);

  // Window actions (kept stable + memo-friendly)
  const mutateDb = useCallback((updater) => {
    const fresh = loadDb();
    const migrated = fresh ?? createEmptyDb();
    updater(migrated);
    saveDb(migrated);
    setTick((t) => t + 1);
  }, []);

  const onRestoreWindow = useCallback((windowId) => {
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      w.hidden = false;
      // Ensure it's in its column order list
      const col = w.column ?? "middle";
      d.layout.columns[col] ??= { id: col, order: [] };
      const order = d.layout.columns[col].order;
      if (!order.includes(windowId)) order.push(windowId);
    });
  }, [mutateDb]);

  const onMoveWindow = useCallback((windowId, targetColumn) => {
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      const from = w.column ?? "middle";
      if (from === targetColumn) return;

      // remove from old column
      const fromOrder = d.layout.columns?.[from]?.order ?? [];
      d.layout.columns[from].order = fromOrder.filter((id) => id !== windowId);

      // add to new
      d.layout.columns[targetColumn] ??= { id: targetColumn, order: [] };
      if (!d.layout.columns[targetColumn].order.includes(windowId)) {
        d.layout.columns[targetColumn].order.push(windowId);
      }

      w.column = targetColumn;
      // Span is only supported from the LEFT column (left+middle).
      if ((w.span ?? 1) > 1 && targetColumn !== "left") {
        w.span = 1;
      }
    });
  }, [mutateDb]);

  const onToggleSpan = useCallback((windowId) => {
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;

      const cur = w.span ?? 1;
      if (cur > 1) {
        w.span = 1;
        return;
      }

      // Only allow spanning from the LEFT column (left + middle).
      const col = w.column ?? "middle";
      if (col !== "left") return;

      w.span = 2;

      // Give wide windows a bit more vertical room if they're still tiny.
      if ((w.h ?? 0.35) < 0.5) w.h = 0.6;
    });
  }, [mutateDb]);


  const onResizeWindow = useCallback((windowId, nextH) => {
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      w.h = Math.max(0.1, Math.min(0.9, nextH));
    });
  }, [mutateDb]);

  const onMinimizeWindow = useCallback((windowId) => {
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      w.minimized = !w.minimized;
    });
  }, [mutateDb]);

  const onHideWindow = useCallback((windowId) => {
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      w.hidden = true;
      // remove from column order
      const col = w.column ?? "middle";
      const order = d.layout.columns?.[col]?.order ?? [];
      d.layout.columns[col].order = order.filter((id) => id !== windowId);
    });
  }, [mutateDb]);

  const onPopoutWindow = useCallback((windowId) => {
    setPopupWinId(windowId);
    mutateDb((d) => {
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      w.popup = true;
    });
  }, [mutateDb]);

  const onClosePopup = useCallback(() => {
    const windowId = popupWinId;
    setPopupWinId(null);
    setModuleSettingsWinId(null);
    mutateDb((d) => {
      if (!windowId) return;
      const w = d.layout.windows?.[windowId];
      if (!w) return;
      w.popup = false;
    });
  }, [mutateDb, popupWinId]);

  // Build ctx per module/window
  const buildCtxForWindow = useCallback((win) => {
    const def = getModuleDef(win.moduleId);

    if (!def) {
      // Unknown module in layout (stale localStorage). Return a safe ctx.
      return {
        store: { get: () => ({}), set: () => {}, patch: () => {} },
        eventBus,
        sharedState,
        window: { id: win.id, moduleId: win.moduleId },
        actions: windowActions,
      };
    }

    const windowActions = {
      hide: () => onHideWindow(win.id),
      minimize: () => onMinimizeWindow(win.id),
      popout: () => onPopoutWindow(win.id),
      close: () => onHideWindow(win.id),
    };

    return {
      store: {
        // ✅ Generic backend-backed store for ALL modules
        get: (defaultValue) => {
          const moduleId = def.id;

          // If cached (from server or local seed), return it
          const cached = getCachedModule(moduleId);
          if (cached != null) return cached;

          // Seed from local DB (fast UI)
          const fresh = loadDb();
          const localVal = fresh.modules?.[moduleId];

          if (localVal != null) {
            setCachedModule(moduleId, localVal);
          } else {
            const dv =
              typeof defaultValue === "function"
                ? defaultValue()
                : (defaultValue ?? { version: 1 });

            mutateDb((d) => { d.modules[moduleId] = dv; });
            setCachedModule(moduleId, dv);
          }

          // Hydrate once from server, then update cache + local DB
          if (!hasHydrated(moduleId)) {
            hydrateModuleFromServer(moduleId)
              .then((serverVal) => {
                const isServerEmpty =
                  !serverVal ||
                  (typeof serverVal === "object" && Object.keys(serverVal).length === 0);

                const currentLocal = loadDb().modules?.[moduleId];
                const isLocalEmpty =
                  currentLocal == null ||
                  (typeof currentLocal === "object" && Object.keys(currentLocal).length === 0);

                // Prefer server if it has data, or local is empty
                const shouldUseServer = (!isServerEmpty) || isLocalEmpty;

                if (shouldUseServer) {
                  setCachedModule(moduleId, serverVal);
                  mutateDb((d) => { d.modules[moduleId] = serverVal; });
                }
              })
              .catch(() => {
                // backend down? keep local seed
              });
          }

          return getCachedModule(moduleId);
        },

        set: (value) => {
          const moduleId = def.id;

          // local immediate
          mutateDb((d) => { d.modules[moduleId] = value; });
          setCachedModule(moduleId, value);

          // async push
          saveModuleToServer(moduleId, value).catch(() => {});
        },

        patch: (partial) => {
          const moduleId = def.id;

          const fresh = loadDb();
          const cur = fresh.modules?.[moduleId] ?? { version: 1 };
          const next = { ...cur, ...partial };

          mutateDb((d) => { d.modules[moduleId] = next; });
          setCachedModule(moduleId, next);

          // async push
          saveModuleToServer(moduleId, next).catch(() => {});
        },
      },

      eventBus,
      sharedState,
      window: { id: win.id, moduleId: def.id },
      actions: windowActions,
    };
  }, [eventBus, sharedState, getModuleDef, mutateDb, onHideWindow, onMinimizeWindow, onPopoutWindow]);

  // Settings actions
  const onSetTheme = useCallback((themeId) => {
    mutateDb((d) => {
      d.theme = { id: themeId };
    });
  }, [mutateDb]);

  const onToggleModule = useCallback((moduleId) => {
    mutateDb((d) => {
      d.layout.moduleVisibility[moduleId] = !d.layout.moduleVisibility[moduleId];
      // Disabling hides windows (preserve layout)
      if (d.layout.moduleVisibility[moduleId] === false) {
        for (const w of Object.values(d.layout.windows ?? {})) {
          if (w.moduleId === moduleId) {
            w.hidden = true;
            const col = w.column ?? "middle";
            d.layout.columns[col].order = (d.layout.columns[col].order ?? []).filter((id) => id !== w.id);
          }
        }
      }
    });
  }, [mutateDb]);

  const onEnsureWindow = useCallback((moduleId) => {
    mutateDb((d) => ensureWindowForModule(d, moduleId));
  }, [mutateDb]);

  const onResetLayoutOnly = useCallback(() => {
    mutateDb((d) => {
      // Preserve modules data and theme; reset layout only.
      const keepTheme = d.theme;
      const keepModules = d.modules;
      d.layout = createDefaultLayout();
      d.theme = keepTheme;
      d.modules = keepModules;

      // Re-apply boot logic to create starter windows and visibility.
      const booted = bootstrapDb(d, moduleList);
      d.layout = booted.layout;
      d.theme = booted.theme;
      d.modules = booted.modules;
    });
  }, [mutateDb, moduleList]);

  const onFactoryReset = useCallback(() => {
    localStorage.removeItem(DB_KEY);
    setTick((t) => t + 1);
  }, []);

  // Popup derived
  const popupWin = popupWinId ? windowsById[popupWinId] : null;
  const popupDef = popupWin ? getModuleDef(popupWin.moduleId) : null;
  const popupCtx = popupWin ? buildCtxForWindow(popupWin) : null;

  const moduleSettingsOpen = !!moduleSettingsWinId;

  return (
    <ErrorBoundary>
      <div className="h-full w-full">
        <SystemBar
          title="Family Home Dashboard"
          hiddenWindows={hiddenWindows}
          modulesById={modulesById}
          onRestoreWindow={onRestoreWindow}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <DesktopSurface
          layout={db.layout}
          windowsById={windowsById}
          getModuleDef={getModuleDef}
          buildCtxForWindow={buildCtxForWindow}
          onMoveWindow={onMoveWindow}
          onResizeWindow={onResizeWindow}
          onMinimizeWindow={onMinimizeWindow}
          onHideWindow={onHideWindow}
          onPopoutWindow={onPopoutWindow}
          onToggleSpan={onToggleSpan}
          onOpenSettings={setModuleSettingsWinId}
        />

        {popupWin && popupDef && popupCtx && (
          <PopupOverlay
            win={popupWin}
            moduleDef={popupDef}
            ctx={popupCtx}
            onClose={onClosePopup}
            onOpenModuleSettings={() => setModuleSettingsWinId(popupWin.id)}
          />
        )}

        {settingsOpen && (
          <GlobalSettings
            onClose={() => setSettingsOpen(false)}
            themeId={db.theme?.id}
            onSetTheme={onSetTheme}
            moduleList={moduleList}
            moduleVisibility={moduleVisibility}
            onToggleModule={onToggleModule}
            onEnsureWindow={onEnsureWindow}
            failedModules={failedModules}
            onResetLayoutOnly={onResetLayoutOnly}
            onFactoryReset={onFactoryReset}
          />
        )}

        {moduleSettingsOpen && moduleSettingsWinId && windowsById[moduleSettingsWinId] && (() => {
          const win = windowsById[moduleSettingsWinId];
          const def = getModuleDef(win.moduleId);
          const ctx = buildCtxForWindow(win);
          if (!def?.SettingsComponent || !ctx) return null;
          return (
            <div className="fixed inset-0 z-[60] p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
              <div className="h-full w-full glass rounded-[2rem] overflow-hidden flex flex-col">
                <div className="h-16 px-4 flex items-center justify-between">
                  <div className="font-semibold">{def.title} Settings</div>
                  <button className="iconBtn" onClick={() => setModuleSettingsWinId(null)} aria-label="Close Module Settings">
                    ✕
                  </button>
                </div>
                <div className="flex-1 p-4 overflow-auto">
                  <def.SettingsComponent ctx={ctx} />
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </ErrorBoundary>
  );
}

function bootstrapDb(db, moduleList) {
  // Required boot sequence (v1.3)
  db.layout ??= createDefaultLayout();
  db.layout.columns ??= createDefaultLayout().columns;
  db.layout.windows ??= {};
  db.layout.moduleVisibility ??= {};
  db.modules ??= {};

  pruneMissingModuleWindows(db, moduleList);

  // ---- Window schema migration (v1.4) ----
  // Ensure newly introduced fields exist without clobbering user choices.
  const calWin = Object.values(db.layout.windows).find((w) => w?.moduleId === "calendar");
  if (calWin && calWin.span == null) {
    calWin.span = 2;
    // If the calendar is still at the old default height, give it more room by default.
    if ((calWin.h ?? 0.35) <= 0.36) calWin.h = 0.7;
  }
  for (const w of Object.values(db.layout.windows)) {
    if (w.span == null) w.span = 1;
  }

  // Ensure visibility + modules keys exist for discovered modules (default OFF)
  for (const m of moduleList) {
    if (db.layout.moduleVisibility[m.id] === undefined) db.layout.moduleVisibility[m.id] = false;
    if (db.modules[m.id] == null) db.modules[m.id] = (typeof m.defaultData === "function" ? m.defaultData() : { version: 1 });
  }

  // Never-blank rule
  if (!hasAnyEnabled(db) && !hasAnyWindows(db)) {
    for (const id of STARTER_ENABLED) db.layout.moduleVisibility[id] = true;
  }

  // Ensure windows exist for enabled modules
  const enabledIds = Object.entries(db.layout.moduleVisibility).filter(([, v]) => v).map(([id]) => id);
  for (const moduleId of enabledIds) ensureWindowForModule(db, moduleId);

  return db;
}

function ensureWindowForModule(db, moduleId) {
  const existing = Object.values(db.layout.windows ?? {}).find((w) => w.moduleId === moduleId);
  if (existing) {
    // If it exists but is hidden and enabled, restore its order presence (do not force visible)
    return;
  }

  const win = createWindowForModule(moduleId);
  db.layout.windows[win.id] = win;
  db.layout.columns[win.column] ??= { id: win.column, order: [] };
  db.layout.columns[win.column].order.push(win.id);
}
