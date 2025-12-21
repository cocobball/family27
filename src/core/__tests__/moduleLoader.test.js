import { describe, it, expect } from "vitest";

// This test is intentionally lightweight since import.meta.glob is Vite-runtime.
// We test the validation helper behavior indirectly by importing the moduleLoader
// and asserting it returns objects with expected keys.
import { loadModules } from "../moduleLoader.js";

describe("moduleLoader", () => {
  it("returns list + failed arrays", () => {
    const { list, failed } = loadModules();
    expect(Array.isArray(list)).toBe(true);
    expect(Array.isArray(failed)).toBe(true);
  });
});
