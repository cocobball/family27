// Firewalla MSP API provider
// Uses Firewalla cloud API instead of direct SSH

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function parseJsonSafe(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function mspFetch(path, { method = "GET", timeoutMs = 15000 } = {}) {
  const domain = requireEnv("FIREWALLA_MSP_DOMAIN");
  const token = requireEnv("FIREWALLA_MSP_TOKEN");

  const url = `https://${domain}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        // Do NOT log this token anywhere.
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      signal: ac.signal,
    });

    const text = await res.text();
    const json = parseJsonSafe(text);

    if (!res.ok) {
      const msg = json?.error || json?.message || text || `${res.status} ${res.statusText}`;
      throw new Error(`MSP API ${method} ${path} failed: ${res.status} ${res.statusText}: ${msg}`);
    }

    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Get rule by ID
 * Returns normalized format matching SSH provider:
 * { ok: true, pid: ruleId, disabled: "0"|"1", notes: ruleName, ... }
 */
export async function mspGetRule(ruleId) {
  if (!ruleId) throw new Error("Missing FIREWALLA_MSP_RULE_ID");
  
  console.log("[firewalla] msp: fetching rule", ruleId);
  
  const q = encodeURIComponent(`id:${ruleId}`);
  const data = await mspFetch(`/v2/rules?query=${q}`, { method: "GET" });

  const rule = data?.results?.[0];
  if (!rule) {
    return { ok: false, error: `MSP rule not found for id=${ruleId}` };
  }

  // Map MSP status to SSH disabled format:
  // paused => disabled="1" (policy disabled => kids allowed)
  // active => disabled="0" (policy enabled => kids blocked)
  const disabled = rule.status === "paused" ? "1" : "0";

  return {
    ok: true,
    pid: ruleId,
    type: rule.type || "rule",
    action: rule.action || "block",
    disabled,
    notes: rule.name || "",
    // Include original MSP data
    msp: {
      status: rule.status,
      name: rule.name,
      target: rule.target,
    },
  };
}

/**
 * Pause rule (disable blocking => kids allowed)
 */
export async function mspPauseRule(ruleId) {
  if (!ruleId) throw new Error("Missing FIREWALLA_MSP_RULE_ID");
  
  console.log("[firewalla] msp: pausing rule", ruleId);
  
  // Pause == allow (rule not enforced)
  await mspFetch(`/v2/rules/${encodeURIComponent(ruleId)}/pause`, { method: "POST" });
  return await mspGetRule(ruleId);
}

/**
 * Resume rule (enable blocking => kids blocked)
 */
export async function mspResumeRule(ruleId) {
  if (!ruleId) throw new Error("Missing FIREWALLA_MSP_RULE_ID");
  
  console.log("[firewalla] msp: resuming rule", ruleId);
  
  // Resume == block (rule enforced)
  await mspFetch(`/v2/rules/${encodeURIComponent(ruleId)}/resume`, { method: "POST" });
  return await mspGetRule(ruleId);
}
