import storage from "./storage/index.js";

await storage.initStorage();

console.log("DATA_DIR=", storage.getDataDir());
console.log("UPLOAD_DIR=", storage.getUploadDir());

await import("./app.js");
