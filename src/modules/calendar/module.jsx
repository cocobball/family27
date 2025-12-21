import React, { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

export default function CalendarModule({ ctx }) {
  const [selected, setSelected] = useState(ctx.sharedState.get().selectedDate);

  useEffect(() => {
    const unsub = ctx.sharedState.subscribe((s) => setSelected(s.selectedDate));
    return unsub;
  }, [ctx]);

  function onChange(e) {
    const v = e.target.value;
    ctx.sharedState.set({ selectedDate: v });
    ctx.eventBus.emit("selectedDate:changed", v);
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <CalendarDays size={18} />
        <div className="font-semibold">Calendar</div>
      </div>

      <div className="space-y-2">
        <div className="text-sm opacity-80">Selected date</div>
        <input
          type="date"
          value={selected}
          onChange={onChange}
          className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
        />
      </div>

      <div className="text-xs opacity-70">
        This is a real module example. It owns <span className="opacity-90">selectedDate</span> in sharedState.
      </div>
    </div>
  );
}
