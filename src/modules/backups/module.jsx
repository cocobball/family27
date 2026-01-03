// src/modules/backups/module.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Shield, RefreshCw, Archive, AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";
import { formatBytes, formatDateTime, isValidBackupFilename } from "./helpers.js";

// --- ParentGate copy (local only; no dependency on chores module) ---
import { getRewardsData, unlockParent, isParentUnlocked, defaultRewardsData } from "../rewards/helpers.js";

function ParentGateLocal({ ctx, title = "Parent", children, onCancel }) {
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
    if (!s || typeof s.subscribe !== "function") return;
    const unsub = s.subscribe(() => setRev((r) => r + 1));
    return () => unsub?.();
  }, [s]);

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

// --- Confirm modal (type RESTORE) ---
function ConfirmRestoreModal({ filename, onCancel, onConfirm, busy, err }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toUpperCase() === "RESTORE";

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-3xl bg-white/10 border border-white/20 p-5">
        <div className="text-white text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-200" />
          Restore backup?
        </div>

        <div className="text-white/70 text-sm mt-2">
          This will restore the entire dashboard system from:
          <div className="mt-2 p-3 rounded-2xl bg-white/5 border border-white/10 text-white/90 font-mono text-xs">
            {filename}
          </div>
          The dashboard will restart and you may get disconnected for a minute.
        </div>

        <div className="mt-4">
          <div className="text-white/70 text-sm mb-2">Type <span className="text-white font-semibold">RESTORE</span> to confirm</div>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="RESTORE"
            className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40"
          />
        </div>

        {err ? <div className="text-red-200 text-sm mt-3">{err}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => ok && onConfirm()}
            disabled={!ok || busy}
            className="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-200/20 text-red-100 text-sm disabled:opacity-50"
          >
            {busy ? "Starting restore..." : "Confirm restore"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function BackupsModule({ ctx }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null); // {summary, backups}
  const [parentOpen, setParentOpen] = useState(false);

  const [confirming, setConfirming] = useState(null); // filename
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreErr, setRestoreErr] = useState("");

  const fetchList = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/v1/backups", { method: "GET" });
      let j = null;
      try {
        j = await r.json();
      } catch {}

      if (!r.ok) {
        // Show friendly "No backups found" instead of throwing
        setPayload({ summary: { count: 0, totalBytes: 0, latestMtimeMs: 0 }, backups: [] });
        return;
      }

      if (!j || j.ok === false || !Array.isArray(j.backups)) {
        setPayload({ summary: { count: 0, totalBytes: 0, latestMtimeMs: 0 }, backups: [] });
      } else {
        setPayload(j);
      }
    } catch (e) {
      setErr(e?.message || "Failed to load backups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = payload?.summary || { count: 0, totalBytes: 0, latestMtimeMs: 0 };
  const backups = Array.isArray(payload?.backups) ? payload.backups : [];

  const startRestore = async (filename) => {
    setRestoreBusy(true);
    setRestoreErr("");
    try {
      const r = await fetch("/api/v1/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      // show a friendly state; the app will restart soon
      setConfirming(null);
      setParentOpen(false);
      alert("Restore started. The dashboard will restart. If the page disconnects, refresh in ~30–60 seconds.");
    } catch (e) {
      setRestoreErr(e?.message || "Failed to start restore");
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2">
        <Archive size={18} />
        <div className="font-semibold">Backups</div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={fetchList}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white/90 text-sm flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            onClick={() => setParentOpen((v) => !v)}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white/90 text-sm flex items-center gap-2"
            title="Parent tools"
          >
            <Shield className="w-4 h-4" />
            Parent
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3 flex-1 min-h-0">
        {err ? (
          <div className="rounded-2xl bg-red-500/10 border border-red-200/20 p-3 text-red-100 text-sm">{err}</div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white/5 border border-white/15 p-3">
            <div className="text-xs opacity-70">Backups found</div>
            <div className="text-lg font-semibold">{summary.count || 0}</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/15 p-3">
            <div className="text-xs opacity-70">Total size</div>
            <div className="text-lg font-semibold">{formatBytes(summary.totalBytes || 0)}</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/15 p-3">
            <div className="text-xs opacity-70">Latest backup</div>
            <div className="text-sm font-semibold mt-1">{formatDateTime(summary.latestMtimeMs || 0)}</div>
          </div>
        </div>

        {parentOpen ? (
          <div className="rounded-3xl bg-white/5 border border-white/15 p-4">
            <ParentGateLocal ctx={ctx} title="Restore backups" onCancel={() => setParentOpen(false)}>
              <div className="text-white/70 text-sm">
                Restore is enabled below. Pick a backup row and click <span className="text-white/90 font-semibold">Restore</span>.
              </div>
            </ParentGateLocal>
          </div>
        ) : null}

        <div className="rounded-2xl bg-white/5 border border-white/15 p-3 flex-1 min-h-0 overflow-auto">
          {loading && !payload ? <div className="text-sm opacity-60 py-3">Loading backups…</div> : null}

          {!loading && backups.length === 0 ? (
            <div className="text-sm opacity-60 py-3">No backups found in /home/masri/backups</div>
          ) : null}

          {backups.length > 0 ? (
            <div className="space-y-2">
              {backups.map((b) => {
                const filename = b?.filename || "";
                const canRestore = parentOpen && isValidBackupFilename(filename);

                return (
                  <div key={filename} className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white/90 truncate">{filename}</div>
                      <div className="text-xs text-white/60 mt-1 flex gap-3 flex-wrap">
                        <span>Modified: {formatDateTime(b?.mtimeMs)}</span>
                        <span>Size: {formatBytes(b?.sizeBytes)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => setConfirming(filename)}
                      disabled={!canRestore}
                      className="px-3 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-200/20 text-red-100 text-sm disabled:opacity-40"
                      title={parentOpen ? "Restore this backup" : "Open Parent to enable restore"}
                    >
                      Restore
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <ConfirmRestoreModal
          filename={confirming}
          busy={restoreBusy}
          err={restoreErr}
          onCancel={() => {
            if (!restoreBusy) setConfirming(null);
            setRestoreErr("");
          }}
          onConfirm={() => startRestore(confirming)}
        />
      ) : null}
    </div>
  );
}
