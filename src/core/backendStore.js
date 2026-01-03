const API_BASE = "/api/v1";

// in-memory cache per browser tab
const cache = new Map();        // moduleId -> data object
const hydrated = new Set();     // moduleId hydrated at least once

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export function getCachedModule(moduleId) {
  return cache.get(moduleId);
}

export function setCachedModule(moduleId, val) {
  cache.set(moduleId, val);
}

export function hasHydrated(moduleId) {
  return hydrated.has(moduleId);
}

export async function hydrateModuleFromServer(moduleId) {
  hydrated.add(moduleId);
  const url = `${API_BASE}/modules/${encodeURIComponent(moduleId)}/state`;
  const out = await fetchJson(url);
  const state = out?.state && typeof out.state === "object" ? out.state : {};
  cache.set(moduleId, state);
  return state;
}

export async function forceHydrateModuleFromServer(moduleId) {
  const url = `${API_BASE}/modules/${encodeURIComponent(moduleId)}/state`;
  const out = await fetchJson(url);
  const state = out?.state && typeof out.state === "object" ? out.state : {};
  cache.set(moduleId, state);
  hydrated.add(moduleId);
  return state;
}

export async function saveModuleToServer(moduleId, data) {
  const url = `${API_BASE}/modules/${encodeURIComponent(moduleId)}/state`;
  await fetchJson(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
}
