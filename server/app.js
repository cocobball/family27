import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs, { promises as fsp } from "fs";
import storage from "./storage/index.js";
import { pauseRule, resumeRule, kidsStatus } from "./firewalla/controller.js";

// ✅ Firewalla endpoints (local SSH/MSP policy toggle)
console.log("Firewalla host:", process.env.FIREWALLA_HOST);

const app = express();

// ----- Middleware -----
app.use(express.json({ limit: "10mb" }));

// Simple request logging (helpful on Pi)
app.use((req, res, next) => {
  console.log(`[api] ${req.method} ${req.url}`);
  next();
});

// ----- Helpers -----
function safeModuleId(id) {
  if (!id) return null;
  const clean = String(id).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(clean)) return null;
  return clean;
}

function stateFileFor(moduleId) {
  return storage.resolveDataPath(`module_state/${moduleId}.json`);
}

async function readModuleState(moduleId) {
  const file = stateFileFor(moduleId);

  // IMPORTANT: fallback must be non-null, otherwise storage.readJson throws
  const fallbackPayload = { module: moduleId, state: {}, updated_at: null };

  const parsed = await storage.readJson(file, { fallback: fallbackPayload });

  return {
    state: parsed?.state ?? {},
    updated_at: parsed?.updated_at ?? null,
  };
}

async function writeModuleState(moduleId, stateObj) {
  const now = new Date().toISOString();
  const file = stateFileFor(moduleId);

  const payload = {
    module: moduleId,
    state: stateObj ?? {},
    updated_at: now,
  };

  await storage.writeJsonAtomic(file, payload);
  return payload;
}

function uploadsIndexFile() {
  return storage.resolveDataPath("uploads_index.json");
}

async function readUploadsIndex() {
  return await storage.readJson(uploadsIndexFile(), { fallback: [] });
}

async function writeUploadsIndex(list) {
  await storage.writeJsonAtomic(uploadsIndexFile(), list);
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

// ----- Health -----
app.get("/api/v1/health", (req, res) => {
  res.json({ ok: true, api: "v1", schema_version: "1" });
});

// ✅ Firewalla control (kids on/off)
app.post("/api/v1/firewalla/pause", pauseRule);
app.post("/api/v1/firewalla/resume", resumeRule);

// Network kids aliases (UI expects these)
app.get("/api/v1/network/kids/status", kidsStatus);

// Kids ON = disable block policy
app.post("/api/v1/network/kids/on", pauseRule);

// Kids OFF = enable block policy
app.post("/api/v1/network/kids/off", resumeRule);

/* =========================================================
   ✅ NEW: Server-side "Game Time Sessions" (Option B)
   - Stores timers on server so expiry still enforces even
     if dashboard UI is closed.
   - Does NOT touch Firewalla MSP/SSH logic.
   - Uses localhost fetch to call existing kids on/off routes.
   ========================================================= */

const NETWORK_STATE_MODULE_ID = "network"; // stored at module_state/network.json
const SESSION_TICK_MS = 10_000; // 10s
const SESSION_DAY_MS = 24 * 60 * 60 * 1000;

const sessionTimers = new Map(); // kidId -> timeout

function nowMs() {
  return Date.now();
}

function startOfLocalDayKey(d = new Date()) {
  // “same day” based on server local time
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultNetworkState() {
  return {
    version: 1,
    dayKey: startOfLocalDayKey(),
    sessions: {
      harvey: {
        status: "idle", // idle|active|paused|ended
        allowUntil: null, // ISO
        remainingMs: 0, // for paused state
        startedAt: null,
        pausedAt: null,
        endedAt: null,
        minutesGranted: 0,
        sourceRef: null,
      },
      brady: {
        status: "idle",
        allowUntil: null,
        remainingMs: 0,
        startedAt: null,
        pausedAt: null,
        endedAt: null,
        minutesGranted: 0,
        sourceRef: null,
      },
    },
    history: [], // optional audit trail
  };
}

async function getNetworkState() {
  const { state } = await readModuleState(NETWORK_STATE_MODULE_ID);
  const base = (!state || state.version !== 1) ? defaultNetworkState() : state;

  // Ensure structure
  base.sessions ||= {};
  base.sessions.harvey ||= defaultNetworkState().sessions.harvey;
  base.sessions.brady ||= defaultNetworkState().sessions.brady;
  base.history ||= [];

  // rollover day (so “resume later (same day)” can be enforced)
  const today = startOfLocalDayKey();
  if (base.dayKey !== today) {
    // On a new day, reset sessions to idle
    base.dayKey = today;
    base.sessions.harvey = { ...defaultNetworkState().sessions.harvey };
    base.sessions.brady = { ...defaultNetworkState().sessions.brady };
    base.history.unshift({
      id: makeId(),
      at: new Date().toISOString(),
      type: "day_rollover",
      dayKey: today,
    });
    await writeModuleState(NETWORK_STATE_MODULE_ID, base);
  }

  return base;
}

async function saveNetworkState(state) {
  await writeModuleState(NETWORK_STATE_MODULE_ID, state);
}

function clearKidTimer(kidId) {
  const t = sessionTimers.get(kidId);
  if (t) clearTimeout(t);
  sessionTimers.delete(kidId);
}

function normalizeKidId(kidId) {
  const k = String(kidId || "").trim().toLowerCase();
  return (k === "harvey" || k === "brady") ? k : null;
}

async function callKidsOnOff(action, port) {
  // action: "on" (pause/block) or "off" (resume/allow)
  const url = `http://127.0.0.1:${port}/api/v1/network/kids/${action}`;
  const r = await fetch(url, { method: "POST" });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = json?.error || `HTTP ${r.status}`;
    throw new Error(`kids/${action} failed: ${msg}`);
  }
  return json;
}

function msUntil(iso) {
  const t = new Date(String(iso || "")).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - nowMs());
}

async function enforceExpiryIfNeeded(port) {
  const state = await getNetworkState();
  const today = startOfLocalDayKey();

  // day rollover already handled in getNetworkState()
  state.dayKey = today;

  let changed = false;

  for (const kidId of ["harvey", "brady"]) {
    const s = state.sessions[kidId];

    if (s?.status === "active" && s.allowUntil) {
      const remaining = msUntil(s.allowUntil);
      if (remaining <= 0) {
        // Expired: end session + pause kids
        try {
          await callKidsOnOff("on", port);
        } catch (e) {
          console.warn("[session] expiry pause failed:", String(e?.message || e));
        }

        s.status = "ended";
        s.endedAt = new Date().toISOString();
        s.allowUntil = null;
        s.remainingMs = 0;

        state.history.unshift({
          id: makeId(),
          at: new Date().toISOString(),
          type: "expired",
          kidId,
        });

        changed = true;
        clearKidTimer(kidId);
      }
    }
  }

  if (changed) await saveNetworkState(state);
}

function scheduleKidExpiry(kidId, allowUntilIso, port) {
  clearKidTimer(kidId);
  const delay = msUntil(allowUntilIso);

  // Add a small buffer so we don’t fire early due to clock rounding
  const when = Math.max(1_000, delay + 500);

  const t = setTimeout(async () => {
    try {
      await enforceExpiryIfNeeded(port);
    } catch (e) {
      console.error("[session] scheduled expiry check failed:", e);
    }
  }, when);

  sessionTimers.set(kidId, t);
}

// Start session
app.post("/api/v1/network/kids/session/start", async (req, res) => {
  try {
    const PORT = Number(process.env.PORT || 3000);

    const kidId = normalizeKidId(req.body?.kidId);
    const minutes = Math.max(0, Math.floor(Number(req.body?.minutes) || 0));
    const sourceRef = req.body?.sourceRef ? String(req.body.sourceRef) : null;

    if (!kidId) return res.status(400).json({ ok: false, error: "Unknown kidId" });
    if (minutes <= 0) return res.status(400).json({ ok: false, error: "minutes must be positive" });

    const state = await getNetworkState();
    const s = state.sessions[kidId];

    // Only allow start if idle/ended/paused (starting overwrites paused remaining)
    const allowUntil = new Date(nowMs() + minutes * 60 * 1000).toISOString();

    s.status = "active";
    s.startedAt = new Date().toISOString();
    s.pausedAt = null;
    s.endedAt = null;
    s.allowUntil = allowUntil;
    s.remainingMs = 0;
    s.minutesGranted = minutes;
    s.sourceRef = sourceRef;

    state.history.unshift({
      id: makeId(),
      at: new Date().toISOString(),
      type: "start",
      kidId,
      minutes,
      sourceRef,
    });

    await saveNetworkState(state);

    // Allow internet
    await callKidsOnOff("off", PORT);

    // Schedule expiry
    scheduleKidExpiry(kidId, allowUntil, PORT);

    res.json({ ok: true, kidId, status: s.status, allowUntil });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Pause session (Option B)
app.post("/api/v1/network/kids/session/pause", async (req, res) => {
  try {
    const PORT = Number(process.env.PORT || 3000);

    const kidId = normalizeKidId(req.body?.kidId);
    if (!kidId) return res.status(400).json({ ok: false, error: "Unknown kidId" });

    const state = await getNetworkState();
    const s = state.sessions[kidId];

    if (s.status !== "active" || !s.allowUntil) {
      return res.status(400).json({ ok: false, error: "No active session" });
    }

    const remaining = msUntil(s.allowUntil);
    s.status = "paused";
    s.pausedAt = new Date().toISOString();
    s.remainingMs = remaining;
    s.allowUntil = null;

    state.history.unshift({
      id: makeId(),
      at: new Date().toISOString(),
      type: "pause",
      kidId,
      remainingMs: remaining,
    });

    await saveNetworkState(state);

    // Pause internet
    await callKidsOnOff("on", PORT);

    clearKidTimer(kidId);

    res.json({ ok: true, kidId, status: s.status, remainingMs: s.remainingMs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Resume paused session (same day)
app.post("/api/v1/network/kids/session/resume", async (req, res) => {
  try {
    const PORT = Number(process.env.PORT || 3000);

    const kidId = normalizeKidId(req.body?.kidId);
    if (!kidId) return res.status(400).json({ ok: false, error: "Unknown kidId" });

    const state = await getNetworkState();

    // If a new day rolled over, getNetworkState() already reset sessions
    const s = state.sessions[kidId];

    if (s.status !== "paused" || !Number.isFinite(s.remainingMs) || s.remainingMs <= 0) {
      return res.status(400).json({ ok: false, error: "No paused time to resume" });
    }

    const allowUntil = new Date(nowMs() + s.remainingMs).toISOString();

    s.status = "active";
    s.allowUntil = allowUntil;
    s.startedAt ||= new Date().toISOString();
    s.pausedAt = null;
    s.endedAt = null;
    s.remainingMs = 0;

    state.history.unshift({
      id: makeId(),
      at: new Date().toISOString(),
      type: "resume",
      kidId,
      allowUntil,
    });

    await saveNetworkState(state);

    // Allow internet
    await callKidsOnOff("off", PORT);

    // Schedule expiry
    scheduleKidExpiry(kidId, allowUntil, PORT);

    res.json({ ok: true, kidId, status: s.status, allowUntil });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// End session early
app.post("/api/v1/network/kids/session/end", async (req, res) => {
  try {
    const PORT = Number(process.env.PORT || 3000);

    const kidId = normalizeKidId(req.body?.kidId);
    if (!kidId) return res.status(400).json({ ok: false, error: "Unknown kidId" });

    const state = await getNetworkState();
    const s = state.sessions[kidId];

    // End regardless of active/paused (as long as not idle)
    if (s.status === "idle") return res.status(400).json({ ok: false, error: "No session to end" });

    s.status = "ended";
    s.endedAt = new Date().toISOString();
    s.allowUntil = null;
    s.remainingMs = 0;

    state.history.unshift({
      id: makeId(),
      at: new Date().toISOString(),
      type: "end",
      kidId,
    });

    await saveNetworkState(state);

    // Pause internet
    await callKidsOnOff("on", PORT);

    clearKidTimer(kidId);

    res.json({ ok: true, kidId, status: s.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Session status
app.get("/api/v1/network/kids/session/status", async (req, res) => {
  try {
    const kidId = normalizeKidId(req.query?.kidId);
    const state = await getNetworkState();

    if (kidId) return res.json({ ok: true, dayKey: state.dayKey, session: state.sessions[kidId] });
    return res.json({ ok: true, dayKey: state.dayKey, sessions: state.sessions });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================================================
   ----- Module state -----
   ========================================================= */

app.get("/api/v1/modules/:module/state", async (req, res) => {
  try {
    const moduleId = safeModuleId(req.params.module);
    if (!moduleId) return res.status(400).json({ ok: false, error: "bad module id" });

    const { state, updated_at } = await readModuleState(moduleId);
    res.json({ module: moduleId, state, updated_at });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.put("/api/v1/modules/:module/state", async (req, res) => {
  try {
    const moduleId = safeModuleId(req.params.module);
    if (!moduleId) return res.status(400).json({ ok: false, error: "bad module id" });

    const body = req.body;
    if (body == null || typeof body !== "object") {
      return res.status(400).json({ ok: false, error: "body must be JSON object" });
    }

    await writeModuleState(moduleId, body);
    const { updated_at } = await readModuleState(moduleId);
    res.json({ ok: true, module: moduleId, updated_at });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----- Uploads -----
const UPLOADS_DIR = storage.getUploadDir();

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".bin";
    cb(null, `${makeId()}${ext}`);
  },
});

const upload = multer({ storage: multerStorage });

app.post("/api/v1/uploads", upload.single("file"), async (req, res) => {
  try {
    const moduleId = safeModuleId(req.body?.module) || "unknown";
    const item_id = req.body?.item_id ?? null;

    if (!req.file) return res.status(400).json({ ok: false, error: "missing file" });

    const url = `/uploads/${req.file.filename}`;
    const record = {
      id: makeId(),
      module: moduleId,
      item_id,
      original_name: req.file.originalname,
      url,
      mime: req.file.mimetype,
      size: req.file.size,
      created_at: new Date().toISOString(),
    };

    const index = await readUploadsIndex();
    index.unshift(record);
    await writeUploadsIndex(index);

    res.json(record);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/v1/uploads", async (req, res) => {
  try {
    const moduleId = safeModuleId(req.query?.module) || null;
    const index = await readUploadsIndex();
    const filtered = moduleId ? index.filter((x) => x.module === moduleId) : index;
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----- Local Photos (Pi filesystem) -----
// Safe base directories for local photos (hardcoded for security)
const SAFE_PHOTO_BASES = [
  "/home/masri/Pictures",
  "/opt/family-dashboard-data/photos",
  "/opt/shared/photos",
];

// Resolve paths safely:
// - Prefer realpath to account for symlinks/mounts
// - Fall back to path.resolve if the target doesn't exist yet
function safeRealPath(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  try {
    return fs.realpathSync(s);
  } catch {
    return path.resolve(s);
  }
}

// Robust containment check using path.relative (avoids subtle startsWith edge cases)
// and realpath (handles symlinks properly).
function isSafePath(requestedPath) {
  if (!requestedPath || typeof requestedPath !== "string") return false;

  const target = safeRealPath(requestedPath);
  if (!target) return false;

  return SAFE_PHOTO_BASES.some((base) => {
    const baseReal = safeRealPath(base);
    if (!baseReal) return false;

    const rel = path.relative(baseReal, target);
    // target is inside base if rel is "" OR does not start with ".." and isn't absolute
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"];

function isImageFile(filenameOrPath) {
  const ext = path.extname(String(filenameOrPath || "")).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function getImageMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
  };
  return mimeMap[ext] || "application/octet-stream";
}

app.post("/api/v1/photos/local/list", async (req, res) => {
  try {
    const requestedPath = req.body?.path;

    if (!requestedPath || typeof requestedPath !== "string") {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'path' in request body" });
    }

    if (!isSafePath(requestedPath)) {
      return res.status(403).json({
        ok: false,
        error: "Path is outside allowed directories. Allowed bases: " + SAFE_PHOTO_BASES.join(", "),
      });
    }

    const resolved = safeRealPath(requestedPath);

    // Check if directory exists
    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      return res.status(404).json({ ok: false, error: "Path does not exist" });
    }

    if (!stat.isDirectory()) {
      return res.status(400).json({ ok: false, error: "Path is not a directory" });
    }

    // Read directory entries (files only)
    const entries = await fsp.readdir(resolved, { withFileTypes: true });

    const imageFiles = entries
      .filter((ent) => ent.isFile())
      .map((ent) => ent.name)
      .filter(isImageFile)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const images = imageFiles.map((filename) => {
      const fullPath = path.join(resolved, filename);
      const encoded = encodeURIComponent(fullPath);
      return `/api/v1/photos/local/file?path=${encoded}`;
    });

    res.json({ images });
  } catch (e) {
    console.error("[api] /photos/local/list error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/v1/photos/local/file", async (req, res) => {
  try {
    const requestedPath = req.query?.path;

    if (!requestedPath || typeof requestedPath !== "string") {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'path' query parameter" });
    }

    if (!isSafePath(requestedPath)) {
      return res.status(403).json({
        ok: false,
        error: "Path is outside allowed directories",
      });
    }

    const resolved = safeRealPath(requestedPath);

    // Check if file exists and is a file
    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      return res.status(404).json({ ok: false, error: "File not found" });
    }

    if (!stat.isFile()) {
      return res.status(400).json({ ok: false, error: "Path is not a file" });
    }

    if (!isImageFile(resolved)) {
      return res.status(400).json({ ok: false, error: "File is not a supported image type" });
    }

    const mimeType = getImageMimeType(resolved);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "public, max-age=86400"); // cache for 1 day

    const fileStream = fs.createReadStream(resolved);
    fileStream.pipe(res);

    fileStream.on("error", (err) => {
      console.error("[api] /photos/local/file stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Error streaming file" });
      } else {
        res.end();
      }
    });
  } catch (e) {
    console.error("[api] /photos/local/file error:", e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
});

// Folder browser endpoint for selecting local photo directories
app.get("/api/v1/photos/local/folders", async (req, res) => {
  try {
    const requestedPath = req.query?.path;

    if (!requestedPath || typeof requestedPath !== "string") {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'path' query parameter" });
    }

    if (!isSafePath(requestedPath)) {
      return res.status(403).json({
        ok: false,
        error: "Path is outside allowed directories. Allowed bases: " + SAFE_PHOTO_BASES.join(", "),
      });
    }

    const resolved = safeRealPath(requestedPath);

    // Check if directory exists
    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      return res.status(404).json({ ok: false, error: "Path does not exist" });
    }

    if (!stat.isDirectory()) {
      return res.status(400).json({ ok: false, error: "Path is not a directory" });
    }

    const entries = await fsp.readdir(resolved, { withFileTypes: true });

    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    res.json({ folders });
  } catch (e) {
    console.error("[api] /photos/local/folders error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----- Listen -----
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "127.0.0.1", async () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);

  // Kick off expiry enforcement loop (server-side reliability)
  try {
    await enforceExpiryIfNeeded(PORT);
  } catch (e) {
    console.warn("[session] initial enforce failed:", String(e?.message || e));
  }

  setInterval(async () => {
    try {
      await enforceExpiryIfNeeded(PORT);
    } catch (e) {
      console.warn("[session] tick enforce failed:", String(e?.message || e));
    }
  }, SESSION_TICK_MS);
});
