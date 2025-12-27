import React, { useMemo, useState, useEffect } from "react";
import { defaultPhotosData, migratePhotosData, DEMO_SETS, isLikelyImagePath } from "./helpers.js";

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

function normalizeFolderUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  let resolved = raw;
  try {
    resolved = new URL(raw, window.location.origin).toString();
  } catch {
    // keep as-is
  }

  // If it's a manifest file (json), do NOT force trailing slash
  if (/\.(json)(\?|#|$)/i.test(resolved)) return resolved;

  // Otherwise treat as folder URL
  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

async function fetchImagesFromFolderUrl(folderUrl) {
  const url = normalizeFolderUrl(folderUrl);
  if (!url) return { urls: [], error: "Folder URL is empty." };

  const bust = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${bust}_ts=${Date.now()}`, { cache: "no-store" });

  if (!res.ok) return { urls: [], error: `Failed to load folder (${res.status}).` };

  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // JSON manifest support
  // Accept:
  //  - ["url1","url2"]
  //  - { images: ["url1", ...] }
  if (ct.includes("application/json")) {
    try {
      const j = await res.json();
      const arr = Array.isArray(j) ? j : Array.isArray(j?.images) ? j.images : [];
      const urls = arr
        .map((x) => String(x || ""))
        .filter(Boolean)
        .filter(isLikelyImagePath)
        .map((p) => new URL(p, url).toString());
      return { urls: Array.from(new Set(urls)), error: "" };
    } catch (e) {
      return { urls: [], error: `JSON parse error: ${String(e?.message || e)}` };
    }
  }

  // HTML directory listing parsing
  const html = await res.text();
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(doc.querySelectorAll("a"))
      .map((a) => a.getAttribute("href"))
      .filter(Boolean);

    const urls = links
      .map((href) => String(href))
      .filter((href) => !href.endsWith("/")) // skip subfolders
      .filter(isLikelyImagePath)
      .map((href) => new URL(href, url).toString());

    return { urls: Array.from(new Set(urls)), error: "" };
  } catch (e) {
    return { urls: [], error: `Unable to parse folder listing: ${String(e?.message || e)}` };
  }
}

export default function PhotosSettings({ ctx }) {
  const raw = storeGet(ctx, defaultPhotosData());
  const data = useMemo(() => migratePhotosData(raw), [raw]);
  const s = data.settings;

  const [busy, setBusy] = useState(false);
  const [folderTestResult, setFolderTestResult] = useState("");
  const [localFolderPath, setLocalFolderPath] = useState(s.localFolderPath || "");
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [pickerCurrentPath, setPickerCurrentPath] = useState("");
  const [pickerFolders, setPickerFolders] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");

  // Sync localFolderPath state with settings when source changes
  useEffect(() => {
    setLocalFolderPath(s.localFolderPath || "");
  }, [s.source, s.localFolderPath]);

  function saveSettings(patch) {
    storeSet(ctx, {
      ...data,
      settings: { ...(data.settings || {}), ...(patch || {}) },
    });
  }

  function setUploadedItems(items) {
    storeSet(ctx, { ...data, uploaded: { items } });
  }

  function setFolderCache(cachePatch) {
    storeSet(ctx, {
      ...data,
      folderCache: { ...(data.folderCache || {}), ...(cachePatch || {}) },
    });
  }

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setBusy(true);
    try {
      const reads = files.map((f) =>
        fileToDataUrl(f).then((dataUrl) => ({
          id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          name: f.name,
          type: f.type || "image/*",
          dataUrl,
          addedAt: new Date().toISOString(),
        }))
      );

      const items = await Promise.all(reads);
      setUploadedItems([...(data.uploaded.items || []), ...items]);
      saveSettings({ source: "uploaded" });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function onLoadFolderNow() {
    const url = String(s.folderUrl || "").trim();
    if (!url) {
      setFolderTestResult("Enter a Folder URL first.");
      return;
    }

    setBusy(true);
    setFolderTestResult("");
    try {
      const out = await fetchImagesFromFolderUrl(url);
      setFolderCache({
        urls: out.urls,
        fetchedAt: new Date().toISOString(),
        lastError: out.error || "",
      });

      if (out.error) {
        setFolderTestResult(out.error);
      } else {
        setFolderTestResult(`Loaded ${out.urls.length} images.`);
        saveSettings({ source: "folder" });
      }
    } catch (e) {
      const msg = String(e?.message || e);
      setFolderCache({ lastError: msg, fetchedAt: new Date().toISOString() });
      setFolderTestResult(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onLoadLocalNow() {
    const localPath = localFolderPath.trim();
    if (!localPath) {
      setFolderTestResult("Enter a local folder path first.");
      return;
    }

    console.log("[photos/settings] Loading local folder:", localPath);
    setBusy(true);
    setFolderTestResult("");
    try {
      const response = await fetch("/api/v1/photos/local/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath }),
      });

      if (!response.ok) {
        let errorMsg;
        try {
          const errorData = await response.json();
          errorMsg = errorData?.error || `Request failed (${response.status})`;
        } catch {
          errorMsg = `Failed to load folder (${response.status}): ${response.statusText || "Unknown error"}`;
        }
        console.error("[photos/settings] Load error:", errorMsg);
        setFolderCache({ lastError: errorMsg, fetchedAt: new Date().toISOString() });
        setFolderTestResult(`Error: ${errorMsg}`);
        return;
      }

      const responseData = await response.json();
      const urls = Array.isArray(responseData?.images) ? responseData.images : [];

      console.log("[photos/settings] Loaded", urls.length, "images from", localPath, "- first 3:", urls.slice(0, 3));

      // Save both folderCache AND settings in ONE storeSet call
      storeSet(ctx, {
        ...data,
        settings: {
          ...data.settings,
          source: "local",
          localFolderPath: localPath,
          folderUrl: "", // Clear folderUrl when using local source
        },
        folderCache: {
          urls,
          fetchedAt: new Date().toISOString(),
          lastError: "",
        },
      });

      console.log("[photos/settings] Saved state - source: local, urls.length:", urls.length);
      setFolderTestResult(`Loaded ${urls.length} images.`);
    } catch (e) {
      const msg = String(e?.message || e);
      console.error("[photos/settings] Exception:", msg);
      setFolderCache({ lastError: msg, fetchedAt: new Date().toISOString() });
      setFolderTestResult(`Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadFolderContents(path) {
    setPickerLoading(true);
    setPickerError("");
    try {
      const response = await fetch(`/api/v1/photos/local/folders?path=${encodeURIComponent(path)}`);

      if (!response.ok) {
        let errorMsg;
        try {
          const errorData = await response.json();
          errorMsg = errorData?.error || `Request failed (${response.status})`;
        } catch {
          errorMsg = `Failed to load folders (${response.status}): ${response.statusText || "Unknown error"}`;
        }
        setPickerError(errorMsg);
        setPickerFolders([]);
        return;
      }

      const json = await response.json();
      setPickerFolders(json.folders || []);
      setPickerCurrentPath(path);
    } catch (e) {
      setPickerError(String(e?.message || e));
      setPickerFolders([]);
    } finally {
      setPickerLoading(false);
    }
  }

  function openFolderPicker() {
    setShowFolderPicker(true);
    setPickerCurrentPath("");
    setPickerFolders([]);
    setPickerError("");
  }

  function selectFolder() {
    if (pickerCurrentPath) {
      setLocalFolderPath(pickerCurrentPath);
      saveSettings({ localFolderPath: pickerCurrentPath });
    }
    setShowFolderPicker(false);
  }

  const demoNames = Object.keys(DEMO_SETS);
  const folderCount = data.folderCache?.urls?.length || 0;

  return (
    <div className="p-4 space-y-4">
      <div className="text-lg font-semibold">Photos Screensaver</div>

      <div className="rounded-2xl bg-white/5 border border-white/15 p-4 space-y-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!s.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} />
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
          <input type="checkbox" checked={!!s.shuffle} onChange={(e) => saveSettings({ shuffle: e.target.checked })} />
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
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-white [&>option]:bg-gray-900 [&>option]:text-white"
            >
              <option value="demo">Demo</option>
              <option value="uploaded">Uploaded</option>
              <option value="folder">Folder URL (NAS / network share via HTTP)</option>
              <option value="local">Local folder (on the Pi)</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Demo set</div>
            <select
              value={s.demoSet}
              onChange={(e) => saveSettings({ demoSet: e.target.value })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-white [&>option]:bg-gray-900 [&>option]:text-white"
              disabled={s.source !== "demo"}
            >
              {demoNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {s.source === "local" ? (
          <div className="mt-3 space-y-2">
            <div className="text-xs opacity-70">Local folder path</div>
            <div className="flex gap-2">
              <input
                value={localFolderPath}
                onChange={(e) => setLocalFolderPath(e.target.value)}
                onBlur={(e) => saveSettings({ localFolderPath: e.target.value })}
                placeholder="/opt/family-dashboard-data/photos/memories-1"
                className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 font-mono text-sm text-white"
              />
              <button className="btn" onClick={openFolderPicker} type="button" disabled={busy}>
                Browse…
              </button>
            </div>

            <div className="text-[11px] opacity-70 leading-relaxed">
              This is the full path to a folder on the Pi's filesystem. The backend service will scan it for images.
              <br />
              Allowed directories: /home/masri/Pictures, /opt/family-dashboard-data/photos
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btnPrimary" onClick={onLoadLocalNow} type="button" disabled={busy}>
                Test & Load
              </button>
            </div>

            {folderTestResult ? <div className="text-sm opacity-90">{folderTestResult}</div> : null}

            {data.folderCache?.lastError ? (
              <div className="text-sm text-red-200/90 bg-red-500/10 rounded-lg px-3 py-2 break-words">
                {data.folderCache.lastError}
              </div>
            ) : null}
          </div>
        ) : null}

        {s.source === "folder" ? (
          <div className="mt-3 space-y-2">
            <div className="text-xs opacity-70">Folder URL</div>
            <input
              value={s.folderUrl}
              onChange={(e) => saveSettings({ folderUrl: e.target.value })}
              placeholder="/photos/memories-1/   (or /photos/memories-1/manifest.json)"
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
            />

            <div className="text-[11px] opacity-70 leading-relaxed">
              SMB paths like <span className="opacity-90">\\192.168.50.199\shared\photos</span> can’t be read by the browser.
              Mount that share on the Pi and expose it over HTTP (nginx alias), then point this field at that HTTP folder.
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btnPrimary" onClick={onLoadFolderNow} type="button" disabled={busy}>
                Test & Load
              </button>

              <button
                className="btn"
                onClick={() => setFolderCache({ urls: [], fetchedAt: null, lastError: "" })}
                type="button"
                disabled={busy || !folderCount}
                title="Clear cached folder list"
              >
                Clear folder cache ({folderCount})
              </button>

              <div className="text-xs opacity-70">
                {data.folderCache?.fetchedAt ? `Last loaded: ${new Date(data.folderCache.fetchedAt).toLocaleString()}` : "Not loaded yet"}
              </div>
            </div>

            {folderTestResult ? <div className="text-sm opacity-90">{folderTestResult}</div> : null}
            {data.folderCache?.lastError ? (
              <div className="text-[11px] text-red-200/80 break-words">{data.folderCache.lastError}</div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <div className="text-xs opacity-70">Auto-refresh folder list</div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={Number(s.folderAutoRefreshMinutes || 0)}
                  onChange={(e) => saveSettings({ folderAutoRefreshMinutes: Number(e.target.value || 0) })}
                  className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
                />
                <div className="text-[11px] opacity-60">Minutes (0 = never)</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="pt-2 border-t border-white/10" />

        <div className="space-y-2">
          <div className="text-xs opacity-70">Upload family photos</div>
          <input type="file" accept="image/*" multiple onChange={onPickFiles} disabled={busy} className="block w-full text-sm" />

          <div className="text-[11px] opacity-60">Uploaded photos are stored inside the dashboard database so they work offline and after refresh.</div>

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

            <button className="btn btnPrimary" onClick={() => saveSettings({ source: data.uploaded.items.length ? "uploaded" : "demo" })} type="button">
              Use uploaded
            </button>
          </div>
        </div>
      </div>

      {/* Display / playback options */}
      <div className="rounded-2xl bg-white/5 border border-white/15 p-4 space-y-3">
        <div className="text-sm font-semibold">Playback & Display</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Crossfade (ms)</div>
            <input
              type="number"
              min={0}
              step={50}
              value={Number(s.fadeMs || 0)}
              onChange={(e) => saveSettings({ fadeMs: Number(e.target.value || 0) })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Fit</div>
            <select
              value={s.fit}
              onChange={(e) => saveSettings({ fit: e.target.value })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-white [&>option]:bg-gray-900 [&>option]:text-white"
            >
              <option value="cover">Cover (fill screen, crops)</option>
              <option value="contain">Contain (no crop, bars)</option>
              <option value="auto">Auto (cover or contain per image)</option>
              <option value="scale-down">Scale-down (no crop, no upscale)</option>
            </select>
            <div className="text-[11px] opacity-60">Auto will “zoom out” portrait/pano shots that would otherwise be cropped.</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">When image doesn’t fill screen</div>
            <select
              value={s.backgroundMode || "none"}
              onChange={(e) => saveSettings({ backgroundMode: e.target.value })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-white [&>option]:bg-gray-900 [&>option]:text-white"
            >
              <option value="none">Black bars</option>
              <option value="blur">Blurred background fill (recommended)</option>
            </select>
            <div className="text-[11px] opacity-60">Blurred background makes the screen look “full” without cropping the main image.</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Background blur (px)</div>
            <input
              type="number"
              min={0}
              max={60}
              step={1}
              value={Number(s.backgroundBlurPx ?? 28)}
              onChange={(e) => saveSettings({ backgroundBlurPx: Number(e.target.value || 0) })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
              disabled={(s.backgroundMode || "none") !== "blur"}
            />
            <div className="text-[11px] opacity-60">Higher = softer background (only when blurred background is enabled).</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Background opacity</div>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={Number(s.backgroundOpacity ?? 0.55)}
              onChange={(e) => saveSettings({ backgroundOpacity: Number(e.target.value || 0) })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
              disabled={(s.backgroundMode || "none") !== "blur"}
            />
            <div className="text-[11px] opacity-60">0 = hidden, 1 = fully visible (only when blurred background is enabled).</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Dim overlay</div>
            <input
              type="number"
              min={0}
              max={0.85}
              step={0.05}
              value={Number(s.dim || 0)}
              onChange={(e) => saveSettings({ dim: Number(e.target.value || 0) })}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2"
            />
            <div className="text-[11px] opacity-60">0 = none • 0.2 is nice • max 0.85</div>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!s.showClock} onChange={(e) => saveSettings({ showClock: e.target.checked })} />
            Show clock
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!s.showCounter} onChange={(e) => saveSettings({ showCounter: e.target.checked })} />
            Show counter
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!s.showTitle} onChange={(e) => saveSettings({ showTitle: e.target.checked })} />
            Show title
          </label>
        </div>
      </div>

      {/* Folder Picker Modal */}
      {showFolderPicker && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowFolderPicker(false)}>
          <div
            className="bg-gray-900 border border-white/15 rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Browse Folders on Pi</h3>
              <button className="text-white/60 hover:text-white" onClick={() => setShowFolderPicker(false)}>
                ✕
              </button>
            </div>

            {/* Breadcrumb */}
            {pickerCurrentPath && (
              <div className="mb-3 text-sm font-mono opacity-80 bg-white/5 rounded-lg px-3 py-2">Current: {pickerCurrentPath}</div>
            )}

            {/* Root folders or current folder contents */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {!pickerCurrentPath ? (
                <>
                  <div className="text-sm opacity-70 mb-2">Select a root directory:</div>
                  <button
                    className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 transition-colors"
                    onClick={() => loadFolderContents("/home/masri/Pictures")}
                  >
                    📁 /home/masri/Pictures
                  </button>
                  <button
                    className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 transition-colors"
                    onClick={() => loadFolderContents("/opt/family-dashboard-data/photos")}
                  >
                    📁 /opt/family-dashboard-data/photos
                  </button>
                </>
              ) : (
                <>
                  {/* Back button */}
                  {pickerCurrentPath !== "/home/masri/Pictures" && pickerCurrentPath !== "/opt/family-dashboard-data/photos" && (
                    <button
                      className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 transition-colors"
                      onClick={() => {
                        const parentPath = pickerCurrentPath.split("/").slice(0, -1).join("/") || "/";
                        loadFolderContents(parentPath);
                      }}
                    >
                      ⬆️ .. (Go up)
                    </button>
                  )}

                  {/* Subfolders */}
                  {pickerLoading ? (
                    <div className="text-center py-8 opacity-60">Loading folders...</div>
                  ) : pickerError ? (
                    <div className="text-red-200/90 bg-red-500/10 rounded-lg px-4 py-3">{pickerError}</div>
                  ) : pickerFolders.length === 0 ? (
                    <div className="text-center py-8 opacity-60">No subfolders found</div>
                  ) : (
                    pickerFolders.map((folder) => (
                      <button
                        key={folder.path}
                        className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 transition-colors"
                        onClick={() => loadFolderContents(folder.path)}
                      >
                        📁 {folder.name}
                      </button>
                    ))
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-3 border-t border-white/15">
              <button className="btn" onClick={() => setShowFolderPicker(false)}>
                Cancel
              </button>
              {pickerCurrentPath && (
                <button className="btn btnPrimary" onClick={selectFolder}>
                  Select this folder
                </button>
              )}
            </div>
          </div>
        </div>
      )}
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
