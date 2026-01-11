// src/modules/chores/module.jsx
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, X, Plus, Timer, Settings, Lock } from "lucide-react";
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

import { unlockParent } from "../rewards/helpers.js";
import { exportChoresToXml, importChoresFromXml } from "./xml.js";

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
// Parent gate (session-based)
// -----------------------------
function ParentGate({ ctx, title = "Settings", unlocked, onCancel, onUnlocked, children }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  if (unlocked) return children;

  const handleUnlock = () => {
    const ok = unlockParent(ctx, pin, 5);
    if (!ok) {
      setErr("Incorrect password.");
      return;
    }
    setErr("");
    try {
      onUnlocked?.();
    } catch {}
  };

  return (
    <div className="rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 p-5">
      <div className="text-white text-lg font-semibold">{title} locked</div>
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
  bus?.emit?.("NETWORK/KIDS/ON", {
    minutes: Number(minutes) || 0,
    kidId: kidId || null,
    sourceModule: "chores",
    sourceRef: sourceRef || "",
    at: Date.now(),
  });

  // Direct API try
  try {
    const payload = {
      sourceModule: "chores",
      action: "on",
      minutes: Number(minutes) || 0,
      kidId: kidId || null,
      sourceRef: sourceRef || "",
    };
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
    console.warn("[CHORES] allowKidsInternet fetch failed", e);
  }
}

async function blockKidsInternet(ctx, { sourceRef = "" } = {}) {
  const bus = getBus(ctx);

  // Event for in-app wiring
  bus?.emit?.("NETWORK/KIDS/OFF", {
    sourceModule: "chores",
    sourceRef: sourceRef || "",
    at: Date.now(),
  });

  // Direct API try
  try {
    const payload = {
      sourceModule: "chores",
      action: "off",
      sourceRef: sourceRef || "",
    };
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
    console.warn("[CHORES] blockKidsInternet fetch failed", e);
  }
}

// -----------------------------
// Game Time helpers
// -----------------------------
function getGameTimeSession(data, ymd, kidId) {
  return data.gameTimeByDay?.[ymd]?.[kidId] || null;
}

function setGameTimeSession(data, ymd, kidId, updates) {
  const perDay = { ...(data.gameTimeByDay?.[ymd] || {}) };
  const cur = perDay[kidId] || {};
  perDay[kidId] = { ...cur, ...updates };

  return {
    ...data,
    gameTimeByDay: {
      ...(data.gameTimeByDay || {}),
      [ymd]: perDay,
    },
  };
}

function getDailyCompletionState(data, dateOrYmd, person) {
  const normalized = normalizeChoresData(data);
  const date = typeof dateOrYmd === "string" ? dateFromYMD(dateOrYmd) : dateOrYmd;
  const dayName = getDayName(date);
  const weekKey = getWeekKey(date);

  const allChoresForDay = (normalized.chores || []).filter((c) => c.day === dayName && c.person === person);
  const doneMap = normalized.doneByWeek?.[weekKey] || {};
  const allDone = allChoresForDay.length > 0 && allChoresForDay.every((c) => doneMap[c.id]);

  const kidId = mapPersonToKidId(person);

  return { allDone, person, kidId, total: allChoresForDay.length };
}

// -----------------------------
// Main Module
// -----------------------------
export default function ChoresModule({ ctx }) {
  const enabled = useChoreModeEnabled();
  const bus = getBus(ctx);

  const { data: rawData, patch } = useModuleData(ctx, defaultChoresData);
  const data = useMemo(() => normalizeChoresData(rawData), [rawData]);

  const [selectedYMD, setSelectedYMD] = useState(() => sharedGetSelectedYMD(ctx));
  const [viewMode, setViewMode] = useState("day");
  const [pendingConfirm, setPendingConfirm] = useState(null);

  const baseDate = useMemo(() => {
    return selectedYMD ? dateFromYMD(selectedYMD) : new Date();
  }, [selectedYMD]);

  const ymd = useMemo(() => ymdFromDate(baseDate), [baseDate]);
  const weekKey = useMemo(() => getWeekKey(baseDate), [baseDate]);

  const people = data.people || PEOPLE_DEFAULTS;

  useEffect(() => {
    const handler = (payload) => {
      const ymd =
        typeof payload === "string"
          ? payload
          : typeof payload?.date === "string"
            ? payload.date
            : null;
      if (ymd) setSelectedYMD(ymd);
    };
    const unsub = bus?.on?.("calendar:dateSelected", handler);
    return () => unsub?.();
  }, [bus]);

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
      blockedAt: null,
    });
    patch(next);

    const minutes = Math.ceil(remainingMs / 60000);
    await allowKidsInternet(ctx, {
      minutes,
      kidId,
      sourceRef: `gametime:resume:${ymd}:${kidId}:${minutes}`,
    });
  };

  const activeHelpers = useMemo(
    () => (data.helperTasks || []).filter((t) => t.status === "active"),
    [data.helperTasks]
  );

  const cardModel = useMemo(() => {
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
  }, [viewMode, data, baseDate, people, selectedYMD, weekKey]);

  const markDoneChild = (wk, chore) => {
    const curDone = !!(data.doneByWeek?.[wk]?.[chore.id]);
    if (curDone) return;

    const nextWeekDone = { ...(data.doneByWeek?.[wk] || {}), [chore.id]: true };
    const nextDoneByWeek = { ...(data.doneByWeek || {}), [wk]: nextWeekDone };
    patch({ ...data, doneByWeek: nextDoneByWeek });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2">
        <ClipboardList size={18} />
        <div className="font-semibold">Chores</div>

        {/* SETTINGS button moved to top-right */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              const todayYMD = ymdFromDate(new Date());
              sharedSet(ctx, "selectedDate", todayYMD);
              setSelectedYMD(todayYMD);
              bus?.emit?.("calendar:dateSelected", { date: todayYMD });
            }}
            className="px-2.5 py-1.5 rounded-lg text-xs border transition-all bg-white/10 border-white/15 hover:bg-white/15 flex items-center gap-1.5"
            title="Jump to today"
          >
            Today
          </button>

          <button
            onClick={() => setChoreModeEnabled(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs border transition-all bg-white/10 border-white/15 hover:bg-white/15 flex items-center gap-1.5"
            aria-pressed={enabled}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>

          <div className="flex items-center gap-1">
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
                          <div className="text-xs opacity-50 mt-0.5">Expires: {new Date(t.expiresAt).toLocaleDateString()}</div>
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
// Overlay (Settings + Planner + Helper + Weekly chores)
// -----------------------------
function ChoreModeOverlay({ ctx, data, patch, baseDate, onChildMarkDone }) {
  const enabled = useChoreModeEnabled();
  const normalized0 = useMemo(() => normalizeChoresData(data), [data]);
  const normalized = useMemo(() => syncHelperExpiry(normalized0), [normalized0]);

  const people = normalized.people || [];
  const chores = normalized.chores || [];

  const weekKey = useMemo(() => getWeekKey(baseDate || new Date()), [baseDate]);
  const ymd = useMemo(() => ymdFromDate(baseDate || new Date()), [baseDate]);

  const [parentPanelOpen, setParentPanelOpen] = useState(false);
  const [parentUnlockedSession, setParentUnlockedSession] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);

  // Parent tab toggle
  const [parentTab, setParentTab] = useState("chores"); // "chores" | "helper" | "planner"

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

  // Preview toggle inside settings screen (right panel for chores tab)
  const [settingsChoresViewMode, setSettingsChoresViewMode] = useState("day"); // "day"|"week"

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

  const todaysChores = useMemo(() => chores.filter((c) => c.day === selectedDayForView), [chores, selectedDayForView]);
  const todaysChoresWithDone = useMemo(() => {
    const doneMap = normalized.doneByWeek?.[weekKey] || {};
    return todaysChores.map((c) => ({ ...c, done: !!doneMap[c.id] }));
  }, [todaysChores, normalized.doneByWeek, weekKey]);
  const todaysChoresByPerson = useMemo(() => groupChoresByPerson(todaysChoresWithDone, people), [todaysChoresWithDone, people]);

  const doneMapWeek = normalized.doneByWeek?.[weekKey] || {};
  const weeklyChoresWithDone = useMemo(() => (normalized.chores || []).map((c) => ({ ...c, done: !!doneMapWeek[c.id] })), [normalized.chores, doneMapWeek]);
  const weeklyByPerson = useMemo(() => {
    const raw = groupChoresByPerson(weeklyChoresWithDone, people);
    const out = {};
    for (const p of people) out[p] = sortWeekList(raw[p] || []);
    return out;
  }, [weeklyChoresWithDone, people]);

  const activeHelpers = useMemo(() => (normalized.helperTasks || []).filter((t) => t.status === "active"), [normalized.helperTasks]);
  const inactiveHelpers = useMemo(
    () => (normalized.helperTasks || []).filter((t) => t.status === "expired" || t.status === "completed"),
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

  // Parent: reset week (uncheck all)
  const parentResetWeek = () => {
    const nextGameTimeByDay = { ...(normalized.gameTimeByDay || {}) };
    if (ymd && Object.prototype.hasOwnProperty.call(nextGameTimeByDay, ymd)) {
      delete nextGameTimeByDay[ymd];
    }

    patch({
      ...normalized,
      doneByWeek: { ...(normalized.doneByWeek || {}), [weekKey]: {} },
      gameTimeByDay: nextGameTimeByDay,
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

  const parentDeleteHelper = (taskId) => {
    const nextData = reverseHelperTaskIfCompleted(ctx, normalized, taskId);
    patch({
      ...nextData,
      helperTasks: (nextData.helperTasks || []).filter((t) => t.id !== taskId),
    });
  };

  const parentReactivateHelper = (taskId) => {
    const next = reactivateHelperAsNewRun(normalized, taskId);
    patch(next);
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

  const showPlanner = parentPanelOpen && parentTab === "planner";
  const showSettingsPanels = parentPanelOpen && parentTab !== "planner";

  const openTab = (tab) => {
    setParentTab(tab);
    setParentPanelOpen(true);
  };

  const lockSession = () => {
    setParentUnlockedSession(false);
  };

  const exportChoresXml = async () => {
    try {
      const xml = exportChoresToXml(normalized);

      try {
        await navigator.clipboard?.writeText?.(xml);
      } catch {}

      const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chores-${new Date().toISOString().slice(0, 10)}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("[CHORES] chores export failed", e);
      alert(e?.message || "Export failed");
    }
  };

  const importChoresXml = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xml,application/xml,text/xml";
      input.onchange = async (e) => {
        try {
          const file = e.target?.files?.[0];
          if (!file) return;

          const xmlText = await file.text();
          const importedData = importChoresFromXml(xmlText);
          patch(importedData);
        } catch (err) {
          console.warn("[CHORES] import failed", err);
          alert(err?.message || "Import failed");
        }
      };
      input.click();
    } catch (e) {
      console.warn("[CHORES] import error", e);
      alert(e?.message || "Import failed");
    }
  };

  const overlayContent = (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm">
      <div className="h-screen overflow-auto">
        <div className="min-h-screen flex flex-col p-4 md:p-8">
          <div className="max-w-6xl mx-auto w-full flex-1">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/10 rounded-2xl">
                  <ClipboardList className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-white text-2xl font-bold">Chores settings</div>
                  <div className="text-white/60 text-sm">
                    Check chores • {selectedDayForView} • Week of {weekKey}
                  </div>
                </div>
              </div>

              {/* TOP TOOLBAR */}
              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-2 mr-2">
                  <button
                    onClick={() => openTab("chores")}
                    className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                      parentPanelOpen && parentTab === "chores"
                        ? "bg-white/20 border-white/30 text-white"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    Weekly chores
                  </button>
                  <button
                    onClick={() => openTab("helper")}
                    className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                      parentPanelOpen && parentTab === "helper"
                        ? "bg-white/20 border-white/30 text-white"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    Daily helper
                  </button>
                  <button
                    onClick={() => openTab("planner")}
                    className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                      parentPanelOpen && parentTab === "planner"
                        ? "bg-white/20 border-white/30 text-white"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    Chore planner
                  </button>
                </div>

                <button
                  onClick={() => setParentPanelOpen((v) => !v)}
                  className="px-4 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm border border-white/10"
                  title="Settings panels"
                >
                  Settings
                </button>

                <button
                  onClick={exportChoresXml}
                  className="px-4 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm border border-white/10"
                  title="Export current chores list as XML"
                >
                  Export chores XML
                </button>

                <button
                  onClick={importChoresXml}
                  className="px-4 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm border border-white/10"
                  title="Import chores list from XML"
                >
                  Import chores XML
                </button>

                {parentUnlockedSession ? (
                  <button
                    onClick={lockSession}
                    className="px-3 py-3 bg-white/10 rounded-xl text-white/90 hover:bg-white/20 transition-all text-sm border border-white/10"
                    title="Lock settings (requires password again)"
                  >
                    <Lock className="w-5 h-5" />
                  </button>
                ) : null}

                <button
                  className="p-3 bg-white/10 backdrop-blur-lg rounded-xl hover:bg-white/20 transition-all"
                  onClick={() => setChoreModeEnabled(false)}
                  title="Close"
                >
                  <X className="w-6 h-6 text-white" />
                </button>
              </div>
            </div>

            {/* PLANNER = FULL WORKSPACE */}
            {showPlanner ? (
              <ParentGate
                ctx={ctx}
                title="Settings"
                unlocked={parentUnlockedSession}
                onCancel={() => setParentPanelOpen(false)}
                onUnlocked={() => setParentUnlockedSession(true)}
              >
                <PlannerWorkspace ctx={ctx} normalized={normalized} patch={patch} people={people} weekKey={weekKey} />
              </ParentGate>
            ) : showSettingsPanels ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* LEFT: Settings input */}
                <div className="self-start bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                  <ParentGate
                    ctx={ctx}
                    title="Settings"
                    unlocked={parentUnlockedSession}
                    onCancel={() => setParentPanelOpen(false)}
                    onUnlocked={() => setParentUnlockedSession(true)}
                  >
                    {parentTab === "chores" ? (
                      <div className="space-y-6">
                        <div>
                          <div className="text-white text-xl font-semibold mb-4">Add weekly chore</div>
                          <div className="space-y-4">
                            <div>
                              <label className="text-white/70 text-sm mb-2 block">Day</label>
                              <div className="mb-2 flex gap-2 flex-wrap">
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

                        <div className="pt-2 border-t border-white/10 space-y-3">
                          <div className="text-white/80 text-sm font-semibold">Game time settings</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                              <div className="text-white/70 text-xs">Harvey minutes</div>
                              <input
                                type="number"
                                value={gameTimeHarvey}
                                onChange={(e) => setGameTimeHarvey(Number(e.target.value || 0) || 0)}
                                className="mt-2 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white"
                              />
                            </div>
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                              <div className="text-white/70 text-xs">Brady minutes</div>
                              <input
                                type="number"
                                value={gameTimeBrady}
                                onChange={(e) => setGameTimeBrady(Number(e.target.value || 0) || 0)}
                                className="mt-2 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white"
                              />
                            </div>
                          </div>
                          <button
                            onClick={saveParentSettings}
                            className="w-full px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white/90 text-sm"
                          >
                            Save settings
                          </button>

                          <button
                            onClick={parentResetWeek}
                            className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white/90 transition-all text-xs"
                          >
                            Reset week (uncheck all)
                          </button>
                        </div>
                      </div>
                    ) : parentTab === "helper" ? (
                      <div className="space-y-6">
                        <div>
                          <div className="text-white text-xl font-semibold mb-4">Add daily helper</div>

                          <div className="space-y-3">
                            <input
                              value={helperTitle}
                              onChange={(e) => setHelperTitle(e.target.value)}
                              placeholder="e.g., Clean the table"
                              className="w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white placeholder-white/40"
                            />

                            <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
                              <div className="text-white/70 text-sm">Assign to</div>
                              <label className="flex items-center gap-2 text-white/80 text-sm">
                                <input
                                  type="checkbox"
                                  checked={!!helperAssignHarvey}
                                  onChange={(e) => setHelperAssignHarvey(e.target.checked)}
                                />
                                Harvey
                              </label>
                              <label className="flex items-center gap-2 text-white/80 text-sm">
                                <input
                                  type="checkbox"
                                  checked={!!helperAssignBrady}
                                  onChange={(e) => setHelperAssignBrady(e.target.checked)}
                                />
                                Brady
                              </label>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                                <div className="text-white/70 text-xs">Reward minutes</div>
                                <input
                                  type="number"
                                  value={helperRewardMinutes}
                                  onChange={(e) => setHelperRewardMinutes(Number(e.target.value || 0) || 0)}
                                  className="mt-2 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white"
                                />
                              </div>
                              <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                                <div className="text-white/70 text-xs">Reward points</div>
                                <input
                                  type="number"
                                  value={helperRewardPoints}
                                  onChange={(e) => setHelperRewardPoints(Number(e.target.value || 0) || 0)}
                                  className="mt-2 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white"
                                />
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                              <div className="text-white/70 text-xs">Expiry (optional)</div>
                              <input
                                type="date"
                                value={helperExpiryDate}
                                onChange={(e) => setHelperExpiryDate(e.target.value)}
                                className="mt-2 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white"
                              />
                            </div>

                            <button
                              onClick={parentAddHelper}
                              className="w-full p-3 rounded-xl text-white font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20"
                            >
                              <Plus className="w-5 h-5" />
                              Add helper
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </ParentGate>
                </div>

                {/* RIGHT: Display panel */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 min-h-[420px]">
                  {parentTab === "chores" ? (
                    <SettingsChoresPreview
                      dayName={selectedDayForView}
                      weekKey={weekKey}
                      people={people}
                      settingsChoresViewMode={settingsChoresViewMode}
                      setSettingsChoresViewMode={setSettingsChoresViewMode}
                      todaysByPerson={todaysChoresByPerson}
                      weeklyByPerson={weeklyByPerson}
                      onRequestDone={(wk, chore) => setPendingConfirm({ type: "chore", weekKey: wk, chore })}
                      onRequestRemove={(choreId) => parentRemoveChore(choreId)}
                    />
                  ) : parentTab === "helper" ? (
                    <SettingsHelperPanel
                      active={activeHelpers}
                      inactive={inactiveHelpers}
                      onComplete={(task) => setPendingConfirm({ type: "helper", task })}
                      onDelete={(id) => parentDeleteHelper(id)}
                      onReactivate={(id) => parentReactivateHelper(id)}
                    />
                  ) : (
                    <div className="text-white/50 text-sm">Open a tab.</div>
                  )}
                </div>
              </div>
            ) : (
              // Default: if settings not open, show a simple checklist view (day) similar to main module
              <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
                <div className="text-white/80 text-sm mb-3">Tip: open “Settings” to edit weekly chores, helper tasks, or the planner.</div>
                <SettingsChoresPreview
                  compact
                  dayName={selectedDayForView}
                  weekKey={weekKey}
                  people={people}
                  settingsChoresViewMode={"day"}
                  setSettingsChoresViewMode={() => {}}
                  todaysByPerson={todaysChoresByPerson}
                  weeklyByPerson={weeklyByPerson}
                  onRequestDone={(wk, chore) => setPendingConfirm({ type: "chore", weekKey: wk, chore })}
                  onRequestRemove={null}
                />
              </div>
            )}

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

function SettingsChoresPreview({
  dayName,
  weekKey,
  people,
  settingsChoresViewMode,
  setSettingsChoresViewMode,
  todaysByPerson,
  weeklyByPerson,
  onRequestDone,
  onRequestRemove,
  compact = false,
}) {
  const isWeek = settingsChoresViewMode === "week";
  const title = compact ? "Today" : "Chores preview";

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className={`flex items-center justify-between gap-2 ${compact ? "mb-2" : "mb-3"}`}>
        <div>
          <div className="text-white font-semibold">{title}</div>
          <div className="text-white/50 text-xs mt-1">
            {isWeek ? `Week of ${weekKey}` : dayName}
          </div>
        </div>

        {!compact ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSettingsChoresViewMode("day")}
              className={`px-2 py-1 rounded-lg text-xs border transition-all ${
                !isWeek ? "bg-white/20 border-white/30" : "bg-white/5 border-white/10 hover:bg-white/10"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setSettingsChoresViewMode("week")}
              className={`px-2 py-1 rounded-lg text-xs border transition-all ${
                isWeek ? "bg-white/20 border-white/30" : "bg-white/5 border-white/10 hover:bg-white/10"
              }`}
            >
              Week
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-2xl bg-white/5 border border-white/10 p-3">
        {(people || []).map((person) => {
          const list = isWeek ? (weeklyByPerson?.[person] || []) : (todaysByPerson?.[person] || []);
          if (!list.length) return null;

          return (
            <div key={person} className="py-2 border-b border-white/10 last:border-b-0">
              <div className="text-sm font-semibold text-white/90 mb-1">{person}</div>
              <div className="space-y-1">
                {list.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-sm text-white/85">
                    <button
                      type="button"
                      onClick={() => {
                        if (!c.done) onRequestDone?.(weekKey, c);
                      }}
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                      title={c.done ? "Done" : "Mark done"}
                    >
                      <span className="inline-block w-4">{c.done ? "✅" : "⬜"}</span>
                      <span className={`truncate ${c.done ? "line-through opacity-70" : ""}`}>
                        {isWeek ? `${c.day}: ${c.name}` : c.name}
                      </span>
                    </button>

                    {onRequestRemove ? (
                      <button
                        onClick={() => onRequestRemove(c.id)}
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 text-xs"
                        title="Delete chore"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {!people?.length ? <div className="text-white/40 text-sm">No people configured.</div> : null}
      </div>
    </div>
  );
}

function SettingsHelperPanel({ active, inactive, onComplete, onDelete, onReactivate }) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="mb-3">
        <div className="text-white font-semibold">Daily helpers</div>
        <div className="text-white/50 text-xs mt-1">Active helpers on top. Expired/completed at the bottom.</div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto space-y-4">
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
          <div className="text-white/80 text-sm font-semibold mb-2">Active</div>
          {active?.length ? (
            <div className="space-y-2">
              {active.map((t) => (
                <div key={t.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-white/90 text-sm font-semibold truncate">{t.title}</div>
                      <div className="text-white/60 text-xs mt-1">
                        {(t.assignedTo || []).join(", ")}
                        {formatInlineReward(t.reward)}
                      </div>
                      {t.expiresAt ? (
                        <div className="text-white/45 text-xs mt-1">Expires: {new Date(t.expiresAt).toLocaleDateString()}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onComplete?.(t)}
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs text-white/90"
                      >
                        Complete
                      </button>
                      <button
                        onClick={() => onDelete?.(t.id)}
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-white/40 text-sm">No active helpers.</div>
          )}
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
          <div className="text-white/80 text-sm font-semibold mb-2">Expired / completed</div>
          {inactive?.length ? (
            <div className="space-y-2">
              {inactive
                .slice()
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .map((t) => (
                  <div key={t.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-white/85 text-sm font-semibold truncate">
                          {t.title}{" "}
                          <span className="text-white/45 text-xs font-normal">({t.status})</span>
                        </div>
                        <div className="text-white/60 text-xs mt-1">
                          {(t.assignedTo || []).join(", ")}
                          {formatInlineReward(t.reward)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onReactivate?.(t.id)}
                          className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs text-white/90"
                          title="Reactivate (clears completion and allows rewards again)"
                        >
                          Reactivate
                        </button>
                        <button
                          onClick={() => onDelete?.(t.id)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-white/40 text-sm">No expired/completed helpers.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Planner workspace (routine-based, full-width)
// -----------------------------
function PlannerWorkspace({ ctx, normalized, patch, people, weekKey }) {
  const [bankSearch, setBankSearch] = useState("");
  const [newBankTitle, setNewBankTitle] = useState("");
  const [newBankTags, setNewBankTags] = useState("");

  const [activeCell, setActiveCell] = useState(null); // {day, person} for modal
  const [pickerQuery, setPickerQuery] = useState("");

  const bank = Array.isArray(normalized.choreBank) ? normalized.choreBank : [];
  const plan = normalized.planner?.plan && typeof normalized.planner.plan === "object" ? normalized.planner.plan : {};

  const bankMap = useMemo(() => {
    const m = new Map();
    for (const b of bank) m.set(b.id, b);
    return m;
  }, [bank]);

  const filteredBank = useMemo(() => {
    const q = bankSearch.trim().toLowerCase();
    if (!q) return bank;
    return bank.filter((b) => {
      const title = String(b.title || "").toLowerCase();
      const tags = Array.isArray(b.tags) ? b.tags.join(" ").toLowerCase() : "";
      return title.includes(q) || tags.includes(q);
    });
  }, [bank, bankSearch]);

  const coverage = useMemo(() => {
    let items = 0;
    let filledCells = 0;
    const totalCells = (people?.length || 0) * DAYS.length;

    for (const day of DAYS) {
      const perDay = plan?.[day] || {};
      for (const person of people || []) {
        const arr = Array.isArray(perDay?.[person]) ? perDay[person] : [];
        if (arr.length) filledCells += 1;
        items += arr.length;
      }
    }
    const pct = totalCells ? Math.round((filledCells / totalCells) * 100) : 0;
    return { items, filledCells, totalCells, pct };
  }, [plan, people]);

  const setPlanCell = useCallback(
    (day, person, nextIds) => {
      const nextPlan = { ...(plan || {}) };
      const perDay = { ...(nextPlan[day] || {}) };
      if (nextIds && nextIds.length) perDay[person] = nextIds.slice();
      else delete perDay[person];
      if (Object.keys(perDay).length) nextPlan[day] = perDay;
      else delete nextPlan[day];

      patch({
        ...normalized,
        planner: {
          ...(normalized.planner || {}),
          plan: nextPlan,
        },
      });
    },
    [plan, patch, normalized]
  );

  const addToCell = useCallback(
    (day, person, bankId) => {
      const cur = Array.isArray(plan?.[day]?.[person]) ? plan[day][person] : [];
      if (cur.includes(bankId)) return;
      setPlanCell(day, person, [...cur, bankId]);
    },
    [plan, setPlanCell]
  );

  const removeFromCell = useCallback(
    (day, person, bankId) => {
      const cur = Array.isArray(plan?.[day]?.[person]) ? plan[day][person] : [];
      const next = cur.filter((x) => x !== bankId);
      setPlanCell(day, person, next);
    },
    [plan, setPlanCell]
  );

  const onDragStartBank = (e, bankId) => {
    try {
      e.dataTransfer.setData("text/plain", bankId);
      e.dataTransfer.effectAllowed = "copy";
    } catch {}
  };

  const onDropCell = (e, day, person) => {
    e.preventDefault();
    const bankId = e.dataTransfer.getData("text/plain");
    if (!bankId) return;
    if (!bankMap.has(bankId)) return;
    addToCell(day, person, bankId);
  };

  const addBankChore = () => {
    const title = newBankTitle.trim();
    if (!title) return;
    const tags = newBankTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const item = {
      id: `b_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title,
      tags,
      createdAt: Date.now(),
    };

    patch({
      ...normalized,
      choreBank: [...bank, item],
    });

    setNewBankTitle("");
    setNewBankTags("");
  };

  const deleteBankChore = (bankId) => {
    const nextBank = bank.filter((b) => b.id !== bankId);

    // remove from plan anywhere it appears
    const nextPlan = {};
    for (const day of DAYS) {
      const perDay = plan?.[day] || {};
      const outDay = {};
      for (const person of Object.keys(perDay)) {
        const arr = Array.isArray(perDay[person]) ? perDay[person] : [];
        const nextArr = arr.filter((x) => x !== bankId);
        if (nextArr.length) outDay[person] = nextArr;
      }
      if (Object.keys(outDay).length) nextPlan[day] = outDay;
    }

    patch({
      ...normalized,
      choreBank: nextBank,
      planner: { ...(normalized.planner || {}), plan: nextPlan },
    });
  };

  const clearPlan = () => {
    if (!window.confirm("Clear the whole routine plan?")) return;
    patch({
      ...normalized,
      planner: { ...(normalized.planner || {}), plan: {}, lastPublishedAt: null },
    });
  };

  const publishPlan = () => {
    const now = Date.now();
    const nextChores = [];

    for (const day of DAYS) {
      const perDay = plan?.[day] || {};
      for (const person of people || []) {
        const ids = Array.isArray(perDay?.[person]) ? perDay[person] : [];
        for (const bankId of ids) {
          const b = bankMap.get(bankId);
          if (!b) continue;
          nextChores.push({
            id: `plan:${day}:${person}:${bankId}`,
            day,
            person,
            name: b.title,
            createdAt: now,
          });
        }
      }
    }

    patch({
      ...normalized,
      chores: nextChores,
      planner: { ...(normalized.planner || {}), lastPublishedAt: now },
    });
  };

  const exportBankXml = async () => {
    try {
      const payload = {
        moduleId: "chores-bank",
        exportedAt: Date.now(),
        schemaVersion: normalized.version,
        data: bank,
      };
      const json = JSON.stringify(payload);
      const safe = json.replaceAll("]]>", "]]]]><![CDATA[>");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FamilyDashboard module="chores-bank" schemaVersion="${normalized.version}">
  <exportedAt>${new Date(payload.exportedAt).toISOString()}</exportedAt>
  <json><![CDATA[${safe}]]></json>
</FamilyDashboard>
`;

      try {
        await navigator.clipboard?.writeText?.(xml);
      } catch {}

      const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chores-bank-${new Date().toISOString().slice(0, 10)}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("[CHORES] bank export failed", e);
      alert(e?.message || "Export failed");
    }
  };

  const importBankXml = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml,application/xml,text/xml";
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const xmlText = await file.text();
      try {
        const parsed = parseBankXml(xmlText);
        const nextBank = Array.isArray(parsed) ? parsed : [];
        patch({ ...normalized, choreBank: nextBank });
      } catch (err) {
        alert(err?.message || "Import failed");
      }
    };
    input.click();
  };

  const pickerItems = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return bank;
    return bank.filter((b) => {
      const title = String(b.title || "").toLowerCase();
      const tags = Array.isArray(b.tags) ? b.tags.join(" ").toLowerCase() : "";
      return title.includes(q) || tags.includes(q);
    });
  }, [bank, pickerQuery]);

  return (
    <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-white text-2xl font-bold">Chore planner</div>
          <div className="text-white/60 text-sm mt-1">Edit the routine, then publish to this week’s chores list.</div>
          <div className="text-white/40 text-xs mt-2">
            Coverage: <span className="text-white/70">{coverage.filledCells}/{coverage.totalCells}</span> cells filled{" "}
            <span className="text-white/50">({coverage.pct}%)</span> •{" "}
            <span className="text-white/70">{coverage.items}</span> total assignments
          </div>
        </div>

        <div className="flex gap-2 flex-wrap justify-end">
          <button
            onClick={exportBankXml}
            className="px-3 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm"
          >
            Export XML
          </button>
          <button
            onClick={importBankXml}
            className="px-3 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm"
          >
            Import XML
          </button>
          <button
            onClick={publishPlan}
            className="px-4 py-3 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm"
            title="Generate this week's chores list from the routine"
          >
            Publish to chores
          </button>
          <button
            onClick={clearPlan}
            className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm"
          >
            Clear routine
          </button>
        </div>
      </div>

      {/* bank + grid: fixed height so bank can scroll without pushing grid off-screen */}
      <div className="mt-5 flex flex-col lg:flex-row gap-4 h-[calc(100vh-260px)] overflow-hidden min-h-0 items-stretch">
        {/* BANK */}
        <div className="lg:w-[22%] lg:min-w-[260px] lg:max-w-[380px] rounded-2xl bg-white/5 border border-white/10 h-full min-h-0 overflow-hidden">
          <div className="p-4 h-full min-h-0 flex flex-col gap-3">
            <input
              value={bankSearch}
              onChange={(e) => setBankSearch(e.target.value)}
              placeholder="Search chores or tags…"
              className="w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white placeholder-white/40"
            />

            <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
              <div className="text-white/80 text-sm font-semibold mb-2">Add to bank</div>
              <input
                value={newBankTitle}
                onChange={(e) => setNewBankTitle(e.target.value)}
                placeholder="e.g., Vacuum living room"
                className="w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white placeholder-white/40"
              />
              <input
                value={newBankTags}
                onChange={(e) => setNewBankTags(e.target.value)}
                placeholder="tags (comma-separated)"
                className="mt-2 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white placeholder-white/40"
              />
              <button
                onClick={addBankChore}
                className="mt-2 w-full px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm"
              >
                Add
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto space-y-2 pr-1">
              {filteredBank.length ? (
                filteredBank
                  .slice()
                  .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
                  .map((b) => (
                    <div
                      key={b.id}
                      draggable
                      onDragStart={(e) => onDragStartBank(e, b.id)}
                      className="rounded-xl bg-white/5 border border-white/10 p-3 hover:bg-white/10 transition-all cursor-grab active:cursor-grabbing"
                      title="Drag into a grid cell"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-white/90 text-sm font-semibold truncate">{b.title}</div>
                          {b.tags?.length ? <div className="text-white/50 text-xs mt-1 truncate">{b.tags.join(", ")}</div> : null}
                        </div>
                        <button
                          onClick={() => {
                            if (window.confirm("Delete this bank chore?")) deleteBankChore(b.id);
                          }}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 text-xs"
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="text-white/40 text-sm mt-2">No bank chores yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* GRID */}
        <div className="flex-1 rounded-2xl bg-white/5 border border-white/10 p-4 h-full min-h-0 overflow-auto">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-white font-semibold">Weekly plan grid</div>
              <div className="text-white/50 text-xs mt-1">
                Routine for this week. Week key: <span className="text-white/70">{weekKey}</span>
              </div>
            </div>
            <div className="text-white/40 text-xs">
              Last published:{" "}
              {normalized.planner?.lastPublishedAt ? new Date(normalized.planner.lastPublishedAt).toLocaleString() : "Not yet"}
            </div>
          </div>

          <div className="mt-4 min-w-[720px]">
            <div className="grid" style={{ gridTemplateColumns: `180px repeat(${DAYS.length}, minmax(160px, 1fr))` }}>
              <div className="text-white/50 text-xs p-2 border-b border-white/10"></div>
              {DAYS.map((d) => (
                <div key={d} className="text-white/70 text-xs font-semibold p-2 border-b border-white/10">
                  {d.slice(0, 3)}
                </div>
              ))}

              {(people || []).map((person) => (
                <React.Fragment key={person}>
                  <div className="p-2 border-b border-white/10 text-white/80 text-sm font-semibold">{person}</div>
                  {DAYS.map((day) => {
                    const ids = Array.isArray(plan?.[day]?.[person]) ? plan[day][person] : [];
                    return (
                      <div
                        key={`${person}-${day}`}
                        onClick={() => {
                          setActiveCell({ day, person });
                          setPickerQuery("");
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDropCell(e, day, person)}
                        className="p-2 border-b border-white/10 border-l border-white/10 min-h-[90px] rounded-none hover:bg-white/5 transition-all"
                        title="Click to pick from bank or drop here"
                      >
                        {ids.length ? (
                          <div className="flex flex-wrap gap-1">
                            {ids.map((bankId) => {
                              const b = bankMap.get(bankId);
                              const label = b?.title || bankId;
                              return (
                                <button
                                  key={bankId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeFromCell(day, person, bankId);
                                  }}
                                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-white/85 text-xs"
                                  title="Click to remove"
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-white/30 text-xs mt-7 text-center">Drop or click</div>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {activeCell ? (
        <PlanPickerModal
          title={`Add chore • ${activeCell.person} • ${activeCell.day}`}
          query={pickerQuery}
          setQuery={setPickerQuery}
          items={pickerItems}
          onCancel={() => setActiveCell(null)}
          onPick={(bankId) => {
            addToCell(activeCell.day, activeCell.person, bankId);
            setActiveCell(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PlanPickerModal({ title, query, setQuery, items, onCancel, onPick }) {
  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-3xl bg-white/10 border border-white/20 p-5">
        <div className="text-white text-lg font-semibold">{title}</div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="mt-3 w-full p-3 bg-white/10 border border-white/15 rounded-xl text-white placeholder-white/40"
        />

        <div className="mt-3 max-h-[50vh] overflow-auto space-y-2">
          {items.length ? (
            items
              .slice()
              .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
              .map((b) => (
                <button
                  key={b.id}
                  onClick={() => onPick(b.id)}
                  className="w-full text-left rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-3"
                >
                  <div className="text-white/90 text-sm font-semibold">{b.title}</div>
                  {b.tags?.length ? <div className="text-white/50 text-xs mt-1">{b.tags.join(", ")}</div> : null}
                </button>
              ))
          ) : (
            <div className="text-white/40 text-sm py-6 text-center">No matches.</div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function parseBankXml(xmlText) {
  if (typeof xmlText !== "string" || !xmlText.trim()) throw new Error("Empty XML.");
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseErr = doc.getElementsByTagName("parsererror")?.[0];
  if (parseErr) throw new Error("Invalid XML.");

  const root = doc.documentElement;
  const mod = root?.getAttribute?.("module") || "";
  if (mod && mod !== "chores-bank") throw new Error(`Wrong module in XML (found "${mod}").`);

  const jsonNode = doc.getElementsByTagName("json")?.[0];
  if (!jsonNode) throw new Error("Unsupported XML format (missing <json>).");
  const rawJson = (jsonNode.textContent || "").trim();
  if (!rawJson) throw new Error("XML contains an empty <json> payload.");

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Could not parse JSON payload inside XML.");
  }

  const data = parsed?.data ?? parsed;
  if (!Array.isArray(data)) throw new Error("Bank payload must be an array.");
  return data
    .map((b) => ({
      id: String(b.id || ""),
      title: String(b.title || ""),
      tags: Array.isArray(b.tags) ? b.tags.map(String).map((t) => t.trim()).filter(Boolean) : [],
      createdAt: Number(b.createdAt || 0) || 0,
    }))
    .filter((b) => b.id && b.title);
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
