// src/core/networkAdapter.js
// Network adapter (Firewalla/MSP)
// Centralizes "Kids Internet" toggling so other modules don't spam the API.

import { setKidsInternet } from "../api/kidsInternet.js";

// In-memory gating to prevent duplicate calls during rapid events
let lastKidsInternet = null; // "allow" | "block" | null
let inFlight = null;

/**
 * Send a Kids Internet toggle command with simple transition gating.
 * - "allow" => POST /api/v1/network/kids/off
 * - "block" => POST /api/v1/network/kids/on
 */
async function sendKidsInternet(mode) {
  if (mode !== "allow" && mode !== "block") return;

  // If we're already in the desired state, do nothing.
  if (mode === lastKidsInternet) return;

  // If a request is in flight, don't start another one.
  // (This avoids spamming and race conditions.)
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await setKidsInternet(mode);
      lastKidsInternet = mode;
    } catch (e) {
      console.error("[NETWORK] Kids Internet toggle failed:", e);
      // Don't update lastKidsInternet if failed
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Called when a kid starts an allowed session (e.g., redeemed minutes).
 * We "allow" kids internet.
 */
export async function unlockKid({ kidId, minutes, targets }) {
  console.log(
    "[NETWORK] unlockKid",
    JSON.stringify({ kidId, minutes, targets }, null, 2)
  );

  // Any session start => allow internet
  await sendKidsInternet("allow");
}

/**
 * Called when a kid's session ends.
 * We "block" kids internet (simple + safe default).
 */
export async function lockKid({ kidId, targets }) {
  console.log(
    "[NETWORK] lockKid",
    JSON.stringify({ kidId, targets }, null, 2)
  );

  // Any session end => block internet
  await sendKidsInternet("block");
}
