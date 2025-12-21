import { describe, it, expect, beforeEach } from "vitest";
import { DB_KEY, createEmptyDb, importAll, loadDb, migrateDbIfNeeded } from "../dashboardStore.js";

beforeEach(() => {
  localStorage.clear();
});

describe("dashboardStore", () => {
  it("creates empty db with required shape", () => {
    const db = createEmptyDb();
    expect(db.version).toBe(1);
    expect(db.layout).toBeTruthy();
    expect(db.modules).toBeTruthy();
  });

  it("migrates missing fields safely", () => {
    const db = migrateDbIfNeeded({ version: 1 });
    expect(db.layout).toBeTruthy();
    expect(db.modules).toBeTruthy();
    expect(db.theme).toBeTruthy();
  });

  it("importAll writes to unified key", () => {
    const db = createEmptyDb();
    importAll(db);
    const raw = localStorage.getItem(DB_KEY);
    expect(raw).toBeTruthy();
    expect(loadDb().version).toBe(1);
  });
});
