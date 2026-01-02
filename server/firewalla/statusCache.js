/**
 * In-memory cache for Firewalla MSP status calls with:
 * - TTL-based caching (15s default)
 * - In-flight request deduplication
 * - 429 backoff with last-known-good fallback
 */

const STATUS_TTL_MS = parseInt(process.env.FIREWALLA_STATUS_TTL_MS) || 15000;
const BACKOFF_WINDOW_MS = parseInt(process.env.FIREWALLA_BACKOFF_WINDOW_MS) || 60000;

let cache = null;           // Last successful status response
let cacheTimestamp = 0;     // When it was cached
let inflightPromise = null; // In-flight request promise for deduplication
let backoffUntil = 0;       // Timestamp until which we're in backoff mode

/**
 * Check if we're currently in backoff mode (rate-limited)
 */
export function isInBackoff() {
  return Date.now() < backoffUntil;
}

/**
 * Enter backoff mode due to 429 rate limiting
 * @param {number} retryAfterSeconds - Optional Retry-After header value
 */
export function enterBackoff(retryAfterSeconds = null) {
  const backoffMs = retryAfterSeconds 
    ? Math.min(retryAfterSeconds * 1000, BACKOFF_WINDOW_MS) 
    : BACKOFF_WINDOW_MS;
  
  backoffUntil = Date.now() + backoffMs;
  console.log(`[statusCache] Entering backoff for ${backoffMs}ms until ${new Date(backoffUntil).toISOString()}`);
}

/**
 * Check if cached data is still valid
 */
function isCacheValid() {
  return cache !== null && (Date.now() - cacheTimestamp) < STATUS_TTL_MS;
}

/**
 * Get cached status with TTL and backoff handling
 * @param {Function} fetchFn - Async function that fetches fresh status
 * @returns {Promise<Object>} Status response
 */
export async function getCachedStatus(fetchFn) {
  // 1. If in backoff, return last-known-good immediately (don't hit MSP)
  if (isInBackoff()) {
    if (cache) {
      console.log(`[statusCache] In backoff, returning last-known-good (${Math.round((backoffUntil - Date.now()) / 1000)}s remaining)`);
      return { ...cache, cached: true, backoff: true };
    }
    
    // No cache available during backoff - this is bad but we must return something
    console.warn("[statusCache] In backoff but no cached data available");
    return { 
      ok: false, 
      error: "Rate limited and no cached data available",
      backoff: true 
    };
  }

  // 2. Return cached data if still valid
  if (isCacheValid()) {
    console.log(`[statusCache] Returning cached status (${Math.round((STATUS_TTL_MS - (Date.now() - cacheTimestamp)) / 1000)}s remaining)`);
    return { ...cache, cached: true };
  }

  // 3. If request already in-flight, await it instead of starting new one
  if (inflightPromise) {
    console.log("[statusCache] Awaiting in-flight request");
    try {
      return await inflightPromise;
    } catch (err) {
      // If inflight promise fails, fall through to retry
      console.log("[statusCache] In-flight request failed, will retry");
    }
  }

  // 4. Start new fetch and store promise for deduplication
  console.log("[statusCache] Fetching fresh status");
  
  inflightPromise = (async () => {
    try {
      const result = await fetchFn();
      
      // Success - update cache and clear backoff
      cache = result;
      cacheTimestamp = Date.now();
      backoffUntil = 0; // Clear any backoff
      
      return { ...result, cached: false };
      
    } catch (err) {
      // Check if this is a 429 rate limit error
      const is429 = err.message && (
        err.message.includes("429") || 
        err.message.toLowerCase().includes("rate limit") ||
        err.message.toLowerCase().includes("too many requests")
      );
      
      if (is429) {
        console.log("[statusCache] 429 Rate limit detected");
        
        // Try to extract Retry-After header value from error message
        // MSP error format: "MSP API GET /v2/rules?query=... failed: 429 Too Many Requests: ..."
        const retryAfterMatch = err.message.match(/retry[- ]after[:\s]+(\d+)/i);
        const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1]) : null;
        
        enterBackoff(retryAfterSeconds);
        
        // Return last-known-good if available
        if (cache) {
          console.log("[statusCache] Returning last-known-good status due to 429");
          return { ...cache, cached: true, backoff: true };
        }
      }
      
      // No cache available or non-429 error - rethrow
      throw err;
    } finally {
      // Always clear inflight promise
      inflightPromise = null;
    }
  })();

  return await inflightPromise;
}

/**
 * Invalidate cache (call after mutations like on/off)
 */
export function invalidateCache() {
  console.log("[statusCache] Cache invalidated");
  cache = null;
  cacheTimestamp = 0;
  // Don't clear backoff - mutations should also respect rate limits
}

/**
 * Update cache with new status (call after successful mutation)
 * @param {Object} newStatus - New status to cache
 */
export function updateCache(newStatus) {
  console.log("[statusCache] Cache updated with new status");
  cache = newStatus;
  cacheTimestamp = Date.now();
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats() {
  return {
    hasCachedData: cache !== null,
    cacheAge: cache ? Date.now() - cacheTimestamp : null,
    isValid: isCacheValid(),
    inBackoff: isInBackoff(),
    backoffRemaining: isInBackoff() ? backoffUntil - Date.now() : 0,
    hasInflight: inflightPromise !== null,
    ttlMs: STATUS_TTL_MS,
    backoffWindowMs: BACKOFF_WINDOW_MS,
  };
}
