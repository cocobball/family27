
import React from "react";
import { defaultData, migrateData } from "./helpers.js";
import { RotateCcw } from "lucide-react";

export default function MealsSettings({ ctx }) {
  const data = migrateData(ctx.store.get(defaultData));

  const set = (patch) => {
    ctx.store.set(migrateData({ ...data, ...patch }));
  };

  const setSettings = (partial) => {
    set({ settings: { ...(data.settings || {}), ...partial } });
  };

  const reset = () => {
    if (!confirm("Reset Meals module data? This will delete recipes, receipts, planner, and grocery list.")) return;
    ctx.store.set(defaultData());
  };

  return (
    <div className="space-y-3">
      <div className="font-semibold">Meals settings</div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!data.settings?.weekStartsOnMonday}
          onChange={(e) => setSettings({ weekStartsOnMonday: e.target.checked })}
        />
        Week starts on Monday
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.settings?.autoDedupeGrocery !== false}
          onChange={(e) => setSettings({ autoDedupeGrocery: e.target.checked })}
        />
        Auto-dedupe grocery items (add “(xN)” counts)
      </label>

      <button className="btn" onClick={reset} title="Reset Meals data">
        <RotateCcw size={16} /> Reset Meals data
      </button>

      <div className="text-xs opacity-70">
        Tip: Changing “Week starts on Monday” affects which days belong to a week when you jump by date.
      </div>
    </div>
  );
}
