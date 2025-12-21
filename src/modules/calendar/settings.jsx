// src/modules/calendar/settings.jsx
import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { defaultCalendarData, uid } from "./helpers.js";

function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);
  const data = useMemo(() => ctx.store.get(defaultFn), [ctx, defaultFn, rev]);
  const patch = (partial) => {
    ctx.store.patch(partial);
    setRev((r) => r + 1);
  };
  return { data, patch };
}

export default function CalendarSettings({ ctx }) {
  const { data, patch } = useModuleData(ctx, defaultCalendarData);
  const prefs = data.prefs ?? defaultCalendarData().prefs;
  const calendars = data.calendars ?? defaultCalendarData().calendars;
  const events = data.events ?? [];

  const updatePrefs = (p) => patch({ prefs: { ...prefs, ...p } });

  const addCalendar = () => {
    const id = uid("cal");
    patch({
      calendars: [...calendars, { id, name: "New calendar", enabled: true, archived: false }],
    });
  };

  const renameCalendar = (id, name) => {
    patch({ calendars: calendars.map((c) => (c.id === id ? { ...c, name } : c)) });
  };

  const toggleArchive = (id) => {
    patch({ calendars: calendars.map((c) => (c.id === id ? { ...c, archived: !c.archived } : c)) });
  };

  const deleteCalendar = (id) => {
    // Failure-safe: do NOT delete events. Reassign to "family".
    const nextEvents = events.map((e) => (e.calendarId === id ? { ...e, calendarId: "family" } : e));
    patch({
      events: nextEvents,
      calendars: calendars.map((c) => (c.id === id ? { ...c, archived: true, enabled: false } : c)),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold">Calendar Settings</div>
        <div className="text-sm opacity-75">Applies instantly and persists in the unified dashboard DB.</div>
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Preferences</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Week starts on</div>
            <div className="flex gap-2">
              <button
                className={"btn flex-1 " + ((prefs.weekStart ?? 0) === 0 ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ weekStart: 0 })}
              >
                Sunday
              </button>
              <button
                className={"btn flex-1 " + ((prefs.weekStart ?? 0) === 1 ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ weekStart: 1 })}
              >
                Monday
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Time format</div>
            <div className="flex gap-2">
              <button
                className={"btn flex-1 " + ((prefs.timeFormat ?? "12") === "12" ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ timeFormat: "12" })}
              >
                12-hour
              </button>
              <button
                className={"btn flex-1 " + ((prefs.timeFormat ?? "12") === "24" ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ timeFormat: "24" })}
              >
                24-hour
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs opacity-70">Default view</div>
          <select
            className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
            value={prefs.view ?? "month"}
            onChange={(e) => updatePrefs({ view: e.target.value })}
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="agenda">Agenda</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!prefs.showWeekNumbers}
            onChange={(e) => updatePrefs({ showWeekNumbers: e.target.checked })}
          />
          Show week numbers (reserved)
        </label>
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Calendars</div>
          <button className="btn" onClick={addCalendar}>
            <Plus size={16} /> Add calendar
          </button>
        </div>

        <div className="space-y-3">
          {calendars.map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/10 p-3 bg-white/5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                  value={c.name}
                  onChange={(e) => renameCalendar(c.id, e.target.value)}
                />
                <button className="btn" onClick={() => toggleArchive(c.id)}>
                  {c.archived ? "Unarchive" : "Archive"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="text-xs opacity-70">
                  id: <span className="opacity-90">{c.id}</span>
                  {c.archived ? " • archived" : ""}
                </div>

                <button className="btn" onClick={() => deleteCalendar(c.id)} title="Archive + disable and reassign events">
                  <Trash2 size={16} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs opacity-70">
          Removing a calendar does not delete events — events are reassigned to “Family”.
        </div>
      </div>
    </div>
  );
}
