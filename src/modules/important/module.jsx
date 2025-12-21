import React from "react";

export default function ImportantModule({ ctx }) {
  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Important Events</div>
      <div className="text-sm opacity-80">
        Placeholder module stub. Enable it in Settings → Modules.
      </div>
      <div className="text-xs opacity-70">
        Storage lives in <span className="opacity-90">db.modules.important</span> via ctx.store.
      </div>
    </div>
  );
}
