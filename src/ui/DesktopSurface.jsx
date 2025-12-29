import React, { useEffect, useMemo, useRef, useState } from "react";
import Column from "./Column.jsx";
import WindowFrame from "./WindowFrame.jsx";

export default function DesktopSurface({
  layout,
  windowsById,
  getModuleDef,
  buildCtxForWindow,
  onMoveWindow,
  onResizeWindow,
  onMinimizeWindow,
  onHideWindow,
  onPopoutWindow,
  onToggleSpan,
  onOpenSettings,
}) {
  const ref = useRef(null);
  const [h, setH] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setH(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = ["left", "middle", "right"];

  const { colWindows, wideWin } = useMemo(() => {
    const out = {};
    for (const c of cols) out[c] = [];

    for (const c of cols) {
      const order = layout.columns?.[c]?.order ?? [];
      out[c] = order
        .map((id) => windowsById[id])
        .filter(Boolean)
        .filter((w) => !w.hidden && !w.popup);
    }

    // Wide windows: currently supported from the LEFT column only (span left + middle).
    const firstLeft = out.left[0];
    const canBeWide = firstLeft && (firstLeft.span ?? 1) > 1 && (firstLeft.column ?? "left") === "left";
    const wide = canBeWide ? firstLeft : null;
    if (wide) out.left = out.left.slice(1);

    return { colWindows: out, wideWin: wide };
  }, [layout, windowsById]);

  // If we have a wide window at the top-left, left+middle columns render beneath it.
  const wideHeightPx = useMemo(() => {
    if (!wideWin) return 0;
    if (wideWin.minimized) return 64;
    return Math.floor((wideWin.h ?? 0.35) * h);
  }, [wideWin, h]);

  // Tailwind gap-3 ~= 12px. Use a small constant so columns below don't overflow.
  const gapPx = 12;
  const leftMiddleHeightPx = wideWin ? Math.max(200, h - wideHeightPx - gapPx) : h;

  return (
    <div ref={ref} className="h-[calc(100%-4rem)] px-4 pb-4">
      <div
        className="h-full grid grid-cols-3 gap-3"
        style={wideWin ? { gridTemplateRows: "auto 1fr" } : undefined}
      >
        {wideWin && (
          <div className="col-span-2 row-start-1">
            <WindowFrame
              win={wideWin}
              moduleDef={getModuleDef(wideWin.moduleId)}
              ctx={buildCtxForWindow(wideWin)}
              onMoveWindow={onMoveWindow}
              onResizeWindow={onResizeWindow}
              onMinimizeWindow={onMinimizeWindow}
              onHideWindow={onHideWindow}
              onPopoutWindow={onPopoutWindow}
              onToggleSpan={onToggleSpan}
              columnHeightPx={h}
              onOpenSettings={onOpenSettings}
            />
          </div>
        )}

        <div className={wideWin ? "row-start-2 col-start-1" : "h-full"}>
          <div className="h-full" style={wideWin ? { height: leftMiddleHeightPx } : undefined}>
            <Column
              columnId="left"
              windows={colWindows.left}
              getModuleDef={getModuleDef}
              buildCtxForWindow={buildCtxForWindow}
              onMoveWindow={onMoveWindow}
              onResizeWindow={onResizeWindow}
              onMinimizeWindow={onMinimizeWindow}
              onHideWindow={onHideWindow}
              onPopoutWindow={onPopoutWindow}
              onToggleSpan={onToggleSpan}
              columnHeightPx={leftMiddleHeightPx}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>

        <div className={wideWin ? "row-start-2 col-start-2" : "h-full"}>
          <div className="h-full" style={wideWin ? { height: leftMiddleHeightPx } : undefined}>
            <Column
              columnId="middle"
              windows={colWindows.middle}
              getModuleDef={getModuleDef}
              buildCtxForWindow={buildCtxForWindow}
              onMoveWindow={onMoveWindow}
              onResizeWindow={onResizeWindow}
              onMinimizeWindow={onMinimizeWindow}
              onHideWindow={onHideWindow}
              onPopoutWindow={onPopoutWindow}
              onToggleSpan={onToggleSpan}
              columnHeightPx={leftMiddleHeightPx}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>

        <div className={wideWin ? "row-start-1 row-span-2 col-start-3" : "h-full"}>
          <Column
            columnId="right"
            windows={colWindows.right}
            getModuleDef={getModuleDef}
            buildCtxForWindow={buildCtxForWindow}
            onMoveWindow={onMoveWindow}
            onResizeWindow={onResizeWindow}
            onMinimizeWindow={onMinimizeWindow}
            onHideWindow={onHideWindow}
            onPopoutWindow={onPopoutWindow}
            onToggleSpan={onToggleSpan}
            columnHeightPx={h}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>
    </div>
  );
}
