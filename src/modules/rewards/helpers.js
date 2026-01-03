// src/modules/rewards/helpers.js

function uuid() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const DEFAULT_PARENT_PASSWORD = "1234"; // 👈 CHANGE PASSWORD HERE

export const FIXED_KIDS = [
  { id: "harvey", name: "Harvey" },
  { id: "brady", name: "Brady" },
];

// Modules allowed to award rewards without parent unlock (system awards)
const SYSTEM_MODULES = ["quizzes", "chores"];

function now() {
  return Date.now();
}

export function defaultRewardsData() {
  return {
    version: 2,
    kids: FIXED_KIDS,
    wallets: {
      harvey: { minutes: 0, points: 0 },
      brady: { minutes: 0, points: 0 },
    },
    ledger: [],
    // sessions are per-kid and can be simultaneous
    // { id, kidId, totalMinutes, startedAt, endsAt, status:"active"|"paused"|"ended"|"canceled", remainingMs?, pausedAt?, target? }
    sessions: [],
    parent: { unlockedUntil: 0 },
  };
}

export function getRewardsData(ctx) {
  let existing;
  if (ctx?.store?.getModuleData) {
    existing = ctx.store.getModuleData("rewards", defaultRewardsData());
  } else {
    existing = ctx.store.get && typeof ctx.store.get === "function" ? ctx.store.get() : null;
  }

  // migrate v1 -> v2
  let data;
  if (!existing || typeof existing !== "object") {
    data = defaultRewardsData();
  } else if (existing.version === 1) {
    data = {
      ...defaultRewardsData(),
      // preserve old shape
      kids: existing.kids || FIXED_KIDS,
      wallets: existing.wallets || defaultRewardsData().wallets,
      ledger: existing.ledger || [],
      sessions: (existing.sessions || []).map((s) => {
        // v1 only had active/ended/canceled; keep what we can
        const status = (s?.status === "ended" || s?.status === "canceled") ? s.status : "active";
        return {
          id: String(s?.id || uuid()),
          kidId: s?.kidId === "harvey" || s?.kidId === "brady" ? s.kidId : "harvey",
          totalMinutes: Number(s?.minutesSpent || s?.totalMinutes || 0) || 0,
          startedAt: s?.startsAt ? new Date(s.startsAt).getTime() : now(),
          endsAt: s?.endsAt ? new Date(s.endsAt).getTime() : now(),
          status,
          remainingMs: null,
          pausedAt: null,
          target: s?.target ?? null,
        };
      }),
      parent: existing.parent || { unlockedUntil: 0 },
      version: 2,
    };
    // write migration
    saveRewardsData(ctx, data);
  } else if (existing.version !== 2) {
    data = defaultRewardsData();
  } else {
    data = existing;
  }

  // Ensure fixed kids/wallets exist
  data.kids ||= FIXED_KIDS;
  data.wallets ||= {};
  data.wallets.harvey ||= { minutes: 0, points: 0 };
  data.wallets.brady ||= { minutes: 0, points: 0 };
  data.ledger ||= [];
  data.sessions ||= [];
  data.parent ||= { unlockedUntil: 0 };

  return data;
}

export function saveRewardsData(ctx, data) {
  if (ctx?.store?.setModuleData) {
    ctx.store.setModuleData("rewards", data);
    return;
  }

  // Fallback: avoid overwriting unrelated module state.
  if (ctx?.store?.get && typeof ctx.store.get === "function" && ctx?.store?.set && typeof ctx.store.set === "function") {
    try {
      const cur = ctx.store.get() || {};
      const next = cur && (cur.version === 1 || cur.version === 2) ? data : { ...(cur || {}), ...data };
      ctx.store.set(next);
      return;
    } catch {}
  }

  if (ctx?.store?.set) ctx.store.set(data);
}

export function isParentUnlocked(data) {
  return (data.parent?.unlockedUntil || 0) > now();
}

/**
 * Unlock parent controls for N minutes if password matches.
 * Returns true/false.
 */
export function unlockParent(ctx, password, minutes = 5) {
  const data = getRewardsData(ctx);
  if (String(password || "") !== DEFAULT_PARENT_PASSWORD) return false;

  data.parent.unlockedUntil = now() + minutes * 60 * 1000;
  saveRewardsData(ctx, data);
  return true;
}

export function lockParent(ctx) {
  const data = getRewardsData(ctx);
  data.parent.unlockedUntil = 0;
  saveRewardsData(ctx, data);
}

export function hasLedgerEntry(data, sourceModule, sourceRef) {
  return (data.ledger || []).some((l) => l.sourceModule === sourceModule && l.sourceRef === sourceRef);
}

export function creditRewards(ctx, payload) {
  const data = getRewardsData(ctx);

  // Validate kid
  if (!["harvey", "brady"].includes(payload.kidId)) {
    return { ok: false, error: "Unknown kidId" };
  }

  // Validate currency
  if (payload.currency !== "minutes" && payload.currency !== "points") {
    return { ok: false, error: "Invalid currency" };
  }

  // Validate amount
  const amt = Math.max(0, Math.floor(Number(payload.amount) || 0));
  if (amt <= 0) return { ok: false, error: "Amount must be positive" };

  // Validate idempotency keys
  if (!payload.sourceModule || !payload.sourceRef) {
    return { ok: false, error: "sourceModule + sourceRef required" };
  }

  // 🔒 HARD BLOCK: manual/other credits require parent unlock
  const isSystem = SYSTEM_MODULES.includes(payload.sourceModule);
  if (!isSystem && !isParentUnlocked(data)) {
    console.warn("[REWARDS] Credit blocked: parent locked", payload);
    return { ok: false, error: "PARENT_LOCKED" };
  }

  // Idempotency
  if (hasLedgerEntry(data, payload.sourceModule, payload.sourceRef)) {
    return { ok: true, idempotent: true };
  }

  data.wallets[payload.kidId][payload.currency] += amt;

  data.ledger.unshift({
    id: uuid(),
    kidId: payload.kidId,
    currency: payload.currency,
    amount: amt,
    kind: "credit",
    sourceModule: payload.sourceModule,
    sourceRef: payload.sourceRef,
    reason: payload.reason || "",
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
  });

  saveRewardsData(ctx, data);
  return { ok: true };
}

export function debitRewards(ctx, payload) {
  const data = getRewardsData(ctx);

  if (!["harvey", "brady"].includes(payload.kidId)) {
    return { ok: false, error: "Unknown kidId" };
  }
  if (payload.currency !== "minutes" && payload.currency !== "points") {
    return { ok: false, error: "Invalid currency" };
  }

  const amt = Math.max(0, Math.floor(Number(payload.amount) || 0));
  if (amt <= 0) return { ok: false, error: "Amount must be positive" };

  if (!payload.sourceModule || !payload.sourceRef) {
    return { ok: false, error: "sourceModule + sourceRef required" };
  }

  data.wallets[payload.kidId][payload.currency] -= amt;

  data.ledger.unshift({
    id: uuid(),
    kidId: payload.kidId,
    currency: payload.currency,
    amount: amt,
    kind: "debit",
    sourceModule: payload.sourceModule,
    sourceRef: payload.sourceRef,
    reason: payload.reason || "",
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
  });

  saveRewardsData(ctx, data);
  return { ok: true };
}

/**
 * --- Network bridge (same idea as Chores) ---
 * We keep these here so Rewards can control Firewalla through the backend.
 */
function getBus(ctx) {
  return ctx?.eventBus || ctx?.bus;
}

export async function allowKidsInternet(ctx, { minutes = 0, kidId = null, sourceRef = "" } = {}) {
  const bus = getBus(ctx);

  // event for any other listeners
  bus?.emit?.("NETWORK/KIDS/ON", {
    minutes: Number(minutes) || 0,
    kidId: kidId || null,
    sourceModule: "rewards",
    sourceRef: sourceRef || "",
    at: Date.now(),
  });

  // direct API (same as Chores)
  try {
    const payload = {
      sourceModule: "rewards",
      action: "on",
      minutes: Number(minutes) || 0,
      kidId: kidId || null,
      sourceRef: sourceRef || "",
    };

    console.log("[REWARDS] POST /api/v1/network/kids/on", payload);
    const res = await fetch("/api/v1/network/kids/on", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log("[REWARDS] kids/on =>", res.status, text);
    if (!res.ok) throw new Error(`${res.status} ${text}`);
  } catch (e) {
    console.warn("[REWARDS] allowKidsInternet fetch failed", e);
  }
}

export async function blockKidsInternet(ctx, { sourceRef = "" } = {}) {
  const bus = getBus(ctx);

  bus?.emit?.("NETWORK/KIDS/OFF", {
    sourceModule: "rewards",
    sourceRef: sourceRef || "",
    at: Date.now(),
  });

  try {
    const payload = { sourceModule: "rewards", action: "off", sourceRef: sourceRef || "" };
    console.log("[REWARDS] POST /api/v1/network/kids/off", payload);
    const res = await fetch("/api/v1/network/kids/off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log("[REWARDS] kids/off =>", res.status, text);
    if (!res.ok) throw new Error(`${res.status} ${text}`);
  } catch (e) {
    console.warn("[REWARDS] blockKidsInternet fetch failed", e);
  }
}

/**
 * Because Firewalla control is currently ONE shared "kids block" rule,
 * we must reconcile ON/OFF based on whether ANY session is active.
 * This is the key fix for "both gaming at the same time".
 */
export async function reconcileKidsInternet(ctx, { sourceRef = "" } = {}) {
  const data = getRewardsData(ctx);
  const anyActive = (data.sessions || []).some((s) => s && s.status === "active" && Number(s.endsAt || 0) > Date.now());

  if (anyActive) {
    // send "ON" (allow)
    await allowKidsInternet(ctx, { minutes: 0, kidId: null, sourceRef: sourceRef || "reconcile:on" });
  } else {
    // send "OFF" (block)
    await blockKidsInternet(ctx, { sourceRef: sourceRef || "reconcile:off" });
  }
}

/**
 * Start a game-time session by redeeming minutes from the kid's wallet.
 * (Honor system for which device they're using; sessions are per kid and can overlap.)
 */
export async function redeemMinutes(ctx, kidId, minutes, target = null) {
  const data = getRewardsData(ctx);

  const mins = Math.max(0, Math.floor(Number(minutes) || 0));
  if (mins <= 0) return { ok: false, error: "Minutes must be positive" };
  if (mins > 120) return { ok: false, error: "Max redeem is 120 minutes" };
  if (!["harvey", "brady"].includes(kidId)) return { ok: false, error: "Unknown kidId" };
  if ((data.wallets?.[kidId]?.minutes || 0) < mins) return { ok: false, error: "Insufficient minutes" };

  // only one session per kid at a time
  const existing = (data.sessions || []).find((s) => s.kidId === kidId && (s.status === "active" || s.status === "paused"));
  if (existing) return { ok: false, error: "Session already active/paused for this kid" };

  const sessionId = uuid();
  const startedAt = Date.now();
  const endsAt = startedAt + mins * 60 * 1000;

  // Debit wallet
  debitRewards(ctx, {
    kidId,
    currency: "minutes",
    amount: mins,
    sourceModule: "rewards",
    sourceRef: `redeem:${sessionId}`,
    reason: "Redeemed minutes for game time",
    metadata: { target },
  });

  // Create session
  const updated = getRewardsData(ctx);
  updated.sessions.push({
    id: sessionId,
    kidId,
    totalMinutes: mins,
    startedAt,
    endsAt,
    status: "active",
    remainingMs: null,
    pausedAt: null,
    target,
  });

  saveRewardsData(ctx, updated);

  // Emit legacy-ish events (optional for other wiring)
  const bus = getBus(ctx);
  bus?.emit?.("NETWORK/SESSION_STARTED", { kidId, sessionId, endsAt: new Date(endsAt).toISOString(), target });

  // Reconcile shared network state
  await reconcileKidsInternet(ctx, { sourceRef: `rewards:start:${kidId}:${sessionId}` });

  return { ok: true, sessionId };
}

export async function pauseSession(ctx, sessionId) {
  const data = getRewardsData(ctx);
  const s = (data.sessions || []).find((x) => x.id === sessionId);
  if (!s || s.status !== "active") return { ok: false, error: "Not active" };

  const remainingMs = Math.max(0, Number(s.endsAt || 0) - Date.now());
  s.status = "paused";
  s.remainingMs = remainingMs;
  s.pausedAt = Date.now();
  s.endsAt = null;

  saveRewardsData(ctx, data);

  // Network OFF only if no one else is active
  await reconcileKidsInternet(ctx, { sourceRef: `rewards:pause:${s.kidId}:${sessionId}` });
  return { ok: true };
}

export async function resumeSession(ctx, sessionId) {
  const data = getRewardsData(ctx);
  const s = (data.sessions || []).find((x) => x.id === sessionId);
  if (!s || s.status !== "paused") return { ok: false, error: "Not paused" };

  const remainingMs = Math.max(0, Number(s.remainingMs || 0));
  if (remainingMs <= 0) {
    s.status = "ended";
    s.remainingMs = 0;
    saveRewardsData(ctx, data);
    await reconcileKidsInternet(ctx, { sourceRef: `rewards:resume->end:${s.kidId}:${sessionId}` });
    return { ok: true, ended: true };
  }

  const nowMs = Date.now();
  s.status = "active";
  s.startedAt = s.startedAt || nowMs;
  s.endsAt = nowMs + remainingMs;
  s.remainingMs = null;
  s.pausedAt = null;

  saveRewardsData(ctx, data);

  const bus = getBus(ctx);
  bus?.emit?.("NETWORK/SESSION_STARTED", {
    kidId: s.kidId,
    sessionId: s.id,
    endsAt: new Date(s.endsAt).toISOString(),
    target: s.target ?? null,
  });

  await reconcileKidsInternet(ctx, { sourceRef: `rewards:resume:${s.kidId}:${sessionId}` });
  return { ok: true };
}

export async function cancelSession(ctx, sessionId) {
  const data = getRewardsData(ctx);
  const s = (data.sessions || []).find((x) => x.id === sessionId);
  if (!s || (s.status !== "active" && s.status !== "paused")) return { ok: false };

  s.status = "canceled";
  saveRewardsData(ctx, data);

  const bus = getBus(ctx);
  bus?.emit?.("NETWORK/SESSION_ENDED", { kidId: s.kidId, sessionId: s.id });

  await reconcileKidsInternet(ctx, { sourceRef: `rewards:cancel:${s.kidId}:${sessionId}` });
  return { ok: true };
}

/**
 * Called periodically by the UI (like your current ticker).
 * Ends sessions when time runs out, then reconciles network.
 */
export async function tickSessions(ctx) {
  const data = getRewardsData(ctx);
  let changed = false;

  for (const s of data.sessions || []) {
    if (!s) continue;
    if (s.status === "active" && Number(s.endsAt || 0) > 0 && Number(s.endsAt) <= Date.now()) {
      s.status = "ended";
      changed = true;

      const bus = getBus(ctx);
      bus?.emit?.("NETWORK/SESSION_ENDED", { kidId: s.kidId, sessionId: s.id });
    }
  }

  if (changed) {
    saveRewardsData(ctx, data);
    await reconcileKidsInternet(ctx, { sourceRef: "rewards:tick:expiry" });
  }

  return changed;
}

/**
 * Parent-only admin actions
 */

export function clearRewardsLedger(ctx) {
  const data = getRewardsData(ctx);
  data.ledger = [];
  saveRewardsData(ctx, data);
  return { ok: true };
}

export function clearRewardsPoints(ctx) {
  const data = getRewardsData(ctx);
  data.wallets.harvey.points = 0;
  data.wallets.brady.points = 0;
  saveRewardsData(ctx, data);
  return { ok: true };
}

export function adjustRewardsPoints(ctx, { kidId, delta, sourceRef, reason }) {
  if (!["harvey", "brady"].includes(kidId)) {
    return { ok: false, error: "Unknown kidId" };
  }
  
  const deltaNum = Math.floor(Number(delta) || 0);
  if (deltaNum === 0) return { ok: false, error: "Delta must be non-zero" };
  
  if (!sourceRef) {
    return { ok: false, error: "sourceRef required" };
  }

  if (deltaNum > 0) {
    // credit
    return creditRewards(ctx, {
      kidId,
      currency: "points",
      amount: deltaNum,
      sourceModule: "rewards-admin",
      sourceRef,
      reason: reason || "Parent points adjustment",
      metadata: {},
    });
  } else {
    // debit
    return debitRewards(ctx, {
      kidId,
      currency: "points",
      amount: Math.abs(deltaNum),
      sourceModule: "rewards-admin",
      sourceRef,
      reason: reason || "Parent points adjustment",
      metadata: {},
    });
  }
}

export function resetRewardsModule(ctx) {
  const fresh = defaultRewardsData();
  saveRewardsData(ctx, fresh);
  return { ok: true };
}
