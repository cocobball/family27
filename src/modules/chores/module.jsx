import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, X, Plus, Settings, Check } from "lucide-react";
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

// ✅ Reuse Rewards parent unlock + session model (same password across app)
import { getRewardsData, unlockParent, isParentUnlocked } from "../rewards/helpers.js"; // <-- path matches your modules layout

// -----------------------------
// lightweight global toggle
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
// ctx helpers
// -----------------------------
function getBus(ctx) {
  return ctx.bus || ctx.eventBus;
}
function getShared(ctx) {
  return ctx.shared || ctx.sharedState;
}
function sharedGetSelectedYMD(ctx) {
  const shared = getShared(ctx);
  if (!shared) return null;
  if (typeof shared.get === "function") {
    const v = shared.get("selectedDate");
    if (typeof v === "string" && v) return v;
    const obj = shared.get();
    if (obj && typeof obj.selectedDate === "string") return obj.selectedDate;
  }
  return null;
}
function sharedSet(ctx, patchOrKey, maybeVal) {
  const shared = getShared(ctx);
  if (!shared) return;
  if (typeof shared.set === "function") {
    if (typeof patchOrKey === "string") {
      try {
        return shared.set(patchOrKey, maybeVal);
      } catch {}
    }
    return shared.set(patchOrKey);
  }
}

// -----------------------------
// Calendar-style module storage hook
// -----------------------------
function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);

  const data = useMemo(() => {
    const value = ctx?.store?.get ? ctx.store.get(defaultFn()) : defaultFn();
    return value;
  }, [ctx, defaultFn, rev]);

  const patch = (partial) => {
    const cur = ctx?.store?.get ? ctx.store.get(defaultFn()) : defaultFn();
    const next = { ...(cur || {}), ...(partial || {}) };
    ctx?.store?.set?.(next);
    setRev((r) => r + 1);
    return next;
  };

  return { data, patch };
}

// -----------------------------
// Rewards bridge (event-driven; Rewards already listens)
// -----------------------------
function emitRewardsCredit(ctx, { kidId, currency, amount, sourceRef, reason, metadata }) {
  const bus = getBus(ctx);
  bus?.emit?.("REWARDS/CREDIT", {
    kidId,
    currency,
    amount: Number(amount) || 0,
    sourceModule: "chores",
    sourceRef,
    reason: reason || "",
    metadata: metadata || {},
  });
}

// -----------------------------
// helpers
// -----------------------------
function sortWeekList(list) {
  const dayIndex = new Map(DAYS.map((d, i) => [d, i]));
  return list.slice().sort((a, b) => {
    const da = dayIndex.get(a.day) ?? 999;
    const db = dayIndex.get(b.day) ?? 999;
    if (da !== db) return da - db;
    return (a.name || "").localeCompare(b.name || "");
  });
}
function mapPersonToKidId(person) {
  const p = String(person || "").toLowerCase();
  if (p === "harvey") return "harvey";
  if (p === "brady") return "brady";
  return null; // only these two kids have wallets per Rewards module
}
function formatInlineReward(reward) {
  const r = reward && typeof reward === "object" ? reward : null;
  if (!r) return "";
  const m = Number(r.minutes || 0) || 0;
  const p = Number(r.points || 0) || 0;
  if (!m && !p) return "";
  const parts = [];
  if (m) parts.push(`${m}m`);
  if (p) parts.push(`${p}pt`);
  return `  •  +${parts.join(" +")}`;
}

// -----------------------------
// Parent gate (uses Rewards unlock)
// -----------------------------
function ParentGate({ ctx, title = "Parent", children, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const rewardsData = getRewardsData(ctx);
  const unlocked = isParentUnlocked(rewardsData);

  if (unlocked) return children;

  return (
    <div className="rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 p-5">
      <div className="text-white text-lg font-semibold">{title} required</div>
      <div className="text-white/60 text-sm mt-1">Enter the parent password (same as Rewards).</div>

      <div className="mt-4 flex gap-2">
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Parent password"
          className="flex-1 p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
        />
        <button
          onClick={() => {
            const ok = unlockParent(ctx, pin, 5);
            if (!ok) {
              setErr("Incorrect password.");
              return;
            }
            setErr("");
          }}
          className="px-4 py-3 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm"
        >
          Unlock
        </button>
      </div>

      {err ? <div className="text-red-200 text-sm mt-3">{err}</div> : null}

      <div className="mt-4 flex justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// -----------------------------
// Weekly bonus logic
// -----------------------------
function maybeGrantWeeklyBonus(ctx, choresData, weekKey, person) {
  const s = normalizeChoresData(choresData);

  const kidId = mapPersonToKidId(person);
  if (!kidId) return s; // only Harvey/Brady have wallets in Rewards

  const bonusCfg = s.settings?.weeklyBonusByPerson?.[person] || { minutes: 0, points: 0 };
  const bonusMinutes = Number(bonusCfg.minutes || 0) || 0;
  const bonusPoints = Number(bonusCfg.points || 0) || 0;
  if (bonusMinutes === 0 && bonusPoints === 0) return s;

  const already = !!(s.weeklyBonusGrantsByWeek?.[weekKey]?.[person]);
  if (already) return s;

  const personChores = (s.chores || []).filter((c) => c.person === person);
  if (!personChores.length) return s;

  const doneMap = s.doneByWeek?.[weekKey] || {};
  const allDone = personChores.every((c) => !!doneMap[c.id]);
  if (!allDone) return s;

  // record grant locally to prevent re-award
  const wk = { ...(s.weeklyBonusGrantsByWeek?.[weekKey] || {}) };
  wk[person] = { grantedAt: Date.now() };
  const next = { ...s, weeklyBonusGrantsByWeek: { ...(s.weeklyBonusGrantsByWeek || {}), [weekKey]: wk } };

  // award via Rewards event bus (idempotent at Rewards level too via sourceRef)
  if (bonusMinutes > 0) {
    emitRewardsCredit(ctx, {
      kidId,
      currency: "minutes",
      amount: bonusMinutes,
      sourceRef: `weekly:${weekKey}:${kidId}:minutes`,
      reason: "Weekly chores bonus",
      metadata: { weekKey, person },
    });
  }
  if (bonusPoints > 0) {
    emitRewardsCredit(ctx, {
      kidId,
      currency: "points",
      amount: bonusPoints,
      sourceRef: `weekly:${weekKey}:${kidId}:points`,
      reason: "Weekly chores bonus",
      metadata: { weekKey, person },
    });
  }

  return next;
}

// -----------------------------
// Module root
// -----------------------------
export default function ChoresModule({ ctx }) {
  const enabled = useChoreModeEnabled();
  const bus = getBus(ctx);

  const { data: rawData, patch } = useModuleData(ctx, defaultChoresData);
  const data = useMemo(() => normalizeChoresData(rawData), [rawData]);

  const [selectedYMD, setSelectedYMD] = useState(() => sharedGetSelectedYMD(ctx));
  const [settingsOpen, setSettingsOpen] = useState(false);

  // listen to calendar changes
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
  const setViewMode = (mode) => patch({ viewMode: mode });

  const people = data.people || [];

  const cardModel = useMemo(() => {
    const weekKey = getWeekKey(baseDate);
    if (viewMode === "day") {
      const choresForDay = getChoresForDateWithDone(data, baseDate);
      const byPerson = groupChoresByPerson(choresForDay, people);
      const total = choresForDay.length;
      const done = choresForDay.filter((c) => c.done).length;
      return {
        mode: "day",
        title: getDayName(baseDate),
        subtitle: selectedYMD ? selectedYMD : "Today",
        weekKey,
        total,
        done,
        byPerson,
      };
    }

    const doneMap = data.doneByWeek?.[weekKey] || {};
    const chores = (data.chores || []).map((c) => ({ ...c, done: !!doneMap[c.id] }));
    const rawByPerson = groupChoresByPerson(chores, people);
    const byPerson = {};
    for (const person of people) byPerson[person] = sortWeekList(rawByPerson[person] || []);
    return {
      mode: "week",
      title: "Week",
      subtitle: `Week of ${weekKey}`,
      weekKey,
      total: chores.length,
      done: chores.filter((c) => c.done).length,
      byPerson,
    };
  }, [viewMode, data, baseDate, people, selectedYMD]);

  // publish shared snapshots for other modules
  useEffect(() => {
    const normalized = normalizeChoresData(rawData);
    const selected = sharedGetSelectedYMD(ctx);
    const dt = selected ? dateFromYMD(selected) : new Date();
    const choresForSelectedDate = getChoresForDateWithDone(normalized, dt);

    sharedSet(ctx, {
      choresData: normalized,
      choresPeople: normalized.people,
      choresByDay: groupChoresByDay(normalized.chores),
      choresForSelectedDate,
    });

    bus?.emit?.("chores:changed", { data: normalized });
    bus?.emit?.("choresForDate:changed", { selectedDate: selected, chores: choresForSelectedDate });
  }, [rawData, ctx, bus]);

  // Child action: check only (cannot uncheck)
  const markDoneChild = (weekKey, chore) => {
    const curDone = !!(data.doneByWeek?.[weekKey]?.[chore.id]);
    if (curDone) return;

    // mark done
    const nextWeekDone = { ...(data.doneByWeek?.[weekKey] || {}), [chore.id]: true };
    const nextDoneByWeek = { ...(data.doneByWeek || {}), [weekKey]: nextWeekDone };

    // award immediate reward once per chore per week, per currency
    const reward = chore.reward || { minutes: 0, points: 0 };
    const minutes = Number(reward.minutes || 0) || 0;
    const points = Number(reward.points || 0) || 0;

    const kidId = mapPersonToKidId(chore.person);

    const wkGrants = { ...(data.rewardGrantsByWeek?.[weekKey] || {}) };
    const choreGrant = { ...(wkGrants[chore.id] || {}) };
    let changedGrant = false;

    if (kidId && minutes > 0 && !choreGrant.minutes) {
      emitRewardsCredit(ctx, {
        kidId,
        currency: "minutes",
        amount: minutes,
        sourceRef: `chore:${weekKey}:${chore.id}:minutes`,
        reason: `Chore: ${chore.name}`,
        metadata: { weekKey, choreId: chore.id, choreName: chore.name, person: chore.person },
      });
      choreGrant.minutes = true;
      changedGrant = true;
    }
    if (kidId && points > 0 && !choreGrant.points) {
      emitRewardsCredit(ctx, {
        kidId,
        currency: "points",
        amount: points,
        sourceRef: `chore:${weekKey}:${chore.id}:points`,
        reason: `Chore: ${chore.name}`,
        metadata: { weekKey, choreId: chore.id, choreName: chore.name, person: chore.person },
      });
      choreGrant.points = true;
      changedGrant = true;
    }

    let nextRewardGrantsByWeek = data.rewardGrantsByWeek || {};
    if (changedGrant) {
      wkGrants[chore.id] = { ...choreGrant, grantedAt: Date.now() };
      nextRewardGrantsByWeek = { ...(data.rewardGrantsByWeek || {}), [weekKey]: wkGrants };
    }

    const nextBase = {
      ...data,
      doneByWeek: nextDoneByWeek,
      rewardGrantsByWeek: nextRewardGrantsByWeek,
    };

    // weekly bonus check after marking done
    const nextAfterBonus = maybeGrantWeeklyBonus(ctx, nextBase, weekKey, chore.person);
    patch(nextAfterBonus);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2">
        <ClipboardList size={18} />
        <div className="font-semibold">Chores</div>

        <div className="ml-auto flex items-center gap-1">
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

          <button
            onClick={() => setSettingsOpen(true)}
            className="ml-1 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
            title="Settings (Parent)"
          >
            <Settings size={16} />
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
                        <button
                          type="button"
                          onClick={() => markDoneChild(cardModel.weekKey, c)}
                          className="flex items-center gap-2 w-full text-left"
                        >
                          <span className="inline-block w-4">{c.done ? "✅" : "⬜"}</span>
                          <span className={c.done ? "line-through opacity-70" : ""}>
                            {viewMode === "week" ? `${c.day}: ${c.name}` : c.name}
                            {formatInlineReward(c.reward)}
                          </span>
                        </button>
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

      <ChoreModeOverlay ctx={ctx} data={data} patch={patch} baseDate={baseDate} onChildMarkDone={markDoneChild} />

      <SettingsOverlay ctx={ctx} open={settingsOpen} onClose={() => setSettingsOpen(false)} data={data} patch={patch} />
    </div>
  );
}

// -----------------------------
// Overlay: kids check chores; parent tools are locked behind Rewards unlock
// -----------------------------
function ChoreModeOverlay({ ctx, data, patch, baseDate, onChildMarkDone }) {
  const enabled = useChoreModeEnabled();
  const normalized = useMemo(() => normalizeChoresData(data), [data]);
  const people = normalized.people || [];
  const chores = normalized.chores || [];

  const weekKey = useMemo(() => getWeekKey(baseDate || new Date()), [baseDate]);
  const doneMap = normalized.doneByWeek?.[weekKey] || {};
  const [activeDay, setActiveDay] = useState(() => getDayName(baseDate || new Date()));
  const [parentPanelOpen, setParentPanelOpen] = useState(false);

  // Add chore form (parent)
  const [newName, setNewName] = useState("");
  const [newPerson, setNewPerson] = useState(PEOPLE_DEFAULTS[0]);
  const [newPersonCustom, setNewPersonCustom] = useState("");
  const [newDay, setNewDay] = useState(() => getDayName(baseDate || new Date()));
  const [newRewardMinutes, setNewRewardMinutes] = useState(0);
  const [newRewardPoints, setNewRewardPoints] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const dayName = getDayName(baseDate || new Date());
    setActiveDay(dayName);
    setNewDay(dayName);
  }, [enabled, weekKey, baseDate]);

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

  // Parent-only: uncheck (no reward reversal; reward remains earned, and cannot be re-awarded due to grant tracking)
  const parentUncheck = (chore) => {
    const isDone = !!doneMap[chore.id];
    if (!isDone) return;

    const nextWeek = { ...(normalized.doneByWeek?.[weekKey] || {}) };
    delete nextWeek[chore.id];

    patch({
      ...normalized,
      doneByWeek: { ...(normalized.doneByWeek || {}), [weekKey]: nextWeek },
    });
  };

  // Parent-only: reset week checks (does NOT revoke rewards; just clears checkmarks)
  const parentResetWeek = () => {
    patch({
      ...normalized,
      doneByWeek: { ...(normalized.doneByWeek || {}), [weekKey]: {} },
      // keep grants so they can't re-earn by rechecking after reset
    });
  };

  const parentAddChore = () => {
    const name = newName.trim();
    if (!name) return;

    let person = newPerson;
    let nextPeople = normalized.people;

    if (person === "__custom__") {
      const custom = newPersonCustom.trim();
      if (!custom) return;
      person = custom;
      if (!nextPeople.includes(custom)) nextPeople = [...nextPeople, custom];
    }

    const rewardMinutes = Number(newRewardMinutes || 0) || 0;
    const rewardPoints = Number(newRewardPoints || 0) || 0;

    const chore = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      day: newDay,
      person,
      name,
      reward: { minutes: rewardMinutes, points: rewardPoints },
      createdAt: Date.now(),
    };

    patch({
      ...normalized,
      people: nextPeople,
      chores: [...(normalized.chores || []), chore],
    });

    setNewName("");
    setNewPerson(PEOPLE_DEFAULTS[0]);
    setNewPersonCustom("");
    setNewRewardMinutes(0);
    setNewRewardPoints(0);
  };

  const parentRemoveChore = (choreId) => {
    const nextChores = (normalized.chores || []).filter((c) => c.id !== choreId);

    // remove from done maps (grants remain as historical “already paid” markers)
    const nextDoneByWeek = { ...(normalized.doneByWeek || {}) };
    for (const wk of Object.keys(nextDoneByWeek)) {
      if (nextDoneByWeek[wk] && nextDoneByWeek[wk][choreId]) {
        const n = { ...nextDoneByWeek[wk] };
        delete n[choreId];
        nextDoneByWeek[wk] = n;
      }
    }

    patch({
      ...normalized,
      chores: nextChores,
      doneByWeek: nextDoneByWeek,
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
                  <div className="text-white/60 text-sm">Check chores • Week of {weekKey}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setParentPanelOpen((v) => !v)}
                  className="px-4 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm border border-white/10"
                  title="Parent tools"
                >
                  Parent
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

            {parentPanelOpen ? (
              <div className="mb-6">
                <ParentGate ctx={ctx} title="Parent tools" onCancel={() => setParentPanelOpen(false)}>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-white text-xl font-semibold">Week controls</div>
                        <div className="text-white/50 text-sm">{weekKey}</div>
                      </div>

                      <button
                        onClick={parentResetWeek}
                        className="w-full px-4 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm border border-white/10"
                      >
                        Reset week (clears checks)
                      </button>

                      <div className="text-white/40 text-xs mt-3">
                        Note: resetting does not revoke already-earned rewards; it only clears checkmarks.
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

                          {newPerson === "__custom__" ? (
                            <input
                              type="text"
                              value={newPersonCustom}
                              onChange={(e) => setNewPersonCustom(e.target.value)}
                              placeholder="Type a name"
                              className="mt-2 w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
                            />
                          ) : null}
                        </div>

                        <div>
                          <label className="text-white/70 text-sm mb-2 block">Chore</label>
                          <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && parentAddChore()}
                            placeholder="e.g., Take out trash"
                            className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-white/70 text-sm mb-2 block">Reward minutes</label>
                            <input
                              type="number"
                              value={newRewardMinutes}
                              onChange={(e) => setNewRewardMinutes(e.target.value)}
                              className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                            />
                          </div>
                          <div>
                            <label className="text-white/70 text-sm mb-2 block">Reward points</label>
                            <input
                              type="number"
                              value={newRewardPoints}
                              onChange={(e) => setNewRewardPoints(e.target.value)}
                              className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                            />
                          </div>
                        </div>

                        <button
                          onClick={parentAddChore}
                          className="w-full p-3 rounded-xl text-white font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20"
                        >
                          <Plus className="w-5 h-5" />
                          Add chore
                        </button>

                        <div className="text-white/40 text-xs leading-relaxed">
                          If you set a reward, it is granted immediately when the chore is checked (once per week).
                        </div>
                      </div>
                    </div>
                  </div>
                </ParentGate>
              </div>
            ) : null}

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
                                    done ? "bg-white/5 opacity-80" : "bg-white/5 hover:bg-white/10"
                                  }`}
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <button
                                      onClick={() => {
                                        if (!done) onChildMarkDone(weekKey, c);
                                        else setParentPanelOpen(true); // uncheck requires parent
                                      }}
                                      className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                                        done ? "bg-green-500 border-green-500" : "border-white/40 hover:border-white/70"
                                      }`}
                                      title={done ? "Done (parent required to uncheck)" : "Mark as done"}
                                    >
                                      {done ? <Check className="w-4 h-4 text-white" /> : null}
                                    </button>

                                    <div className="min-w-0">
                                      <div className={`text-white font-medium truncate ${done ? "line-through" : ""}`}>
                                        {c.name}
                                        <span className="text-white/60 text-xs">{formatInlineReward(c.reward)}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {parentPanelOpen ? (
                                    <ParentGate ctx={ctx} title="Parent action" onCancel={() => setParentPanelOpen(false)}>
                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={() => parentUncheck(c)}
                                          className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm"
                                        >
                                          Uncheck
                                        </button>
                                        <button
                                          onClick={() => parentRemoveChore(c.id)}
                                          className="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-200/20 text-red-100 text-sm"
                                        >
                                          Remove chore
                                        </button>
                                      </div>
                                    </ParentGate>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-white/40 text-center py-10">No chores for {activeDay}.</div>
                  )}
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                <div className="text-white text-xl font-semibold mb-2">Weekly bonus</div>
                <div className="text-white/60 text-sm mb-4">
                  When a child finishes <span className="text-white/80">all chores for the week</span>, they earn their
                  bonus.
                </div>

                <div className="space-y-3 text-white/80 text-sm">
                  {["Harvey", "Brady"].map((kid) => {
                    const cfg = normalized.settings?.weeklyBonusByPerson?.[kid] || { minutes: 0, points: 0 };
                    const granted = normalized.weeklyBonusGrantsByWeek?.[weekKey]?.[kid];
                    return (
                      <div key={kid} className="rounded-2xl bg-white/5 border border-white/10 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-white">{kid}</div>
                          <div className="text-white/70 text-xs">
                            Bonus: {Number(cfg.minutes || 0) || 0}m • {Number(cfg.points || 0) || 0}pt
                          </div>
                        </div>
                        <div className="mt-2 text-white/60 text-xs">{granted ? "✅ Bonus granted" : "Not yet granted"}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-white/40 text-xs mt-4">Change bonus amounts in Settings (gear icon).</div>
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

// -----------------------------
// Settings overlay (gear icon) — parent-only
// -----------------------------
function SettingsOverlay({ ctx, open, onClose, data, patch }) {
  if (!open) return null;

  const normalized = normalizeChoresData(data);

  const content = (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm">
      <div className="h-screen overflow-auto">
        <div className="min-h-screen flex flex-col p-4 md:p-8">
          <div className="max-w-3xl mx-auto w-full flex-1">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/10 rounded-2xl">
                  <Settings className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-white text-2xl font-bold">Chores Settings</div>
                  <div className="text-white/60 text-sm">Parent-only settings</div>
                </div>
              </div>

              <button
                className="p-3 bg-white/10 backdrop-blur-lg rounded-xl hover:bg-white/20 transition-all"
                onClick={onClose}
                title="Close"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            <ParentGate ctx={ctx} title="Settings" onCancel={onClose}>
              <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                <div className="text-white text-xl font-semibold mb-2">Weekly bonus rewards</div>
                <div className="text-white/60 text-sm mb-5">
                  When a child completes <span className="text-white/80">all their chores</span> for the week, grant this
                  bonus.
                </div>

                {["Harvey", "Brady"].map((kid) => {
                  const cfg = normalized.settings?.weeklyBonusByPerson?.[kid] || { minutes: 0, points: 0 };
                  return (
                    <div key={kid} className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-3">
                      <div className="text-white font-semibold mb-3">{kid}</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-white/70 text-sm mb-2 block">Minutes</label>
                          <input
                            type="number"
                            value={Number(cfg.minutes || 0) || 0}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0) || 0;
                              patch({
                                ...normalized,
                                settings: {
                                  ...(normalized.settings || {}),
                                  weeklyBonusByPerson: {
                                    ...(normalized.settings?.weeklyBonusByPerson || {}),
                                    [kid]: { ...(cfg || {}), minutes: v },
                                  },
                                },
                              });
                            }}
                            className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                          />
                        </div>

                        <div>
                          <label className="text-white/70 text-sm mb-2 block">Points</label>
                          <input
                            type="number"
                            value={Number(cfg.points || 0) || 0}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0) || 0;
                              patch({
                                ...normalized,
                                settings: {
                                  ...(normalized.settings || {}),
                                  weeklyBonusByPerson: {
                                    ...(normalized.settings?.weeklyBonusByPerson || {}),
                                    [kid]: { ...(cfg || {}), points: v },
                                  },
                                },
                              });
                            }}
                            className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                          />
                        </div>
                      </div>

                      <div className="text-white/40 text-xs mt-3">Set either to 0 if you don’t want that reward type.</div>
                    </div>
                  );
                })}

                <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="text-white font-semibold">Chore editing moved</div>
                  <div className="text-white/60 text-sm mt-1">
                    Adding/removing chores and unchecking is available in the Chores overlay under{" "}
                    <span className="text-white/80">Parent</span>.
                  </div>
                </div>
              </div>
            </ParentGate>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
