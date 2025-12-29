# Storage Layer (server/storage)

Drop-in storage module for the Family Dashboard API.

## What this solves
- Centralizes filesystem paths under `DATA_DIR` / `UPLOAD_DIR`
- Creates required directories on boot (`ensureDirs`)
- Provides atomic JSON/file writes (`writeJsonAtomic`, `writeFileAtomic`)
- Supports legacy read fallback + optional migration

## Quick start (API entrypoint)
```js
import storage from "./storage/index.js";

await storage.initStorage(); // creates dirs
```

## Environment (Pi)
Recommended:
- `DATA_DIR=/opt/family-dashboard/data`
- `UPLOAD_DIR=/opt/family-dashboard/data/uploads`

Optional legacy fallbacks (comma-separated):
- `LEGACY_DATA_DIRS=/opt/family-dashboard/old-data,/home/pi/family-dashboard-data`
- `LEGACY_UPLOAD_DIRS=/opt/family-dashboard/old-uploads`

Debug logging:
- `STORAGE_DEBUG=1`

## Health check
```js
app.get("/api/v1/storage/health", async (req, res) => {
  res.json(await storage.healthCheck());
});
```

## Notes
- Reads: prefer `findExistingDataPath(rel)` if you need backward compatibility.
- Writes: always write to canonical paths (`resolveDataPath`, `resolveUploadPath`).
