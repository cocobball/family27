import { execFile } from "node:child_process";

const FIREWALLA_HOST = process.env.FIREWALLA_HOST || "192.168.122.1";
const FIREWALLA_USER = process.env.FIREWALLA_USER || "pi";
const FIREWALLA_KEY =
  process.env.FIREWALLA_KEY || `${process.env.HOME}/.ssh/firewalla_dashboard`;

// Your “test block kids” policy pid from Firewalla:
const DEFAULT_POLICY_ID = process.env.FIREWALLA_KIDS_POLICY_ID || "48";

function sshRun(remoteCmd) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      FIREWALLA_KEY,
      "-o",
      "StrictHostKeyChecking=no",
      `${FIREWALLA_USER}@${FIREWALLA_HOST}`,
      remoteCmd,
    ];

    execFile("ssh", args, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

function nodeToggleCmd(policyId, action /* "enable" | "disable" */) {
  return `/home/pi/firewalla/bin/node -e "
const PM2 = require('/home/pi/firewalla/alarm/PolicyManager2.js');
(async () => {
  const pm2 = new PM2();
  const p = await pm2.getPolicy('${policyId}');
  if (!p) { console.log('no policy'); process.exit(2); }
  if ('${action}' === 'disable') await pm2.disablePolicy(p);
  else await pm2.enablePolicy(p);
  console.log('${action}d', '${policyId}');
})();
"`;
}

// Keep the same names so your existing routes keep working.
// NOTE: we interpret “pause” as ALLOW kids (disable block policy),
// and “resume” as BLOCK kids (enable block policy).

export async function pauseRule(req, res) {
  try {
    const policyId = String(req.body?.policyId || DEFAULT_POLICY_ID);
    const out = await sshRun(nodeToggleCmd(policyId, "disable"));
    res.json({ ok: true, policyId, result: out.stdout.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

export async function resumeRule(req, res) {
  try {
    const policyId = String(req.body?.policyId || DEFAULT_POLICY_ID);
    const out = await sshRun(nodeToggleCmd(policyId, "enable"));
    res.json({ ok: true, policyId, result: out.stdout.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
