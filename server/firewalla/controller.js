import { execFile } from "node:child_process";

const FIREWALLA_HOST = process.env.FIREWALLA_HOST || "192.168.122.1";
const FIREWALLA_USER = process.env.FIREWALLA_USER || "pi";
const FIREWALLA_KEY =
  process.env.FIREWALLA_KEY || `${process.env.HOME}/.ssh/firewalla_dashboard`;

// Your “Kids block” policy pid from Firewalla (you said 48):
const DEFAULT_POLICY_ID = process.env.FIREWALLA_KIDS_POLICY_ID || "48";
// De-duping for concurrent SSH status calls
let inFlightStatus = null;
let lastStatus = null;
let lastStatusAt = 0;
const STATUS_CACHE_MS = 2000;
function sshRun(remoteCmd) {
  console.log("[firewalla] ssh key:", FIREWALLA_KEY);
  return new Promise((resolve, reject) => {
const args = [
  "-i",
  FIREWALLA_KEY,
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=8",
  "-o",
  "ServerAliveInterval=5",
  "-o",
  "ServerAliveCountMax=2",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "LogLevel=ERROR",
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
  const js =
    'const PM2=require("./alarm/PolicyManager2.js");' +
    '(async()=>{' +
    "const pm2=new PM2();" +
    `const p=await pm2.getPolicy("${policyId}");` +
    'if(!p){console.log(JSON.stringify({ok:false,error:"no policy"}));process.exit(2);}' +
    (action === "disable"
      ? "await pm2.disablePolicy(p);"
      : "await pm2.enablePolicy(p);") +
    `const p2=await pm2.getPolicy("${policyId}");` +
    'console.log(JSON.stringify({ok:true,pid:p2.pid,disabled:p2.disabled,notes:p2.notes||""}));' +
    "})().catch(e=>{console.log(JSON.stringify({ok:false,error:String((e && e.message) ? e.message : e)}));process.exit(1);});";

  const escaped = js.replace(/'/g, "'\\''" );
  return `cd /home/pi/firewalla && export GIT_DIR=/home/pi/firewalla/.git GIT_WORK_TREE=/home/pi/firewalla && /home/pi/firewalla/bin/node -e '${escaped}'`;
}

function nodeStatusCmd(policyId) {
  const js =
    'const PM2=require("./alarm/PolicyManager2.js");' +
    '(async()=>{' +
    "const pm2=new PM2();" +
    `const p=await pm2.getPolicy("${policyId}");` +
    'if(!p){console.log(JSON.stringify({ok:false,error:"no policy"}));process.exit(2);}' +
    'console.log(JSON.stringify({ok:true,pid:p.pid,type:p.type,action:p.action,tag:p.tag,target:p.target,direction:p.direction,disabled:p.disabled,notes:p.notes||""}));' +
    "})().catch(e=>{console.log(JSON.stringify({ok:false,error:String((e && e.message) ? e.message : e)}));process.exit(1);});";

  const escaped = js.replace(/'/g, "'\\''" );
  return `cd /home/pi/firewalla && export GIT_DIR=/home/pi/firewalla/.git GIT_WORK_TREE=/home/pi/firewalla && /home/pi/firewalla/bin/node -e '${escaped}'`;
}

// NOTE (important):
// - policy.disabled = "0" means policy ENABLED => BLOCK active => Kids internet OFF
// - policy.disabled = "1" means policy DISABLED => BLOCK inactive => Kids internet ON

export async function pauseRule(req, res) {
  // "pause" here means ALLOW kids => disable the blocking policy
  try {
    const policyId = String(req.body?.policyId || DEFAULT_POLICY_ID);
    const out = await sshRun(nodeToggleCmd(policyId, "disable"));
    res.json({ ok: true, policyId, result: out.stdout.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

export async function resumeRule(req, res) {
  // "resume" here means BLOCK kids => enable the blocking policy
  try {
    const policyId = String(req.body?.policyId || DEFAULT_POLICY_ID);
    const out = await sshRun(nodeToggleCmd(policyId, "enable"));
    res.json({ ok: true, policyId, result: out.stdout.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

export async function kidsStatus(req, res) {
  try {
    const policyId = String(req.query?.policyId || DEFAULT_POLICY_ID);
    
    // Return cached result if fresh enough
    if (Date.now() - lastStatusAt < STATUS_CACHE_MS && lastStatus) {
      return res.json(lastStatus);
    }
    
    // If there's already a request in flight, await it
    if (inFlightStatus) {
      const result = await inFlightStatus;
      return res.json(result);
    }
    
    // Start a new request
    inFlightStatus = (async () => {
      const out = await sshRun(nodeStatusCmd(policyId));
      const jsonLine = out.stdout.trim().split("\n").pop();
      const parsed = JSON.parse(jsonLine);
      return parsed;
    })();
    
    try {
      const result = await inFlightStatus;
      // Cache successful result
      lastStatus = result;
      lastStatusAt = Date.now();
      res.json(result);
    } finally {
      inFlightStatus = null;
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
