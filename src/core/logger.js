const LOG_KEY = "family_dashboard_log_v1"; // internal queue, NOT the main DB key

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export function logInfo(message, extra) {
  console.info("[dashboard]", message, extra ?? "");
}

export function logWarn(message, extra) {
  console.warn("[dashboard]", message, extra ?? "");
  enqueue("warn", message, extra);
}

export function logError(message, extra) {
  console.error("[dashboard]", message, extra ?? "");
  enqueue("error", message, extra);
}

function enqueue(level, message, extra) {
  // This is NOT separate module data; it's a tiny rotating debug queue.
  // Kept separate from the unified DB so exports don't leak noisy logs unless requested.
  const raw = localStorage.getItem(LOG_KEY);
  const arr = safeParse(raw) ?? [];
  const item = { level, message, extra, at: new Date().toISOString() };
  arr.push(item);
  const trimmed = arr.slice(-200);
  localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
}

export function readLogQueue() {
  const raw = localStorage.getItem(LOG_KEY);
  return safeParse(raw) ?? [];
}

export function clearLogQueue() {
  localStorage.removeItem(LOG_KEY);
}

export { LOG_KEY };
