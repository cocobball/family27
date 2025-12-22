import React, { useMemo, useState } from "react";
import { defaultPhotosData, migratePhotosData, DEMO_SETS } from "./helpers.js";

// --- ctx compatibility ---
function storeGet(ctx, fallback) {
  const s = ctx.store;
  if (s?.getModuleData) return s.getModuleData(ctx.moduleId, fallback);
  if (s?.get) return s.get(fallback);
  return fallback;
}
function storeSet(ctx, nextData) {
  const s = ctx.store;
  if (s?.setModuleData) return s.setModuleData(ctx.moduleId, nextData);
  if (s?.set) return s.set(nextData);
}

export default function PhotosSettings({ ctx }) {
  const raw = storeGet(ctx, defaultPhotosData());
  const data = useMemo(() => migratePhotosData(raw), [raw]);
  const s = data.settings;

  const [busy, setBusy] = useState(false);

  function saveSettings(patch) {
    storeSet(ctx, {
      ...data,
      settings: { ...(data.settings || {}), ...(patch || {}) },
    });
  }

  function setUploadedItems(items) {
    storeSet(ctx, { ...data, uploaded: { items } });
  }

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setBusy(true);
    try {
      const reads = files.map((f) => fileToDataUrl(f).then((dataUrl) => ({
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: f.name,
        type: f.type || "image/*",
        dataUrl,
        addedAt: new Date().toISOString(),
      })));

      const items = await Promise.all(reads);
      setUploadedItems([...(data.uploaded.items || []), ...items]);
      saveSettings({ source: "uploaded" });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  const demoNames = Object.keys(DEMO_SETS);

  return (
    <div className="p-4 space-y-4">
      <div className="text-lg font-semibold">Photos Screensaver</div>

      <div className="rounded-2xl bg-white/5 border border-white/15 p-4 space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!s.enabled}
            onChange={(e) => saveSettings({ enabled: e.target.checked })}
          />
          Enable screensaver
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Start after inactivity</div>
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={Number(s.idleMinutes)}
              onChange={(e) => saveSettings({ idleMinutes: Number(e.target.value || 5) })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
            />
            <div className="text-[11px] opacity-60">Minutes (0.25 = 15 seconds)</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Seconds per photo</div>
            <input
              type="number"
              min={3}
              step={1}
              value={Number(s.slideSeconds)}
              onChange={(e) => saveSettings({ slideSeconds: Number(e.target.value || 12) })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
            />
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!s.shuffle}
            onChange={(e) => saveSettings({ shuffle: e.target.checked })}
          />
          Shuffle photos
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!s.touchToEnable}
            onChange={(e) => saveSettings({ touchToEnable: e.target.checked })}
          />
          Show “touch to enable” button on module card
        </label>
      </div>

      <div className="rounded-2xl bg-white/5 border border-white/15 p-4 space-y-3">
        <div className="text-sm font-semibold">Photo source</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Source</div>
            <select
              value={s.source}
              onChange={(e) => saveSettings({ source: e.target.value })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
            >
              <option value="demo">Demo</option>
              <option value="uploaded">Uploaded</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Demo set</div>
            <select
              value={s.demoSet}
              onChange={(e) => saveSettings({ demoSet: e.target.value })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
              disabled={s.source !== "demo"}
            >
              {demoNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-2 border-t border-white/10" />

        <div className="space-y-2">
          <div className="text-xs opacity-70">Upload family photos</div>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            disabled={busy}
            className="block w-full text-sm"
          />

          <div className="text-[11px] opacity-60">
            Uploaded photos are stored inside the dashboard database so they work offline and after refresh.
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn"
              onClick={() => setUploadedItems([])}
              type="button"
              disabled={!data.uploaded.items.length}
              title="Remove uploaded photos from the dashboard database"
            >
              Clear uploaded ({data.uploaded.items.length})
            </button>

            <button
              className="btn btnPrimary"
              onClick={() => saveSettings({ source: data.uploaded.items.length ? "uploaded" : "demo" })}
              type="button"
            >
              Use uploaded
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
