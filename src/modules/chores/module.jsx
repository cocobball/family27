import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, X, Plus, Trash2, Check } from "lucide-react";
import {
  DAYS,
  PEOPLE_DEFAULTS,
  defaultChoresData,
  normalizeChoresData,
  getWeekKey,
  getDayName,
  dateFromYMD,
  groupChoresByPerson,
  groupChoresByDay,
  getChoresForDateWithDone,
} from "./helpers.js";

/**
 * Compatibility layer:
 * - Some dashboards use ctx.store.get/set (module-local)
 * - Some dashboards use ctx.store.getModuleData/setModuleData (moduleId-based)
 * - Some dashboards use ctx.eventBus + ctx.sharedState
 * - Some dashboards use ctx.bus + ctx.shared
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
// ctx compatibility helpers
// -----------------------------
function getBus(ctx) {
  return ctx.bus || ctx.eventBus;
}
function getShared(ctx) {
  return ctx.shared || ctx.sharedState;
}
function storeGet(ctx, fallbackValue) {
  const s = ctx.store;
  if (s?.getModuleData) return s.getModuleData(ctx.moduleId, fallbackValue);
  if (s?.get) return s.get(fallbackValue);
  return fallbackValue;
}
function storeSet(ctx, nextData) {
  const s = ctx.store;
  if (s?.setModuleData) return s.setModuleData(ctx.moduleId, nextData);
  if (s?.set) return s.set(nextData);
}
function sharedGetSelectedYMD(ctx) {
  const shared = getShared(ctx);
  if (!shared) return null;

  // Pattern A: shared.get("selectedDate")
  if (typeof shared.get === "function") {
    const v = shared.get("selectedDate");
    if (typeof v === "string" && v) return v;
    // Pattern B: shared.get() returns object
    const obj = shared.get();
    if (obj && typeof obj.selectedDate === "string") return obj.selectedDate;
  }

  return null;
}
function sharedSet(ctx, patchOrKey, maybeVal) {
  const shared = getShared(ctx);
  if (!shared) return;

  // Pattern A: shared.set({ ... })
  if (typeof shared.set === "function") {
    if (typeof patchOrKey === "string") {
      // support shared.set("key", value) if implemented
      try {
        return shared.set(patchOrKey, maybeVal);
      } catch {
        // fall through
      }
    }
    return shared.set(patchOrKey);
  }
}

// -----------------------------
// view helpers
// -----------------------------
function getWeekChoresWithDone(normalized, baseDate) {
  const weekKey = getWeekKey(baseDate);
  const doneMap = normalized.doneByWeek?.[weekKey] || {};
  const chores = (normalized.chores || []).map((c) => ({ ...c, done: !!doneMap[c.id] }));
  return { weekKey, chores, doneMap };
}

function sortWeekList(list) {
  const dayIndex = new Map(DAYS.map((d, i) => [d, i]));
  return list.slice().sort((a, b) => {
    const da = dayIndex.get(a.day) ?? 999;
    const db = dayIndex.get(b.day) ?? 999;
    if (da !== db) return da - db;
    return (a.name || "").localeCompare(b.name || "");
  });
}

// -----------------------------
// Module root component
// -----------------------------
export default function ChoresModule({ ctx }) {
  const enabled = useChoreModeEnabled();
  const bus = getBus(ctx);

  const [data, setData] = useState(() => normalizeChoresData(storeGet(ctx, defaultChoresData())));
  const [selectedYMD, setSelectedYMD] = useState(() => sharedGetSelectedYMD(ctx));

  // persist
  useEffect(() => {
    storeSet(ctx, data);
  }, [ctx, data]);

  // listen to calendar changes (supports multiple payload shapes)
  useEffect(() => {
    const handler = (payload) => {
      const ymd =
        typeof payload === "string"
          ? payload
          : typeof payload?.date === "string"
            ? payload.date
            : typeof payload?.ymd === "string"
              ? payload.ymd
              : null;

      if (ymd) {
        setSelectedYMD(ymd);
        // keep shared state in sync
        sharedSet(ctx, { selectedDate: ymd });
      }
    };

    bus?.on?.("selectedDate:changed", handler);
    return () => bus?.off?.("selectedDate:changed", handler);
  }, [bus, ctx]);

  const baseDate = useMemo(() => {
    if (!selectedYMD) return new Date();
    const dt = dateFromYMD(selectedYMD);
    return dt instanceof Date && !isNaN(dt) ? dt : new Date();
  }, [selectedYMD]);

  const viewMode = data.viewMode === "week" ? "week" : "day";
  const setViewMode = (mode) =>
    setData((prev) => {
      const s = normalizeChoresData(prev);
      return { ...s, viewMode: mode };
    });

  const normalized = useMemo(() => normalizeChoresData(data), [data]);
  const people = normalized.people || [];

  const cardModel = useMemo(() => {
    if (viewMode === "day") {
      const choresForDay = getChoresForDateWithDone(normalized, baseDate);
      const byPerson = groupChoresByPerson(choresForDay, people);
      const total = choresForDay.length;
      const done = choresForDay.filter((c) => c.done).length;
      return {
        mode: "day",
        title: getDayName(baseDate),
        subtitle: selectedYMD ? selectedYMD : "Today",
        weekKey: getWeekKey(baseDate),
        total,
        done,
        byPerson,
      };
    }

    const { weekKey, chores } = getWeekChoresWithDone(normalized, baseDate);
    const rawByPerson = groupChoresByPerson(chores, people);

    const byPerson = {};
    for (const person of people) {
      byPerson[person] = sortWeekList(rawByPerson[person] || []);
    }

    const total = chores.length;
    const done = chores.filter((c) => c.done).length;

    return {
      mode: "week",
      title: "Week",
      subtitle: `Week of ${weekKey}`,
      weekKey,
      total,
      done,
      byPerson,
    };
  }, [viewMode, normalized, baseDate, people, selectedYMD]);

  // publish some values for other modules if they want them (safe for both shared APIs)
  useEffect(() => {
    sharedSet(ctx, {
      choresViewMode: viewMode,
      choresWeekKey: cardModel.weekKey,
    });
  }, [ctx, viewMode, cardModel.weekKey]);

  // Publish chores data and choresForSelectedDate when chores data changes
  useEffect(() => {
    const normalized = normalizeChoresData(data);
    const selectedYMD = sharedGetSelectedYMD(ctx);
    const baseDate = selectedYMD ? dateFromYMD(selectedYMD) : new Date();

    const choresForSelectedDate = getChoresForDateWithDone(normalized, baseDate);

    sharedSet(ctx, {
      choresData: normalized,
      choresPeople: normalized.people,
      choresByDay: groupChoresByDay(normalized.chores),
      choresForSelectedDate,
    });

    const bus = getBus(ctx);
    bus?.emit?.("chores:changed", { data: normalized });
    bus?.emit?.("choresForDate:changed", { selectedDate: selectedYMD, chores: choresForSelectedDate });
  }, [data, ctx]);

  // Update choresForSelectedDate when selected date changes elsewhere
  useEffect(() => {
    const bus = getBus(ctx);
    const handler = (payload) => {
      const ymd = typeof payload === "string" ? payload : payload?.date || payload?.ymd;
      if (!ymd) return;

      const normalized = normalizeChoresData(storeGet(ctx, defaultChoresData()));
      const choresForSelectedDate = getChoresForDateWithDone(normalized, dateFromYMD(ymd));

      sharedSet(ctx, { choresForSelectedDate });
      bus?.emit?.("choresForDate:changed", { selectedDate: ymd, chores: choresForSelectedDate });
    };

    bus?.on?.("selectedDate:changed", handler);
    return () => bus?.off?.("selectedDate:changed", handler);
  }, [ctx]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2">
        <ClipboardList size={18} />
        <div className="font-semibold">Chores</div>

        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setViewMode("day")}
            className={`px-2 py-1 rounded-lg text-xs border transition-all ${
              viewMode === "day" ? "bg-white/20 border-white/30" : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setViewMode("week")}
            className={`px-2 py-1 rounded-lg text-xs border transition-all ${
              viewMode === "week" ? "bg-white/20 border-white/30" : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            Week
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2 flex-1 min-h-0">
        <div className="text-sm opacity-80">
          {cardModel.title} <span className="opacity-60">• {cardModel.subtitle}</span>
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/15 px-3 py-2">
          <div className="text-sm opacity-90">
            {cardModel.done}/{cardModel.total} done
          </div>
          <div className="text-xs opacity-70">Week of {cardModel.weekKey}</div>
        </div>

        {/* THIS is what was missing: list on the dashboard card */}
        <div className="rounded-2xl bg-white/5 border border-white/15 px-3 py-2 flex-1 min-h-0 overflow-auto">
          {cardModel.total === 0 ? (
            <div className="text-sm opacity-60 py-3">No chores to show.</div>
          ) : (
            people.map((person) => {
              const list = cardModel.byPerson[person] || [];
              if (!list.length) return null;

              return (
                <div key={person} className="py-2 border-b border-white/10 last:border-b-0">
                  <div className="text-sm font-semibold opacity-90 mb-1">{person}</div>
                  <div className="space-y-1">
                    {list.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm opacity-90">
                        <span className="inline-block w-4">{c.done ? "✅" : "⬜"}</span>
                        <span className={c.done ? "line-through opacity-70" : ""}>
                          {viewMode === "week" ? `${c.day}: ${c.name}` : c.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button
          onClick={() => setChoreModeEnabled(true)}
          className="w-full rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-2 text-sm transition-all"
          aria-pressed={enabled}
        >
          Open chores
        </button>
      </div>

      <ChoreModeOverlay ctx={ctx} data={data} setData={setData} baseDate={baseDate} />
    </div>
  );
}

// -----------------------------
// Overlay UI (calendar-week aware)
// -----------------------------
export function ChoreModeOverlay({ ctx, data, setData, baseDate }) {
  const enabled = useChoreModeEnabled();

  const normalized = useMemo(() => normalizeChoresData(data), [data]);
  const people = normalized.people || [];
  const chores = normalized.chores || [];

  const weekKey = useMemo(() => getWeekKey(baseDate || new Date()), [baseDate]);
  const doneByWeek = normalized.doneByWeek || {};
  const doneMap = doneByWeek[weekKey] || {};

  const [activeDay, setActiveDay] = useState(() => getDayName(baseDate || new Date()));

  const [newName, setNewName] = useState("");
  const [newPerson, setNewPerson] = useState(PEOPLE_DEFAULTS[0]);
  const [newPersonCustom, setNewPersonCustom] = useState("");
  const [newDay, setNewDay] = useState(() => getDayName(baseDate || new Date()));

  useEffect(() => {
    if (!enabled) return;

    const dayName = getDayName(baseDate || new Date());
    setActiveDay(dayName);
    setNewDay(dayName);

    if (!doneByWeek[weekKey]) {
      setData((prev) => {
        const s = normalizeChoresData(prev);
        return { ...s, doneByWeek: { ...(s.doneByWeek || {}), [weekKey]: {} } };
      });
    }
  }, [enabled, weekKey, baseDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock background scrolling when overlay is open
  useEffect(() => {
    if (!enabled) return;

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e) => e.key === "Escape" && setChoreModeEnabled(false);
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

  const overlayContent = (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm">
      <div className="h-screen overflow-auto">
        <div className="min-h-screen flex flex-col p-4 md:p-8">
          <div className="max-w-5xl mx-auto w-full flex-1">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/10 rounded-2xl">
                  <ClipboardList className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-white text-2xl font-bold">Chores</div>
                  <div className="text-white/60 text-sm">Weekly chores • checks for Week of {weekKey}</div>
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
    </div>
  );

  return createPortal(overlayContent, document.body);
}
