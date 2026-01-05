// src/modules/torrents/helpers.js

export const defaultData = {
  version: 1,
  settings: {
    // Max results to request from qB search/results endpoint
    resultLimit: 50,

    // Savepath presets for "Add torrent"
    // path: "" means qBittorrent default save path
    savepaths: [
      { label: "Default", path: "" },
    ],
    defaultSavepathLabel: "Default",
  },
};

export function migrateIfNeeded(db) {
  const cur = (db && typeof db === "object") ? db : { ...defaultData };
  if (!cur.version) cur.version = 1;
  if (!cur.settings) cur.settings = { ...defaultData.settings };
  if (!Array.isArray(cur.settings.savepaths)) cur.settings.savepaths = [...defaultData.settings.savepaths];
  if (!cur.settings.defaultSavepathLabel) cur.settings.defaultSavepathLabel = "Default";
  if (!cur.settings.resultLimit) cur.settings.resultLimit = 50;
  return cur;
}

export function formatBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPct(x) {
  const v = Number(x);
  if (!isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function formatSpeed(bps) {
  const v = Number(bps);
  if (!isFinite(v) || v <= 0) return "0 B/s";
  return `${formatBytes(v)}/s`;
}

export function pickSavepath(db, labelOrPath) {
  const settings = db?.settings || {};
  const list = Array.isArray(settings.savepaths) ? settings.savepaths : [];
  if (!labelOrPath) return list.find(s => s.label === settings.defaultSavepathLabel)?.path ?? "";
  // allow passing label or path
  const byLabel = list.find(s => s.label === labelOrPath);
  if (byLabel) return byLabel.path ?? "";
  const byPath = list.find(s => s.path === labelOrPath);
  if (byPath) return byPath.path ?? "";
  return "";
}

export function safeText(v) {
  if (v == null) return "";
  return String(v);
}
