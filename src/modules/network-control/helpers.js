export function defaultNetworkControlData() {
  return {
    version: 1,

    // If set, we automatically keep kids internet ON until this time
    // (ISO string or null)
    allowUntil: null,

    // cache of last status fetch
    lastStatus: null, // { ok, pid, disabled, ... } or null
    lastStatusAt: null, // ISO string

    // history of actions
    history: [], // [{ id, at, action, minutes, ok, error }]
  };
}

export function isAllowActive(data) {
  if (!data?.allowUntil) return false;
  return new Date(data.allowUntil).getTime() > Date.now();
}

export function remainingMs(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, ms);
}

export function formatRemaining(iso) {
  const ms = remainingMs(iso);
  if (!ms) return "0m";

  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function uuid() {
  return globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
