// server/storage/index.js
// ESM storage layer for Family Dashboard API (Node >=18; repo uses "type":"module").
//
// Contract:
// - All persistent app state should live under DATA_DIR.
// - Uploads should live under UPLOAD_DIR (defaults to `${DATA_DIR}/uploads`).
// - Modules should not hardcode absolute paths; use resolve* helpers.
// - Reads can optionally fall back to legacy directories for backward compatibility.
// - Writes always go to the canonical directories.
//
// Env:
//   DATA_DIR=/opt/family-dashboard/data
//   UPLOAD_DIR=/opt/family-dashboard/data/uploads
//   LEGACY_DATA_DIRS=/old/path1,/old/path2
//   LEGACY_UPLOAD_DIRS=/old/uploads1,/old/uploads2
//
// Optional:
//   STORAGE_DEBUG=1  (logs resolved paths + migrations)

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_DATA_DIR = "/opt/family-dashboard/data";

function debug(...args) {
  if (process.env.STORAGE_DEBUG) console.log("[storage]", ...args);
}

function normalizeDir(p) {
  if (!p) return p;
  // Support relative paths in dev; resolve relative to cwd.
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  return path.normalize(abs);
}

function parseDirList(envValue) {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeDir);
}

export function getDataDir() {
  return normalizeDir(process.env.DATA_DIR || DEFAULT_DATA_DIR);
}

export function getUploadDir() {
  const dataDir = getDataDir();
  return normalizeDir(process.env.UPLOAD_DIR || path.join(dataDir, "uploads"));
}

export function getLegacyDataDirs() {
  return parseDirList(process.env.LEGACY_DATA_DIRS);
}

export function getLegacyUploadDirs() {
  return parseDirList(process.env.LEGACY_UPLOAD_DIRS);
}

export function resolveDataPath(relPath) {
  if (!relPath) throw new Error("resolveDataPath(relPath) requires relPath");
  return path.join(getDataDir(), relPath);
}

export function resolveUploadPath(relPath) {
  if (!relPath) throw new Error("resolveUploadPath(relPath) requires relPath");
  return path.join(getUploadDir(), relPath);
}

export async function exists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function ensureDirs() {
  const dataDir = getDataDir();
  const uploadDir = getUploadDir();

  await ensureDir(dataDir);
  await ensureDir(uploadDir);

  // Common optional subdirs (safe; no-op if already exists)
  await ensureDir(path.join(dataDir, "db"));
  await ensureDir(path.join(dataDir, "logs"));
  await ensureDir(path.join(dataDir, "cache"));
  await ensureDir(path.join(dataDir, "tmp"));

  // ✅ REQUIRED for module state (calendar/events/rewards/etc)
  await ensureDir(path.join(dataDir, "module_state"));

  debug("ensureDirs OK", { dataDir, uploadDir });
  return { dataDir, uploadDir };
}

async function assertWritableDir(dirPath) {
  // Make a small temp file and remove it.
  const name = `.write_test_${process.pid}_${Date.now()}`;
  const testPath = path.join(dirPath, name);
  await fsp.writeFile(testPath, "ok", "utf8");
  await fsp.unlink(testPath);
}

export async function healthCheck() {
  const dataDir = getDataDir();
  const uploadDir = getUploadDir();

  const result = {
    dataDir,
    uploadDir,
    dataDirExists: await exists(dataDir),
    uploadDirExists: await exists(uploadDir),
    dataDirWritable: false,
    uploadDirWritable: false,
  };

  try {
    await assertWritableDir(dataDir);
    result.dataDirWritable = true;
  } catch (e) {
    result.dataDirWritable = false;
    result.dataDirWriteError = String(e?.message || e);
  }

  try {
    await assertWritableDir(uploadDir);
    result.uploadDirWritable = true;
  } catch (e) {
    result.uploadDirWritable = false;
    result.uploadDirWriteError = String(e?.message || e);
  }

  return result;
}

/**
 * Atomic write:
 * - writes to a temp file in the same directory
 * - fsyncs (best-effort)
 * - renames to target
 */
export async function writeFileAtomic(targetPath, data, options = {}) {
  const dir = path.dirname(targetPath);
  await ensureDir(dir);

  const tmpName = `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto
    .randomBytes(6)
    .toString("hex")}.tmp`;
  const tmpPath = path.join(dir, tmpName);

  const { encoding = undefined, mode = undefined } = options;

  // Write temp
  await fsp.writeFile(tmpPath, data, { encoding, mode });

  // Best-effort fsync
  try {
    const fd = await fsp.open(tmpPath, "r+");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  } catch {
    // ignore
  }

  // Rename into place (atomic on same filesystem)
  await fsp.rename(tmpPath, targetPath);
}

export async function writeJsonAtomic(targetPath, obj, options = {}) {
  const json = JSON.stringify(obj, null, 2);
  await writeFileAtomic(targetPath, json, { encoding: "utf8", ...options });
}

export async function readJson(p, { fallback = null } = {}) {
  try {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (fallback !== null) return fallback;
    throw e;
  }
}

/**
 * Find an existing file by trying canonical path first,
 * then legacy directories (if configured).
 *
 * Example:
 *   const p = await findExistingDataPath("config/settings.json");
 */
export async function findExistingDataPath(relPath) {
  const canonical = resolveDataPath(relPath);
  if (await exists(canonical)) return canonical;

  for (const legacyDir of getLegacyDataDirs()) {
    const candidate = path.join(legacyDir, relPath);
    if (await exists(candidate)) return candidate;
  }
  return canonical; // default to canonical (even if missing)
}

export async function findExistingUploadPath(relPath) {
  const canonical = resolveUploadPath(relPath);
  if (await exists(canonical)) return canonical;

  for (const legacyDir of getLegacyUploadDirs()) {
    const candidate = path.join(legacyDir, relPath);
    if (await exists(candidate)) return candidate;
  }
  return canonical;
}

/**
 * Copy legacy files into canonical location.
 * - Safe to run multiple times (idempotent).
 * - Does NOT delete legacy by default (set { removeLegacy: true } to move instead).
 */
export async function migrateLegacyPaths({
  relPaths = [], // explicit list of relative paths to migrate (preferred)
  includeUploads = true,
  includeData = true,
  removeLegacy = false,
  markerName = ".migrated_storage_v1",
} = {}) {
  await ensureDirs();

  const dataDir = getDataDir();
  const uploadDir = getUploadDir();
  const markerPath = path.join(dataDir, markerName);

  if (await exists(markerPath)) {
    debug("migration marker exists, skipping", markerPath);
    return { skipped: true, markerPath };
  }

  const actions = [];

  async function copyOrMove(src, dst) {
    await ensureDir(path.dirname(dst));
    if (await exists(dst)) {
      return { action: "skip_exists", src, dst };
    }
    await fsp.copyFile(src, dst);
    if (removeLegacy) {
      await fsp.unlink(src).catch(() => {});
    }
    return { action: removeLegacy ? "moved" : "copied", src, dst };
  }

  // Explicit relPaths are migrated from legacyDataDirs → canonical dataDir
  if (includeData && relPaths.length) {
    for (const rel of relPaths) {
      const canonical = path.join(dataDir, rel);
      if (await exists(canonical)) continue;
      for (const legacy of getLegacyDataDirs()) {
        const src = path.join(legacy, rel);
        if (await exists(src)) {
          actions.push(await copyOrMove(src, canonical));
          break;
        }
      }
    }
  }

  // Uploads: migrate files found directly under legacy upload dirs into canonical uploadDir
  if (includeUploads) {
    for (const legacyUp of getLegacyUploadDirs()) {
      if (!(await exists(legacyUp))) continue;

      // Copy entire directory tree (best-effort). Keeps structure under uploads/.
      async function walk(dir) {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          const src = path.join(dir, ent.name);
          const rel = path.relative(legacyUp, src);
          const dst = path.join(uploadDir, rel);
          if (ent.isDirectory()) {
            await walk(src);
          } else if (ent.isFile()) {
            actions.push(await copyOrMove(src, dst));
          }
        }
      }

      try {
        await walk(legacyUp);
      } catch (e) {
        actions.push({ action: "error", legacyUp, error: String(e?.message || e) });
      }
    }
  }

  // Write marker
  await writeFileAtomic(
    markerPath,
    `migrated_at=${new Date().toISOString()}\nactions=${actions.length}\n`,
    { encoding: "utf8" }
  );

  debug("migration complete", { markerPath, actions: actions.length });
  return { skipped: false, markerPath, actions };
}

/**
 * Convenience initializer for server startup.
 * Call once in your server's bootstrap before routes.
 */
export async function initStorage({ migrate = false, migrateOptions = {} } = {}) {
  const dirs = await ensureDirs();
  if (migrate) {
    await migrateLegacyPaths(migrateOptions);
  }
  return dirs;
}

// Default export for ergonomics
export default {
  getDataDir,
  getUploadDir,
  getLegacyDataDirs,
  getLegacyUploadDirs,
  resolveDataPath,
  resolveUploadPath,
  findExistingDataPath,
  findExistingUploadPath,
  ensureDirs,
  healthCheck,
  exists,
  writeFileAtomic,
  writeJsonAtomic,
  readJson,
  migrateLegacyPaths,
  initStorage,
};
