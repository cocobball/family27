import express from "express";
import multer from "multer";
import path from "path";
import storage from "./storage/index.js";

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

// ----- Module state -----
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

// ----- Listen -----
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);
});
