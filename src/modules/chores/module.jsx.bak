// src/modules/chores/module.jsx
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, X, Plus, Settings, Check, Trash2 } from "lucide-react";

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
  isHelperExpired,
} from "./helpers.js";

import { getRewardsData, unlockParent, isParentUnlocked, defaultRewardsData } from "../rewards/helpers.js";
import { setKidsInternet } from "../../api/kidsInternet.js";

// -----------------------------
// lightweight global toggle
// -----------------------------
let _enabled = false;
const _listeners = new Set();
function _notify() { for (const l of _listeners) l(); }
export function setChoreModeEnabled(val) { _enabled = !!val; _notify(); }
function subscribe(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
function getSnapshot() { return _enabled; }
export function useChoreModeEnabled() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// -----------------------------
// ctx helpers
// -----------------------------
function getBus(ctx) { return ctx.bus || ctx.eventBus; }
function getShared(ctx) { return ctx.shared || ctx.sharedState; }

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
      try { return shared.set(patchOrKey, maybeVal); } catch {}
    }
    return shared.set(patchOrKey);
  }
}

// -----------------------------
// Calendar-style module storage hook (server-backed)
// -----------------------------
function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);
  const s = ctx?.store;

  const data = useMemo(() => {
    if (s?.getModuleData) {
      return s.getModuleData("chores", defaultFn());
    }
    return s?.get?.(defaultFn()) ?? defaultFn();
  }, [ctx, s, defaultFn, rev]);

  useEffect(() => {
    if (!s || typeof s.subscribe !== "function") return;
    const unsub = s.subscribe(() => setRev((r) => r + 1));
    return () => unsub?.();
  }, [s]);

  const patch = useCallback((partialOrFullNext) => {
    let cur;
    if (s?.getModuleData) cur = s.getModuleData("chores", defaultFn());
    else cur = s?.get?.(defaultFn()) ?? defaultFn();

    const next =
      partialOrFullNext && typeof partialOrFullNext === "object" && partialOrFullNext.version
        ? partialOrFullNext
        : { ...(cur || {}), ...(partialOrFullNext || {}) };

    if (s?.setModuleData) s.setModuleData("chores", next);
    else if (s?.set) s.set(next);

    setRev((r) => r + 1);
    return next;
  }, [s, defaultFn]);

  return { data, patch };
}

// -----------------------------
// Rewards bridge (event-driven)
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
  return null;
}

function toEndOfDayTs(dateStr /* YYYY-MM-DD */) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  return dt.getTime();
}

// -----------------------------
// Parent gate (uses Rewards unlock)
// -----------------------------
function ParentGate({ ctx, title = "Parent", children, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const [rev, setRev] = useState(0);

  const s = ctx?.store;

  const rewardsData = useMemo(() => {
    if (s?.getModuleData) return s.getModuleData("rewards", defaultRewardsData());
    return getRewardsData(ctx);
  }, [ctx, s, rev]);

  useEffect(() => {
    const s = ctx?.store;
    if (!s || typeof s.subscribe !== "function") return;
    const unsub = s.subscribe(() => setRev((r) => r + 1));
    return () => unsub?.();
  }, [ctx]);

  useEffect(() => {
    if (!localUnlocked) return;
    const timer = setTimeout(() => {
      if (isParentUnlocked(rewardsData)) return;
      setLocalUnlocked(false);
    }, 100);
    return () => clearTimeout(timer);
  }, [localUnlocked, rewardsData]);

  const unlocked = localUnlocked || isParentUnlocked(rewardsData);
  if (unlocked) return children;

  const handleUnlock = () => {
    const rewardsCtx = {
      ...ctx,
      store: {
        ...ctx.store,
        get: () =>
          ctx.store?.getModuleData
            ? ctx.store.getModuleData("rewards", defaultRewardsData())
            : getRewardsData(ctx),
        set: (next) => {
          if (ctx.store?.setModuleData) return ctx.store.setModuleData("rewards", next);
          return ctx.store?.set?.(next);
        },
      },
    };

    const ok = ctx.store?.setModuleData ? unlockParent(rewardsCtx, pin, 5) : unlockParent(ctx, pin, 5);
    if (!ok) {
      setErr("Incorrect password.");
      return;
    }
    setErr("");
    setLocalUnlocked(true);
    setRev((r) => r + 1);
  };

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
          onClick={handleUnlock}
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
// Helper tasks logic (unchanged; still can award bonus)
// -----------------------------
function syncHelperExpiry(choresData) {
  const s = normalizeChoresData(choresData);
  const nowMs = Date.now();
  let changed = false;

  const nextTasks = (s.helperTasks || []).map((t) => {
    if (!t) return t;
    if (t.status === "completed") return t;
    const expired = isHelperExpired(t, nowMs);
    if (expired && t.status !== "expired") {
      changed = true;
      return { ...t, status: "expired" };
    }
    if (!expired && t.status === "expired" && t.expiresAt && nowMs <= t.expiresAt) {
      changed = true;
      return { ...t, status: "active" };
    }
    return t;
  });

  return changed ? { ...s, helperTasks: nextTasks } : s;
}

function helperGrantKey(helperId, kidId, currency) {
  return `helper:${helperId}:${kidId}:${currency}`;
}

function awardHelperTask(ctx, choresData, helperTask, completedByKidIds) {
  const s0 = normalizeChoresData(choresData);
  const s = syncHelperExpiry(s0);
  const cur = (s.helperTasks || []).find((t) => t.id === helperTask.id);
  if (!cur || cur.status !== "active") return s;

  const minutes = Number(cur.reward?.minutes || 0) || 0;
  const points = Number(cur.reward?.points || 0) || 0;

  const nextGrants = { ...(s.helperGrants || {}) };
  const perHelper = { ...(nextGrants[cur.id] || {}) };

  for (const kidId of completedByKidIds) {
    if (kidId !== "harvey" && kidId !== "brady") continue;
    const perKid = { ...(perHelper[kidId] || {}) };

    if (minutes > 0 && !perKid.minutes) {
      emitRewardsCredit(ctx, {
        kidId,
        currency: "minutes",
        amount: minutes,
        sourceRef: helperGrantKey(cur.id, kidId, "minutes"),
        reason: `Helper: ${cur.title}`,
        metadata: { helperId: cur.id, title: cur.title },
      });
      perKid.minutes = true;
    }

    if (points > 0 && !perKid.points) {
      emitRewardsCredit(ctx, {
        kidId,
        currency: "points",
        amount: points,
        sourceRef: helperGrantKey(cur.id, kidId, "points"),
        reason: `Helper: ${cur.title}`,
        metadata: { helperId: cur.id, title: cur.title },
      });
      perKid.points = true;
    }

    if (perKid.minutes || perKid.points) {
      perKid.grantedAt = Date.now();
      perHelper[kidId] = perKid;
    }
  }

  nextGrants[cur.id] = perHelper;

  const nextTasks = (s.helperTasks || []).map((t) =>
    t.id === cur.id ? { ...t, status: "completed", completedAt: Date.now(), completedBy: completedByKidIds.slice() } : t
  );

  return { ...s, helperGrants: nextGrants, helperTasks: nextTasks };
}

// -----------------------------
// Daily completion + Kids Internet gating
// -----------------------------
function ymdFromDate(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function computeKidDayCompletion(data, dateObj) {
  const s = normalizeChoresData(data);
  const wk = getWeekKey(dateObj);
  const doneMap = s.doneByWeek?.[wk] || {};
  const dayName = getDayName(dateObj);

  const choresToday = (s.chores || []).filter((c) => c.day === dayName);
  const kidChoresToday = choresToday.filter((c) => mapPersonToKidId(c.person));

  const byKid = { harvey: [], brady: [] };
  for (const c of kidChoresToday) {
    const kid = mapPersonToKidId(c.person);
    if (!kid) continue;
    byKid[kid].push(c);
  }

  const harveyAllDone = byKid.harvey.length ? byKid.harvey.every((c) => !!doneMap[c.id]) : false;
  const bradyAllDone = byKid.brady.length ? byKid.brady.every((c) => !!doneMap[c.id]) : false;

  // “All kids complete” only if at least one kid has chores today
  const anyKidHasChores = byKid.harvey.length > 0 || byKid.brady.length > 0;
  const allKidsComplete = anyKidHasChores ? (harveyAllDone && bradyAllDone) : false;

  return { harveyAllDone, bradyAllDone, allKidsComplete, anyKidHasChores };
}

async function maybeSendKidsInternetCommand({ ctx, data, patch, dateObj, desired }) {
  // desired: "allow" | "block"
  const normalized = normalizeChoresData(data);
  const lastSent = normalized.kidsInternetLastSent || null;
  if (desired === lastSent) return;

  try {
    await setKidsInternet(desired);
    patch({ ...normalized, kidsInternetLastSent: desired });
  } catch (e) {
    console.error("[CHORES] kids internet toggle failed:", e);
    // Do NOT update lastSent if failed; avoids “stuck” state.
  }
}

// -----------------------------
// Module root
// -----------------------------
export default function ChoresModule({ ctx }) {
  const enabled = useChoreModeEnabled();
  const bus = getBus(ctx);

  const { data: rawData, patch } = useModuleData(ctx, defaultChoresData);
  const data0 = useMemo(() => normalizeChoresData(rawData), [rawData]);

  // Derive helper expiry for UI without auto-writing back to the store.
  const data = useMemo(() => syncHelperExpiry(data0), [data0]);

  const [selectedYMD, setSelectedYMD] = useState(() => sharedGetSelectedYMD(ctx));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helperChooser, setHelperChooser] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);

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
  const activeHelpers = useMemo(() => (data.helperTasks || []).filter((t) => t.status === "active"), [data.helperTasks]);

  // derived card model
  const cardModel = useMemo(() => {
    const weekKey = getWeekKey(baseDate);

    if (viewMode === "day") {
      const choresForDay = getChoresForDateWithDone(data, baseDate);
      const byPerson = groupChoresByPerson(choresForDay, people);
      const total = choresForDay.length;
      const done = choresForDay.filter((c) => c.done).length;
      const helpersActive = (data.helperTasks || []).filter((t) => t.status === "active").length;

      return {
        mode: "day",
        title: getDayName(baseDate),
        subtitle: selectedYMD ? selectedYMD : "Today",
        weekKey,
        total,
        done,
        byPerson,
        helpersActive,
      };
    }

    const doneMap = data.doneByWeek?.[weekKey] || {};
    const chores = (data.chores || []).map((c) => ({ ...c, done: !!doneMap[c.id] }));
    const rawByPerson = groupChoresByPerson(chores, people);
    const byPerson = {};
    for (const person of people) byPerson[person] = sortWeekList(rawByPerson[person] || []);
    const helpersActive = (data.helperTasks || []).filter((t) => t.status === "active").length;

    return {
      mode: "week",
      title: "Week",
      subtitle: `Week of ${weekKey}`,
      weekKey,
      total: chores.length,
      done: chores.filter((c) => c.done).length,
      byPerson,
      helpersActive,
    };
  }, [viewMode, data, baseDate, people, selectedYMD]);

  // broadcast for other modules (unchanged)
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
      helperTasks: normalized.helperTasks || [],
    });

    bus?.emit?.("chores:changed", { data: normalized });
    bus?.emit?.("choresForDate:changed", { selectedDate: selected, chores: choresForSelectedDate });
  }, [rawData, ctx, bus]);

  // Mark done: NO REWARDS per chore anymore.
  const markDoneChild = async (weekKey, chore) => {
    const curDone = !!(data.doneByWeek?.[weekKey]?.[chore.id]);
    if (curDone) return;

    const nextWeekDone = { ...(data.doneByWeek?.[weekKey] || {}), [chore.id]: true };
    const nextDoneByWeek = { ...(data.doneByWeek || {}), [weekKey]: nextWeekDone };
    const nextBase = { ...data, doneByWeek: nextDoneByWeek };
    patch(nextBase);

    // Kids Internet toggle (transition gated, NO status polling)
    const completion = computeKidDayCompletion(nextBase, baseDate);
    if (completion.anyKidHasChores) {
      const desired = completion.allKidsComplete ? "allow" : "block";
      await maybeSendKidsInternetCommand({ ctx, data: nextBase, patch, dateObj: baseDate, desired });
    }
  };

  // Daily “Turn in” (credits minutes once per kid per day, after their chores complete)
  const turnInKidForDay = (kidId) => {
    const normalized = normalizeChoresData(data);
    const settings = normalized.settings?.gametime || { enabled: false, minutesPerDay: 60 };
    if (!settings.enabled) return;

    const minutes = Math.max(0, Math.floor(Number(settings.minutesPerDay || 0)));
    if (minutes <= 0) return;

    const ymd = selectedYMD || ymdFromDate(baseDate);
    const perDay = { ...(normalized.dailyTurnIns?.[ymd] || {}) };
    if (perDay[kidId]) return; // already turned in

    // idempotent sourceRef (safe across refresh + re-renders)
    const sourceRef = `daily:${ymd}:${kidId}:minutes`;

    emitRewardsCredit(ctx, {
      kidId,
      currency: "minutes",
      amount: minutes,
      sourceRef,
      reason: "Daily chores complete (gametime)",
      metadata: { ymd, kidId, minutesPerDay: minutes },
    });

    perDay[kidId] = true;

    patch({
      ...normalized,
      dailyTurnIns: {
        ...(normalized.dailyTurnIns || {}),
        [ymd]: perDay,
      },
    });
  };

  const completionToday = useMemo(() => computeKidDayCompletion(data, baseDate), [data, baseDate]);
  const ymdToday = selectedYMD || ymdFromDate(baseDate);
  const turnedInToday = data.dailyTurnIns?.[ymdToday] || {};
  const gametimeEnabled = !!data.settings?.gametime?.enabled;
  const minutesPerDay = Number(data.settings?.gametime?.minutesPerDay || 0) || 0;

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
          <div className="text-xs opacity-70 mt-1">Helpers available: {cardModel.helpersActive}</div>

          {/* Gametime turn-in status (kids) */}
          <div className="mt-3 rounded-xl bg-white/5 border border-white/10 p-2">
            <div className="text-xs opacity-80 font-semibold">Daily Gametime</div>
            {gametimeEnabled ? (
              <div className="text-xs opacity-70 mt-1">
                Enabled • {minutesPerDay} min/day • Claim after your chores are done
              </div>
            ) : (
              <div className="text-xs opacity-60 mt-1">Disabled (enable in Settings)</div>
            )}

            {gametimeEnabled && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <TurnInCard
                  kidId="harvey"
                  label="Harvey"
                  complete={completionToday.harveyAllDone}
                  already={!!turnedInToday.harvey}
                  minutes={minutesPerDay}
                  onTurnIn={() => turnInKidForDay("harvey")}
                />
                <TurnInCard
                  kidId="brady"
                  label="Brady"
                  complete={completionToday.bradyAllDone}
                  already={!!turnedInToday.brady}
                  minutes={minutesPerDay}
                  onTurnIn={() => turnInKidForDay("brady")}
                />
              </div>
            )}
          </div>
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
                          onClick={() => {
                            if (!c.done) {
                              setPendingConfirm({ type: "chore", weekKey: cardModel.weekKey, chore: c });
                            }
                          }}
                          className="flex items-center gap-2 w-full text-left"
                        >
                          <span className="inline-block w-4">{c.done ? "✅" : "⬜"}</span>
                          <span className={c.done ? "line-through opacity-70" : ""}>
                            {viewMode === "week" ? `${c.day}: ${c.name}` : c.name}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {/* Helpers block */}
          {activeHelpers.length > 0 && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <div className="text-sm font-semibold opacity-90 mb-2">Daily Helper</div>
              <div className="space-y-2">
                {activeHelpers.map((t) => (
                  <div key={t.id} className="rounded-xl bg-white/5 border border-white/10 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm opacity-90 font-medium">{t.title}</div>
                        <div className="text-xs opacity-60 mt-0.5">{(t.assignedTo || []).join(", ")}</div>
                        {t.expiresAt && (
                          <div className="text-xs opacity-50 mt-0.5">
                            Expires: {new Date(t.expiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setPendingConfirm({ type: "helper", task: t })}
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs"
                      >
                        Complete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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

      <ChoreModeOverlay
        ctx={ctx}
        data={data}
        patch={patch}
        baseDate={baseDate}
        onChildMarkDone={markDoneChild}
        helperChooser={helperChooser}
        setHelperChooser={setHelperChooser}
      />

      <SettingsOverlay ctx={ctx} open={settingsOpen} onClose={() => setSettingsOpen(false)} data={data} patch={patch} />

      {helperChooser ? (
        <HelperChooserModal
          task={(data.helperTasks || []).find((t) => t.id === helperChooser.taskId)}
          options={helperChooser.options}
          onCancel={() => setHelperChooser(null)}
          onConfirm={(kids) => {
            const s = syncHelperExpiry(data);
            const task = (s.helperTasks || []).find((t) => t.id === helperChooser.taskId);
            if (!task) return setHelperChooser(null);
            const next = awardHelperTask(ctx, s, task, kids);
            patch(next);
            setHelperChooser(null);
          }}
        />
      ) : null}

      {pendingConfirm ? (
        <ConfirmCompleteModal
          title="Confirm completion"
          subtitle={pendingConfirm.type === "chore" ? pendingConfirm.chore.name : pendingConfirm.task.title}
          details={
            pendingConfirm.type === "chore"
              ? `Assigned to: ${pendingConfirm.chore.person}`
              : `Assigned to: ${(pendingConfirm.task.assignedTo || []).join(", ")}`
          }
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            if (pendingConfirm.type === "chore") {
              markDoneChild(pendingConfirm.weekKey, pendingConfirm.chore);
              setPendingConfirm(null);
            } else if (pendingConfirm.type === "helper") {
              const s = syncHelperExpiry(data);
              const nowTask = (s.helperTasks || []).find((t) => t.id === pendingConfirm.task.id);
              if (nowTask && nowTask.status === "active") {
                const options = nowTask.assignedTo || [];
                if (options.length <= 1) {
                  const next = awardHelperTask(ctx, s, nowTask, options);
                  patch(next);
                } else {
                  setHelperChooser({ taskId: nowTask.id, options });
                }
              }
              setPendingConfirm(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function TurnInCard({ label, complete, already, minutes, onTurnIn }) {
  const disabled = !complete || already || minutes <= 0;
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold opacity-90">{label}</div>
        <div className="text-[11px] opacity-70">
          {already ? "✅ Turned in today" : complete ? "Ready to turn in" : "Finish chores first"}
        </div>
      </div>
      <button
        disabled={disabled}
        onClick={() => !disabled && onTurnIn()}
        className={`px-2 py-1 rounded-lg border text-xs transition-all ${
          disabled ? "bg-white/5 border-white/10 opacity-40 cursor-not-allowed" : "bg-white/10 hover:bg-white/20 border-white/15"
        }`}
      >
        Claim {minutes}m
      </button>
    </div>
  );
}

// -----------------------------
// Overlay
// -----------------------------
function ChoreModeOverlay({ ctx, data, patch, baseDate, onChildMarkDone, helperChooser, setHelperChooser }) {
  const enabled = useChoreModeEnabled();
  const normalized0 = useMemo(() => normalizeChoresData(data), [data]);
  const normalized = useMemo(() => syncHelperExpiry(normalized0), [normalized0]);

  const people = normalized.people || [];
  const chores = normalized.chores || [];
  const weekKey = useMemo(() => getWeekKey(baseDate || new Date()), [baseDate]);
  const doneMap = normalized.doneByWeek?.[weekKey] || {};

  const [parentPanelOpen, setParentPanelOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);

  // Add weekly chore form (parent)
  const [newName, setNewName] = useState("");
  const [newPerson, setNewPerson] = useState(PEOPLE_DEFAULTS[0]);
  const [newPersonCustom, setNewPersonCustom] = useState("");
  const [newDay, setNewDay] = useState(() => getDayName(baseDate || new Date()));

  // Add helper task form (parent)
  const [helperTitle, setHelperTitle] = useState("");
  const [helperAssignHarvey, setHelperAssignHarvey] = useState(true);
  const [helperAssignBrady, setHelperAssignBrady] = useState(false);
  const [helperRewardMinutes, setHelperRewardMinutes] = useState(0);
  const [helperRewardPoints, setHelperRewardPoints] = useState(0);
  const [helperExpiryDate, setHelperExpiryDate] = useState(""); // YYYY-MM-DD

  useEffect(() => {
    if (!enabled) return;
    const dayName = getDayName(baseDate || new Date());
    setNewDay(dayName);
  }, [enabled, weekKey, baseDate]);

  useEffect(() => {
    if (!enabled) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e) => e.key === "Escape" && setChoreModeEnabled(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  const todaysChores = useMemo(() => chores.filter((c) => c.day === newDay), [chores, newDay]);
  const todaysChoresByPerson = useMemo(() => groupChoresByPerson(todaysChores, people), [todaysChores, people]);

  const activeHelpers = useMemo(() => (normalized.helperTasks || []).filter((t) => t.status === "active"), [normalized.helperTasks]);
  const expiredHelpers = useMemo(() => (normalized.helperTasks || []).filter((t) => t.status === "expired"), [normalized.helperTasks]);

  // Parent-only: uncheck weekly chore (NO reward reversal now; we don’t award per-chore)
  const parentUncheck = async (chore) => {
    const isDone = !!doneMap[chore.id];
    if (!isDone) return;

    const nextWeek = { ...(normalized.doneByWeek?.[weekKey] || {}) };
    delete nextWeek[chore.id];

    const nextData = { ...normalized, doneByWeek: { ...(normalized.doneByWeek || {}), [weekKey]: nextWeek } };
    patch(nextData);

    // Kids Internet toggle update
    const completion = computeKidDayCompletion(nextData, baseDate);
    if (completion.anyKidHasChores) {
      const desired = completion.allKidsComplete ? "allow" : "block";
      await maybeSendKidsInternetCommand({ ctx, data: nextData, patch, dateObj: baseDate, desired });
    }
  };

  // Parent-only: reset week (just clears done flags)
  const parentResetWeekSafe = async () => {
    const nextData = {
      ...normalized,
      doneByWeek: { ...(normalized.doneByWeek || {}), [weekKey]: {} },
    };
    patch(nextData);

    // After reset, block internet (if there are kid chores today)
    const completion = computeKidDayCompletion(nextData, baseDate);
    if (completion.anyKidHasChores) {
      await maybeSendKidsInternetCommand({ ctx, data: nextData, patch, dateObj: baseDate, desired: "block" });
    }
  };

  // Parent: add weekly chore (no reward inputs)
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

    const chore = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      day: newDay,
      person,
      name,
      createdAt: Date.now(),
    };

    patch({ ...normalized, people: nextPeople, chores: [...(normalized.chores || []), chore] });

    setNewName("");
    setNewPerson(PEOPLE_DEFAULTS[0]);
    setNewPersonCustom("");
  };

  const parentRemoveChore = async (choreId) => {
    const chore = (normalized.chores || []).find((c) => c.id === choreId);
    const isDone = !!doneMap[choreId];
    if (chore && isDone) await parentUncheck(chore);

    const nextChores = (normalized.chores || []).filter((c) => c.id !== choreId);
    const nextDoneByWeek = { ...(normalized.doneByWeek || {}) };

    for (const wk of Object.keys(nextDoneByWeek)) {
      if (nextDoneByWeek[wk] && nextDoneByWeek[wk][choreId]) {
        const n = { ...nextDoneByWeek[wk] };
        delete n[choreId];
        nextDoneByWeek[wk] = n;
      }
    }

    patch({ ...normalized, chores: nextChores, doneByWeek: nextDoneByWeek });
  };

  // Parent: helper operations (kept)
  const parentAddHelper = () => {
    const title = helperTitle.trim();
    if (!title) return;

    const assignedTo = [];
    if (helperAssignHarvey) assignedTo.push("harvey");
    if (helperAssignBrady) assignedTo.push("brady");
    if (!assignedTo.length) return;

    const minutes = Number(helperRewardMinutes || 0) || 0;
    const points = Number(helperRewardPoints || 0) || 0;
    const expiresAt = helperExpiryDate ? toEndOfDayTs(helperExpiryDate) : null;

    const task = {
      id: `h_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title,
      assignedTo,
      reward: { minutes, points },
      expiresAt,
      status: expiresAt && Date.now() > expiresAt ? "expired" : "active",
      createdAt: Date.now(),
      completedAt: null,
      completedBy: [],
    };

    patch({ ...normalized, helperTasks: [...(normalized.helperTasks || []), task] });

    setHelperTitle("");
    setHelperAssignHarvey(true);
    setHelperAssignBrady(false);
    setHelperRewardMinutes(0);
    setHelperRewardPoints(0);
    setHelperExpiryDate("");
  };

  const parentReactivateHelper = (taskId, newExpiryDateStr = "") => {
    const nextTasks = (normalized.helperTasks || []).map((t) => {
      if (t.id !== taskId) return t;
      const newExpiresAt = newExpiryDateStr ? toEndOfDayTs(newExpiryDateStr) : null;
      return { ...t, status: "active", expiresAt: newExpiresAt };
    });
    patch({ ...normalized, helperTasks: nextTasks });
  };

  const parentDeleteHelper = (taskId) => {
    patch({ ...normalized, helperTasks: (normalized.helperTasks || []).filter((t) => t.id !== taskId) });
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {parentPanelOpen ? (
                <div className="self-start bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                  <ParentGate ctx={ctx} title="Parent tools" onCancel={() => setParentPanelOpen(false)}>
                    <div className="space-y-6">
                      {/* Add weekly chore */}
                      <div>
                        <div className="text-white text-xl font-semibold mb-4">Add weekly chore</div>
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

                          <button
                            onClick={parentAddChore}
                            className="w-full p-3 rounded-xl text-white font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20"
                          >
                            <Plus className="w-5 h-5" />
                            Add chore
                          </button>
                        </div>
                      </div>

                      {/* Helper task editor */}
                      <div>
                        <div className="text-white text-xl font-semibold mb-2">Daily Helper tasks</div>
                        <div className="text-white/60 text-sm mb-4">One-off bonus tasks. Can expire.</div>

                        <div className="space-y-4">
                          <div>
                            <label className="text-white/70 text-sm mb-2 block">Task title</label>
                            <input
                              value={helperTitle}
                              onChange={(e) => setHelperTitle(e.target.value)}
                              placeholder="e.g., Help clean the garage"
                              className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
                            />
                          </div>

                          <div>
                            <label className="text-white/70 text-sm mb-2 block">Expires (optional)</label>
                            <input
                              type="date"
                              value={helperExpiryDate}
                              onChange={(e) => setHelperExpiryDate(e.target.value)}
                              className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                            />
                          </div>

                          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                            <div className="text-white/80 text-sm font-semibold mb-2">Assign to</div>
                            <label className="flex items-center gap-2 text-white/80 text-sm">
                              <input type="checkbox" checked={helperAssignHarvey} onChange={(e) => setHelperAssignHarvey(e.target.checked)} /> Harvey
                            </label>
                            <label className="flex items-center gap-2 text-white/80 text-sm mt-2">
                              <input type="checkbox" checked={helperAssignBrady} onChange={(e) => setHelperAssignBrady(e.target.checked)} /> Brady
                            </label>
                            <div className="text-white/40 text-xs mt-2">If both are checked, completion can credit one or both.</div>
                          </div>

                          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                            <div className="text-white/80 text-sm font-semibold mb-2">Bonus reward</div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-white/70 text-xs block mb-1">Minutes</label>
                                <input
                                  type="number"
                                  value={helperRewardMinutes}
                                  onChange={(e) => setHelperRewardMinutes(e.target.value)}
                                  className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                                />
                              </div>
                              <div>
                                <label className="text-white/70 text-xs block mb-1">Points</label>
                                <input
                                  type="number"
                                  value={helperRewardPoints}
                                  onChange={(e) => setHelperRewardPoints(e.target.value)}
                                  className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                                />
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={parentAddHelper}
                            className="w-full p-3 rounded-xl text-white font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20"
                          >
                            <Plus className="w-5 h-5" />
                            Add helper task
                          </button>
                        </div>
                      </div>

                      {/* Expired helpers */}
                      <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                        <div className="text-white font-semibold mb-2">Expired helpers</div>
                        {expiredHelpers.length ? (
                          <div className="space-y-2">
                            {expiredHelpers.map((t) => (
                              <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-white/90 text-sm font-semibold">{t.title}</div>
                                <div className="text-white/60 text-xs">Assigned: {(t.assignedTo || []).join(", ")}</div>
                                <div className="mt-2 flex gap-2">
                                  <button
                                    onClick={() => parentReactivateHelper(t.id, "")}
                                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm"
                                  >
                                    Reactivate
                                  </button>
                                  <button
                                    onClick={() => parentDeleteHelper(t.id)}
                                    className="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-200/20 text-red-100 text-sm"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-white/40 text-sm">None</div>
                        )}
                      </div>

                      {/* Reset week */}
                      <div className="pt-4 border-t border-white/10">
                        <button
                          onClick={parentResetWeekSafe}
                          className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white/90 transition-all text-xs"
                        >
                          Reset week (uncheck chores)
                        </button>
                      </div>
                    </div>
                  </ParentGate>
                </div>
              ) : null}

              {/* Right column chores */}
              <div className={parentPanelOpen ? "" : "lg:col-span-2"}>
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-white text-xl font-semibold">{newDay}</div>
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
                                          if (!done) {
                                            setPendingConfirm({ type: "chore", weekKey, chore: c });
                                          } else {
                                            setParentPanelOpen(true);
                                          }
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
                                        </div>
                                      </div>
                                    </div>

                                    {parentPanelOpen ? (
                                      <button
                                        onClick={() => {
                                          if (window.confirm("Delete this chore?")) {
                                            parentRemoveChore(c.id);
                                          }
                                        }}
                                        className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 transition-all"
                                        title="Delete chore"
                                      >
                                        <Trash2 className="w-4 h-4 text-white/60 hover:text-red-200" />
                                      </button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-white/40 text-center py-10">No chores for {newDay}.</div>
                    )}
                  </div>
                </div>

                {/* Helpers section */}
                <div className="space-y-6 mt-6">
                  <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                    <div className="text-white text-xl font-semibold mb-1">Daily Helper</div>
                    <div className="text-white/60 text-sm mb-4">One-off bonus tasks. Completing gives bonus time/points.</div>

                    {activeHelpers.length ? (
                      <div className="space-y-3">
                        {activeHelpers.map((t) => (
                          <div key={t.id} className="rounded-2xl bg-white/5 border border-white/10 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-white font-semibold truncate">{t.title}</div>
                                <div className="text-white/60 text-xs mt-1">Assigned: {(t.assignedTo || []).join(", ")}</div>
                                {t.expiresAt ? (
                                  <div className="text-white/40 text-xs mt-1">Expires: {new Date(t.expiresAt).toLocaleDateString()}</div>
                                ) : null}
                              </div>
                              <button
                                onClick={() => setPendingConfirm({ type: "helper", task: t })}
                                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm"
                              >
                                Complete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-white/40 text-sm">No helper tasks right now.</div>
                    )}

                    {expiredHelpers.length ? (
                      <div className="mt-4 text-white/40 text-xs">{expiredHelpers.length} expired task(s). Parent can reactivate in Parent tools.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 text-center text-white/40 text-sm">
              Press <span className="text-white/60">ESC</span> to exit
            </div>
          </div>

          {pendingConfirm ? (
            <ConfirmCompleteModal
              title="Confirm completion"
              subtitle={pendingConfirm.type === "chore" ? pendingConfirm.chore.name : pendingConfirm.task.title}
              details={
                pendingConfirm.type === "chore"
                  ? `Assigned to: ${pendingConfirm.chore.person}`
                  : `Assigned to: ${(pendingConfirm.task.assignedTo || []).join(", ")}`
              }
              onCancel={() => setPendingConfirm(null)}
              onConfirm={() => {
                if (pendingConfirm.type === "chore") {
                  onChildMarkDone(pendingConfirm.weekKey, pendingConfirm.chore);
                  setPendingConfirm(null);
                } else if (pendingConfirm.type === "helper") {
                  const s = syncHelperExpiry(normalized);
                  const nowTask = (s.helperTasks || []).find((t) => t.id === pendingConfirm.task.id);
                  if (nowTask && nowTask.status === "active") {
                    const options = nowTask.assignedTo || [];
                    if (options.length <= 1) {
                      const next = awardHelperTask(ctx, s, nowTask, options);
                      patch(next);
                    } else {
                      setHelperChooser({ taskId: nowTask.id, options });
                    }
                  }
                  setPendingConfirm(null);
                }
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(overlayContent, document.body);
}

function HelperChooserModal({ task, options, onCancel, onConfirm }) {
  const [selHarvey, setSelHarvey] = useState(options.includes("harvey"));
  const [selBrady, setSelBrady] = useState(options.includes("brady"));

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-3xl bg-white/10 border border-white/20 p-5">
        <div className="text-white text-lg font-semibold">Who completed it?</div>
        <div className="text-white/70 text-sm mt-1">{task?.title || ""}</div>

        <div className="mt-4 space-y-2">
          {options.includes("harvey") ? (
            <label className="flex items-center gap-2 text-white/90 text-sm">
              <input type="checkbox" checked={selHarvey} onChange={(e) => setSelHarvey(e.target.checked)} /> Harvey
            </label>
          ) : null}
          {options.includes("brady") ? (
            <label className="flex items-center gap-2 text-white/90 text-sm">
              <input type="checkbox" checked={selBrady} onChange={(e) => setSelBrady(e.target.checked)} /> Brady
            </label>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm">
            Cancel
          </button>
          <button
            onClick={() => {
              const kids = [];
              if (selHarvey) kids.push("harvey");
              if (selBrady) kids.push("brady");
              if (!kids.length) return;
              onConfirm(kids);
            }}
            className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm"
          >
            Confirm
          </button>
        </div>
        <div className="text-white/40 text-xs mt-3">If you pick both, both get the rewards.</div>
      </div>
    </div>,
    document.body
  );
}

function ConfirmCompleteModal({ title, subtitle, details, onCancel, onConfirm }) {
  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-3xl bg-white/10 border border-white/20 p-5">
        <div className="text-white text-lg font-semibold">{title}</div>
        <div className="text-white/70 text-sm mt-1">{subtitle}</div>
        {details ? <div className="text-white/60 text-sm mt-2">{details}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm">
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// -----------------------------
// Settings overlay — parent-only
// -----------------------------
function SettingsOverlay({ ctx, open, onClose, data, patch }) {
  if (!open) return null;
  const normalized = normalizeChoresData(data);
  const g = normalized.settings?.gametime || { enabled: false, minutesPerDay: 60 };

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
              <button className="p-3 bg-white/10 backdrop-blur-lg rounded-xl hover:bg-white/20 transition-all" onClick={onClose} title="Close">
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            <ParentGate ctx={ctx} title="Settings" onCancel={onClose}>
              <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl space-y-5">
                <div>
                  <div className="text-white text-xl font-semibold mb-1">Gametime from chores</div>
                  <div className="text-white/60 text-sm">
                    When a kid completes <span className="text-white/80">all chores for the day</span>, they can claim their daily gametime once.
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-4">
                  <label className="flex items-center gap-3 text-white/90 text-sm">
                    <input
                      type="checkbox"
                      checked={!!g.enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        patch({
                          ...normalized,
                          settings: {
                            ...(normalized.settings || {}),
                            gametime: {
                              ...(normalized.settings?.gametime || {}),
                              enabled,
                              minutesPerDay: Math.max(0, Math.floor(Number(g.minutesPerDay || 0))),
                            },
                          },
                        });
                      }}
                    />
                    Enable chores for gametime
                  </label>

                  <div>
                    <label className="text-white/70 text-sm mb-2 block">Gametime minutes per day</label>
                    <input
                      type="number"
                      value={Math.max(0, Math.floor(Number(g.minutesPerDay || 0)))}
                      onChange={(e) => {
                        const v = Math.max(0, Math.floor(Number(e.target.value || 0) || 0));
                        patch({
                          ...normalized,
                          settings: {
                            ...(normalized.settings || {}),
                            gametime: {
                              ...(normalized.settings?.gametime || {}),
                              enabled: !!g.enabled,
                              minutesPerDay: v,
                            },
                          },
                        });
                      }}
                      className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                    />
                    <div className="text-white/40 text-xs mt-2">
                      This is what Harvey or Brady earns per day once their chores are complete.
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="text-white font-semibold">Internet toggle rule</div>
                  <div className="text-white/60 text-sm mt-1">
                    This module sends a single POST on transitions:
                    <div className="text-white/60 text-sm mt-2">
                      • All kids done → <span className="text-white/80">POST /api/v1/network/kids/off</span> (allow) <br />
                      • Becomes incomplete → <span className="text-white/80">POST /api/v1/network/kids/on</span> (block)
                    </div>
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
