import React, { Suspense, useMemo, useRef, useState } from "react";
import { Minus, EyeOff, Maximize2, Columns2 } from "lucide-react";

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
  onToggleSpan,
  columnHeightPx,
  onOpenSettings,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [previewColumn, setPreviewColumn] = useState(null);
  const dragStateRef = useRef(null);
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
    // Don't start drag on interactive elements
    const interactive = e.target?.closest?.(
      "button, a, input, select, textarea, [role='button'], [data-no-drag]"
    );
    if (interactive) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // Initialize drag state with activation constraints
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      activated: false,
      longPressTimer: setTimeout(() => {
        // Long press activation (200ms)
        if (dragStateRef.current && !dragStateRef.current.activated) {
          dragStateRef.current.activated = true;
          setDragActive(true);
        }
      }, 200),
    };
  }

  function onHeaderPointerMove(e) {
    if (!dragStateRef.current) return;

    const state = dragStateRef.current;
    
    // Check if drag should activate based on movement threshold
    if (!state.activated) {
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Activate if moved more than 8px
      if (distance > 8) {
        clearTimeout(state.longPressTimer);
        state.activated = true;
        setDragActive(true);
      } else {
        // Not activated yet, don't process movement
        return;
      }
    }

    // Drag is active - calculate target column
    const x = e.clientX;
    const w = window.innerWidth;
    const target = x < w / 3 ? "left" : x < (2 * w) / 3 ? "middle" : "right";
    
    // Update preview column for visual feedback
    setPreviewColumn(target);
  }

  function onHeaderPointerUp(e) {
    if (!dragStateRef.current) return;

    const state = dragStateRef.current;
    clearTimeout(state.longPressTimer);

    // Only move window if drag was activated
    if (state.activated && previewColumn) {
      onMoveWindow(win.id, previewColumn);
    }

    // Clean up
    if (e.currentTarget?.releasePointerCapture) {
      try {
        e.currentTarget.releasePointerCapture(state.pointerId);
      } catch {}
    }

    dragStateRef.current = null;
    setDragActive(false);
    setPreviewColumn(null);
  }

  function onHeaderPointerCancel(e) {
    if (!dragStateRef.current) return;

    clearTimeout(dragStateRef.current.longPressTimer);
    
    if (e.currentTarget?.releasePointerCapture) {
      try {
        e.currentTarget.releasePointerCapture(dragStateRef.current.pointerId);
      } catch {}
    }

    dragStateRef.current = null;
    setDragActive(false);
    setPreviewColumn(null);
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
    <div 
      className="glass rounded-3xl overflow-hidden" 
      style={{ 
        height: win.minimized ? 64 : heightPx,
        outline: dragActive && previewColumn ? `3px solid var(--accent)` : 'none',
        outlineOffset: '2px',
        transition: dragActive ? 'none' : 'outline 0.2s ease',
      }}
    >
      <div
        className="drag-handle"
        onPointerDown={onHeaderPointerDown}
        onPointerUp={onHeaderPointerUp}
        onPointerMove={onHeaderPointerMove}
        onPointerCancel={onHeaderPointerCancel}
        style={{ 
          minHeight: '56px',
          height: '64px',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: dragActive ? 'grabbing' : 'grab',
        }}
      >
        <div className="h-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center"
                 style={{ background: "color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,0.06))", border: "1px solid var(--border)" }}>
              {Icon ? <Icon size={18} /> : null}
            </div>
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">{Title}</div>
              <div className="text-xs opacity-70 leading-tight truncate">
                {previewColumn ? previewColumn.toUpperCase() : (win.column?.toUpperCase?.() ?? "")}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {moduleDef?.SettingsComponent && (
              <button
                className="iconBtn"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  if (onOpenSettings) onOpenSettings(win.id);
                }}
                aria-label="Settings"
                title="Settings"
                data-no-drag
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.4a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 5 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09c0 .66.38 1.26 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.66 0 1.26.38 1.51 1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.26.38-1.51 1z"/></svg>
              </button>
            )}
            <button className="iconBtn" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMinimizeWindow(win.id); }} aria-label="Minimize" data-no-drag>
              <Minus size={18} />
            </button>
            <button className="iconBtn" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onHideWindow(win.id); }} aria-label="Hide" data-no-drag>
              <EyeOff size={18} />
            </button>
            {onToggleSpan && (win.column ?? "middle") === "left" && (
              <button
                className="iconBtn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSpan(win.id);
                }}
                aria-label={(win.span ?? 1) > 1 ? "Unstretch" : "Stretch across 2 columns"}
                title={(win.span ?? 1) > 1 ? "Use 1 column" : "Use 2 columns"}
                data-no-drag
              >
                <Columns2 size={18} />
              </button>
            )}

            <button className="iconBtn" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPopoutWindow(win.id); }} aria-label="Popout" data-no-drag>
              <Maximize2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {!win.minimized && (
        <div className="h-[calc(100%-4rem)] p-4" style={{ touchAction: 'auto' }}>
          <div className="h-full rounded-2xl" style={{ background: "rgba(0,0,0,0.12)", border: "1px solid var(--border)" }}>
            <div className="h-full overflow-auto rounded-2xl p-4" style={{ touchAction: 'pan-y pan-x' }}>
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
