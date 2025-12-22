/**
 * Photos / Screensaver module helpers
 *
 * Storage notes:
 * - Uploaded photos are stored as data URLs (base64) so they persist with the dashboard DB.
 * - This can grow the DB. Keep uploads reasonable (or downscale externally).
 */

export function defaultPhotosData() {
  return {
    version: 1,
    settings: {
      enabled: false,
      idleMinutes: 5,        // minutes of inactivity before screensaver starts
      slideSeconds: 12,      // seconds per photo
      shuffle: true,
      touchToEnable: false,  // show a "Start screensaver" button in the module card
      source: "demo",        // "demo" | "uploaded"
      demoSet: "Family",     // which demo set to use
    },
    uploaded: {
      items: [
        // { id, name, type, dataUrl, addedAt }
      ],
    },
  };
}

export function migratePhotosData(raw) {
  const base = defaultPhotosData();
  const d = raw && typeof raw === "object" ? raw : {};
  const version = Number(d.version || 0);

  // v0 -> v1: ensure shape
  const next = {
    ...base,
    ...d,
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    uploaded: {
      items: Array.isArray(d.uploaded?.items) ? d.uploaded.items : base.uploaded.items,
    },
  };

  // sanitize
  next.settings.idleMinutes = clampNumber(next.settings.idleMinutes, 0.25, 240, base.settings.idleMinutes);
  next.settings.slideSeconds = clampNumber(next.settings.slideSeconds, 3, 300, base.settings.slideSeconds);
  next.settings.enabled = !!next.settings.enabled;
  next.settings.shuffle = !!next.settings.shuffle;
  next.settings.touchToEnable = !!next.settings.touchToEnable;
  next.settings.source = next.settings.source === "uploaded" ? "uploaded" : "demo";
  next.settings.demoSet = String(next.settings.demoSet || base.settings.demoSet);

  return next;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// --- Demo photo sets (stable URLs) ---
export const DEMO_SETS = {
  Family: [
    "https://picsum.photos/id/1027/1600/900",
    "https://picsum.photos/id/1035/1600/900",
    "https://picsum.photos/id/1062/1600/900",
    "https://picsum.photos/id/1074/1600/900",
    "https://picsum.photos/id/1084/1600/900",
    "https://picsum.photos/id/1011/1600/900",
  ],
  Nature: [
    "https://picsum.photos/id/1015/1600/900",
    "https://picsum.photos/id/1016/1600/900",
    "https://picsum.photos/id/1020/1600/900",
    "https://picsum.photos/id/1039/1600/900",
    "https://picsum.photos/id/1043/1600/900",
    "https://picsum.photos/id/1056/1600/900",
  ],
  Cities: [
    "https://picsum.photos/id/1012/1600/900",
    "https://picsum.photos/id/1013/1600/900",
    "https://picsum.photos/id/1014/1600/900",
    "https://picsum.photos/id/1025/1600/900",
    "https://picsum.photos/id/1031/1600/900",
    "https://picsum.photos/id/1049/1600/900",
  ],
};

export function getActivePhotoList(data) {
  const d = migratePhotosData(data);
  const { source, demoSet } = d.settings;

  if (source === "uploaded" && d.uploaded.items.length) {
    return d.uploaded.items.map((x) => x.dataUrl).filter(Boolean);
  }
  const list = DEMO_SETS[demoSet] || DEMO_SETS.Family;
  return list.slice();
}

export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function formatMinutes(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n)) return "";
  if (n < 1) return `${Math.round(n * 60)}s`;
  if (n === 1) return "1 min";
  return `${n} mins`;
}
