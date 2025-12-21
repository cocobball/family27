import React, { Suspense, useMemo, useRef, useState } from "react";
import { Minus, EyeOff, Maximize2 } from "lucide-react";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default function WindowFrame({
  win,
  moduleDef,
  ctx,
  onMoveWindow,
  onResizeWindow,
  onMinimizeWindow,
  onHideWindow,
  onPopoutWindow,
  columnHeightPx,
}) {
  const [dragging, setDragging] = useState(false);
  const resizeRef = useRef(null);

  const heightPx = useMemo(() => {
    const minPx = 140;
    const maxPx = Math.floor(columnHeightPx * 0.9);
    const px = Math.floor((win.h ?? 0.35) * columnHeightPx);
    return clamp(px, minPx, maxPx);
  }, [win.h, columnHeightPx]);

  const Icon = moduleDef?.icon;
  const Title = moduleDef?.title ?? win.moduleId;

  const Component = moduleDef?.Component;

  function onHeaderPointerDown(e) {
    // Touch-first: pointer events
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  }

  function onHeaderPointerUp() {
    setDragging(false);
  }

  function onHeaderPointerMove(e) {
    if (!dragging) return;
    // Move by X position across thirds of viewport
    const x = e.clientX;
    const w = window.innerWidth;
    const target = x < w / 3 ? "left" : x < (2 * w) / 3 ? "middle" : "right";
    onMoveWindow(win.id, target);
  }

  function onResizePointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = heightPx;
    const colH = columnHeightPx;
    const minPx = 140;
    const maxPx = Math.floor(colH * 0.9);

    const move = (ev) => {
      const dy = ev.clientY - startY;
      const nextPx = clamp(startH + dy, minPx, maxPx);
      const nextH = nextPx / colH;
      onResizeWindow(win.id, nextH);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="glass rounded-3xl overflow-hidden" style={{ height: win.minimized ? 64 : heightPx }}>
      <div
        className="h-16 px-4 flex items-center justify-between select-none"
        onPointerDown={onHeaderPointerDown}
        onPointerUp={onHeaderPointerUp}
        onPointerMove={onHeaderPointerMove}
        style={{ cursor: "grab" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center"
               style={{ background: "color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,0.06))", border: "1px solid var(--border)" }}>
            {Icon ? <Icon size={18} /> : null}
          </div>
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">{Title}</div>
            <div className="text-xs opacity-70 leading-tight truncate">{win.column?.toUpperCase?.() ?? ""}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="iconBtn" onClick={(e) => { e.stopPropagation(); onMinimizeWindow(win.id); }} aria-label="Minimize">
            <Minus size={18} />
          </button>
          <button className="iconBtn" onClick={(e) => { e.stopPropagation(); onHideWindow(win.id); }} aria-label="Hide">
            <EyeOff size={18} />
          </button>
          <button className="iconBtn" onClick={(e) => { e.stopPropagation(); onPopoutWindow(win.id); }} aria-label="Popout">
            <Maximize2 size={18} />
          </button>
        </div>
      </div>

      {!win.minimized && (
        <div className="h-[calc(100%-4rem)] p-4">
          <div className="h-full rounded-2xl" style={{ background: "rgba(0,0,0,0.12)", border: "1px solid var(--border)" }}>
            <div className="h-full overflow-auto rounded-2xl p-4">
              <Suspense fallback={<div className="text-sm opacity-70">Loading…</div>}>
                {Component ? <Component ctx={ctx} /> : <div className="text-sm opacity-70">Missing module component.</div>}
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {!win.minimized && (
        <div
          ref={resizeRef}
          onPointerDown={onResizePointerDown}
          className="absolute"
          style={{
            width: 26,
            height: 26,
            right: 10,
            bottom: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid var(--border)",
            cursor: "ns-resize",
          }}
          title="Resize"
        />
      )}
    </div>
  );
}
