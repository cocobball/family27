import React, { useEffect, useMemo, useRef, useState } from "react";
import { defaultPhotosData, migratePhotosData, getActivePhotoList, shuffleInPlace } from "./helpers.js";

// --- ctx compatibility ---
function storeGet(ctx, fallback) {
  const s = ctx.store;
  if (s?.getModuleData) return s.getModuleData(ctx.moduleId, fallback);
  if (s?.get) return s.get(fallback);
  return fallback;
}

function pad2(n) {
  const x = Math.floor(Math.abs(n));
  return x < 10 ? `0${x}` : String(x);
}

function getClockString() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function chooseFit(fitSetting, imgSize, screenSize) {
  const fit = String(fitSetting || "cover");
  if (fit !== "auto") return fit;

  const iw = imgSize?.w || 0;
  const ih = imgSize?.h || 0;
  const sw = screenSize?.w || window.innerWidth;
  const sh = screenSize?.h || window.innerHeight;
  if (!iw || !ih || !sw || !sh) return "cover";

  const ia = iw / ih;
  const sa = sw / sh;
  const mismatch = ia > sa ? ia / sa : sa / ia; // >= 1
  return mismatch >= 1.35 ? "contain" : "cover";
}

export default function PhotosModule({ ctx }) {
  const raw = storeGet(ctx, defaultPhotosData());
  const data = useMemo(() => migratePhotosData(raw), [raw]);
  const s = data.settings;

  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [prevUrl, setPrevUrl] = useState("");
  const [clock, setClock] = useState(getClockString());
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const lastActivityRef = useRef(Date.now());
  const slideTimerRef = useRef(null);

  // Build list (and keep shuffle stable per list)
  const urls = useMemo(() => {
    const list = getActivePhotoList(data).filter(Boolean);
    const out = list.slice();
    if (s.shuffle) shuffleInPlace(out);
    return out;
  }, [data, s.shuffle]);

  // keep idx valid
  useEffect(() => {
    if (!urls.length) setIdx(0);
    else setIdx((x) => Math.max(0, Math.min(x, urls.length - 1)));
  }, [urls.length]);

  // screen size
  useEffect(() => {
    const onResize = () => setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // idle detection
  useEffect(() => {
    if (!s.enabled) return;

    const onAct = () => {
      lastActivityRef.current = Date.now();
      if (active) setActive(false);
    };

    const opts = { capture: true, passive: true };
    window.addEventListener("pointerdown", onAct, opts);
    window.addEventListener("pointermove", onAct, opts);
    window.addEventListener("keydown", onAct, opts);
    window.addEventListener("touchstart", onAct, opts);

    const interval = window.setInterval(() => {
      if (active) return;
      const idleMs = Date.now() - lastActivityRef.current;
      const thresholdMs = Math.max(0.25, Number(s.idleMinutes || 5)) * 60_000;
      if (idleMs >= thresholdMs) setActive(true);
    }, 750);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onAct, opts);
      window.removeEventListener("pointermove", onAct, opts);
      window.removeEventListener("keydown", onAct, opts);
      window.removeEventListener("touchstart", onAct, opts);
    };
  }, [s.enabled, s.idleMinutes, active]);

  // slide timer
  useEffect(() => {
    if (!active) {
      if (slideTimerRef.current) window.clearInterval(slideTimerRef.current);
      slideTimerRef.current = null;
      return;
    }
    if (!urls.length) return;

    const seconds = Math.max(3, Number(s.slideSeconds || 12));
    if (slideTimerRef.current) window.clearInterval(slideTimerRef.current);
    slideTimerRef.current = window.setInterval(() => {
      setIdx((x) => (urls.length ? (x + 1) % urls.length : 0));
    }, seconds * 1000);

    return () => {
      if (slideTimerRef.current) window.clearInterval(slideTimerRef.current);
      slideTimerRef.current = null;
    };
  }, [active, urls.length, s.slideSeconds]);

  // clock update
  useEffect(() => {
    if (!active || !s.showClock) return;
    const t = window.setInterval(() => setClock(getClockString()), 1000);
    return () => window.clearInterval(t);
  }, [active, s.showClock]);

  // exit on escape
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === "Escape") setActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const currentUrl = urls[idx] || "";
  const nextUrl = urls.length ? urls[(idx + 1) % urls.length] : "";

  // measure current image for auto fit
  useEffect(() => {
    if (!currentUrl) {
      setImgSize({ w: 0, h: 0 });
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setImgSize({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    };
    img.onerror = () => {
      if (cancelled) return;
      setImgSize({ w: 0, h: 0 });
    };
    img.src = currentUrl;
    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  // preload next
  useEffect(() => {
    if (!active || !nextUrl) return;
    const img = new Image();
    img.src = nextUrl;
  }, [active, nextUrl]);

  // crossfade bookkeeping
  useEffect(() => {
    if (!active) return;
    setPrevUrl((prev) => (prev === currentUrl ? prev : prev || currentUrl));
    // when idx changes, keep previous for fade
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => {
    if (!active) return;
    // when currentUrl changes, set prevUrl to previous current
    setPrevUrl((prev) => (prev && prev !== currentUrl ? prev : prevUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  const fit = chooseFit(s.fit, imgSize, screenSize);
  const objectFit = fit === "scale-down" ? "scale-down" : fit;

  const fadeMs = Math.max(0, Number(s.fadeMs || 0));
  const dim = Math.max(0, Math.min(0.85, Number(s.dim || 0)));

  const showBlurBg = (s.backgroundMode || "none") === "blur" && !!currentUrl;

  const showStartButton = !!s.touchToEnable && !active;

  return (
    <div className="w-full h-full relative overflow-hidden rounded-2xl bg-white/5 border border-white/10">
      {/* Module card content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {showStartButton ? (
          <button
            className="btn btnPrimary"
            type="button"
            onClick={() => {
              lastActivityRef.current = Date.now();
              setActive(true);
            }}
            disabled={!urls.length}
            title={!urls.length ? "No photos available" : "Start screensaver"}
          >
            Touch to enable
          </button>
        ) : (
          <div className="text-sm opacity-70 px-4 text-center">
            {s.enabled ? (urls.length ? "Screensaver ready" : "No photos loaded yet") : "Screensaver disabled"}
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {active && (
        <div className="fixed inset-0 z-[9999] bg-black" onClick={() => setActive(false)} style={{ touchAction: "manipulation" }}>
          {/* blurred background */}
          {showBlurBg ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url("${currentUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: `blur(${Math.max(0, Number(s.backgroundBlurPx ?? 28))}px)`,
                opacity: Math.max(0, Math.min(1, Number(s.backgroundOpacity ?? 0.55))),
                transform: "scale(1.1)",
              }}
            />
          ) : null}

          {/* previous image (for crossfade) */}
          {fadeMs > 0 && prevUrl && prevUrl !== currentUrl ? (
            <img
              src={prevUrl}
              alt=""
              className="absolute inset-0 w-full h-full"
              style={{ objectFit, objectPosition: "center", opacity: 1 }}
              draggable={false}
            />
          ) : null}

          {/* current image */}
          <img
            key={currentUrl}
            src={currentUrl}
            alt=""
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit,
              objectPosition: "center",
              opacity: 1,
              transition: fadeMs ? `opacity ${fadeMs}ms ease-in-out` : undefined,
            }}
            draggable={false}
            onLoad={() => {
              // when current finishes loading, update prevUrl to enable crossfade on next tick
              setPrevUrl(currentUrl);
            }}
          />

          {/* dim overlay */}
          {dim > 0 ? <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim})` }} /> : null}

          {/* HUD */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-6 left-6 right-6 flex items-start justify-between gap-6">
              <div className="flex flex-col gap-2">
                {s.showTitle ? <div className="text-white/90 text-sm font-semibold">Family Photos</div> : null}
                {s.showClock ? <div className="text-white/90 text-3xl font-semibold tabular-nums">{clock}</div> : null}
              </div>

              {s.showCounter && urls.length ? (
                <div className="text-white/80 text-sm tabular-nums">
                  {idx + 1} / {urls.length}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Optional: keep backwards compatibility if anything imports helpers from module.jsx
export * from "./helpers.js";
