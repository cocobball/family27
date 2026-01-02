// Firewalla MSP API provider
// Uses Firewalla cloud API instead of direct SSH

// ===== In-memory cache for kidsStatus with TTL, deduplication, and backoff =====
let kidsCache = null;           // Last successful provider payload
let kidsCacheAt = 0;            // Timestamp when cached
let kidsInflight = null;        // In-flight request promise
let backoffUntil = 0;           // Timestamp until which we're in backoff
let backoffStep = 0;            // Current backoff step (0-5)

const KIDS_TTL_MS = 30000;      // 30s cache TTL
const BACKOFF_STEPS = [30000, 60000, 120000, 240000, 480000, 960000]; // 30s, 60s, 120s, 240s, 480s, 960s (max 6 steps)

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

/**
 * Get kids status with caching, in-flight deduplication, and backoff
 * @param {Function} fetchFn - Async function that fetches fresh status
 * @returns {Promise<Object>} Status response with optional warnings
 */
export async function getKidsStatusCached(fetchFn) {
  const now = Date.now();

  // 1. If in backoff, return cached payload with warning (don't call MSP)
  if (now < backoffUntil) {
    const remainingSec = Math.round((backoffUntil - now) / 1000);
    console.log(`[msp] kidsStatus: in backoff (${remainingSec}s remaining, step ${backoffStep})`);
    
    if (kidsCache) {
      return { 
        ...kidsCache, 
        warning: "msp_backoff_cached",
        backoffRemaining: remainingSec 
      };
    }
    
    // No cache during backoff - should not happen, but handle gracefully
    console.warn("[msp] kidsStatus: in backoff but no cached data");
    throw new Error("MSP in backoff and no cached data available");
  }

  // 2. If cache is fresh (<30s), return cached without calling MSP
  if (kidsCache && (now - kidsCacheAt) < KIDS_TTL_MS) {
    const cacheAge = Math.round((now - kidsCacheAt) / 1000);
    console.log(`[msp] kidsStatus: returning fresh cache (${cacheAge}s old)`);
    return { ...kidsCache };
  }

  // 3. If request already in-flight, await the same Promise
  if (kidsInflight) {
    console.log("[msp] kidsStatus: awaiting in-flight request");
    try {
      return await kidsInflight;
    } catch (err) {
      // If inflight failed, fall through to retry
      console.log("[msp] kidsStatus: in-flight request failed, retrying");
    }
  }

  // 4. Start new fetch and store promise for deduplication
  console.log("[msp] kidsStatus: fetching fresh status");
  
  kidsInflight = (async () => {
    try {
      const result = await fetchFn();
      
      // Success - update cache and clear backoff
      kidsCache = result;
      kidsCacheAt = Date.now();
      backoffUntil = 0;
      backoffStep = 0;
      
      return { ...result };
      
    } catch (err) {
      // Check for 429 rate limit
      const is429 = err.message && (
        err.message.includes("429") || 
        err.message.toLowerCase().includes("rate limit") ||
        err.message.toLowerCase().includes("too many requests")
      );
      
      if (is429) {
        console.log(`[msp] kidsStatus: 429 detected, entering backoff step ${backoffStep}`);
        
        // Set backoffUntil with exponential backoff (max 6 steps)
        const backoffMs = BACKOFF_STEPS[Math.min(backoffStep, BACKOFF_STEPS.length - 1)];
        backoffUntil = Date.now() + backoffMs;
        backoffStep = Math.min(backoffStep + 1, BACKOFF_STEPS.length - 1);
        
        console.log(`[msp] kidsStatus: backoff until ${new Date(backoffUntil).toISOString()} (${backoffMs}ms)`);
        
        // On 429 with cache, return HTTP 200 with cached payload + warning
        if (kidsCache) {
          return { 
            ...kidsCache, 
            warning: "msp_429_served_cached",
            backoffRemaining: Math.round(backoffMs / 1000)
          };
        }
        
        // No cache available - rethrow so handler returns 500
        throw err;
      }
      
      // Other errors: return cached payload if available with warning
      if (kidsCache) {
        console.log("[msp] kidsStatus: upstream error, returning cached payload");
        return { 
          ...kidsCache, 
          warning: "upstream_error_served_cached",
          error: String(err.message || err)
        };
      }
      
      // No cache available - rethrow
      throw err;
      
    } finally {
      // Always clear inflight promise
      kidsInflight = null;
    }
  })();

  return await kidsInflight;
}
