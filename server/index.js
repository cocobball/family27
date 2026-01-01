import dotenv from "dotenv";
dotenv.config({ path: "/opt/family-dashboard/.env", override: false });

console.log("cwd=", process.cwd());
console.log("FIREWALLA_KEY=", process.env.FIREWALLA_KEY);

import storage from "./storage/index.js";

await storage.initStorage();

console.log("DATA_DIR=", storage.getDataDir());
console.log("UPLOAD_DIR=", storage.getUploadDir());

await import("./app.js");
