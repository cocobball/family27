// server/routes/backups.js
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const BACKUP_DIR = "/home/masri/backups";
const FILE_RE = /^family-dashboard-system-backup-\d{8}-\d{4}\.tgz$/;

function safeListBackups() {
  let names = [];
  try {
    names = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => FILE_RE.test(n));
  } catch {
    names = [];
  }

  const backups = names
    .map((filename) => {
      const fullPath = path.join(BACKUP_DIR, filename);
      try {
        const st = fs.statSync(fullPath);
        return {
          filename,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

  const summary = {
    count: backups.length,
    totalBytes: backups.reduce((sum, b) => sum + (Number(b.sizeBytes) || 0), 0),
    latestMtimeMs: backups[0]?.mtimeMs || 0,
  };

  return { summary, backups };
}

function systemdEscapeInstance(filename) {
  // safest: call systemd-escape
  return new Promise((resolve, reject) => {
    execFile("systemd-escape", ["-p", filename], (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || "").trim());
    });
  });
}

export default function registerBackupsRoutes(app) {
  console.log("[backups] routes registered");
  app.get("/api/v1/backups", (req, res) => {
    const out = safeListBackups();
    res.json({ ok: true, dir: BACKUP_DIR, summary: out.summary, backups: out.backups });
  });

  app.post("/api/v1/backups/run", (req, res) => {
    try {
      const script = "/usr/local/bin/familydash-backup.sh";
      if (!fs.existsSync(script)) {
        return res.status(500).json({ ok: false, error: "Backup script missing" });
      }

      // Spawn the backup script and return immediately
      execFile(script, (err, stdout, stderr) => {
        if (err) {
          console.error("[backups] run failed", err, String(stdout || ""), String(stderr || ""));
        } else {
          console.log("[backups] run completed", String(stdout || ""));
        }
      });

      return res.json({ ok: true, started: true });
    } catch (e) {
      console.error("[backups] run error", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete("/api/v1/backups/:filename", (req, res) => {
    try {
      const filename = String(req.params?.filename || "");
      if (!FILE_RE.test(filename)) return res.status(400).json({ error: "Invalid filename" });

      const fullPath = path.join(BACKUP_DIR, filename);
      const resolved = path.resolve(fullPath);
      const dirResolved = path.resolve(BACKUP_DIR);
      if (!resolved.startsWith(dirResolved + path.sep)) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      if (!fs.existsSync(resolved)) return res.status(404).json({ error: "Backup not found" });

      fs.unlinkSync(resolved);
      return res.json({ ok: true, deleted: true, filename });
    } catch (e) {
      console.error("[backups] delete error", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/v1/backups/restore", async (req, res) => {
    try {
      const filename = String(req.body?.filename || "");
      if (!FILE_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const fullPath = path.join(BACKUP_DIR, filename);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "Backup not found" });
      }

      // Start systemd restore unit: familydash-restore@<escaped>.service
      const instance = await systemdEscapeInstance(filename);

      execFile("systemctl", ["start", `familydash-restore@${instance}.service`], (err) => {
        if (err) {
          console.error("[backups] restore start failed", err);
          return res.status(500).json({ error: "Failed to start restore" });
        }
        res.json({ ok: true, started: true, filename });
      });
    } catch (e) {
      console.error("[backups] restore error", e);
      res.status(500).json({ error: "Restore error" });
    }
  });
}
