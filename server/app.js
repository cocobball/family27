import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import storage from "./storage/index.js";

const app = express();

// ----- Paths -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use shared storage module (DATA_DIR / UPLOAD_DIR come from env on the Pi)
const DATA_DIR = storage.getDataDir();
const UPLOADS_DIR = storage.getUploadDir();
const STATE_DIR = storage.resolveDataPath("module_state");


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

function stateFileFor(moduleId) {
  return storage.resolveDataPath(`module_state/${moduleId}.json`);
}


function readModuleState(moduleId) {
  const file = stateFileFor(moduleId);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return {
      state: parsed?.state ?? {},
      updated_at: parsed?.updated_at ?? null,
    };
  } catch {
    return { state: {}, updated_at: null };
  }
}

function writeModuleState(moduleId, stateObj) {
  const now = new Date().toISOString();
  const file = stateFileFor(moduleId);
  const payload = {
    module: moduleId,
    state: stateObj ?? {},
    updated_at: now,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function uploadsIndexFile() {
  return storage.resolveDataPath("uploads_index.json");
}


function readUploadsIndex() {
  try {
    return JSON.parse(fs.readFileSync(uploadsIndexFile(), "utf8"));
  } catch {
    return [];
  }
}

function writeUploadsIndex(list) {
  fs.writeFileSync(uploadsIndexFile(), JSON.stringify(list, null, 2), "utf8");
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

// ----- Health -----
app.get("/api/v1/health", (req, res) => {
  res.json({ ok: true, api: "v1", schema_version: "1" });
});

// ----- Module state -----
app.get("/api/v1/modules/:module/state", (req, res) => {
  const moduleId = safeModuleId(req.params.module);
  if (!moduleId) return res.status(400).json({ ok: false, error: "bad module id" });

  const { state, updated_at } = readModuleState(moduleId);
  res.json({ module: moduleId, state, updated_at });
});

app.put("/api/v1/modules/:module/state", (req, res) => {
  const moduleId = safeModuleId(req.params.module);
  if (!moduleId) return res.status(400).json({ ok: false, error: "bad module id" });

  const body = req.body;
  if (body == null || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "body must be JSON object" });
  }

  writeModuleState(moduleId, body);
  res.json({ ok: true, module: moduleId, updated_at: readModuleState(moduleId).updated_at });
});

// ----- Uploads -----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".bin";
    cb(null, `${makeId()}${ext}`);
  },
});
const upload = multer({ storage });

app.post("/api/v1/uploads", upload.single("file"), (req, res) => {
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

  const index = readUploadsIndex();
  index.unshift(record);
  writeUploadsIndex(index);

  res.json(record);
});

app.get("/api/v1/uploads", (req, res) => {
  const moduleId = safeModuleId(req.query?.module) || null;
  const index = readUploadsIndex();
  const filtered = moduleId ? index.filter((x) => x.module === moduleId) : index;
  res.json(filtered);
});

// ----- Listen -----
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);
});