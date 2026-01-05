import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, Download, Pause, Play, Trash2, AlertTriangle } from "lucide-react";
import { defaultData, formatBytes, formatPct, formatSpeed, migrateIfNeeded, pickSavepath, safeText } from "./helpers.js";

function card() {
  return "rounded-2xl border border-white/10 bg-white/5 p-4";
}

function btn(kind = "default") {
  const base = "px-3 py-2 rounded-xl text-sm border transition flex items-center gap-2";
  if (kind === "primary") return base + " bg-white/10 border-white/15 hover:bg-white/15";
  if (kind === "danger") return base + " bg-red-500/10 border-red-500/25 hover:bg-red-500/15";
  return base + " bg-white/5 border-white/10 hover:bg-white/10";
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) throw new Error((json && json.error) ? json.error : `HTTP ${r.status}`);
  return json;
}

export default function TorrentsModule({ ctx }) {
  const { store } = ctx;

  const [db, setDb] = useState(() => migrateIfNeeded(store.get(() => defaultData)));
  const settings = db.settings || defaultData.settings;

  useEffect(() => {
    setDb(migrateIfNeeded(store.get(() => defaultData)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next) => {
    const migrated = migrateIfNeeded(next);
    setDb(migrated);
    store.set(migrated);
  };

  const patchSettings = (partial) => {
    persist({ ...db, settings: { ...settings, ...partial } });
  };

  // --- connectivity ---
  const [ping, setPing] = useState({ state: "idle", message: "" });

  const doPing = async () => {
    setPing({ state: "loading", message: "Checking qBittorrent…" });
    try {
      const out = await fetchJson("/api/v1/qbit/ping");
      setPing({ state: out.ok ? "ok" : "err", message: out.ok ? `Connected (qB ${out.version})` : "Not connected" });
    } catch (e) {
      setPing({ state: "err", message: e?.message || "Not connected" });
    }
  };

  useEffect(() => { doPing(); }, []);

  // --- search ---
  const [pattern, setPattern] = useState("");
  const [searchId, setSearchId] = useState("");
  const [searchState, setSearchState] = useState({ state: "idle", message: "" });
  const [results, setResults] = useState([]);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const fetchResults = async (id) => {
    const limit = settings.resultLimit ?? 50;
    const out = await fetchJson(`/api/v1/qbit/search/${encodeURIComponent(id)}/results?limit=${encodeURIComponent(limit)}&offset=0`);
    const list = Array.isArray(out.results) ? out.results : [];
    setResults(list);
    return out;
  };

  const fetchStatus = async (id) => {
    const out = await fetchJson(`/api/v1/qbit/search/status?id=${encodeURIComponent(id)}`);
    const arr = Array.isArray(out.status) ? out.status : [];
    const st = arr.find((x) => String(x.id) === String(id)) || arr[0] || null;
    return st;
  };

  const startSearch = async () => {
    const q = pattern.trim();
    if (!q) return;

    stopPolling();
    setResults([]);
    setSearchState({ state: "loading", message: "Starting search…" });

    try {
      const out = await fetchJson("/api/v1/qbit/search/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: q }),
      });

      const id = safeText(out.id);
      setSearchId(id);
      setSearchState({ state: "loading", message: `Searching… (id ${id})` });

      // First fetch soon, then poll
      await new Promise((r) => setTimeout(r, 500));
      await fetchResults(id).catch(() => {});

      pollRef.current = setInterval(async () => {
        try {
          const st = await fetchStatus(id).catch(() => null);
          await fetchResults(id).catch(() => {});

          const statusText = safeText(st?.status || "").toLowerCase();
          const total = st?.total != null ? ` • ${st.total} found` : "";
          if (!statusText) {
            setSearchState({ state: "loading", message: "Searching…" + total });
            return;
          }

          if (statusText.includes("running")) {
            setSearchState({ state: "loading", message: "Searching…" + total });
          } else {
            setSearchState({ state: "ok", message: `Search finished${total}` });
            stopPolling();
          }
        } catch (e) {
          setSearchState({ state: "err", message: e?.message || "Search failed" });
          stopPolling();
        }
      }, 1500);
    } catch (e) {
      setSearchState({ state: "err", message: e?.message || "Search failed" });
    }
  };

  const stopSearch = async () => {
    if (!searchId) return;
    stopPolling();
    try {
      await fetchJson(`/api/v1/qbit/search/${encodeURIComponent(searchId)}/stop`, { method: "POST" });
    } catch {}
    setSearchState({ state: "idle", message: "Stopped" });
  };

  // --- add torrent ---
  const savepathOptions = useMemo(() => {
    const list = Array.isArray(settings.savepaths) ? settings.savepaths : [];
    return list.length ? list : [{ label: "Default", path: "" }];
  }, [settings.savepaths]);

  const [selectedSaveLabel, setSelectedSaveLabel] = useState(settings.defaultSavepathLabel || "Default");
  useEffect(() => {
    setSelectedSaveLabel(settings.defaultSavepathLabel || "Default");
  }, [settings.defaultSavepathLabel]);

  const [addState, setAddState] = useState({ state: "idle", message: "" });

  const addTorrent = async (url) => {
    const urls = safeText(url).trim();
    if (!urls) return;

    setAddState({ state: "loading", message: "Sending to qBittorrent…" });

    try {
      const savepath = pickSavepath(db, selectedSaveLabel);
      const out = await fetchJson("/api/v1/qbit/torrents/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, savepath }),
      });
      setAddState({ state: out.ok ? "ok" : "err", message: out.ok ? "Added." : (out.raw || "Failed to add") });
    } catch (e) {
      setAddState({ state: "err", message: e?.message || "Failed to add" });
    }
  };

  // --- manage torrents ---
  const [torrentsState, setTorrentsState] = useState({ state: "idle", message: "" });
  const [torrents, setTorrents] = useState([]);

  const refreshTorrents = async () => {
    setTorrentsState({ state: "loading", message: "Loading torrents…" });
    try {
      const out = await fetchJson("/api/v1/qbit/torrents?filter=all");
      setTorrents(Array.isArray(out.torrents) ? out.torrents : []);
      setTorrentsState({ state: "ok", message: "" });
    } catch (e) {
      setTorrentsState({ state: "err", message: e?.message || "Failed to load torrents" });
    }
  };

  useEffect(() => { refreshTorrents(); }, []);

  const act = async (path, body) => {
    await fetchJson(`/api/v1/qbit/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    await refreshTorrents().catch(() => {});
  };

  // --- UI ---
  const statusPill = (s) => {
    if (s.state === "loading") return "bg-white/10 border-white/15";
    if (s.state === "ok") return "bg-emerald-500/10 border-emerald-500/25";
    if (s.state === "err") return "bg-red-500/10 border-red-500/25";
    return "bg-white/5 border-white/10";
  };

  return (
    <div className="space-y-4">
      <div className={card()}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">qBittorrent</div>
            <div className={"text-xs px-2 py-1 rounded-xl border " + statusPill(ping)}>
              {ping.message || "—"}
            </div>
          </div>

          <button className={btn()} onClick={doPing}>
            <RefreshCw className="w-4 h-4" />
            Ping
          </button>
        </div>
      </div>

      <div className={card()}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="text-xs opacity-70 mb-1">Search</div>
            <input
              className="w-full rounded-2xl bg-black/20 border border-white/10 px-4 py-3 text-sm"
              placeholder="Search via qBittorrent plugins…"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") startSearch(); }}
            />
          </div>

          <div>
            <div className="text-xs opacity-70 mb-1">Save to</div>
            <select
              className="rounded-2xl bg-black/20 border border-white/10 px-4 py-3 text-sm"
              value={selectedSaveLabel}
              onChange={(e) => setSelectedSaveLabel(e.target.value)}
            >
              {savepathOptions.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}{s.path ? ` — ${s.path}` : ""}
                </option>
              ))}
            </select>
          </div>

          <button className={btn("primary")} onClick={startSearch} disabled={!pattern.trim()}>
            <Search className="w-4 h-4" />
            Search
          </button>

          <button className={btn()} onClick={stopSearch} disabled={!searchId || searchState.state !== "loading"}>
            Stop
          </button>

          <button className={btn()} onClick={() => searchId && fetchResults(searchId)} disabled={!searchId}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className={"text-xs px-2 py-1 rounded-xl border " + statusPill(searchState)}>
            {searchState.message || "Idle"}
          </div>

          {addState.message ? (
            <div className={"text-xs px-2 py-1 rounded-xl border " + statusPill(addState)}>
              {addState.message}
            </div>
          ) : null}
        </div>

        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <div className="text-sm opacity-70">
              {searchState.state === "loading" ? "Searching…" : "No results yet."}
            </div>
          ) : (
            results.map((r, idx) => {
              const name = safeText(r?.fileName || r?.name || r?.title || `Result ${idx + 1}`);
              const size = formatBytes(r?.fileSize ?? r?.size ?? 0);
              const seeds = r?.nbSeeders ?? r?.seeds ?? "";
              const leech = r?.nbLeechers ?? r?.leechers ?? "";
              const engine = safeText(r?.siteUrl || r?.engine || r?.site || "");
              const url = safeText(r?.fileUrl || r?.magnetUri || r?.magnet || r?.url || "");

              return (
                <div key={`${name}-${idx}`} className="rounded-2xl border border-white/10 bg-black/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{name}</div>
                      <div className="text-xs opacity-70 flex flex-wrap gap-2">
                        <span>{size}</span>
                        {seeds !== "" ? <span>Seeds: {seeds}</span> : null}
                        {leech !== "" ? <span>Leech: {leech}</span> : null}
                        {engine ? <span className="truncate">Src: {engine}</span> : null}
                      </div>
                    </div>

                    <button
                      className={btn("primary")}
                      onClick={() => addTorrent(url)}
                      disabled={!url}
                      title={url ? "" : "No magnet/URL in this result"}
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className={card()}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold">Manage</div>

          <button className={btn()} onClick={refreshTorrents}>
            <RefreshCw className="w-4 h-4" />
            Refresh list
          </button>
        </div>

        {torrentsState.state === "err" ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-200">
            <AlertTriangle className="w-4 h-4" />
            {torrentsState.message}
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {torrents.length === 0 ? (
            <div className="text-sm opacity-70">No torrents.</div>
          ) : (
            torrents.map((t) => {
              const hash = safeText(t.hash);
              const name = safeText(t.name);
              const prog = formatPct(t.progress);
              const down = formatSpeed(t.dlspeed);
              const up = formatSpeed(t.upspeed);
              const state = safeText(t.state);

              const isPaused = state.toLowerCase().includes("paused") || state.toLowerCase().includes("stalled");

              return (
                <div key={hash} className="rounded-2xl border border-white/10 bg-black/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{name}</div>
                      <div className="text-xs opacity-70 flex flex-wrap gap-2">
                        <span>{prog}</span>
                        <span>↓ {down}</span>
                        <span>↑ {up}</span>
                        {state ? <span className="truncate">State: {state}</span> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isPaused ? (
                        <button className={btn()} onClick={() => act("torrents/resume", { hashes: hash })}>
                          <Play className="w-4 h-4" /> Resume
                        </button>
                      ) : (
                        <button className={btn()} onClick={() => act("torrents/pause", { hashes: hash })}>
                          <Pause className="w-4 h-4" /> Pause
                        </button>
                      )}

                      <button
                        className={btn("danger")}
                        onClick={() => {
                          const ok = window.confirm(`Delete torrent?\n\n${name}\n\n(This will NOT delete files.)`);
                          if (!ok) return;
                          act("torrents/delete", { hashes: hash, deleteFiles: false }).catch(() => {});
                        }}
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="text-xs opacity-60">
        This module proxies qBittorrent through the dashboard backend at <code className="px-1 py-0.5 rounded bg-black/20 border border-white/10">/api/v1/qbit</code> so credentials never reach the browser.
      </div>
    </div>
  );
}
