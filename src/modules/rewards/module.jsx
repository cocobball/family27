import React, { useEffect, useState } from "react";
import {
  FIXED_KIDS,
  creditRewards,
  redeemMinutes,
  tickSessions,
  cancelSession,
  getRewardsData,
  unlockParent,
  lockParent,
} from "./helpers.js";
import { unlockKid, lockKid } from "../../core/networkAdapter.js";

function fmtRemaining(endsAt) {
  const ms = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
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
  label: { fontSize: 12, opacity: 0.85, marginBottom: 6 },
};

export default function RewardsModule({ ctx }) {
  const [, rerender] = useState(0);

  // Manual credit controls
  const [kidId, setKidId] = useState("harvey");
  const [currency, setCurrency] = useState("minutes");
  const [amount, setAmount] = useState(10);
  const [reason, setReason] = useState("Manual credit");

  // Listen for events + run session ticker
  useEffect(() => {
    const offCredit = ctx.eventBus.on("REWARDS/CREDIT", (payload) => {
      const res = creditRewards(ctx, payload);
      if (!res.ok && res.error === "PARENT_LOCKED") {
        // If some UI accidentally tried, don't spam alerts
        console.warn("[REWARDS] Credit rejected (locked)");
      }
      rerender((x) => x + 1);
    });

    const offStart = ctx.eventBus.on("NETWORK/SESSION_STARTED", async (payload) => {
      console.log("[NETWORK/SESSION_STARTED]", payload);
      await unlockKid({
        kidId: payload.kidId,
        minutes: null,
        targets: payload.target ? [payload.target] : undefined,
      });
    });

    const offEnd = ctx.eventBus.on("NETWORK/SESSION_ENDED", async (payload) => {
      console.log("[NETWORK/SESSION_ENDED]", payload);
      await lockKid({ kidId: payload.kidId, targets: undefined });
      rerender((x) => x + 1);
    });

    const t = setInterval(() => {
      tickSessions(ctx);
      rerender((x) => x + 1);
    }, 1000);

    return () => {
      try { offCredit && offCredit(); } catch {}
      try { offStart && offStart(); } catch {}
      try { offEnd && offEnd(); } catch {}
      clearInterval(t);
    };
  }, [ctx]);

  const data = getRewardsData(ctx);
  const ledger = data.ledger || [];
  const sessions = data.sessions || [];
  const parentUnlocked = (data.parent?.unlockedUntil || 0) > Date.now();

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
          ) : null}
        </div>
      </div>

      {/* Manual credit (parent-locked) */}
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

      {/* Balances / Redeem (kids can use) */}
      <h3 style={{ margin: "0 0 10px 0" }}>Balances</h3>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {FIXED_KIDS.map((k) => {
          const w = data.wallets[k.id];
          const active = sessions.find((s) => s.kidId === k.id && s.status === "active");

          return (
            <div key={k.id} style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{k.name}</div>
                  <div>Minutes: {w.minutes}</div>
                  <div>Points: {w.points}</div>
                </div>

                <div style={{ textAlign: "right" }}>
                  {active ? (
                    <>
                      <div style={{ fontWeight: 800 }}>Ends in {fmtRemaining(active.endsAt)}</div>
                      <button style={{ ...S.btnDanger, marginTop: 8 }} onClick={() => cancelSession(ctx, active.id)}>
                        Cancel session
                      </button>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button style={S.btn(false)} onClick={() => redeemMinutes(ctx, k.id, 15)}>Redeem 15</button>
                      <button style={S.btn(false)} onClick={() => redeemMinutes(ctx, k.id, 30)}>Redeem 30</button>
                      <button style={S.btn(false)} onClick={() => redeemMinutes(ctx, k.id, 60)}>Redeem 60</button>
                    </div>
                  )}
                </div>
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
