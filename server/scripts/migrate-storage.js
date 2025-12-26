// server/scripts/migrate-storage.js
// Usage:
//   node server/scripts/migrate-storage.js --dry-run
//   node server/scripts/migrate-storage.js --apply
//
// Reads env vars for DATA_DIR / UPLOAD_DIR / LEGACY_*.

import storage from "../storage/index.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const apply = args.has("--apply");

if (!dryRun && !apply) {
  console.log("Specify --dry-run or --apply");
  process.exit(1);
}

const opts = {
  // Explicit relPaths are the safest way to migrate known files.
  // Add your module-specific rel paths here over time.
  relPaths: [
    "config/settings.json",
    "db/app.sqlite",
  ],
  includeUploads: true,
  includeData: true,
  removeLegacy: false,
};

async function main() {
  console.log("DATA_DIR:", storage.getDataDir());
  console.log("UPLOAD_DIR:", storage.getUploadDir());
  console.log("LEGACY_DATA_DIRS:", storage.getLegacyDataDirs());
  console.log("LEGACY_UPLOAD_DIRS:", storage.getLegacyUploadDirs());

  if (dryRun) {
    console.log("\nDry run: showing what would happen (no marker written).");
    // For dry-run we call migrateLegacyPaths but prevent marker by using unique markerName
    const res = await storage.migrateLegacyPaths({ ...opts, markerName: `.dry_run_${Date.now()}` });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.log("\nApply migration:");
  const res = await storage.migrateLegacyPaths(opts);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
