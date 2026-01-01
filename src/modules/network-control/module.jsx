import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultNetworkControlData,
  formatRemaining,
  isAllowActive,
  remainingMs,
  uuid,
} from "./helpers.js";

// Rewards parent-lock helpers
import {
  defaultRewardsData,
  isParentUnlocked,
  unlockParent,
  lockParent,
} from "../rewards/helpers.js";

// Read/write rewards module data via the global store helpers
import { getModuleData, setModuleData } from "../../core/dashboardStore.js";

function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);

  const data = useMemo(() => {
    return ctx.store.get(defaultFn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, ctx]);

  const patch = (partial) => {
    const cur = ctx.store.get(defaultFn());
    const next = { ...(cur || {}), ...(partial || {}) };
    ctx.store.set(next);
    setRev((r) => r + 1);
    return next;
  };

  return { data, patch, bump: () => setRev((r) => r + 1) };
}

const ui = {
  card: {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.12)",
    borderRadius: 16,
    padding: 12,
  },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
  },
  btn: {
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "14px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.14)",
    color: "rgba(255,255,255,0.95)",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnDanger: {
    padding: "14px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,80,80,0.25)",
    color: "rgba(255,255,255,0.95)",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(0,0,0,0.18)",
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: 0.2,
  },
};

export default function NetworkControlModule({ ctx }) {
  const { data, patch } = useModuleData(ctx, defaultNetworkControlData);

  const [busy, setBusy] = useState(false);

  // parent lock
  const [parentUnlocked, setParentUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  // countdown tick (forces re-render once a second so remaining time updates)
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll rewards lock status
  useEffect(() => {
    function checkParentLock() {
      const rewards = getModuleData("rewards", defaultRewardsData());
      setParentUnlocked(isParentUnlocked(rewards));
    }
    checkParentLock();
    const t = setInterval(checkParentLock, 500);
    return () => clearInterval(t);
  }, []);

  // ----- API helpers -----
  async function apiGetStatus() {
    const r = await fetch("/api/v1/network/kids/status");
    const j = await r.json();
    patch({ lastStatus: j, lastStatusAt: new Date().toISOString() });
    return j;
  }

  async function apiKidsOff() {
    // OFF = block (policy enabled)
    const r = await fetch("/api/v1/network/kids/off", { method: "POST" });
    return await r.json();
  }

  async function apiKidsOn() {
    // ON = allow (policy disabled)
    const r = await fetch("/api/v1/network/kids/on", { method: "POST" });
    return await r.json();
  }

  function addHistory(entry) {
    const next = [entry, ...(data.history || [])].slice(0, 20);
    patch({ history: next });
  }

  // ----- Parent unlock actions -----
  function rewardsCtx() {
    return {
      store: {
        get: (defaultVal) => getModuleData("rewards", defaultVal),
        set: (val) => setModuleData("rewards", val),
      },
    };
  }

  function requireParentOrOpenModal() {
    if (parentUnlocked) return true;
    setShowPw(true);
    return false;
  }

  function doUnlock() {
    const ok = unlockParent(rewardsCtx(), pw, 5); // 5 minutes
    if (!ok) return alert("Wrong parent password");
    setPw("");
    setShowPw(false);
  }

  function doLock() {
    lockParent(rewardsCtx());
  }

  // ----- Derived Firewalla state -----
  // disabled="0" => policy enabled => block active => Kids internet OFF
  // disabled="1" => policy disabled => block inactive => Kids internet ON
  const fwDisabled = String(data?.lastStatus?.disabled ?? "");
  const kidsInternetOn = fwDisabled === "1";
  const kidsInternetOff = fwDisabled === "0";

  const allowActive = isAllowActive(data);
  const remain = allowActive ? formatRemaining(data.allowUntil) : null;

  // ----- Actions -----
  async function setKids(state /* "on" | "off" */, minutes = 0, metaAction = null) {
    if (!requireParentOrOpenModal()) return;

    setBusy(true);
    try {
      let result;
      if (state === "off") {
        // Block now: clear any allow timer
        patch({ allowUntil: null });
        result = await apiKidsOff();
      } else {
        result = await apiKidsOn();
      }

      addHistory({
        id: uuid(),
        at: new Date().toISOString(),
        action:
          metaAction ||
          (state === "off" ? "KIDS_OFF_BLOCK" : "KIDS_ON_ALLOW"),
        minutes: minutes || 0,
        ok: !!result?.ok,
        error: result?.ok ? "" : (result?.error || "unknown error"),
      });

      await apiGetStatus();
    } catch (e) {
      addHistory({
        id: uuid(),
        at: new Date().toISOString(),
        action: metaAction || (state === "off" ? "KIDS_OFF_BLOCK" : "KIDS_ON_ALLOW"),
        minutes: minutes || 0,
        ok: false,
        error: String(e?.message || e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function allowFor(minutes) {
    if (!requireParentOrOpenModal()) return;

    // 1) Allow now
    await setKids("on", minutes, `ALLOW_FOR_${minutes}M`);

    // 2) Set allowUntil timer
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    patch({ allowUntil: until });
  }

  async function cancelTimer() {
    if (!requireParentOrOpenModal()) return;
    patch({ allowUntil: null });
    addHistory({
      id: uuid(),
      at: new Date().toISOString(),
      action: "CANCEL_TIMER",
      minutes: 0,
      ok: true,
      error: "",
    });
  }

  // Auto-block when timer expires (no parent prompt)
  const autoBlockRunningRef = useRef(false);
  useEffect(() => {
    const t = setInterval(async () => {
      const cur = ctx.store.get(defaultNetworkControlData());
      const ms = cur?.allowUntil ? remainingMs(cur.allowUntil) : 0;

      if (cur?.allowUntil && ms <= 0 && !autoBlockRunningRef.current) {
        autoBlockRunningRef.current = true;

        patch({ allowUntil: null });
        setBusy(true);

        try {
          const result = await apiKidsOff();
          addHistory({
            id: uuid(),
            at: new Date().toISOString(),
            action: "AUTO_BLOCK_TIMER_EXPIRED",
            minutes: 0,
            ok: !!result?.ok,
            error: result?.ok ? "" : (result?.error || "unknown error"),
          });
          await apiGetStatus();
        } catch (e) {
          addHistory({
            id: uuid(),
            at: new Date().toISOString(),
            action: "AUTO_BLOCK_TIMER_EXPIRED",
            minutes: 0,
            ok: false,
            error: String(e?.message || e),
          });
        } finally {
          setBusy(false);
          autoBlockRunningRef.current = false;
        }
      }
    }, 1000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Status poll
  useEffect(() => {
    apiGetStatus().catch(() => {});
    const t = setInterval(() => apiGetStatus().catch(() => {}), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disabledBtnStyle = busy ? ui.btnDisabled : null;

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Internet Control</div>
          <div style={{ opacity: 0.75, marginTop: 4 }}>
            Policy ID: <b>{data?.lastStatus?.pid || "?"}</b>
            {" • "}
            Last check:{" "}
            {data?.lastStatusAt ? new Date(data.lastStatusAt).toLocaleTimeString() : "—"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={ui.pill}>
            Kids Internet:{" "}
            {kidsInternetOn ? "ON" : kidsInternetOff ? "OFF" : "UNKNOWN"}
          </div>

          <button
            onClick={() => (parentUnlocked ? doLock() : setShowPw(true))}
            style={{
              ...ui.btn,
              ...(busy ? ui.btnDisabled : null),
            }}
            disabled={busy}
          >
            {parentUnlocked ? "Lock Parent" : "Unlock Parent"}
          </button>
        </div>
      </div>

      {/* Timer card */}
      {allowActive ? (
        <div style={ui.card}>
          <div style={{ fontWeight: 900 }}>Timer active</div>
          <div style={{ opacity: 0.9, marginTop: 4 }}>
            Kids internet stays <b>ON</b> for: <b>{remain}</b>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              disabled={busy}
              onClick={cancelTimer}
              style={{ ...ui.btn, ...(busy ? ui.btnDisabled : null) }}
            >
              Cancel Timer
            </button>
            <button
              disabled={busy}
              onClick={() => apiGetStatus().catch(() => {})}
              style={{ ...ui.btn, ...(busy ? ui.btnDisabled : null) }}
            >
              Refresh Status
            </button>
          </div>
        </div>
      ) : (
        <div style={{ ...ui.card, opacity: 0.9 }}>
          <div style={{ fontWeight: 900 }}>No timer running</div>
          <div style={{ opacity: 0.8, marginTop: 4 }}>
            Use a preset below to allow internet temporarily.
          </div>
        </div>
      )}

      {/* Primary actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button
          disabled={busy}
          onClick={() => setKids("on")}
          style={{ ...ui.btnPrimary, ...(busy ? ui.btnDisabled : null) }}
        >
          Kids ON (Allow)
        </button>

        <button
          disabled={busy}
          onClick={() => setKids("off")}
          style={{ ...ui.btnDanger, ...(busy ? ui.btnDisabled : null) }}
        >
          Kids OFF (Block)
        </button>
      </div>

      {/* Timer presets */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <button disabled={busy} onClick={() => allowFor(15)} style={{ ...ui.btn, ...(disabledBtnStyle || null) }}>
          15 min
        </button>
        <button disabled={busy} onClick={() => allowFor(30)} style={{ ...ui.btn, ...(disabledBtnStyle || null) }}>
          30 min
        </button>
        <button disabled={busy} onClick={() => allowFor(60)} style={{ ...ui.btn, ...(disabledBtnStyle || null) }}>
          1 hour
        </button>
        <button disabled={busy} onClick={() => allowFor(120)} style={{ ...ui.btn, ...(disabledBtnStyle || null) }}>
          2 hours
        </button>
      </div>

      {/* History */}
      <div style={{ marginTop: 6 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>History (last 20)</div>
        <div style={{ display: "grid", gap: 6 }}>
          {(data.history || []).length === 0 ? (
            <div style={{ opacity: 0.7 }}>No actions yet.</div>
          ) : (
            (data.history || []).map((h) => (
              <div
                key={h.id}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ display: "grid" }}>
                  <div style={{ fontWeight: 800 }}>
                    {h.action} {h.minutes ? `(${h.minutes}m)` : ""}
                  </div>
                  <div style={{ opacity: 0.7 }}>{new Date(h.at).toLocaleString()}</div>
                  {h.error ? <div style={{ opacity: 0.9 }}>Error: {h.error}</div> : null}
                </div>
                <div style={{ fontWeight: 900 }}>{h.ok ? "✅" : "❌"}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Parent password modal */}
      {showPw && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 9999,
          }}
          onClick={() => setShowPw(false)}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "rgba(10,10,10,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 16,
              display: "grid",
              gap: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 900 }}>Parent Unlock</div>
            <div style={{ opacity: 0.8 }}>
              Enter parent password to control internet.
            </div>

            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Parent password"
              style={ui.input}
              autoFocus
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowPw(false)} style={ui.btn}>
                Cancel
              </button>
              <button onClick={doUnlock} style={ui.btnPrimary}>
                Unlock (5 min)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
