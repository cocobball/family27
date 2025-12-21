import JSZip from "jszip";
import { exportAll, importAll } from "./dashboardStore.js";

export async function exportZip() {
  const zip = new JSZip();
  const db = exportAll();

  zip.file("manifest.json", JSON.stringify(db, null, 2));
  zip.file("meta.json", JSON.stringify({ exportedAt: new Date().toISOString(), app: "family-home-dashboard", format: 1 }, null, 2));
  zip.folder("assets"); // future-proof

  const blob = await zip.generateAsync({ type: "blob" });
  return blob;
}

export async function importZip(file) {
  const zip = await JSZip.loadAsync(file);
  const manifest = zip.file("manifest.json");
  if (!manifest) throw new Error("Invalid export ZIP: missing manifest.json");
  const raw = await manifest.async("string");
  const db = JSON.parse(raw);

  // minimal shape validation
  if (db?.version == null || db?.layout == null || db?.modules == null) {
    throw new Error("Invalid manifest.json: missing required fields (version/layout/modules)");
  }

  return importAll(db);
}
