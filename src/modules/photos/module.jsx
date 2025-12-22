import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Image as ImageIcon } from "lucide-react";
import {
  defaultPhotosData,
  migratePhotosData,
  getActivePhotoList,
  shuffleInPlace,
  formatMinutes,
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

export default function PhotosModule({ ctx }) {
  const raw = storeGet(ctx, defaultPhotosData());
  const data = useMemo(() => migratePhotosData(raw), [raw]);
  const s = data.settings;

  const [active, setActive] = useState(false);      // screensaver active
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const idleTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const slideTimerRef = useRef(null);

  // Build photo list (demo or uploaded)
  const photos = useMemo(() => {
    const list = getActivePhotoList(data);
    if (s.shuffle) shuffleInPlace(list);
    return list;
  }, [data, s.shuffle]);

  // If no photos (shouldn't happen), avoid crash
  const currentSrc = photos.length ? photos[index % photos.length] : null;

  function setActiveState(next) {
    setActive(next);
    sharedSet(ctx, { screensaverActive: next });
    ctx.eventBus?.emit?.("screensaver:activeChanged", { active: next, moduleId: ctx.moduleId });
  }

  function resetIdleClock() {
    lastActivityRef.current = Date.now();
    // if screensaver is running, any activity exits it
    if (active) {
      setActiveState(false);
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
  }, [s.enabled]);

  // Idle polling loop (simple + reliable)
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

  // Slide timer while active
  useEffect(() => {
    if (!active || paused) return;

    const ms = Math.max(1000, Number(s.slideSeconds) * 1000);
    if (slideTimerRef.current) clearInterval(slideTimerRef.current);

    slideTimerRef.current = setInterval(() => {
      setIndex((i) => (photos.length ? (i + 1) % photos.length : 0));
    }, ms);

    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
      slideTimerRef.current = null;
    };
  }, [active, paused, s.slideSeconds, photos.length]);

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
          <div className="text-sm opacity-90">
            {s.source === "uploaded" ? `Uploaded (${data.uploaded.items.length})` : `Demo • ${s.demoSet}`}
          </div>
        </div>

        {s.touchToEnable && (
          <button
            onClick={() => {
              lastActivityRef.current = Date.now();
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
          Tip: click/tap a photo to return to the dashboard.
        </div>
      </div>

      {active && (
        <ScreensaverOverlay
          src={currentSrc}
          hasPhotos={!!photos.length}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onExit={() => {
            lastActivityRef.current = Date.now();
            setActiveState(false);
          }}
        />
      )}
    </div>
  );
}

function ScreensaverOverlay({ src, hasPhotos, paused, onTogglePause, onExit }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[999999] bg-black"
      onClick={onExit}
      role="button"
      tabIndex={0}
    >
      {/* image */}
      <div className="absolute inset-0">
        {hasPhotos && src ? (
          <img
            src={src}
            alt="Screensaver"
            className="w-full h-full object-cover select-none"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/70">
            No photos configured.
          </div>
        )}
        <div className="absolute inset-0 bg-black/20" />
      </div>

      {/* subtle top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between pointer-events-none">
        <div className="text-white/70 text-sm">Family Photos</div>

        <div className="pointer-events-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePause();
            }}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm inline-flex items-center gap-2"
            type="button"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      {/* bottom hint */}
      <div className="absolute bottom-0 left-0 right-0 p-6 text-center text-white/60 text-sm">
        Tap/click to wake
      </div>
    </div>,
    document.body
  );
}
