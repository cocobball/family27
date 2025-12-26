import express from "express";
import multer from "multer";
import path from "path";
import storage from "./storage/index.js";

const app = express();

// Use shared storage module (DATA_DIR / UPLOAD_DIR come from env on the Pi)
const UPLOADS_DIR = storage.getUploadDir();

// ----- Middleware -----
app.use(express.json({ limit: "10mb" }));

// Simple request logging (helpful on Pi)
app.use((req, res, next) => {
  console.log(`[api] ${req.method} ${req.url}`);
  next();
});

// ----- Helpers -----
function safeModuleId(id) {
  // keep it simple + safe for filenames
  if (!id) return null;
  const clean = String(id).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(clean)) return null;
  return clean;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

function stateRelPathFor(moduleId) {
  return `module_state/${moduleId}.json`;
}

async function readModuleState(moduleId) {
  const rel = stateRelPathFor(moduleId);

  // Legacy-aware read (checks canonical first, then LEGACY_DATA_DIRS if configured)
  const filePath = await storage.findExistingDataPath(rel);

  const parsed = await storage.readJson(filePath, { fallback: null });
  if (!parsed) return { state: {}, updated_at: null };

  return {
    state: parsed?.state ?? {},
    updated_at: parsed?.updated_at ?? null,
  };
}

async function writeModuleState(moduleId, stateObj) {
  const now = new Date().toISOString();
  const rel = stateRelPathFor(moduleId);
  const filePath = storage.resolveDataPath(rel);

  const payload = {
    module: moduleId,
    state: stateObj ?? {},
    updated_at: now,
  };

  await storage.writeJsonAtomic(filePath, payload);
  return payload;
}

function uploadsIndexRelPath() {
  return "uploads_index.json";
}

async function readUploadsIndex() {
  const rel = uploadsIndexRelPath();
  const filePath = await storage.findExistingDataPath(rel);
  return await storage.readJson(filePath, { fallback: [] });
}

async function writeUploadsIndex(list) {
  const filePath = storage.resolveDataPath(uploadsIndexRelPath());
  await storage.writeJsonAtomic(filePath, list ?? []);
}

// ----- Health -----
app.get("/api/v1/health", (req, res) => {
  res.json({ ok: true, api: "v1", schema_version: "1" });
});

// ----- Module state -----
app.get("/api/v1/modules/:module/state", async (req, res) => {
  const moduleId = safeModuleId(req.params.module);
  if (!moduleId) return res.status(400).json({ ok: false, error: "bad module id" });

  const { state, updated_at } = await readModuleState(moduleId);
  res.json({ module: moduleId, state, updated_at });
});

app.put("/api/v1/modules/:module/state", async (req, res) => {
  const moduleId = safeModuleId(req.params.module);
  if (!moduleId) return res.status(400).json({ ok: false, error: "bad module id" });

  const body = req.body;
  if (body == null || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "body must be JSON object" });
  }

  const payload = await writeModuleState(moduleId, body);
  res.json({ ok: true, module: moduleId, updated_at: payload.updated_at });
});

// ----- Uploads -----
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".bin";
    cb(null, `${makeId()}${ext}`);
  },
});
const upload = multer({ storage: multerStorage });

app.post("/api/v1/uploads", upload.single("file"), async (req, res) => {
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
});

app.get("/api/v1/uploads", async (req, res) => {
  const moduleId = safeModuleId(req.query?.module) || null;
  const index = await readUploadsIndex();
  const filtered = moduleId ? index.filter((x) => x.module === moduleId) : index;
  res.json(filtered);
});

// ----- Listen -----
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);
});
