import React from "react";
import { Settings, RotateCcw, RefreshCw } from "lucide-react";

export default function SystemBar({
  title = "Family Dashboard",
  hiddenWindows,
  modulesById,
  onRestoreWindow,
  onOpenSettings,
  onRefreshAll,
}) {
  return (
    <div className="h-16 w-full px-4 flex items-center gap-4">
      {/* LEFT: title */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-lg font-semibold tracking-tight">{title}</div>
        <div className="text-xs opacity-70">OS-style dashboard</div>
      </div>

      {/* RIGHT: hidden windows + settings (settings always far right) */}
      <div className="ml-auto flex items-center gap-2 min-w-0">
        {/* Hidden windows strip (can shrink/scroll) */}
        <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
          {hiddenWindows.map((win) => {
            const def = modulesById[win.moduleId];
            const Icon = def?.icon ?? RotateCcw;
            return (
              <button
                key={win.id}
                className="iconBtn shrink-0"
                onClick={() => onRestoreWindow(win.id)}
                aria-label={`Restore ${def?.title ?? win.moduleId}`}
                title={`Restore ${def?.title ?? win.moduleId}`}
              >
                <Icon size={20} />
              </button>
            );
          })}
        </div>

        {/* Refresh button */}
        <button
          className="iconBtn shrink-0"
          onClick={onRefreshAll}
          aria-label="Refresh all modules"
          title="Refresh all modules"
        >
          <RefreshCw size={20} />
        </button>

        {/* Settings ALWAYS at far right */}
        <button
          className="iconBtn shrink-0"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </div>
    </div>
  );
}
