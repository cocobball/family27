import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";

// Load .env file and force-override FIREWALLA_* vars
const envPath = "/opt/family-dashboard/.env";
const result = dotenv.config({ path: envPath });
const envFromFile = result.parsed || {};

// Force-override FIREWALLA_* vars from .env (they take precedence over systemd)
const firewallKeys = [
  "FIREWALLA_PROVIDER",
  "FIREWALLA_MSP_DOMAIN",
  "FIREWALLA_MSP_RULE_ID",
  "FIREWALLA_MSP_TOKEN",
  "FIREWALLA_KEY",
  "FIREWALLA_HOST",
  "FIREWALLA_USER",
  "FIREWALLA_KIDS_POLICY_ID",
];

let overrideCount = 0;
for (const key of firewallKeys) {
  if (envFromFile[key] !== undefined) {
    const before = process.env[key];
    process.env[key] = envFromFile[key];
    if (before !== envFromFile[key]) {
      console.log(`[env] ${key}: systemd="${before}" → .env="${envFromFile[key]}"`);
      overrideCount++;
    }
  }
}
console.log(`[env] Overrode ${overrideCount} FIREWALLA_* vars from ${envPath}`);

// Determine provider at runtime
const provider = String(process.env.FIREWALLA_PROVIDER || "ssh").trim().toLowerCase();
console.log(`[env] Provider mode: "${provider}"`);

// Validate FIREWALLA_KEY (only fatal for SSH provider)
const currentUser = userInfo().username;
const firewallKey = process.env.FIREWALLA_KEY;

if (provider === "msp") {
  console.log("[env] MSP mode detected - skipping SSH key validation");
  // MSP mode: warn about SSH key issues but don't fail
  if (firewallKey && firewallKey.startsWith("/home/pi/")) {
    console.warn(`WARNING: FIREWALLA_KEY is set to ${firewallKey} but provider is 'msp'`);
    console.warn("MSP provider does not use SSH keys. This setting will be ignored.");
  }
} else {
  console.log("[env] SSH mode detected - validating SSH key");
  // SSH mode: FIREWALLA_KEY is required
  if (!firewallKey) {
    console.error(`ERROR: FIREWALLA_KEY is not set in ${envPath}`);
    console.error("Please ensure FIREWALLA_KEY is defined in the .env file.");
    process.exit(1);
  }

  // If running as masri but key points to /home/pi, that's wrong
  if (currentUser === "masri" && firewallKey === "/home/pi/.ssh/firewalla_dashboard") {
    console.error(`ERROR: FIREWALLA_KEY is set to ${firewallKey} but you are running as user '${currentUser}'`);
    console.error(`Expected: /home/${currentUser}/.ssh/firewalla_dashboard`);
    console.error(`Please update ${envPath} with the correct FIREWALLA_KEY path.`);
    process.exit(1);
  }

  // Verify the key file exists
  if (!existsSync(firewallKey)) {
    console.error(`ERROR: FIREWALLA_KEY file does not exist: ${firewallKey}`);
    console.error(`Please ensure the SSH key file exists and is readable.`);
    process.exit(1);
  }
}

// Validate MSP provider configuration if using MSP
if (provider === "msp") {
  const mspDomain = process.env.FIREWALLA_MSP_DOMAIN;
  const mspToken = process.env.FIREWALLA_MSP_TOKEN;
  const mspRuleId = process.env.FIREWALLA_MSP_RULE_ID;

  if (!mspDomain) {
    console.error("ERROR: FIREWALLA_PROVIDER is 'msp' but FIREWALLA_MSP_DOMAIN is not set");
    console.error(`Please set FIREWALLA_MSP_DOMAIN in ${envPath} or via systemd override`);
    process.exit(1);
  }

  if (!mspToken) {
    console.error("ERROR: FIREWALLA_PROVIDER is 'msp' but FIREWALLA_MSP_TOKEN is not set");
    console.error(`Please set FIREWALLA_MSP_TOKEN in ${envPath} or via systemd override`);
    process.exit(1);
  }

  if (!mspRuleId) {
    console.error("ERROR: FIREWALLA_PROVIDER is 'msp' but FIREWALLA_MSP_RULE_ID is not set");
    console.error(`Please set FIREWALLA_MSP_RULE_ID in ${envPath} or via systemd override`);
    process.exit(1);
  }
}

console.log("cwd=", process.cwd());
console.log("FIREWALLA_PROVIDER=", provider);
console.log("FIREWALLA_HOST=", process.env.FIREWALLA_HOST);
console.log("FIREWALLA_USER=", process.env.FIREWALLA_USER);
console.log("FIREWALLA_KEY=", process.env.FIREWALLA_KEY);

// Log MSP config (safe values only, never token)
if (provider === "msp") {
  console.log("FIREWALLA_MSP_DOMAIN=", process.env.FIREWALLA_MSP_DOMAIN);
  console.log("FIREWALLA_MSP_RULE_ID=", process.env.FIREWALLA_MSP_RULE_ID);
  console.log("FIREWALLA_MSP_TOKEN=", "[REDACTED]");
}

import storage from "./storage/index.js";

await storage.initStorage();

console.log("DATA_DIR=", storage.getDataDir());
console.log("UPLOAD_DIR=", storage.getUploadDir());

await import("./app.js");
