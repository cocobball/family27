import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Image as ImageIcon, SkipBack, SkipForward, X } from "lucide-react";
import {
  defaultPhotosData,
  migratePhotosData,
  getActivePhotoList,
  shuffleInPlace,
  formatMinutes,
  isLikelyImagePath,
} from "./helpers.js";
import { createPortal } from "react-dom";

// --- ctx compatibility (supports both store APIs found in your project) ---
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
function sharedSet(ctx, patch) {
  const shared = ctx.shared || ctx.sharedState;
  if (!shared?.set) return;
  try {
    shared.set(patch);
  } catch {
    // ignore
  }
}

function normalizeFolderUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // Resolve relative URLs against current origin
  let resolved = raw;
  try {
    resolved = new URL(raw, window.location.origin).toString();
  } catch {
    // keep as-is
  }

  // If it's a manifest file (json), do NOT force trailing slash
  if (/\.(json)(\?|#|$)/i.test(resolved)) return resolved;

  // Otherwise treat as a folder URL
  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

async function fetchImagesFromFolderUrl(folderUrl) {
  const url = normalizeFolderUrl(folderUrl);
  if (!url) return { urls: [], error: "Folder URL is empty." };

  // Cache-bust so nginx/autoindex doesn't aggressively cache
  const bust = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${bust}_ts=${Date.now()}`, { cache: "no-store" });

  if (!res.ok) {
    return { urls: [], error: `Failed to load folder (${res.status}).` };
  }

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
      .filter((href) => !href.startsWith("?") && !href.startsWith("#"))
      .filter((href) => !href.endsWith("/")) // skip subfolders (no recursion)
      .filter(isLikelyImagePath)
      .map((href) => new URL(href, url).toString());

    return { urls: Array.from(new Set(urls)), error: "" };
  } catch (e) {
    // Regex fallback
    const matches = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1]).filter(Boolean);
    const urls = Array.from(
      new Set(
        matches
          .filter((href) => !href.endsWith("/"))
          .filter(isLikelyImagePath)
          .map((href) => new URL(href, url).toString())
      )
    );
    return { urls, error: urls.length ? "" : `Unable to parse folder listing: ${String(e?.message || e)}` };
  }
}

export default function PhotosModule({ ctx }) {
  const raw = storeGet(ctx, defaultPhotosData());
  const data = useMemo(() => migratePhotosData(raw), [raw]);
  const s = data.settings;

  const [active, setActive] = useState(false); // screensaver active
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const idleTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const ignoreActivityUntilRef = useRef(0);
  const slideTimerRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const refreshInFlightRef = useRef(false);

  // Build photo list (demo, uploaded, or folderCache)
  const photos = useMemo(() => {
    const list = getActivePhotoList(data);
    if (s.shuffle) shuffleInPlace(list);
    return list;
  }, [data, s.shuffle]);

  const total = photos.length;
  const currentSrc = total ? photos[index % total] : null;

  function setActiveState(next) {
    setActive(next);
    sharedSet(ctx, { screensaverActive: next });
    ctx.eventBus?.emit?.("screensaver:activeChanged", { active: next, moduleId: ctx.moduleId });
  }

  function resetIdleClock() {
    lastActivityRef.current = Date.now();

    // Fix start flicker: ignore the same click that started it
    if (active && Date.now() > ignoreActivityUntilRef.current) {
      setActiveState(false);
    }
  }

  async function refreshFolderList({ silent } = { silent: false }) {
    if (refreshInFlightRef.current) return;
    if (s.source !== "folder") return;

    const folderUrl = s.folderUrl;
    if (!String(folderUrl || "").trim()) return;

    refreshInFlightRef.current = true;
    try {
      const out = await fetchImagesFromFolderUrl(folderUrl);

      const nextData = migratePhotosData(storeGet(ctx, defaultPhotosData()));
      storeSet(ctx, {
        ...nextData,
        folderCache: {
          urls: out.urls,
          fetchedAt: new Date().toISOString(),
          lastError: out.error || "",
        },
      });

      if (!silent && out.error) {
        console.warn("[photos] folder refresh error:", out.error);
      }
    } catch (e) {
      const nextData = migratePhotosData(storeGet(ctx, defaultPhotosData()));
      storeSet(ctx, {
        ...nextData,
        folderCache: {
          ...(nextData.folderCache || {}),
          fetchedAt: new Date().toISOString(),
          lastError: String(e?.message || e),
        },
      });
    } finally {
      refreshInFlightRef.current = false;
    }
  }

  // Attach global activity listeners when enabled
  useEffect(() => {
    if (!s.enabled) return;

    const onAny = () => resetIdleClock();
    const opts = { passive: true };

    window.addEventListener("mousemove", onAny, opts);
    window.addEventListener("mousedown", onAny, opts);
    window.addEventListener("keydown", onAny);
    window.addEventListener("touchstart", onAny, opts);
    window.addEventListener("pointerdown", onAny, opts);
    window.addEventListener("wheel", onAny, opts);

    return () => {
      window.removeEventListener("mousemove", onAny, opts);
      window.removeEventListener("mousedown", onAny, opts);
      window.removeEventListener("keydown", onAny);
      window.removeEventListener("touchstart", onAny, opts);
      window.removeEventListener("pointerdown", onAny, opts);
      window.removeEventListener("wheel", onAny, opts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.enabled, active]);

  // Idle polling loop
  useEffect(() => {
    if (!s.enabled) {
      setActive(false);
      return;
    }

    if (idleTimerRef.current) clearInterval(idleTimerRef.current);

    const idleMs = Math.max(250, Number(s.idleMinutes) * 60 * 1000);

    idleTimerRef.current = setInterval(() => {
      if (active) return;
      const delta = Date.now() - lastActivityRef.current;
      if (delta >= idleMs) {
        setIndex(0);
        setPaused(false);
        setActiveState(true);
      }
    }, 500);

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.enabled, s.idleMinutes, active]);

  // Background refresh for folder source
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = null;

    if (!s.enabled) return;
    if (s.source !== "folder") return;

    // Try once on boot if empty
    if (!data.folderCache?.urls?.length && String(s.folderUrl || "").trim()) {
      refreshFolderList({ silent: true });
    }

    const mins = Number(s.folderAutoRefreshMinutes || 0);
    if (mins > 0) {
      const ms = Math.max(10_000, mins * 60 * 1000);
      refreshTimerRef.current = setInterval(() => {
        refreshFolderList({ silent: true });
      }, ms);
    }

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.enabled, s.source, s.folderUrl, s.folderAutoRefreshMinutes, data.folderCache?.urls?.length]);

  // Slide timer while active
  useEffect(() => {
    if (!active || paused) return;

    const ms = Math.max(1000, Number(s.slideSeconds) * 1000);
    if (slideTimerRef.current) clearInterval(slideTimerRef.current);

    slideTimerRef.current = setInterval(() => {
      setIndex((i) => (total ? (i + 1) % total : 0));
    }, ms);

    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
      slideTimerRef.current = null;
    };
  }, [active, paused, s.slideSeconds, total]);

  // Lock background scroll while active
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  const statusText = useMemo(() => {
    if (!s.enabled) return "Screensaver off";
    return `Screensaver on • starts after ${formatMinutes(s.idleMinutes)}`;
  }, [s.enabled, s.idleMinutes]);

  const sourceText = useMemo(() => {
    if (s.source === "uploaded") return `Uploaded (${data.uploaded.items.length})`;
    if (s.source === "folder") {
      const n = data.folderCache?.urls?.length || 0;
      return n ? `Folder (${n})` : "Folder (not loaded)";
    }
    return `Demo • ${s.demoSet}`;
  }, [s.source, s.demoSet, data.uploaded.items.length, data.folderCache?.urls?.length]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2">
        <ImageIcon size={18} />
        <div className="font-semibold">Photos</div>
      </div>

      <div className="mt-3 space-y-2 flex-1 min-h-0">
        <div className="text-sm opacity-80">{statusText}</div>

        <div className="rounded-2xl bg-white/5 border border-white/15 px-3 py-2">
          <div className="text-xs opacity-70">Source</div>
          <div className="text-sm opacity-90">{sourceText}</div>
          {s.source === "folder" && data.folderCache?.lastError ? (
            <div className="text-[11px] text-red-200/80 mt-1 break-words">
              {data.folderCache.lastError}
            </div>
          ) : null}
        </div>

        {s.touchToEnable && (
          <button
            onClick={async () => {
              lastActivityRef.current = Date.now();
              ignoreActivityUntilRef.current = Date.now() + 750; // fixes "start flicker"

              // If folder source and not loaded, try to load now
              if (s.source === "folder" && !data.folderCache?.urls?.length) {
                await refreshFolderList({ silent: true });
              }

              setIndex(0);
              setPaused(false);
              setActiveState(true);
            }}
            className="w-full rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-2 text-sm transition-all inline-flex items-center justify-center gap-2"
            type="button"
          >
            <Play size={16} /> Start screensaver
          </button>
        )}

        <div className="text-xs opacity-60 leading-relaxed">
          Tip: click/tap a photo to return to the dashboard. Use ← → for prev/next, Space to pause.
        </div>
      </div>

      {active && (
        <ScreensaverOverlay
          src={currentSrc}
          hasPhotos={!!total}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onExit={() => {
            lastActivityRef.current = Date.now();
            setActiveState(false);
          }}
          onPrev={() => setIndex((i) => (total ? (i - 1 + total) % total : 0))}
          onNext={() => setIndex((i) => (total ? (i + 1) % total : 0))}
          index={index}
          total={total}
          fadeMs={Number(s.fadeMs || 0)}
          fit={s.fit}
          dim={Number(s.dim || 0.2)}
          showClock={!!s.showClock}
          showCounter={!!s.showCounter}
          showTitle={!!s.showTitle}
        />
      )}
    </div>
  );
}

function ScreensaverOverlay({
  src,
  hasPhotos,
  paused,
  onTogglePause,
  onExit,
  onPrev,
  onNext,
  index,
  total,
  fadeMs,
  fit,
  dim,
  showClock,
  showCounter,
  showTitle,
}) {
  const [now, setNow] = useState(() => new Date());
  const [current, setCurrent] = useState(src || null);
  const [next, setNext] = useState(null);
  const [showNext, setShowNext] = useState(false);

  const fitClass = fit === "contain" ? "object-contain" : "object-cover";

  // Clock tick
  useEffect(() => {
    if (!showClock) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [showClock]);

  // Keyboard controls while overlay is active
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onExit();
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onTogglePause();
      }
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, onTogglePause, onPrev, onNext]);

  // Crossfade on src changes (preload first to prevent flicker)
  useEffect(() => {
    if (!hasPhotos || !src) return;

    // First paint
    if (!current) {
      setCurrent(src);
      return;
    }

    if (src === current) return;

    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      setNext(src);
      requestAnimationFrame(() => setShowNext(true));

      const t = setTimeout(() => {
        if (!alive) return;
        setCurrent(src);
        setNext(null);
        setShowNext(false);
      }, Math.max(0, Number(fadeMs || 0)));

      img._fadeTimeout = t;
    };
    img.onerror = () => {
      if (!alive) return;
      setCurrent(src);
      setNext(null);
      setShowNext(false);
    };
    img.src = src;

    return () => {
      alive = false;
      try {
        if (img._fadeTimeout) clearTimeout(img._fadeTimeout);
      } catch {
        // ignore
      }
    };
  }, [src, hasPhotos, fadeMs, current]);

  const timeStr = useMemo(() => {
    const h = now.getHours();
    const m = now.getMinutes();
    const mm = String(m).padStart(2, "0");
    const hh = String(((h + 11) % 12) + 1);
    const ap = h >= 12 ? "PM" : "AM";
    return `${hh}:${mm} ${ap}`;
  }, [now]);

  return createPortal(
    <div className="fixed inset-0 z-[999999] bg-black" onClick={onExit} role="button" tabIndex={0}>
      {/* image layer(s) */}
      <div className="absolute inset-0">
        {hasPhotos && current ? (
          <>
            <img
              src={current}
              alt="Screensaver"
              className={`w-full h-full ${fitClass} select-none`}
              draggable={false}
            />
            {next ? (
              <img
                src={next}
                alt="Screensaver next"
                className={`absolute inset-0 w-full h-full ${fitClass} select-none transition-opacity`}
                style={{
                  opacity: showNext ? 1 : 0,
                  transitionDuration: `${Math.max(0, Number(fadeMs || 0))}ms`,
                }}
                draggable={false}
              />
            ) : null}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/70">
            No photos configured.
          </div>
        )}

        <div className="absolute inset-0" style={{ backgroundColor: "black", opacity: dim }} />
      </div>

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between">
        <div className="pointer-events-none">
          {showTitle ? <div className="text-white/75 text-sm">Family Photos</div> : null}
          {showClock ? <div className="text-white/90 text-2xl font-semibold mt-1">{timeStr}</div> : null}
          {showCounter && total ? (
            <div className="text-white/60 text-xs mt-1">
              {((index % total) + total) % total + 1} / {total}
            </div>
          ) : null}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm inline-flex items-center gap-2"
            type="button"
            title="Previous"
          >
            <SkipBack size={16} />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); onTogglePause(); }}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm inline-flex items-center gap-2"
            type="button"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? "Resume" : "Pause"}
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm inline-flex items-center gap-2"
            type="button"
            title="Next"
          >
            <SkipForward size={16} />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); onExit(); }}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm inline-flex items-center gap-2"
            type="button"
            title="Exit"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* bottom hint */}
      <div className="absolute bottom-0 left-0 right-0 p-6 text-center text-white/60 text-sm pointer-events-none">
        Tap/click to wake • Esc to exit • ← → to navigate • Space to pause
      </div>
    </div>,
    document.body
  );
}
