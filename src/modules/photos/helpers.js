// src/modules/photos/helpers.js
// Pure helpers (NO React components in this file)

export function isLikelyImagePath(input) {
  const s = String(input || "").toLowerCase().trim();
  if (!s) return false;

  // allow data URLs
  if (s.startsWith("data:image/")) return true;

  // allow query strings/fragments
  return /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic)(?:[?#].*)?$/.test(s);
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

export function defaultPhotosData() {
  return {
    version: 2,
    settings: {
      enabled: false,
      idleMinutes: 5, // minutes of inactivity before screensaver starts
      slideSeconds: 12, // seconds per photo
      shuffle: true,
      touchToEnable: false, // show a "Touch to enable" button in the module card

      source: "demo", // "demo" | "uploaded" | "folder" | "local"
      demoSet: "Family",

      folderUrl: "",
      folderAutoRefreshMinutes: 0, // 0 = never

      localFolderPath: "",

      fadeMs: 700, // crossfade duration (ms)
      fit: "cover", // "cover" | "contain" | "auto" | "scale-down"

      backgroundMode: "blur", // "none" | "blur"
      backgroundBlurPx: 28, // 0..60
      backgroundOpacity: 0.55, // 0..1

      dim: 0.2, // 0..0.85 overlay
      showClock: true,
      showCounter: true,
      showTitle: true,
    },

    uploaded: { items: [] },

    folderCache: { urls: [], fetchedAt: null, lastError: "" },
  };
}

export function migratePhotosData(raw) {
  const base = defaultPhotosData();
  const d = raw && typeof raw === "object" ? raw : {};

  const next = {
    ...base,
    ...d,
    version: 2,
    settings: { ...base.settings, ...(d.settings || {}) },
    uploaded: {
      items: Array.isArray(d.uploaded?.items) ? d.uploaded.items : base.uploaded.items,
    },
    folderCache: {
      ...base.folderCache,
      ...(d.folderCache || {}),
      urls: Array.isArray(d.folderCache?.urls) ? d.folderCache.urls : base.folderCache.urls,
      fetchedAt: d.folderCache?.fetchedAt ? String(d.folderCache.fetchedAt) : base.folderCache.fetchedAt,
      lastError: d.folderCache?.lastError ? String(d.folderCache.lastError) : "",
    },
  };

  next.settings.idleMinutes = clampNumber(next.settings.idleMinutes, 0.25, 240, base.settings.idleMinutes);
  next.settings.slideSeconds = clampNumber(next.settings.slideSeconds, 3, 300, base.settings.slideSeconds);
  next.settings.enabled = !!next.settings.enabled;
  next.settings.shuffle = !!next.settings.shuffle;
  next.settings.touchToEnable = !!next.settings.touchToEnable;

  {
    const src = String(next.settings.source || "demo");
    const allowed = new Set(["demo", "uploaded", "folder", "local"]);
    next.settings.source = allowed.has(src) ? src : "demo";
  }

  {
    const demoNames = Object.keys(DEMO_SETS);
    const demoSet = String(next.settings.demoSet || base.settings.demoSet);
    next.settings.demoSet = demoNames.includes(demoSet) ? demoSet : (demoNames[0] || "Family");
  }

  next.settings.folderUrl = String(next.settings.folderUrl || "");
  next.settings.folderAutoRefreshMinutes = clampNumber(
    next.settings.folderAutoRefreshMinutes,
    0,
    1440,
    base.settings.folderAutoRefreshMinutes
  );

  next.settings.localFolderPath = String(next.settings.localFolderPath || "");
  next.settings.fadeMs = clampNumber(next.settings.fadeMs, 0, 5000, base.settings.fadeMs);

  {
    const fit = String(next.settings.fit || base.settings.fit);
    const allowed = new Set(["cover", "contain", "auto", "scale-down"]);
    next.settings.fit = allowed.has(fit) ? fit : base.settings.fit;
  }

  {
    const bg = String(next.settings.backgroundMode || base.settings.backgroundMode);
    next.settings.backgroundMode = bg === "none" || bg === "blur" ? bg : base.settings.backgroundMode;
  }

  next.settings.backgroundBlurPx = clampNumber(next.settings.backgroundBlurPx, 0, 60, base.settings.backgroundBlurPx);
  next.settings.backgroundOpacity = clampNumber(next.settings.backgroundOpacity, 0, 1, base.settings.backgroundOpacity);

  next.settings.dim = clampNumber(next.settings.dim, 0, 0.85, base.settings.dim);
  next.settings.showClock = !!next.settings.showClock;
  next.settings.showCounter = !!next.settings.showCounter;
  next.settings.showTitle = next.settings.showTitle !== false;

  return next;
}

export function getActivePhotoList(data) {
  const d = migratePhotosData(data);
  const { source, demoSet } = d.settings;

  if (source === "uploaded" && d.uploaded.items.length) {
    return d.uploaded.items.map((x) => x.dataUrl).filter(Boolean);
  }

  if ((source === "folder" || source === "local") && d.folderCache.urls.length) {
    return d.folderCache.urls.filter(Boolean);
  }

  if (source === "demo") {
    const list = DEMO_SETS[demoSet] || DEMO_SETS.Family || [];
    return list.slice();
  }

  return [];
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
  return `${Math.round(n)} mins`;
}
