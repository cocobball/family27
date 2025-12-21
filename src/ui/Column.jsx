import React from "react";
import WindowFrame from "./WindowFrame.jsx";

export default function Column({
  columnId,
  windows,
  getModuleDef,
  buildCtxForWindow,
  onMoveWindow,
  onResizeWindow,
  onMinimizeWindow,
  onHideWindow,
  onPopoutWindow,
  onClosePopup,
  activePopup,
  columnHeightPx,
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      {windows.map((win) => (
        <WindowFrame
          key={win.id}
          win={win}
          moduleDef={getModuleDef(win.moduleId)}
          ctx={buildCtxForWindow(win)}
          onMoveWindow={onMoveWindow}
          onResizeWindow={onResizeWindow}
          onMinimizeWindow={onMinimizeWindow}
          onHideWindow={onHideWindow}
          onPopoutWindow={onPopoutWindow}
          columnHeightPx={columnHeightPx}
          isPopup={activePopup?.id === win.id}
          onClosePopup={onClosePopup}
        />
      ))}
    </div>
  );
}
