import React, { useEffect, useState } from "react";
import {
  FIXED_KIDS,
  creditRewards,
  redeemMinutes,
  tickSessions,
  cancelSession,
  pauseSession,
  resumeSession,
  getRewardsData,
  unlockParent,
  lockParent,
  clearRewardsLedger,
  clearRewardsPoints,
  adjustRewardsPoints,
  resetRewardsModule,
} from "./helpers.js";

function fmtRemainingMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function fmtRemainingFromSession(session) {
  if (!session) return "00:00";
  if (session.status === "active" && session.endsAt) {
    return fmtRemainingMs(Math.max(0, Number(session.endsAt) - Date.now()));
  }
  if (session.status === "paused") {
    return fmtRemainingMs(Math.max(0, Number(session.remainingMs || 0)));
  }
  return "00:00";
}

const S = {
  card: {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    borderRadius: 12,
    padding: 12,
  },
  input: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    outline: "none",
  },
  btn: (active) => ({
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)",
    color: "white",
    cursor: "pointer",
  }),
  btnDanger: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,120,120,0.35)",
    background: "rgba(255,80,80,0.12)",
    color: "white",
    cursor: "pointer",
  },
  btnSmall: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    cursor: "pointer",
    fontSize: 12,
  },
  label: { fontSize: 12, opacity: 0.85, marginBottom: 6 },
};

export default function RewardsModule({ ctx }) {
  const [, rerender] = useState(0);

  // Manual credit controls
  const [kidId, setKidId] = useState("harvey");
  const [currency, setCurrency] = useState("minutes");
  const [amount, setAmount] = useState(10);
  const [reason, setReason] = useState("Manual credit");

  // Parent admin controls
  const [adminKidId, setAdminKidId] = useState("harvey");
  const [pointsDelta, setPointsDelta] = useState(0);

  // Listen for events + run session ticker
  useEffect(() => {
    const offCredit = ctx.eventBus.on("REWARDS/CREDIT", (payload) => {
      const res = creditRewards(ctx, payload);
      if (!res.ok && res.error === "PARENT_LOCKED") {
        console.warn("[REWARDS] Credit rejected (locked)");
      }
      rerender((x) => x + 1);
    });

    const t = setInterval(async () => {
      await tickSessions(ctx);
      rerender((x) => x + 1);
    }, 1000);

    return () => {
      try { offCredit && offCredit(); } catch {}
      clearInterval(t);
    };
  }, [ctx]);

  const data = getRewardsData(ctx);
  const ledger = data.ledger || [];
  const sessions = data.sessions || [];
  const parentUnlocked = (data.parent?.unlockedUntil || 0) > Date.now();

  const sessionForKid = (kid) =>
    sessions.find((s) => s.kidId === kid && (s.status === "active" || s.status === "paused")) || null;

  return (
    <div style={{ padding: 16, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Rewards</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Parent: {parentUnlocked ? "Unlocked" : "Locked"}
          </div>

          {parentUnlocked ? (
            <button
              style={S.btn(false)}
              onClick={() => {
                lockParent(ctx);
                rerender((x) => x + 1);
              }}
            >
              Lock now
            </button>
          ) : (
            <button
              style={S.btn(false)}
              onClick={() => {
                const pwd = prompt("Parent password:");
                if (!pwd) return;
                const ok = unlockParent(ctx, pwd, 5);
                if (!ok) {
                  alert("Incorrect password");
                  return;
                }
                rerender((x) => x + 1);
              }}
            >
              Unlock
            </button>
          )}
        </div>
      </div>

      {/* Manual credit (parent-locked) */}
      {parentUnlocked ? (
        <div style={{ ...S.card, marginTop: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>
            Manual credit (Parent required)
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={S.label}>Kid</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={S.btn(kidId === "harvey")} onClick={() => setKidId("harvey")}>
                  Harvey
                </button>
                <button style={S.btn(kidId === "brady")} onClick={() => setKidId("brady")}>
                  Brady
                </button>
              </div>
            </div>

            <div>
              <div style={S.label}>Currency</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={S.btn(currency === "minutes")} onClick={() => setCurrency("minutes")}>
                  Minutes
                </button>
                <button style={S.btn(currency === "points")} onClick={() => setCurrency("points")}>
                  Points
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <div style={{ minWidth: 140 }}>
                <div style={S.label}>Amount</div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ ...S.input, width: "100%" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={S.label}>Reason</div>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ ...S.input, width: "100%" }}
                />
              </div>

              <button
                style={S.btn(false)}
                onClick={() => {
                  if (!parentUnlocked) {
                    const pwd = prompt("Parent password required to add rewards:");
                    if (!pwd) return;
                    const ok = unlockParent(ctx, pwd, 5);
                    if (!ok) {
                      alert("Incorrect password");
                      return;
                    }
                  }

                  const sourceRef = `manual:${Date.now()}`;
                  ctx.eventBus.emit("REWARDS/CREDIT", {
                    kidId,
                    currency,
                    amount: Number(amount),
                    sourceModule: "manual",
                    sourceRef,
                    reason,
                  });

                  rerender((x) => x + 1);
                }}
              >
                Credit
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Parent Admin */}
      {parentUnlocked ? (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>
            Parent Admin
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={S.label}>Adjust Points</div>
              <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                <div>
                  <div style={{ ...S.label, fontSize: 11 }}>Kid</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={S.btnSmall} onClick={() => setAdminKidId("harvey")}>
                      {adminKidId === "harvey" ? "✓ " : ""}Harvey
                    </button>
                    <button style={S.btnSmall} onClick={() => setAdminKidId("brady")}>
                      {adminKidId === "brady" ? "✓ " : ""}Brady
                    </button>
                  </div>
                </div>

                <div style={{ minWidth: 120 }}>
                  <div style={{ ...S.label, fontSize: 11 }}>Delta (+/-)</div>
                  <input
                    type="number"
                    value={pointsDelta}
                    onChange={(e) => setPointsDelta(e.target.value)}
                    placeholder="e.g. 10 or -5"
                    style={{ ...S.input, width: "100%" }}
                  />
                </div>

                <button
                  style={S.btn(false)}
                  onClick={() => {
                    const delta = Number(pointsDelta) || 0;
                    if (delta === 0) {
                      alert("Delta must be non-zero");
                      return;
                    }
                    const res = adjustRewardsPoints(ctx, {
                      kidId: adminKidId,
                      delta,
                      sourceRef: `points_adjust:${Date.now()}`,
                      reason: `Parent adjusted points by ${delta}`,
                    });
                    if (!res.ok) {
                      alert(res.error || "Failed");
                    } else {
                      setPointsDelta(0);
                      rerender((x) => x + 1);
                    }
                  }}
                >
                  Apply points change
                </button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 12 }}>
              <div style={{ ...S.label, marginBottom: 8 }}>Destructive Actions</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={S.btnDanger}
                  onClick={() => {
                    if (!window.confirm("Clear entire ledger (transaction history)? This cannot be undone.")) return;
                    clearRewardsLedger(ctx);
                    rerender((x) => x + 1);
                  }}
                >
                  Clear ledger
                </button>

                <button
                  style={S.btnDanger}
                  onClick={() => {
                    if (!window.confirm("Set both kids' points to 0? This cannot be undone.")) return;
                    clearRewardsPoints(ctx);
                    rerender((x) => x + 1);
                  }}
                >
                  Clear all points
                </button>

                <button
                  style={S.btnDanger}
                  onClick={() => {
                    if (!window.confirm("Reset entire Rewards module to defaults (balances + ledger + sessions)?\n\nThis CANNOT be undone!")) return;
                    if (!window.confirm("Are you SURE? All data will be lost.")) return;
                    resetRewardsModule(ctx);
                    rerender((x) => x + 1);
                  }}
                >
                  Reset rewards data
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Balances / Game time sessions */}
      <h3 style={{ margin: "0 0 10px 0" }}>Balances / Game time</h3>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {FIXED_KIDS.map((k) => {
          const w = data.wallets[k.id];
          const sess = sessionForKid(k.id);

          return (
            <div key={k.id} style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{k.name}</div>
                  <div>Minutes: {w.minutes}</div>
                  <div>Points: {w.points}</div>
                </div>

                <div style={{ textAlign: "right" }}>
                  {sess ? (
                    <>
                      <div style={{ fontWeight: 800 }}>
                        {sess.status === "active" ? "Active" : "Paused"} • {fmtRemainingFromSession(sess)}
                      </div>

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                        {sess.status === "active" ? (
                          <button
                            style={S.btnSmall}
                            onClick={async () => {
                              await pauseSession(ctx, sess.id);
                              rerender((x) => x + 1);
                            }}
                            title="Pause (blocks kids internet if no other active session)"
                          >
                            Pause
                          </button>
                        ) : (
                          <button
                            style={S.btnSmall}
                            onClick={async () => {
                              await resumeSession(ctx, sess.id);
                              rerender((x) => x + 1);
                            }}
                            title="Resume (allows kids internet)"
                          >
                            Resume
                          </button>
                        )}

                        <button
                          style={S.btnDanger}
                          onClick={async () => {
                            await cancelSession(ctx, sess.id);
                            rerender((x) => x + 1);
                          }}
                          title="End this kid's session (shared internet only blocks if nobody else is active)"
                        >
                          End
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        style={S.btn(false)}
                        onClick={async () => {
                          const res = await redeemMinutes(ctx, k.id, 15);
                          if (!res.ok) alert(res.error || "Failed");
                          rerender((x) => x + 1);
                        }}
                      >
                        Redeem 15
                      </button>
                      <button
                        style={S.btn(false)}
                        onClick={async () => {
                          const res = await redeemMinutes(ctx, k.id, 30);
                          if (!res.ok) alert(res.error || "Failed");
                          rerender((x) => x + 1);
                        }}
                      >
                        Redeem 30
                      </button>
                      <button
                        style={S.btn(false)}
                        onClick={async () => {
                          const res = await redeemMinutes(ctx, k.id, 60);
                          if (!res.ok) alert(res.error || "Failed");
                          rerender((x) => x + 1);
                        }}
                      >
                        Redeem 60
                      </button>
                      {w.minutes >= 120 ? (
                        <button
                          style={S.btn(false)}
                          onClick={async () => {
                            const res = await redeemMinutes(ctx, k.id, 120);
                            if (!res.ok) alert(res.error || "Failed");
                            rerender((x) => x + 1);
                          }}
                        >
                          Redeem 120
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                Note: Firewalla currently uses a shared kids rule, so internet stays ON while either kid has an active session.
              </div>
            </div>
          );
        })}
      </div>

      {/* Ledger */}
      <h3 style={{ margin: "0 0 10px 0" }}>Ledger</h3>
      {ledger.length === 0 ? (
        <div style={{ opacity: 0.85 }}>No transactions yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {ledger.slice(0, 50).map((l) => (
            <div key={l.id} style={S.card}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {new Date(l.createdAt).toLocaleString()} • {l.sourceModule}
              </div>
              <div style={{ marginTop: 4 }}>
                <b>{l.kidId === "harvey" ? "Harvey" : "Brady"}</b> {l.kind}{" "}
                <b>{l.amount}</b> {l.currency} — {l.reason || "(no reason)"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
