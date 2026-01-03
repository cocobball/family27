import React, { useMemo, useState } from "react";
import { Download, Upload, Trash2, LayoutDashboard, Palette, Bug, X } from "lucide-react";
import { exportZip, importZip } from "../core/exportImport.js";
import { themes, defaultThemeId } from "../core/themes.js";
import { readLogQueue, clearLogQueue } from "../core/logger.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function GlobalSettings({
  onClose,
  themeId,
  onSetTheme,
  moduleList,
  moduleVisibility,
  onToggleModule,
  onEnsureWindow,
  failedModules,
  onResetLayoutOnly,
  onFactoryReset,
  refreshIntervalSec,
  onSetRefreshInterval,
}) {
  const [tab, setTab] = useState("data");
  const [importErr, setImportErr] = useState("");

  const logs = useMemo(() => readLogQueue(), []);

  async function handleExport() {
    const blob = await exportZip();
    downloadBlob(blob, `family-dashboard-export-v1_${new Date().toISOString().slice(0,19).replaceAll(":","-")}.zip`);
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErr("");
    try {
      await importZip(file);
      location.reload();
    } catch (err) {
      setImportErr(String(err?.message ?? err));
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="h-full w-full glass rounded-[2rem] overflow-hidden flex flex-col">
        <div className="h-16 px-4 flex items-center justify-between">
          <div className="font-semibold">Global Settings</div>
          <button className="iconBtn" onClick={onClose} aria-label="Close Settings">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex gap-2">
            <button className={"btn " + (tab === "data" ? "btnPrimary" : "")} onClick={() => setTab("data")}>
              <LayoutDashboard size={16} /> Data
            </button>
            <button className={"btn " + (tab === "themes" ? "btnPrimary" : "")} onClick={() => setTab("themes")}>
              <Palette size={16} /> Themes
            </button>
            <button className={"btn " + (tab === "modules" ? "btnPrimary" : "")} onClick={() => setTab("modules")}>
              <Bug size={16} /> Modules
            </button>
            <button className={"btn " + (tab === "diag" ? "btnPrimary" : "")} onClick={() => setTab("diag")}>
              <Bug size={16} /> Diagnostics
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-hidden">
          <div className="h-full overflow-auto rounded-3xl p-4" style={{ background: "rgba(0,0,0,0.12)", border: "1px solid var(--border)" }}>
            {tab === "data" && (
              <div className="space-y-4">
                <div className="text-sm opacity-80">
                  Export/Import uses a ZIP package: <span className="opacity-90">manifest.json</span>, <span className="opacity-90">meta.json</span>, and <span className="opacity-90">assets/</span>.
                </div>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btnPrimary" onClick={handleExport}><Download size={16} /> Export ZIP</button>
                  <label className="btn cursor-pointer">
                    <Upload size={16} /> Import ZIP
                    <input className="hidden" type="file" accept=".zip" onChange={handleImport} />
                  </label>
                </div>

                {importErr && (
                  <div className="text-sm" style={{ color: "color-mix(in srgb, #ff5a7a 70%, white)" }}>
                    Import failed: {importErr}
                  </div>
                )}

                <div className="pt-2 border-t hairline" />

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Auto Refresh Interval</div>
                  <div className="flex flex-wrap gap-2">
                    {[0, 15, 30, 60, 120].map((sec) => (
                      <button
                        key={sec}
                        className={"btn " + ((refreshIntervalSec ?? 0) === sec ? "btnPrimary" : "")}
                        onClick={() => onSetRefreshInterval(sec)}
                      >
                        {sec === 0 ? "Off" : `${sec}s`}
                      </button>
                    ))}
                  </div>
                  <div className="text-xs opacity-70">
                    Automatically refresh all modules from server at this interval.
                  </div>
                </div>

                <div className="pt-2 border-t hairline" />

                <div className="flex flex-wrap gap-2">
                  <button className="btn" onClick={onResetLayoutOnly}><Trash2 size={16} /> Reset Layout Only</button>
                  <button className="btn" onClick={onFactoryReset}><Trash2 size={16} /> Factory Reset</button>
                </div>
                <div className="text-xs opacity-70">
                  Reset layout preserves modules data. Factory reset clears the unified dashboard DB.
                </div>
              </div>
            )}

            {tab === "themes" && (
              <div className="space-y-4">
                <div className="text-sm opacity-80">Theme applies instantly and persists in the unified DB.</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {themes.map((t) => (
                    <button
                      key={t.id}
                      className={"glass rounded-2xl p-3 text-left " + (t.id === (themeId ?? defaultThemeId) ? "ring-2" : "")}
                      style={{ ringColor: "var(--accent)" }}
                      onClick={() => onSetTheme(t.id)}
                    >
                      <div className="font-semibold">{t.name}</div>
                      <div className="flex gap-2 mt-2">
                        {t.swatches?.map((s) => (
                          <span key={s} className="inline-block w-6 h-6 rounded-xl" style={{ background: s, border: "1px solid var(--border)" }} />
                        ))}
                      </div>
                      <div className="text-xs opacity-70 mt-2">{t.id}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === "modules" && (
              <div className="space-y-4">
                <div className="text-sm opacity-80">
                  Drop-in discovery is automatic. New modules default OFF to avoid clutter. Enabling creates a window if missing.
                </div>

                {failedModules?.length ? (
                  <div className="glass rounded-2xl p-3">
                    <div className="font-semibold mb-2">Modules that failed to load</div>
                    <div className="space-y-2 text-sm">
                      {failedModules.map((f, idx) => (
                        <div key={idx} className="p-2 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)" }}>
                          <div className="font-semibold">{f.id}</div>
                          <div className="opacity-80">{f.reason}</div>
                          <div className="opacity-60 text-xs mt-1">{f.path}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {moduleList.map((m) => {
                    const enabled = !!moduleVisibility[m.id];
                    return (
                      <div key={m.id} className="glass rounded-2xl p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{m.title}</div>
                          <div className="text-xs opacity-70 truncate">{m.id}{m.dependencies?.length ? ` • deps: ${m.dependencies.join(", ")}` : ""}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className={"btn " + (enabled ? "btnPrimary" : "")} onClick={() => onToggleModule(m.id)}>
                            {enabled ? "Enabled" : "Disabled"}
                          </button>
                          {enabled && (
                            <button className="btn" onClick={() => onEnsureWindow(m.id)}>
                              Ensure Window
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "diag" && (
              <div className="space-y-4">
                <div className="text-sm opacity-80">
                  Diagnostics include module loader warnings/errors and a small local log queue.
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => { clearLogQueue(); location.reload(); }}>Clear Logs</button>
                </div>
                <div className="space-y-2">
                  {logs.length ? logs.slice().reverse().map((l, idx) => (
                    <div key={idx} className="p-2 rounded-xl text-sm"
                         style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)" }}>
                      <div className="font-semibold">{l.level.toUpperCase()} <span className="opacity-60 font-normal">{l.at}</span></div>
                      <div className="opacity-90">{l.message}</div>
                      {l.extra ? <pre className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{JSON.stringify(l.extra, null, 2)}</pre> : null}
                    </div>
                  )) : <div className="text-sm opacity-70">No logs yet.</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="h-14 px-4 flex items-center justify-between border-t hairline">
          <div className="text-xs opacity-70">v1.3 spec • localStorage: family_dashboard_db_v1</div>
          <div className="text-xs opacity-70">Touch-first • Pi-friendly</div>
        </div>
      </div>
    </div>
  );
}
