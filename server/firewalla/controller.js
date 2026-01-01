import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const FIREWALLA_HOST = process.env.FIREWALLA_HOST || "192.168.122.1";
const FIREWALLA_USER = process.env.FIREWALLA_USER || "pi";
const FIREWALLA_KEY =
  process.env.FIREWALLA_KEY || `${process.env.HOME}/.ssh/firewalla_dashboard`;

// Your “Kids block” policy pid from Firewalla (you said 48):
const DEFAULT_POLICY_ID = process.env.FIREWALLA_KIDS_POLICY_ID || "48";

// 3-second cache + single-flight lock for kids status
let statusCache = null;
let statusCacheAt = 0;
let statusInflightPromise = null;
const STATUS_CACHE_MS = 3000;

function sshRun(remoteCmd) {
  // Validate SSH key exists before attempting connection
  if (!existsSync(FIREWALLA_KEY)) {
    const expectedPath = `${process.env.HOME}/.ssh/firewalla_dashboard`;
    throw new Error(
      `SSH key not found at: ${FIREWALLA_KEY}\n` +
      `Expected path: ${expectedPath}\n` +
      `Please ensure the Firewalla SSH key exists and is readable, or set FIREWALLA_KEY environment variable.`
    );
  }

  console.log("[firewalla] ssh key:", FIREWALLA_KEY);
  return new Promise((resolve, reject) => {
    const args = [
      "-n",
      "-i",
      FIREWALLA_KEY,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=15",
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
  const policyId = String(req.query?.policyId || DEFAULT_POLICY_ID);
  
  try {
    // 1. Return cached result if fresh enough (< 3000ms old)
    if (statusCache && Date.now() - statusCacheAt < STATUS_CACHE_MS) {
      console.log("[firewalla] status: cached");
      return res.json(statusCache);
    }
    
    // 2. If a request is already in-flight, await it (single-flight lock)
    if (statusInflightPromise) {
      console.log("[firewalla] status: awaiting inflight");
      const result = await statusInflightPromise;
      return res.json(result);
    }
    
    // 3. Start new SSH request and store the promise immediately (prevents race)
    console.log("[firewalla] status: ssh start");
    statusInflightPromise = (async () => {
      const out = await sshRun(nodeStatusCmd(policyId));
      const jsonLine = out.stdout.trim().split("\n").pop();
      const parsed = JSON.parse(jsonLine);
      return parsed;
    })();
    
    // Ensure inflight is always cleared even if SSH fails
    try {
      const result = await statusInflightPromise;
      
      // Cache successful result
      statusCache = result;
      statusCacheAt = Date.now();
      
      return res.json(result);
    } finally {
      // Always clear the inflight promise, even on failure
      statusInflightPromise = null;
    }
  } catch (e) {
    // Cache error response as well
    const errorResponse = { ok: false, error: String(e.message || e) };
    statusCache = errorResponse;
    statusCacheAt = Date.now();
    
    // Ensure inflight is cleared
    statusInflightPromise = null;
    return res.status(500).json(errorResponse);
  }
}
