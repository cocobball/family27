function uuid() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const FIXED_KIDS = [
  { id: "harvey", name: "Harvey" },
  { id: "brady", name: "Brady" },
];

export function defaultRewardsData() {
  return {
    version: 1,
    kids: FIXED_KIDS,
    wallets: {
      harvey: { minutes: 0, points: 0 },
      brady: { minutes: 0, points: 0 },
    },
    ledger: [],
    sessions: [],
  };
}

export function getRewardsData(ctx) {
  const existing = ctx.store.get();
  if (!existing || existing.version !== 1) return defaultRewardsData();
  // ensure fixed kids/wallets exist even if old data
  existing.kids ||= FIXED_KIDS;
  existing.wallets ||= {};
  existing.wallets.harvey ||= { minutes: 0, points: 0 };
  existing.wallets.brady ||= { minutes: 0, points: 0 };
  existing.ledger ||= [];
  existing.sessions ||= [];
  return existing;
}

export function saveRewardsData(ctx, data) {
  ctx.store.set(data);
}

export function hasLedgerEntry(data, sourceModule, sourceRef) {
  return (data.ledger || []).some(
    (l) => l.sourceModule === sourceModule && l.sourceRef === sourceRef
  );
}

export function creditRewards(ctx, payload) {
  const data = getRewardsData(ctx);

  if (!["harvey", "brady"].includes(payload.kidId)) {
    return { ok: false, error: "Unknown kidId" };
  }
  if (payload.currency !== "minutes" && payload.currency !== "points") {
    return { ok: false, error: "Invalid currency" };
  }

  const amt = Math.max(0, Math.floor(Number(payload.amount) || 0));
  if (amt <= 0) return { ok: false, error: "Amount must be positive" };

  // idempotency
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

export function redeemMinutes(ctx, kidId, minutes, target = null) {
  const data = getRewardsData(ctx);

  const mins = Math.max(0, Math.floor(Number(minutes) || 0));
  if (mins <= 0) return { ok: false, error: "Minutes must be positive" };
  if (data.wallets[kidId].minutes < mins) return { ok: false, error: "Insufficient minutes" };

  const sessionId = uuid();
  const endsAt = new Date(Date.now() + mins * 60 * 1000).toISOString();

  debitRewards(ctx, {
    kidId,
    currency: "minutes",
    amount: mins,
    sourceModule: "rewards",
    sourceRef: `redeem:${sessionId}`,
    reason: "Redeemed minutes",
    metadata: { target },
  });

  const updated = getRewardsData(ctx);
  updated.sessions.push({
    id: sessionId,
    kidId,
    minutesSpent: mins,
    startsAt: new Date().toISOString(),
    endsAt,
    status: "active",
  });

  saveRewardsData(ctx, updated);

  ctx.eventBus.emit("NETWORK/SESSION_STARTED", { kidId, sessionId, endsAt, target });
  return { ok: true, sessionId };
}

export function cancelSession(ctx, sessionId) {
  const data = getRewardsData(ctx);
  const s = data.sessions.find((x) => x.id === sessionId);
  if (!s || s.status !== "active") return { ok: false };

  s.status = "canceled";
  saveRewardsData(ctx, data);
  ctx.eventBus.emit("NETWORK/SESSION_ENDED", { kidId: s.kidId, sessionId: s.id });
  return { ok: true };
}

export function tickSessions(ctx) {
  const data = getRewardsData(ctx);
  let changed = false;

  for (const s of data.sessions) {
    if (s.status === "active" && new Date(s.endsAt).getTime() <= Date.now()) {
      s.status = "ended";
      changed = true;
      ctx.eventBus.emit("NETWORK/SESSION_ENDED", { kidId: s.kidId, sessionId: s.id });
    }
  }

  if (changed) saveRewardsData(ctx, data);
}
