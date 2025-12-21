import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { defaultEventsData } from "./helpers.js";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function EventsModule({ ctx }) {
  const selectedDate = ctx.sharedState.get().selectedDate;
  const [date, setDate] = useState(selectedDate);

  useEffect(() => {
    const unsub = ctx.sharedState.subscribe((s) => setDate(s.selectedDate));
    return unsub;
  }, [ctx]);

  const data = ctx.store.get(defaultEventsData);
  const items = data.items ?? [];

  const filtered = useMemo(() => {
    return items.filter((it) => (it.date ?? date) === date);
  }, [items, date]);

  function add() {
    const next = { id: uid(), date, title: "New event", time: "All day" };
    ctx.store.patch({ items: [...items, next] });
  }

  function remove(id) {
    ctx.store.patch({ items: items.filter((i) => i.id !== id) });
  }

  function update(id, patch) {
    ctx.store.patch({
      items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Events</div>
          <div className="text-xs opacity-70">Filtering by selected date: {date}</div>
        </div>
        <button className="btn btnPrimary" onClick={add}><Plus size={16} /> Add</button>
      </div>

      <div className="space-y-2">
        {filtered.length ? filtered.map((e) => (
          <div key={e.id} className="p-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)" }}>
            <div className="flex gap-2 items-center justify-between">
              <input
                value={e.title}
                onChange={(ev) => update(e.id, { title: ev.target.value })}
                className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
              />
              <button className="iconBtn" onClick={() => remove(e.id)} aria-label="Delete">
                <Trash2 size={18} />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                value={e.time ?? ""}
                onChange={(ev) => update(e.id, { time: ev.target.value })}
                className="rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                placeholder="Time"
              />
              <input
                type="date"
                value={e.date ?? date}
                onChange={(ev) => update(e.id, { date: ev.target.value })}
                className="rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
              />
            </div>
          </div>
        )) : (
          <div className="text-sm opacity-70">No events for this date yet.</div>
        )}
      </div>
    </div>
  );
}
