/**
 * Photos / Screensaver module helpers
 *
 * IMPORTANT (NAS / network share):
 * Browsers cannot read SMB paths like \\192.168.50.199\shared\photos directly.
 * To use a NAS/share, you must expose the folder over HTTP from the Pi (recommended: nginx alias)
 * and then point this module at the HTTP folder URL (example: /photos/memories-1/).
 *
 * Storage notes:
 * - Uploaded photos are stored as data URLs (base64) so they persist with the dashboard DB.
 * - This can grow the DB. Keep uploads reasonable (or downscale externally).
 */

export function defaultPhotosData() {
  return {
    version: 2,
    settings: {
      enabled: false,
      idleMinutes: 5, // minutes of inactivity before screensaver starts
      slideSeconds: 12, // seconds per photo
      shuffle: true,
      touchToEnable: false, // show a "Start screensaver" button in the module card

      source: "demo", // "demo" | "uploaded" | "folder" | "local"
      demoSet: "Family",

      // "folder" source (HTTP directory listing or JSON manifest)
      // Example (nginx alias): /photos/memories-1/
      // Or manifest file:      /photos/memories-1/manifest.json
      folderUrl: "",
      folderAutoRefreshMinutes: 0, // 0 = never

      // "local" source (local filesystem folder on the Pi)
      // Example: /opt/shared/photos/memories-1
      localFolderPath: "",

      // UI / playback
      fadeMs: 700, // crossfade duration (ms)

      // Fit options:
      // - cover: fills screen, crops (may look "zoomed")
      // - contain: shows full image, letterbox bars
      // - auto: chooses cover/contain per image based on aspect ratio mismatch
      // - scale-down: like contain, but won't upscale small images
      fit: "cover", // "cover" | "contain" | "auto" | "scale-down"

      // When image doesn't fill the screen (contain/scale-down), optionally fill background
      // - none: black bars
      // - blur: blurred cover version behind the main image (best "full screen" look without cropping)
      backgroundMode: "blur", // "none" | "blur"
      backgroundBlurPx: 28, // 0..60
      backgroundOpacity: 0.55, // 0..1

      dim: 0.2, // 0..0.85 black overlay
      showClock: true,
      showCounter: true,
      showTitle: true, // show "Family Photos" label
    },

    // "uploaded" source
    uploaded: {
      items: [
        // { id, name, type, dataUrl, addedAt }
      ],
    },

    // Cache used by BOTH "folder" and "local" sources
    folderCache: {
      urls: [], // resolved image URLs
      fetchedAt: null, // ISO timestamp
      lastError: "", // string
    },
  };
}

export function migratePhotosData(raw) {
  const base = defaultPhotosData();
  const d = raw && typeof raw === "object" ? raw : {};
  // keep for forward compatibility, even if unused here
  const version = Number(d.version || 0);
  void version;

  // v0/v1 -> v2: ensure shape + new settings
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

  // sanitize settings
  next.settings.idleMinutes = clampNumber(next.settings.idleMinutes, 0.25, 240, base.settings.idleMinutes);
  next.settings.slideSeconds = clampNumber(next.settings.slideSeconds, 3, 300, base.settings.slideSeconds);
  next.settings.enabled = !!next.settings.enabled;
  next.settings.shuffle = !!next.settings.shuffle;
  next.settings.touchToEnable = !!next.settings.touchToEnable;

  const src = String(next.settings.source || "demo");
  next.settings.source = src === "uploaded" || src === "folder" || src === "local" ? src : "demo";

  next.settings.demoSet = String(next.settings.demoSet || base.settings.demoSet);

  next.settings.folderUrl = String(next.settings.folderUrl || "");
  next.settings.folderAutoRefreshMinutes = clampNumber(
    next.settings.folderAutoRefreshMinutes,
    0,
    1440,
    base.settings.folderAutoRefreshMinutes
  );

  next.settings.localFolderPath = String(next.settings.localFolderPath || "");

  next.settings.fadeMs = clampNumber(next.settings.fadeMs, 0, 5000, base.settings.fadeMs);

  // ✅ IMPORTANT: preserve new fit values
  {
    const fit = String(next.settings.fit || base.settings.fit);
    const allowed = new Set(["cover", "contain", "auto", "scale-down"]);
    next.settings.fit = allowed.has(fit) ? fit : base.settings.fit;
  }

  next.settings.dim = clampNumber(next.settings.dim, 0, 0.85, base.settings.dim);
  next.settings.showClock = !!next.settings.showClock;
  next.settings.showCounter = !!next.settings.showCounter;
  next.settings.showTitle = next.settings.showTitle !== false;

  {
    const bg = String(next.settings.backgroundMode || base.settings.backgroundMode);
    next.settings.backgroundMode = bg === "none" || bg === "blur" ? bg : base.settings.backgroundMode;
  }
  next.settings.backgroundBlurPx = clampNumber(
    next.settings.backgroundBlurPx,
    0,
    60,
    base.settings.backgroundBlurPx
  );
  next.settings.backgroundOpacity = clampNumber(
    next.settings.backgroundOpacity,
    0,
    1,
    base.settings.backgroundOpacity
  );

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

  console.log("[photos] getActivePhotoList - source:", source);

  if (source === "uploaded" && d.uploaded.items.length) {
    const urls = d.uploaded.items.map((x) => x.dataUrl).filter(Boolean);
    console.log("[photos] Using uploaded source:", urls.length, "images, first 3:", urls.slice(0, 3));
    return urls;
  }

  // Both "folder" (HTTP) and "local" (Pi filesystem via backend) populate folderCache.urls
  if ((source === "folder" || source === "local") && d.folderCache.urls.length) {
    const urls = d.folderCache.urls.filter(Boolean);
    console.log("[photos] Using folder/local source:", urls.length, "images, first 3:", urls.slice(0, 3));
    return urls;
  }

  // ONLY use demo set when source === "demo" OR as absolute fallback
  if (source === "demo") {
    const list = DEMO_SETS[demoSet] || DEMO_SETS.Family;
    console.log("[photos] Using demo source:", demoSet, "-", list.length, "images, first 3:", list.slice(0, 3));
    return list.slice();
  }

  // Fallback: if source is local/folder but no URLs cached yet, show empty
  console.warn("[photos] No images available for source:", source, "- folderCache.urls:", d.folderCache.urls.length);
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

// For folder listing / manifest filtering
export function isLikelyImagePath(p) {
  const raw = String(p || "").toLowerCase();
  const s = raw.split("?")[0].split("#")[0];
  return (
    s.endsWith(".jpg") ||
    s.endsWith(".jpeg") ||
    s.endsWith(".png") ||
    s.endsWith(".webp") ||
    s.endsWith(".gif") ||
    s.endsWith(".bmp") ||
    s.endsWith(".avif")
  );
}
