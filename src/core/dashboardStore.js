import { defaultThemeId } from "./themes.js";
import { createDefaultLayout } from "./layoutDefaults.js";

export const DB_KEY = "family_dashboard_db_v1";

function nowIso() { return new Date().toISOString(); }

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export function createEmptyDb() {
  return {
    version: 1,
    updatedAt: nowIso(),
    theme: { id: defaultThemeId },
    layout: createDefaultLayout(),
    modules: {},
  };
}

export function migrateDbIfNeeded(db) {
  // v1 only for now — keep for future.
  if (!db || typeof db !== "object") return createEmptyDb();
  db.version ??= 1;
  db.updatedAt ??= nowIso();
  db.theme ??= { id: defaultThemeId };
  db.layout ??= createDefaultLayout();
  db.layout.columns ??= createDefaultLayout().columns;
  db.layout.windows ??= {};
  db.layout.moduleVisibility ??= {};
  db.modules ??= {};
  return db;
}

export function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  const parsed = raw ? safeParse(raw) : null;
  const db = migrateDbIfNeeded(parsed ?? createEmptyDb());
  return db;
}

export function saveDb(db) {
  db.updatedAt = nowIso();
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function exportAll() {
  return loadDb();
}

export function importAll(newDb) {
  const db = migrateDbIfNeeded(newDb);
  saveDb(db);
  return db;
}

export function getTheme() {
  return loadDb().theme?.id ?? defaultThemeId;
}

export function setTheme(themeId) {
  const db = loadDb();
  db.theme = { id: themeId };
  saveDb(db);
}

export function ensureModule(moduleId, defaultValue) {
  const db = loadDb();
  db.modules[moduleId] ??= (typeof defaultValue === "function" ? defaultValue() : (defaultValue ?? { version: 1 }));
  saveDb(db);
  return db.modules[moduleId];
}

export function getModuleData(moduleId, defaultValue) {
  const db = loadDb();
  const existing = db.modules[moduleId];
  if (existing == null) {
    const val = typeof defaultValue === "function" ? defaultValue() : (defaultValue ?? { version: 1 });
    db.modules[moduleId] = val;
    saveDb(db);
    return val;
  }
  return existing;
}

export function setModuleData(moduleId, value) {
  // Debug guard for chores module
  if (moduleId === "chores") {
    console.warn("[STORE] setModuleData(chores) attempt:", value);
    console.trace("[STORE] setModuleData(chores) stack");
    
    if (!value || typeof value !== "object" || !("version" in value)) {
      console.warn("[STORE] setModuleData(chores) BLOCKED: invalid value (not an object or missing version)");
      return;
    }
  }
  
  const db = loadDb();
  db.modules[moduleId] = value;
  saveDb(db);
}

export function patchModuleData(moduleId, partial) {
  // Debug guard for chores module
  if (moduleId === "chores") {
    console.warn("[STORE] patchModuleData(chores) attempt:", partial);
    console.trace("[STORE] patchModuleData(chores) stack");
    
    if (!partial || typeof partial !== "object") {
      console.warn("[STORE] patchModuleData(chores) BLOCKED: partial is not an object");
      const db = loadDb();
      return db.modules[moduleId] ?? { version: 1 };
    }
  }
  
  const db = loadDb();
  const current = db.modules[moduleId] ?? { version: 1 };
  db.modules[moduleId] = { ...current, ...partial };
  saveDb(db);
  return db.modules[moduleId];
}
