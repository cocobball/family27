import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, X, Plus, Check, Trash2, Timer } from "lucide-react";
import {
  DAYS,
  PEOPLE_DEFAULTS,
  defaultChoresData,
  normalizeChoresData,
  getWeekKey,
  getDayName,
  dateFromYMD,
  ymdFromDate,
  groupChoresByPerson,
  groupChoresByDay,
  getChoresForDateWithDone,
  isHelperExpired,
} from "./helpers.js";

import { getRewardsData, unlockParent, isParentUnlocked, defaultRewardsData } from "../rewards/helpers.js";

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
  return ctx.eventBus || ctx.bus;
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

  const patch = useCallback(
    (partialOrFullNext) => {
      let cur;
      if (s?.getModuleData) {
        cur = s.getModuleData("chores", defaultFn());
      } else {
        cur = s?.get?.(defaultFn()) ?? defaultFn();
      }

      const next =
        partialOrFullNext && typeof partialOrFullNext === "object" && partialOrFullNext.version
          ? partialOrFullNext
          : { ...(cur || {}), ...(partialOrFullNext || {}) };

      if (s?.setModuleData) {
        s.setModuleData("chores", next);
      } else if (s?.set) {
        s.set(next);
      }

      setRev((r) => r + 1);
      return next;
    },
    [ctx, s, defaultFn]
  );

  return { data, patch };
}

// -----------------------------
// Rewards bridge (event-driven) — used ONLY for helper tasks now
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

function emitRewardsDebit(ctx, { kidId, currency, amount, sourceRef, reason, metadata }) {
  const bus = getBus(ctx);
  bus?.emit?.("REWARDS/DEBIT", {
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
// Network bridge (event + API call)
// -----------------------------
async function allowKidsInternet(ctx, { minutes = 0, kidId = null, sourceRef = "" } = {}) {
  const bus = getBus(ctx);

  // Event for in-app wiring (Network module can listen)
  bus?.emit?.("NETWORK/KIDS/OFF", {
    minutes: Number(minutes) || 0,
    kidId: kidId || null,
    sourceModule: "chores",
    sourceRef: sourceRef || "",
    at: Date.now(),
  });

  // Direct API
  try {
    const payload = { sourceModule: "chores", action: "off", minutes: Number(minutes) || 0, kidId: kidId || null, sourceRef: sourceRef || "" };
    console.log("[CHORES] POST /api/v1/network/kids/off", payload);
    const res = await fetch("/api/v1/network/kids/off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log("[CHORES] kids/off =>", res.status, text);
    if (!res.ok) throw new Error(`${res.status} ${text}`);
  } catch (e) {
    console.warn("[CHORES] allowKidsInternet fetch failed", e);
  }
}

async function blockKidsInternet(ctx, { sourceRef = "" } = {}) {
  const bus = getBus(ctx);
  bus?.emit?.("NETWORK/KIDS/ON", { sourceModule: "chores", sourceRef: sourceRef || "", at: Date.now() });
  try {
    const payload = { sourceModule: "chores", action: "on", sourceRef: sourceRef || "" };
    console.log("[CHORES] POST /api/v1/network/kids/on", payload);
    const res = await fetch("/api/v1/network/kids/on", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log("[CHORES] kids/on =>", res.status, text);
    if (!res.ok) throw new Error(`${res.status} ${text}`);
  } catch (e) {
    console.warn("[CHORES] blockKidsInternet fetch failed", e);
  }
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

function toEndOfDayTs(dateStr /* YYYY-MM-DD */) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  return dt.getTime();
}

function msToClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// -----------------------------
// Parent gate (uses Rewards unlock)
// -----------------------------
function ParentGate({ ctx, title = "Parent", children, onCancel, onUnlocked }) {
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

  // Keep localUnlocked for the session; do not auto-lock when data updates.
  const unlocked = localUnlocked || isParentUnlocked(rewardsData);
  if (unlocked) return children;

  const handleUnlock = () => {
    const ok = unlockParent(ctx, pin, 5);
    if (!ok) {
      setErr("Incorrect password.");
      return;
    }
    setErr("");
    setLocalUnlocked(true);
    setRev((r) => r + 1);
    try {
      onUnlocked?.();
    } catch {}
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
// Helper tasks logic (rewards stay here)
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
    t.id === cur.id
      ? { ...t, status: "completed", completedAt: Date.now(), completedBy: completedByKidIds.slice() }
      : t
  );

  return { ...s, helperGrants: nextGrants, helperTasks: nextTasks };
}

function reverseHelperTaskIfCompleted(ctx, choresData, helperTaskId) {
  const s0 = normalizeChoresData(choresData);
  const s = syncHelperExpiry(s0);

  const task = (s.helperTasks || []).find((t) => t.id === helperTaskId);
  if (!task) return s;
  if (task.status !== "completed") return s;

  const minutes = Number(task.reward?.minutes || 0) || 0;
  const points = Number(task.reward?.points || 0) || 0;

  const perHelper = s.helperGrants?.[task.id] || {};
  for (const kidId of Object.keys(perHelper)) {
    const perKid = perHelper[kidId] || {};
    if (minutes > 0 && perKid.minutes) {
      emitRewardsDebit(ctx, {
        kidId,
        currency: "minutes",
        amount: minutes,
        sourceRef: helperGrantKey(task.id, kidId, "minutes"),
        reason: `Reversed helper: ${task.title}`,
        metadata: { helperId: task.id, title: task.title },
      });
    }
    if (points > 0 && perKid.points) {
      emitRewardsDebit(ctx, {
        kidId,
        currency: "points",
        amount: points,
        sourceRef: helperGrantKey(task.id, kidId, "points"),
        reason: `Reversed helper: ${task.title}`,
        metadata: { helperId: task.id, title: task.title },
      });
    }
  }

  const nowMs = Date.now();
  const expired = task.expiresAt && nowMs > task.expiresAt;

  const nextTasks = (s.helperTasks || []).map((t) =>
    t.id === task.id ? { ...t, status: expired ? "expired" : "active", completedAt: null, completedBy: [] } : t
  );

  const nextGrants = { ...(s.helperGrants || {}) };
  delete nextGrants[task.id];

  return { ...s, helperTasks: nextTasks, helperGrants: nextGrants };
}

// -----------------------------
// Daily completion + Game Time
// -----------------------------
function getDailyCompletionState(data, baseDate, person) {
  const kidId = mapPersonToKidId(person);
  if (!kidId) return { kidId: null, total: 0, done: 0, allDone: false };

  const choresForDay = getChoresForDateWithDone(data, baseDate).filter((c) => c.person === person);
  const total = choresForDay.length;
  const done = choresForDay.filter((c) => c.done).length;
  return { kidId, total, done, allDone: total > 0 && done === total };
}

function getGameTimeSession(data, ymd, kidId) {
  const perDay = data.gameTimeByDay?.[ymd] || {};
  return perDay?.[kidId] || null;
}

function setGameTimeSession(data, ymd, kidId, patchSession) {
  const perDay = { ...(data.gameTimeByDay?.[ymd] || {}) };
  const cur = perDay[kidId] || {
    totalMinutes: 0,
    startedAt: null,
    endsAt: null,
    status: "ready", // "ready" | "active" | "paused" | "ended"
    blockedAt: null,
    remainingMs: null,
    pausedAt: null,
  };
  perDay[kidId] = { ...cur, ...(patchSession || {}) };
  return { ...data, gameTimeByDay: { ...(data.gameTimeByDay || {}), [ymd]: perDay } };
}

// -----------------------------
// Module root
// -----------------------------
export default function ChoresModule({ ctx }) {
  const enabled = useChoreModeEnabled();
  const bus = getBus(ctx);

  const { data: rawData, patch } = useModuleData(ctx, defaultChoresData);
  const data0 = useMemo(() => normalizeChoresData(rawData), [rawData]);
  const data = useMemo(() => syncHelperExpiry(data0), [data0]);

  const [selectedYMD, setSelectedYMD] = useState(() => sharedGetSelectedYMD(ctx));
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
  const ymd = useMemo(() => ymdFromDate(baseDate || new Date()), [baseDate]);

  const activeHelpers = useMemo(
    () => (data.helperTasks || []).filter((t) => t.status === "active"),
    [data.helperTasks]
  );

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

  // NOTE: Weekly chores no longer grant rewards. Just mark done.
  const markDoneChild = (weekKey, chore) => {
    const curDone = !!(data.doneByWeek?.[weekKey]?.[chore.id]);
    if (curDone) return;

    const nextWeekDone = { ...(data.doneByWeek?.[weekKey] || {}), [chore.id]: true };
    const nextDoneByWeek = { ...(data.doneByWeek || {}), [weekKey]: nextWeekDone };

    patch({
      ...data,
      doneByWeek: nextDoneByWeek,
    });
  };

  // Main-screen Game Time button state tick
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Best-effort: if we have an active session that has ended, mark ended + block once
  useEffect(() => {
    const now = Date.now();
    let next = data;
    let changed = false;

    const perDay = data.gameTimeByDay?.[ymd] || {};
    for (const kidId of Object.keys(perDay)) {
      const s = perDay[kidId];
      if (!s) continue;
      if (s.status !== "active") continue;
      if (!s.endsAt) continue;
      if (now < s.endsAt) continue;

      changed = true;
      next = setGameTimeSession(next, ymd, kidId, { status: "ended" });

      // block once
      const ended = getGameTimeSession(next, ymd, kidId);
      if (!ended?.blockedAt) {
        next = setGameTimeSession(next, ymd, kidId, { blockedAt: Date.now() });
        blockKidsInternet(ctx, { sourceRef: `gametime:end:${ymd}:${kidId}` });
      }
    }

    if (changed) patch(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ymd]);

  const startGameTimeForKid = async (person) => {
    const daily = getDailyCompletionState(data, baseDate || new Date(), person);
    const kidId = daily.kidId;
    if (!kidId || !daily.allDone) return;

    const totalMinutes = Number(data.settings?.gameTimeMinutesOnDailyComplete?.[person] || 0) || 0;
    if (totalMinutes <= 0) return;

    const existing = getGameTimeSession(data, ymd, kidId);
    if (existing?.status === "active" || existing?.status === "paused" || existing?.status === "ended") return;

    const now = Date.now();
    const endsAt = now + totalMinutes * 60 * 1000;

    const next = setGameTimeSession(data, ymd, kidId, {
      totalMinutes,
      startedAt: now,
      endsAt,
      status: "active",
      blockedAt: null,
      remainingMs: null,
      pausedAt: null,
    });
    patch(next);

    await allowKidsInternet(ctx, {
      minutes: totalMinutes,
      kidId,
      sourceRef: `gametime:start:${ymd}:${kidId}:${totalMinutes}`,
    });
  };

  const pauseGameTimeForKid = async (kidId) => {
    if (!kidId) return;
    const cur = getGameTimeSession(data, ymd, kidId);
    if (!cur || cur.status !== "active" || !cur.endsAt) return;

    const remainingMs = Math.max(0, cur.endsAt - Date.now());
    const next = setGameTimeSession(data, ymd, kidId, {
      status: "paused",
      remainingMs,
      pausedAt: Date.now(),
      endsAt: null,
    });
    patch(next);

    await blockKidsInternet(ctx, { sourceRef: `gametime:pause:${ymd}:${kidId}` });
  };

  const resumeGameTimeForKid = async (kidId) => {
    if (!kidId) return;
    const cur = getGameTimeSession(data, ymd, kidId);
    if (!cur || cur.status !== "paused") return;

    const remainingMs = Number(cur.remainingMs || 0) || 0;
    if (remainingMs <= 0) {
      const nextEnded = setGameTimeSession(data, ymd, kidId, { status: "ended", remainingMs: 0 });
      patch(nextEnded);
      await blockKidsInternet(ctx, { sourceRef: `gametime:resume->end:${ymd}:${kidId}` });
      return;
    }

    const now = Date.now();
    const endsAt = now + remainingMs;
    const next = setGameTimeSession(data, ymd, kidId, {
      status: "active",
      endsAt,
      remainingMs: null,
      pausedAt: null,
      blockedAt: null, // allow end logic to block again if needed
    });
    patch(next);

    const minutes = Math.ceil(remainingMs / 60000);
    await allowKidsInternet(ctx, {
      minutes,
      kidId,
      sourceRef: `gametime:resume:${ymd}:${kidId}:${minutes}`,
    });
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
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/15 px-3 py-2 flex-1 min-h-0 overflow-auto">
          {cardModel.total === 0 ? (
            <div className="text-sm opacity-60 py-3">No chores to show.</div>
          ) : (
            people.map((person) => {
              const list = cardModel.byPerson[person] || [];
              if (!list.length) return null;

              const daily = viewMode === "day" ? getDailyCompletionState(data, baseDate || new Date(), person) : null;
              const kidId = daily?.kidId || null;

              const totalMinutes = Number(data.settings?.gameTimeMinutesOnDailyComplete?.[person] || 0) || 0;
              const session = viewMode === "day" && kidId ? getGameTimeSession(data, ymd, kidId) : null;

              const canStart =
                viewMode === "day" &&
                kidId &&
                daily?.allDone &&
                totalMinutes > 0 &&
                (!session || session.status === "ready" || session.status === null);

              const isActive = session?.status === "active" && session?.endsAt;
              const isPaused = session?.status === "paused";
              const isEnded = session?.status === "ended";

              const remainingMs = isActive
                ? Math.max(0, session.endsAt - Date.now())
                : isPaused
                  ? Math.max(0, Number(session.remainingMs || 0) || 0)
                  : 0;

              return (
                <div key={person} className="py-2 border-b border-white/10 last:border-b-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm font-semibold opacity-90">{person}</div>

                    {/* GAME TIME BUTTONS */}
                    {viewMode === "day" && kidId ? (
                      <div className="flex items-center gap-2">
                        {canStart ? (
                          <button
                            onClick={() => startGameTimeForKid(person)}
                            className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-xs flex items-center gap-2"
                            title="Start game time"
                          >
                            <Timer className="w-4 h-4" />
                            Game time ({totalMinutes}m) • Start
                          </button>
                        ) : isActive ? (
                          <>
                            <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-white/90 text-xs flex items-center gap-2">
                              <Timer className="w-4 h-4" />
                              Game time: {msToClock(remainingMs)}
                            </div>
                            <button
                              onClick={() => pauseGameTimeForKid(kidId)}
                              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white/90 text-xs"
                              title="Pause game time (blocks internet)"
                            >
                              Pause
                            </button>
                          </>
                        ) : isPaused ? (
                          <>
                            <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-white/90 text-xs flex items-center gap-2">
                              <Timer className="w-4 h-4" />
                              Paused: {msToClock(remainingMs)}
                            </div>
                            <button
                              onClick={() => resumeGameTimeForKid(kidId)}
                              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white/90 text-xs"
                              title="Resume game time (unblocks internet)"
                            >
                              Resume
                            </button>
                          </>
                        ) : isEnded ? (
                          <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-xs">
                            Game time ended
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    {list.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm opacity-90">
                        <button
                          type="button"
                          onClick={() => {
                            if (!c.done) setPendingConfirm({ type: "chore", weekKey: cardModel.weekKey, chore: c });
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

          {activeHelpers.length > 0 && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <div className="text-sm font-semibold opacity-90 mb-2">Daily Helper</div>
              <div className="space-y-2">
                {activeHelpers.map((t) => (
                  <div key={t.id} className="rounded-xl bg-white/5 border border-white/10 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm opacity-90 font-medium">{t.title}</div>
                        <div className="text-xs opacity-60 mt-0.5">
                          {(t.assignedTo || []).join(", ")}
                          {formatInlineReward(t.reward)}
                        </div>
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

      <ChoreModeOverlay ctx={ctx} data={data} patch={patch} baseDate={baseDate} onChildMarkDone={markDoneChild} />

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
                const next = awardHelperTask(ctx, s, nowTask, options);
                patch(next);
              }
              setPendingConfirm(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

// -----------------------------
// Overlay
// -----------------------------
function ChoreModeOverlay({ ctx, data, patch, baseDate, onChildMarkDone }) {
  const enabled = useChoreModeEnabled();
  const normalized0 = useMemo(() => normalizeChoresData(data), [data]);
  const normalized = useMemo(() => syncHelperExpiry(normalized0), [normalized0]);

  const people = normalized.people || [];
  const chores = normalized.chores || [];

  const weekKey = useMemo(() => getWeekKey(baseDate || new Date()), [baseDate]);
  const doneMap = normalized.doneByWeek?.[weekKey] || {};
  const ymd = useMemo(() => ymdFromDate(baseDate || new Date()), [baseDate]);

  const [parentPanelOpen, setParentPanelOpen] = useState(false);
  const [parentUnlockedSession, setParentUnlockedSession] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);

  // Parent tab toggle
  const [parentTab, setParentTab] = useState("chores"); // "chores" | "helper"

  // Add weekly chore form (parent)
  const [newName, setNewName] = useState("");
  const [newPerson, setNewPerson] = useState(PEOPLE_DEFAULTS[0]);
  const [newPersonCustom, setNewPersonCustom] = useState("");
  const [newDays, setNewDays] = useState(() => [getDayName(baseDate || new Date())]);

  // Parent settings: game time minutes per kid
  const [gameTimeHarvey, setGameTimeHarvey] = useState(
    Number(normalized.settings?.gameTimeMinutesOnDailyComplete?.Harvey || 0) || 0
  );
  const [gameTimeBrady, setGameTimeBrady] = useState(
    Number(normalized.settings?.gameTimeMinutesOnDailyComplete?.Brady || 0) || 0
  );

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
    setNewDays([dayName]);
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

  const selectedDayForView = (newDays && newDays.length && newDays[0]) || getDayName(baseDate || new Date());
  const todaysChores = useMemo(() => chores.filter((c) => c.day === selectedDayForView), [chores, newDays]);
  const todaysChoresByPerson = useMemo(() => groupChoresByPerson(todaysChores, people), [todaysChores, people]);

  const activeHelpers = useMemo(
    () => (normalized.helperTasks || []).filter((t) => t.status === "active"),
    [normalized.helperTasks]
  );
  const expiredHelpers = useMemo(
    () => (normalized.helperTasks || []).filter((t) => t.status === "expired"),
    [normalized.helperTasks]
  );

  // Parent: add weekly chore (NO rewards)
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

    const now = Date.now();

    const newChores = (newDays || []).map((d) => ({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      day: d,
      person,
      name,
      createdAt: now,
    }));

    patch({
      ...normalized,
      people: nextPeople,
      chores: [...(normalized.chores || []), ...newChores],
    });

    setNewName("");
    setNewPerson(PEOPLE_DEFAULTS[0]);
    setNewPersonCustom("");
  };

  const parentRemoveChore = (choreId) => {
    const nextChores = (normalized.chores || []).filter((c) => c.id !== choreId);

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

  // Parent: reset week (no reward reversing anymore)
  const parentResetWeek = () => {
    patch({
      ...normalized,
      doneByWeek: { ...(normalized.doneByWeek || {}), [weekKey]: {} },
    });
  };

  // Parent: helper operations
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

    patch({
      ...normalized,
      helperTasks: [...(normalized.helperTasks || []), task],
    });

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
    const nextData = reverseHelperTaskIfCompleted(ctx, normalized, taskId);
    patch({
      ...nextData,
      helperTasks: (nextData.helperTasks || []).filter((t) => t.id !== taskId),
    });
  };

  const saveParentSettings = () => {
    patch({
      ...normalized,
      settings: {
        ...(normalized.settings || {}),
        gameTimeMinutesOnDailyComplete: {
          ...(normalized.settings?.gameTimeMinutesOnDailyComplete || {}),
          Harvey: Number(gameTimeHarvey || 0) || 0,
          Brady: Number(gameTimeBrady || 0) || 0,
        },
      },
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
                  <div className="text-white/60 text-sm">
                    Check chores • {selectedDayForView} • Week of {weekKey}
                  </div>
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
                  <ParentGate
                    ctx={ctx}
                    title="Parent tools"
                    onCancel={() => setParentPanelOpen(false)}
                    onUnlocked={() => setParentUnlockedSession(true)}
                  >
                    <div className="space-y-4">
                      {/* TOGGLE */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setParentTab("chores")}
                          className={`flex-1 px-3 py-2 rounded-xl border text-sm transition-all ${
                            parentTab === "chores"
                              ? "bg-white/20 border-white/30 text-white"
                              : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                          }`}
                        >
                          Weekly chores
                        </button>
                        <button
                          onClick={() => setParentTab("helper")}
                          className={`flex-1 px-3 py-2 rounded-xl border text-sm transition-all ${
                            parentTab === "helper"
                              ? "bg-white/20 border-white/30 text-white"
                              : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                          }`}
                        >
                          Daily helper
                        </button>
                      </div>

                      {/* WEEKLY CHORES TAB */}
                      {parentTab === "chores" ? (
                        <div className="space-y-6">
                          <div>
                            <div className="text-white text-xl font-semibold mb-4">Add weekly chore</div>

                            <div className="space-y-4">
                              <div>
                                <label className="text-white/70 text-sm mb-2 block">Day</label>

                                <div className="mb-2 flex gap-2">
                                  <button
                                    onClick={() => setNewDays(DAYS.slice(0, 5))}
                                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm"
                                  >
                                    Weekdays
                                  </button>
                                  <button
                                    onClick={() => setNewDays(DAYS)}
                                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm"
                                  >
                                    All days
                                  </button>
                                  <button
                                    onClick={() => setNewDays([getDayName(baseDate || new Date())])}
                                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm"
                                  >
                                    Today only
                                  </button>
                                </div>

                                <div className="rounded-2xl bg-white/5 border border-white/10 p-3 grid grid-cols-2 gap-2">
                                  {DAYS.map((d) => (
                                    <label key={d} className="flex items-center gap-2 text-white/80 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={Array.isArray(newDays) && newDays.includes(d)}
                                        onChange={() => {
                                          const prev = new Set(newDays || []);
                                          if (prev.has(d)) prev.delete(d);
                                          else prev.add(d);
                                          setNewDays(DAYS.filter((day) => prev.has(day)));
                                        }}
                                      />
                                      {d}
                                    </label>
                                  ))}
                                </div>
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

                          <div className="pt-2 border-t border-white/10">
                            <button
                              onClick={parentResetWeek}
                              className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white/90 transition-all text-xs"
                            >
                              Reset week (uncheck all)
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* HELPER TAB */}
                      {parentTab === "helper" ? (
                        <div className="space-y-6">
                          <div>
                            <div className="text-white text-xl font-semibold mb-2">Daily Helper tasks</div>
                            <div className="text-white/60 text-sm mb-4">
                              One-off bonus tasks. Can expire. Rewards stay here.
                            </div>

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
                                  <input
                                    type="checkbox"
                                    checked={helperAssignHarvey}
                                    onChange={(e) => setHelperAssignHarvey(e.target.checked)}
                                  />
                                  Harvey
                                </label>
                                <label className="flex items-center gap-2 text-white/80 text-sm mt-2">
                                  <input
                                    type="checkbox"
                                    checked={helperAssignBrady}
                                    onChange={(e) => setHelperAssignBrady(e.target.checked)}
                                  />
                                  Brady
                                </label>
                                <div className="text-white/40 text-xs mt-2">
                                  If both are checked, both get the rewards.
                                </div>
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

                          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                            <div className="text-white font-semibold mb-2">Expired helpers</div>
                            {expiredHelpers.length ? (
                              <div className="space-y-2">
                                {expiredHelpers.map((t) => (
                                  <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                    <div className="text-white/90 text-sm font-semibold">{t.title}</div>
                                    <div className="text-white/60 text-xs">
                                      Assigned: {(t.assignedTo || []).join(", ")}
                                      {formatInlineReward(t.reward)}
                                    </div>

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
                        </div>
                      ) : null}
                    </div>
                  </ParentGate>
                </div>
              ) : null}

              <div className={parentPanelOpen ? "" : "lg:col-span-2"}>
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-white text-xl font-semibold">{selectedDayForView}</div>
                    <div className="text-white/50 text-sm">Week of {weekKey}</div>
                  </div>

                  <div className="space-y-5">
                    {todaysChores.length ? (
                      people.map((person) => {
                        const list = todaysChoresByPerson[person] || [];
                        if (!list.length) return null;

                        return (
                          <div key={person} className="space-y-3">
                            <div className="px-3 py-2 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-3">
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
                                        title={done ? "Done (parent required to uncheck via reset)" : "Mark as done"}
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
                                          if (window.confirm("Delete this chore?")) parentRemoveChore(c.id);
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
                      <div className="text-white/40 text-center py-10">No chores for {selectedDayForView}.</div>
                    )}
                  </div>
                </div>

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
                                <div className="text-white/60 text-xs mt-1">
                                  Assigned: {(t.assignedTo || []).join(", ")}
                                  {formatInlineReward(t.reward)}
                                </div>
                                {t.expiresAt ? (
                                  <div className="text-white/40 text-xs mt-1">
                                    Expires: {new Date(t.expiresAt).toLocaleDateString()}
                                  </div>
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
                      <div className="mt-4 text-white/40 text-xs">
                        {expiredHelpers.length} expired task(s). Parent can reactivate in Parent tools.
                      </div>
                    ) : null}
                  </div>

                  {/* GAME TIME SETTINGS MOVED HERE (RIGHT SIDE, BELOW DAILY HELPER) */}
                  {parentPanelOpen ? (
                    <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                      <div className="text-white text-xl font-semibold mb-1">Game Time settings</div>
                      <div className="text-white/60 text-sm mb-4">
                        Set minutes unlocked when they finish all chores for the day.
                      </div>

                      {parentUnlockedSession ? (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-white/70 text-sm mb-2 block">Harvey (minutes)</label>
                              <input
                                type="number"
                                value={gameTimeHarvey}
                                onChange={(e) => setGameTimeHarvey(e.target.value)}
                                className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                              />
                            </div>
                            <div>
                              <label className="text-white/70 text-sm mb-2 block">Brady (minutes)</label>
                              <input
                                type="number"
                                value={gameTimeBrady}
                                onChange={(e) => setGameTimeBrady(e.target.value)}
                                className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white"
                              />
                            </div>
                          </div>

                          <button
                            onClick={saveParentSettings}
                            className="mt-3 w-full p-3 rounded-xl text-white font-semibold hover:shadow-lg transition-all bg-white/15 hover:bg-white/25 border border-white/20"
                          >
                            Save settings
                          </button>

                          <div className="text-white/40 text-xs mt-3">
                            Start triggers <code className="text-white/70">POST /api/v1/network/kids/off</code>. End (and
                            Pause) triggers <code className="text-white/70">POST /api/v1/network/kids/on</code>.
                          </div>
                        </>
                      ) : (
                        <div className="text-white/60 text-sm">
                          Unlock Parent tools to edit settings.
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="text-center text-white/40 text-sm">
                    Press <span className="text-white/60">ESC</span> to exit
                  </div>

                  {parentPanelOpen ? (
                    <div className="text-center">
                      <button
                        onClick={() => blockKidsInternet(ctx, { sourceRef: `manual:${ymd}` })}
                        className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm"
                      >
                        Block kids internet now
                      </button>
                    </div>
                  ) : null}
                </div>
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
                      const next = awardHelperTask(ctx, s, nowTask, options);
                      patch(next);
                    }
                    setPendingConfirm(null);
                  }
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlayContent, document.body);
}

function ConfirmCompleteModal({ title, subtitle, details, onCancel, onConfirm }) {
  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-3xl bg-white/10 border border-white/20 p-5">
        <div className="text-white text-lg font-semibold">{title}</div>
        <div className="text-white/70 text-sm mt-1">{subtitle}</div>
        {details ? <div className="text-white/60 text-sm mt-2">{details}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
