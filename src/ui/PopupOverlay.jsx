import React, { Suspense } from "react";
import { X, SlidersHorizontal } from "lucide-react";

export default function PopupOverlay({ win, moduleDef, ctx, onClose, onOpenModuleSettings }) {
  if (!win || !moduleDef) return null;
  const Component = moduleDef.Component;
  const hasSettings = !!moduleDef.SettingsComponent;

  return (
    <div className="fixed inset-0 z-50 p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="h-full w-full glass rounded-[2rem] overflow-hidden flex flex-col">
        <div className="h-16 px-4 flex items-center justify-between">
          <div className="font-semibold">{moduleDef.title}</div>
          <div className="flex items-center gap-2">
            {hasSettings && (
              <button className="iconBtn" onClick={onOpenModuleSettings} aria-label="Module Settings">
                <SlidersHorizontal size={18} />
              </button>
            )}
            <button className="iconBtn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-hidden">
          <div className="h-full rounded-3xl" style={{ background: "rgba(0,0,0,0.12)", border: "1px solid var(--border)" }}>
            <div className="h-full overflow-auto rounded-3xl p-5">
              <Suspense fallback={<div className="text-sm opacity-70">Loading…</div>}>
                <Component ctx={ctx} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
