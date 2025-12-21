import React from "react";
import { Settings, RotateCcw } from "lucide-react";

export default function SystemBar({
  title = "Family Dashboard",
  hiddenWindows,
  modulesById,
  onRestoreWindow,
  onOpenSettings,
}) {
  return (
    <div className="h-16 w-full px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="text-lg font-semibold tracking-tight">{title}</div>
        <div className="text-xs opacity-70">OS-style dashboard</div>
      </div>

      <div className="flex items-center gap-2">
        <button className="iconBtn" onClick={onOpenSettings} aria-label="Settings">
          <Settings size={20} />
        </button>

        {hiddenWindows.map((win) => {
          const def = modulesById[win.moduleId];
          const Icon = def?.icon ?? RotateCcw;
          return (
            <button
              key={win.id}
              className="iconBtn"
              onClick={() => onRestoreWindow(win.id)}
              aria-label={`Restore ${def?.title ?? win.moduleId}`}
              title={`Restore ${def?.title ?? win.moduleId}`}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
