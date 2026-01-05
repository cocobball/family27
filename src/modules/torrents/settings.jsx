import { useEffect, useMemo, useState } from "react";
import { defaultData, migrateIfNeeded } from "./helpers.js";

export default function TorrentsSettings({ ctx }) {
  const { store } = ctx;
  const [db, setDb] = useState(() => migrateIfNeeded(store.get(() => defaultData)));
  const settings = db.settings || defaultData.settings;

  useEffect(() => {
    // keep local in sync with store (on first hydrate)
    setDb(migrateIfNeeded(store.get(() => defaultData)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savepaths = Array.isArray(settings.savepaths) ? settings.savepaths : [];

  const [newLabel, setNewLabel] = useState("");
  const [newPath, setNewPath] = useState("");

  const persist = (patch) => {
    setDb((prev) => {
      const next = migrateIfNeeded({ ...prev, ...patch });
      store.set(next);
      return next;
    });
  };

  const updateSettings = (partial) => {
    persist({ settings: { ...settings, ...partial } });
  };

  const canAdd = useMemo(() => {
    const l = newLabel.trim();
    if (!l) return false;
    if (savepaths.some((s) => (s.label || "").toLowerCase() === l.toLowerCase())) return false;
    return true;
  }, [newLabel, savepaths]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold mb-3">Search Defaults</div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs opacity-80">Result limit</label>
          <input
            className="w-24 rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm"
            type="number"
            min={10}
            max={200}
            value={settings.resultLimit ?? 50}
            onChange={(e) => updateSettings({ resultLimit: Math.max(10, Math.min(200, Number(e.target.value) || 50)) })}
          />

          <div className="flex items-center gap-2 ml-4">
            <label className="text-xs opacity-80">Default save path</label>
            <select
              className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm"
              value={settings.defaultSavepathLabel || "Default"}
              onChange={(e) => updateSettings({ defaultSavepathLabel: e.target.value })}
            >
              {savepaths.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}{s.path ? ` — ${s.path}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold mb-3">Save Path Presets</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <input
            className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm"
            placeholder="Label (e.g., Movies)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <input
            className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm"
            placeholder='Path (optional, e.g., /mnt/media/movies). Empty = qB default'
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
        </div>

        <button
          className={"px-4 py-2 rounded-xl text-sm border transition " + (canAdd ? "bg-white/10 border-white/15 hover:bg-white/15" : "bg-white/5 border-white/10 opacity-50 cursor-not-allowed")}
          disabled={!canAdd}
          onClick={() => {
            const label = newLabel.trim();
            const path = newPath.trim();
            const next = [...savepaths, { label, path }];
            updateSettings({ savepaths: next });
            setNewLabel("");
            setNewPath("");
          }}
        >
          Add preset
        </button>

        <div className="mt-4 space-y-2">
          {savepaths.map((s) => (
            <div key={s.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{s.label}</div>
                <div className="text-xs opacity-70 truncate">{s.path || "(qB default save path)"}</div>
              </div>

              <button
                className="ml-3 px-3 py-1.5 rounded-xl text-xs border border-white/10 bg-white/5 hover:bg-white/10"
                onClick={() => {
                  const next = savepaths.filter((x) => x.label !== s.label);
                  const nextDefault =
                    settings.defaultSavepathLabel === s.label
                      ? (next[0]?.label || "Default")
                      : settings.defaultSavepathLabel;

                  updateSettings({
                    savepaths: next.length ? next : [{ label: "Default", path: "" }],
                    defaultSavepathLabel: nextDefault,
                  });
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 text-xs opacity-70">
          Tip: Leave “Path” blank to use qBittorrent’s default save location.
        </div>
      </div>
    </div>
  );
}
