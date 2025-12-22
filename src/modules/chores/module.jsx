import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ClipboardList, X, Plus, Trash2, Check } from "lucide-react";
import {
  DAYS,
  PEOPLE_DEFAULTS,
  defaultChoresData,
  normalizeChoresData,
  getWeekKey,
  getDayName,
  dateFromYMD,
  groupChoresByDay,
  groupChoresByPerson,
  getChoresForDateWithDone,
} from "./helpers.js";

/**
 * Chores module
 * - UI/overlay style matches your old app example
 * - Persistent data in ctx.store (module-local)
 * - Publishes easy-to-consume views to ctx.sharedState for other modules:
 *    sharedState.choresByDay
 *    sharedState.choresForSelectedDate
 * - Emits events:
 *    eventBus.emit("chores:changed", { choresByDay, data })
 *    eventBus.emit("choresForDate:changed", { selectedDate, chores })
 */

// -----------------------------
// tiny shared store (no Provider)
// -----------------------------
let _enabled = false;
const _listeners = new Set();
function _notify() {
  for (const l of _listeners) l();
}
export function setChoreModeEnabled(val) {
  _enabled = !!val;
  _notify();
}
export function toggleChoreMode() {
  setChoreModeEnabled(!_enabled);
}
function subscribe(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function getSnapshot() {
  return _enabled;
}
export function useChoreModeEnabled() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// -----------------------------
// Module root component
// -----------------------------
export default function ChoresModule({ ctx }) {
  // small card + overlay
  const enabled = useChoreModeEnabled();
  const [data, setData] = useState(() => normalizeChoresData(ctx.store.get(defaultChoresData())));

  // Persist to module store
  useEffect(() => {
    ctx.store.set(data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Publish chores views to sharedState so other modules can read them.
   * This runs whenever chores data changes.
   */
  useEffect(() => {
    const normalized = normalizeChoresData(data);
    const choresByDay = groupChoresByDay(normalized.chores);

    // Update sharedState
    const shared = ctx.sharedState.get() || {};
    const selectedDate = shared.selectedDate;
    const selectedDt = dateFromYMD(selectedDate);
    const choresForSelectedDate = getChoresForDateWithDone(normalized, selectedDt);

    ctx.sharedState.set({
      choresByDay,
      choresPeople: normalized.people,
      choresForSelectedDate,
    });

    // Events for anyone listening
    ctx.eventBus.emit("chores:changed", { choresByDay, data: normalized });
    ctx.eventBus.emit("choresForDate:changed", { selectedDate, chores: choresForSelectedDate });
  }, [data, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Keep choresForSelectedDate updated when calendar selection changes
   */
  useEffect(() => {
    const handler = (ymd) => {
      const normalized = normalizeChoresData(ctx.store.get(defaultChoresData()));
      const dt = dateFromYMD(ymd);
      const choresForSelectedDate = getChoresForDateWithDone(normalized, dt);
      ctx.sharedState.set({ choresForSelectedDate });
      ctx.eventBus.emit("choresForDate:changed", { selectedDate: ymd, chores: choresForSelectedDate });
    };

    ctx.eventBus.on?.("selectedDate:changed", handler);
    return () => ctx.eventBus.off?.("selectedDate:changed", handler);
  }, [ctx]);

  const todayName = useMemo(() => getDayName(new Date()), []);
  const weekKey = useMemo(() => getWeekKey(new Date()), []);
  const todayChores = useMemo(() => data.chores.filter((c) => c.day === todayName), [data.chores, todayName]);
  const doneMap = data.doneByWeek?.[weekKey] || {};
  const doneCount = useMemo(() => todayChores.filter((c) => !!doneMap[c.id]).length, [todayChores, doneMap]);

  return (
    <div className="h-full flex flex-col justify-between">
      <div className="flex items-center gap-2">
        <ClipboardList size={18} />
        <div className="font-semibold">Chores</div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="text-sm opacity-80">{todayName}</div>
        <div className="rounded-2xl bg-white/5 border border-white/15 px-3 py-2">
          <div className="text-sm opacity-90">
            {doneCount}/{todayChores.length} done today
          </div>
          <div className="text-xs opacity-70">Week of {weekKey}</div>
        </div>

        <button
          onClick={() => setChoreModeEnabled(true)}
          className="w-full rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-2 text-sm transition-all"
          aria-pressed={enabled}
        >
          Open chores
        </button>
      </div>

      <ChoreModeOverlay ctx={ctx} data={data} setData={setData} />
    </div>
  );
}

// -----------------------------
// Overlay UI (matches old app style)
// -----------------------------
export function ChoreModeOverlay({ ctx, data, setData }) {
  const enabled = useChoreModeEnabled();

  const [activeDay, setActiveDay] = useState("Monday");

  const weekKey = useMemo(() => getWeekKey(new Date()), []);
  const people = useMemo(() => normalizeChoresData(data).people, [data]);
  const chores = useMemo(() => normalizeChoresData(data).chores, [data]);
  const doneByWeek = data.doneByWeek || {};
  const doneMap = doneByWeek[weekKey] || {};

  const [newName, setNewName] = useState("");
  const [newPerson, setNewPerson] = useState(PEOPLE_DEFAULTS[0]);
  const [newPersonCustom, setNewPersonCustom] = useState("");
  const [newDay, setNewDay] = useState("Monday");

  // reset active day / week housekeeping on open
  useEffect(() => {
    if (!enabled) return;

    const dayName = getDayName(new Date());
    setActiveDay(dayName);
    setNewDay(dayName);

    if (!doneByWeek[weekKey]) {
      setData((prev) => {
        const s = normalizeChoresData(prev);
        return { ...s, doneByWeek: { ...(s.doneByWeek || {}), [weekKey]: {} } };
      });
    }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC to exit
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") setChoreModeEnabled(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  const todaysChores = useMemo(() => chores.filter((c) => c.day === activeDay), [chores, activeDay]);
  const todaysChoresByPerson = useMemo(() => groupChoresByPerson(todaysChores, people), [todaysChores, people]);

  const toggleDone = (choreId) => {
    setData((prev) => {
      const s = normalizeChoresData(prev);
      const wk = s.doneByWeek?.[weekKey] || {};
      const nextWk = { ...wk, [choreId]: !wk[choreId] };
      if (!nextWk[choreId]) delete nextWk[choreId];
      return { ...s, doneByWeek: { ...(s.doneByWeek || {}), [weekKey]: nextWk } };
    });
  };

  const addChore = () => {
    const name = newName.trim();
    if (!name) return;

    setData((prev) => {
      const s = normalizeChoresData(prev);

      let person = newPerson;
      let nextPeople = s.people;

      if (person === "__custom__") {
        const custom = newPersonCustom.trim();
        if (!custom) return s;
        person = custom;
        if (!nextPeople.includes(custom)) nextPeople = [...nextPeople, custom];
      }

      const chore = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        day: newDay,
        person,
        name,
        createdAt: Date.now(),
      };

      return { ...s, people: nextPeople, chores: [...(s.chores || []), chore] };
    });

    setNewName("");
    setNewPerson(PEOPLE_DEFAULTS[0]);
    setNewPersonCustom("");
  };

  const removeChore = (choreId) => {
    setData((prev) => {
      const s = normalizeChoresData(prev);
      const nextChores = (s.chores || []).filter((c) => c.id !== choreId);

      // Remove done marks across all weeks (keeps data clean)
      const nextDoneByWeek = { ...(s.doneByWeek || {}) };
      for (const wk of Object.keys(nextDoneByWeek)) {
        if (nextDoneByWeek[wk] && nextDoneByWeek[wk][choreId]) {
          const n = { ...nextDoneByWeek[wk] };
          delete n[choreId];
          nextDoneByWeek[wk] = n;
        }
      }

      return { ...s, chores: nextChores, doneByWeek: nextDoneByWeek };
    });
  };

  const clearChecksForWeek = () => {
    setData((prev) => {
      const s = normalizeChoresData(prev);
      return { ...s, doneByWeek: { ...(s.doneByWeek || {}), [weekKey]: {} } };
    });
  };

  if (!enabled) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm">
      <div className="absolute inset-0 p-4 md:p-8 overflow-auto">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/10 rounded-2xl">
                <ClipboardList className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-white text-2xl font-bold">Chores</div>
                <div className="text-white/60 text-sm">Weekly chores • checks reset each week</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={clearChecksForWeek}
                className="px-4 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm"
                title="Clear all checkmarks for this week"
              >
                Reset week
              </button>

              <button
                className="p-3 bg-white/10 backdrop-blur-lg rounded-xl hover:bg-white/20 transition-all"
                onClick={() => setChoreModeEnabled(false)}
                title="Close"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
          </div>

          {/* Day tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setActiveDay(d)}
                className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                  activeDay === d
                    ? "bg-white/20 text-white border-white/30"
                    : "bg-white/10 text-white/80 border-white/10 hover:bg-white/15"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* List */}
            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="text-white text-xl font-semibold">{activeDay}</div>
                <div className="text-white/50 text-sm">Week of {weekKey}</div>
              </div>

              <div className="space-y-5">
                {todaysChores.length ? (
                  people.map((person) => {
                    const list = todaysChoresByPerson[person] || [];
                    if (!list.length) return null;

                    return (
                      <div key={person} className="space-y-3">
                        <div className="px-3 py-2 rounded-2xl bg-white/5 border border-white/10">
                          <div className="text-white font-semibold">{person}</div>
                        </div>

                        <div className="space-y-3">
                          {list.map((c) => {
                            const done = !!doneMap[c.id];
                            return (
                              <div
                                key={c.id}
                                className={`flex items-center justify-between p-3 rounded-2xl transition-all ${
                                  done ? "bg-white/5 opacity-70" : "bg-white/5 hover:bg-white/10"
                                }`}
                              >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <button
                                    onClick={() => toggleDone(c.id)}
                                    className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                                      done ? "bg-green-500 border-green-500" : "border-white/40 hover:border-white/70"
                                    }`}
                                    title={done ? "Mark as not done" : "Mark as done"}
                                  >
                                    {done && <Check className="w-4 h-4 text-white" />}
                                  </button>

                                  <div className="min-w-0">
                                    <div className={`text-white font-medium truncate ${done ? "line-through" : ""}`}>
                                      {c.name}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  onClick={() => removeChore(c.id)}
                                  className="ml-3 p-2 rounded-lg hover:bg-white/10 transition-all text-red-200/80 hover:text-red-200"
                                  title="Remove chore"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-white/40 text-center py-10">No chores for {activeDay}. Add one on the right.</div>
                )}
              </div>
            </div>

            {/* Add form */}
            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
              <div className="text-white text-xl font-semibold mb-4">Add chore</div>

              <div className="space-y-4">
                <div>
                  <label className="text-white/70 text-sm mb-2 block">Day</label>
                  <select
                    value={newDay}
                    onChange={(e) => setNewDay(e.target.value)}
                    className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d} className="bg-slate-900 text-white">
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-white/70 text-sm mb-2 block">Person</label>
                  <select
                    value={newPerson}
                    onChange={(e) => setNewPerson(e.target.value)}
                    className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                  >
                    {people.map((p) => (
                      <option key={p} value={p} className="bg-slate-900 text-white">
                        {p}
                      </option>
                    ))}
                    <option value="__custom__" className="bg-slate-900 text-white">
                      Other...
                    </option>
                  </select>

                  {newPerson === "__custom__" && (
                    <input
                      type="text"
                      value={newPersonCustom}
                      onChange={(e) => setNewPersonCustom(e.target.value)}
                      placeholder="Type a name"
                      className="mt-2 w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
                    />
                  )}
                </div>

                <div>
                  <label className="text-white/70 text-sm mb-2 block">Chore</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addChore()}
                    placeholder="e.g., Take out trash"
                    className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
                  />
                </div>

                <button
                  onClick={addChore}
                  className="w-full p-3 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl text-white font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add chore
                </button>

                <div className="text-white/40 text-xs leading-relaxed">
                  Tip: chores repeat every week. The only thing that resets is the checkmarks.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-white/40 text-sm">
            Press <span className="text-white/60">ESC</span> to exit
          </div>
        </div>
      </div>
    </div>
  );
}
