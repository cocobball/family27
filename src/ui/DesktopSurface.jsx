import React, { useEffect, useMemo, useRef, useState } from "react";
import Column from "./Column.jsx";

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

  const colWindows = useMemo(() => {
    const out = {};
    for (const c of cols) out[c] = [];
    for (const c of cols) {
      const order = layout.columns?.[c]?.order ?? [];
      out[c] = order.map((id) => windowsById[id]).filter(Boolean).filter((w) => !w.hidden && !w.popup);
    }
    return out;
  }, [layout, windowsById]);

  return (
    <div ref={ref} className="h-[calc(100%-4rem)] px-4 pb-4">
      <div className="h-full grid grid-cols-3 gap-3">
        {cols.map((c) => (
          <div key={c} className="h-full">
            <Column
              columnId={c}
              windows={colWindows[c]}
              getModuleDef={getModuleDef}
              buildCtxForWindow={buildCtxForWindow}
              onMoveWindow={onMoveWindow}
              onResizeWindow={onResizeWindow}
              onMinimizeWindow={onMinimizeWindow}
              onHideWindow={onHideWindow}
              onPopoutWindow={onPopoutWindow}
              columnHeightPx={h}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
