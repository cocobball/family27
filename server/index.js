import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";

// Load .env file but don't globally override
const envPath = "/opt/family-dashboard/.env";
const result = dotenv.config({ path: envPath });

// Selectively override FIREWALLA_* vars from .env (they take precedence over systemd)
if (result.parsed) {
  const firewallKeys = ["FIREWALLA_HOST", "FIREWALLA_USER", "FIREWALLA_KEY", "FIREWALLA_KIDS_POLICY_ID"];
  for (const key of firewallKeys) {
    if (result.parsed[key] !== undefined) {
      process.env[key] = result.parsed[key];
    }
  }
}

// Validate FIREWALLA_KEY
const currentUser = userInfo().username;
const firewallKey = process.env.FIREWALLA_KEY;

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

console.log("cwd=", process.cwd());
console.log("FIREWALLA_HOST=", process.env.FIREWALLA_HOST);
console.log("FIREWALLA_USER=", process.env.FIREWALLA_USER);
console.log("FIREWALLA_KEY=", process.env.FIREWALLA_KEY);

import storage from "./storage/index.js";

await storage.initStorage();

console.log("DATA_DIR=", storage.getDataDir());
console.log("UPLOAD_DIR=", storage.getUploadDir());

await import("./app.js");
