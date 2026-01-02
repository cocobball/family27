// src/api/kidsInternet.js
export async function setKidsInternet(mode) {
  // mode: "allow" | "block"
  const endpoint = mode === "allow"
    ? "/api/v1/network/kids/off" // allow/unpause
    : "/api/v1/network/kids/on"; // block/pause

  const res = await fetch(endpoint, { method: "POST" });

  let json = {};
  try {
    json = await res.json();
  } catch {}

  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `KidsInternet failed: HTTP ${res.status}`);
  }

  return json;
}
