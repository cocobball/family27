import React from "react";
import { logWarn } from "./logger.js";

function validateModuleDef(def) {
  if (!def || typeof def !== "object") return "Missing moduleDef export";
  if (!def.id) return "Missing required field: id";
  if (!def.title) return `Invalid module ${def.id || "(unknown)"}: Missing required field: title`;
  if (!def.Component) return `Invalid module ${def.id}: Missing required field: Component`;
  if (def.dependencies && !Array.isArray(def.dependencies)) return `Invalid module ${def.id}: dependencies must be an array`;
  return null;
}

function topoSort(modulesById) {
  const visited = new Set();
  const temp = new Set();
  const out = [];

  function visit(id) {
    if (visited.has(id)) return;
    if (temp.has(id)) throw new Error(`Cyclic dependency detected at ${id}`);
    temp.add(id);
    const m = modulesById[id];
    const deps = (m?.dependencies ?? []);
    for (const d of deps) {
      if (modulesById[d]) visit(d);
    }
    temp.delete(id);
    visited.add(id);
    out.push(modulesById[id]);
  }

  for (const id of Object.keys(modulesById)) visit(id);
  return out;
}

export function loadModules() {
  const discovered = import.meta.glob("../modules/*/index.js", { eager: true });

  const modulesById = {};
  const failed = []; // { id, path, reason }
  const disabledByDeps = []; // { id, missing: [] }

  for (const path in discovered) {
    // skip template folder if it exists inside modules (should, per spec)
    if (path.includes("/template/")) continue;

    const mod = discovered[path];
    const def = mod?.moduleDef;

    const err = validateModuleDef(def);
    if (err) {
      const idGuess = def?.id ?? path.split("/").slice(-2, -1)[0];
      failed.push({ id: idGuess, path, reason: err });
      logWarn("Module failed validation", { id: idGuess, path, reason: err });
      continue;
    }

    if (modulesById[def.id]) {
      const reason = `Duplicate module id: ${def.id}`;
      failed.push({ id: def.id, path, reason });
      logWarn("Module failed validation", { id: def.id, path, reason });
      continue;
    }

    modulesById[def.id] = def;
  }

  // dependency checks
  for (const id of Object.keys(modulesById)) {
    const deps = modulesById[id].dependencies ?? [];
    const missing = deps.filter((d) => !modulesById[d]);
    if (missing.length) {
      disabledByDeps.push({ id, missing });
    }
  }

  // remove modules with missing deps from active list, but keep them reported
  for (const d of disabledByDeps) {
    const def = modulesById[d.id];
    delete modulesById[d.id];
    failed.push({ id: def.id, path: "(discovered)", reason: `Missing dependencies: ${d.missing.join(", ")}` });
    logWarn("Module disabled due to missing deps", d);
  }

  let sorted = [];
  try {
    sorted = topoSort(modulesById);
  } catch (e) {
    // if topo fails, don't crash — keep unsorted order but report
    failed.push({ id: "(loader)", path: "moduleLoader.js", reason: String(e?.message ?? e) });
    sorted = Object.values(modulesById);
    logWarn("Dependency sort failed", { error: String(e?.message ?? e) });
  }

  // Normalize components to lazy if a module provides a lazyImport function
  // (optional pattern). Otherwise leave as-is.
  const list = sorted.map((m) => {
    if (m.lazyImport && typeof m.lazyImport === "function") {
      return { ...m, Component: React.lazy(m.lazyImport) };
    }
    return m;
  });

  return { list, failed };
}
