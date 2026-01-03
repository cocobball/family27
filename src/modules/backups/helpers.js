// src/modules/backups/helpers.js
export function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : i < 3 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatDateTime(ms) {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const d = new Date(n);
  return d.toLocaleString();
}

export function isValidBackupFilename(name) {
  return /^family-dashboard-system-backup-\d{8}-\d{4}\.tgz$/.test(String(name || ""));
}
