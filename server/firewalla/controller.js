import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { mspGetRule, mspPauseRule, mspResumeRule } from "./msp.js";

const HOME = homedir();
const FIREWALLA_HOST = process.env.FIREWALLA_HOST || "192.168.122.1";
const FIREWALLA_USER = process.env.FIREWALLA_USER || "pi";
const FIREWALLA_KEY =
  process.env.FIREWALLA_KEY || `${HOME}/.ssh/firewalla_dashboard`;

// Your “Kids block” policy pid from Firewalla (you said 48):
const DEFAULT_POLICY_ID = process.env.FIREWALLA_KIDS_POLICY_ID || "48";
// Provider configuration
const FIREWALLA_PROVIDER = (process.env.FIREWALLA_PROVIDER || "ssh").toLowerCase();
const MSP_RULE_ID = process.env.FIREWALLA_MSP_RULE_ID || "";
// Global SSH mutex - ensures only one SSH command runs at a time
let sshMutex = Promise.resolve();
// 3-second cache + single-flight lock for kids status
let statusCache = null;
let statusCacheAt = 0;
let statusInflightPromise = null;
const STATUS_CACHE_MS = 3000;

async function sshRun(remoteCmd) {
  // Validate SSH key exists before attempting connection
  if (!existsSync(FIREWALLA_KEY)) {
    throw new Error(
      `SSH key not found: ${FIREWALLA_KEY}\n` +
      `HOME directory: ${HOME}\n` +
      `Fix via systemd drop-in or .env`
    );
  }

  // Acquire global SSH mutex
  const prevOperation = sshMutex;
  let releaseMutex;
  sshMutex = new Promise(resolve => { releaseMutex = resolve; });

  // Wait for previous SSH operation to complete
  if (prevOperation !== Promise.resolve()) {
    console.log("[firewalla] ssh: queued");
  }
  await prevOperation.catch(() => {}); // ignore previous errors

  try {
    console.log("[firewalla] ssh key:", FIREWALLA_KEY);
    return await new Promise((resolve, reject) => {
      const args = [
        "-n",
        "-i",
        FIREWALLA_KEY,
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        "-o",
        "ControlMaster=no",
        `${FIREWALLA_USER}@${FIREWALLA_HOST}`,
        remoteCmd,
      ];

      execFile("ssh", args, { timeout: 20000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve({ stdout, stderr });
      });
    });
  } finally {
    releaseMutex();
  }
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
    
    // Use MSP or SSH provider
    if (FIREWALLA_PROVIDER === "msp") {
      const ruleId = MSP_RULE_ID || policyId;
      const firewalla = await mspPauseRule(ruleId);
      return res.json({ ok: true, policyId: ruleId, firewalla });
    }
    
    // SSH provider (default)
    const out = await sshRun(nodeToggleCmd(policyId, "disable"));
    
    // Parse JSON from last non-empty line
    const jsonLine = out.stdout.trim().split("\n").filter(l => l.trim()).pop();
    try {
      const firewalla = JSON.parse(jsonLine);
      res.json({ ok: true, policyId, firewalla });
    } catch (parseErr) {
      res.status(500).json({
        ok: false,
        error: "Bad Firewalla output",
        stdout: out.stdout.trim(),
        stderr: out.stderr.trim()
      });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

export async function resumeRule(req, res) {
  // "resume" here means BLOCK kids => enable the blocking policy
  try {
    const policyId = String(req.body?.policyId || DEFAULT_POLICY_ID);
    
    // Use MSP or SSH provider
    if (FIREWALLA_PROVIDER === "msp") {
      const ruleId = MSP_RULE_ID || policyId;
      const firewalla = await mspResumeRule(ruleId);
      return res.json({ ok: true, policyId: ruleId, firewalla });
    }
    
    // SSH provider (default)
    const out = await sshRun(nodeToggleCmd(policyId, "enable"));
    
    // Parse JSON from last non-empty line
    const jsonLine = out.stdout.trim().split("\n").filter(l => l.trim()).pop();
    try {
      const firewalla = JSON.parse(jsonLine);
      res.json({ ok: true, policyId, firewalla });
    } catch (parseErr) {
      res.status(500).json({
        ok: false,
        error: "Bad Firewalla output",
        stdout: out.stdout.trim(),
        stderr: out.stderr.trim()
      });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

export async function kidsStatus(req, res) {
  const policyId = String(req.query?.policyId || DEFAULT_POLICY_ID);
  
  try {
    // 1. Return cached result if fresh enough (< 3000ms old)
    // Only cache successful responses; errors cached separately with shorter TTL
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
    
    // 3. Start new request (MSP or SSH) and store the promise
    if (FIREWALLA_PROVIDER === "msp") {
      console.log("[firewalla] status: msp start");
      const ruleId = MSP_RULE_ID || policyId;
      statusInflightPromise = mspGetRule(ruleId);
    } else {
      console.log("[firewalla] status: ssh start");
      statusInflightPromise = (async () => {
        const out = await sshRun(nodeStatusCmd(policyId));
        const jsonLine = out.stdout.trim().split("\n").pop();
        const parsed = JSON.parse(jsonLine);
        return parsed;
      })();
    }
    
    // Ensure inflight is always cleared even if request fails
    try {
      const result = await statusInflightPromise;
      
      // Cache only successful responses (ok:true)
      if (result && result.ok === true) {
        statusCache = result;
        statusCacheAt = Date.now();
      }
      
      return res.json(result);
    } finally {
      // Always clear the inflight promise, even on failure
      statusInflightPromise = null;
    }
  } catch (e) {
    // Don't cache errors (or cache for very short time)
    const errorResponse = { ok: false, error: String(e.message || e) };
    
    // Optional: cache errors for 250ms to prevent error storms
    statusCache = errorResponse;
    statusCacheAt = Date.now() - (STATUS_CACHE_MS - 250);
    
    // Ensure inflight is cleared
    statusInflightPromise = null;
    return res.status(500).json(errorResponse);
  }
}
