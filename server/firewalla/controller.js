import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { mspGetRule, mspPauseRule, mspResumeRule } from "./msp.js";
import { getCachedStatus, invalidateCache, updateCache, isInBackoff, enterBackoff } from "./statusCache.js";

const HOME = homedir();
const FIREWALLA_HOST = process.env.FIREWALLA_HOST || "192.168.122.1";
const FIREWALLA_USER = process.env.FIREWALLA_USER || "pi";
const FIREWALLA_KEY =
  process.env.FIREWALLA_KEY || `${HOME}/.ssh/firewalla_dashboard`;

// Your “Kids block” policy pid from Firewalla (you said 48):
const DEFAULT_POLICY_ID = process.env.FIREWALLA_KIDS_POLICY_ID || "48";

// Provider helpers - evaluated at request-time to avoid import-time capture issues
function getProvider() {
  return String(process.env.FIREWALLA_PROVIDER || "ssh").trim().toLowerCase();
}

function getMspRuleId() {
  return String(process.env.FIREWALLA_MSP_RULE_ID || "").trim();
}

// Global SSH mutex - ensures only one SSH command runs at a time
let sshMutex = Promise.resolve();

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
    if (getProvider() === "msp") {
      const ruleId = getMspRuleId() || policyId;
      
      try {
        const firewalla = await mspPauseRule(ruleId);
        
        // Update cache with new status after successful mutation
        updateCache({ ok: true, provider: "msp", ...firewalla });
        
        return res.json({ ok: true, provider: "msp", policyId: ruleId, firewalla });
      } catch (err) {
        // Check for 429 rate limiting
        const is429 = err.message && (
          err.message.includes("429") || 
          err.message.toLowerCase().includes("rate limit") ||
          err.message.toLowerCase().includes("too many requests")
        );
        
        if (is429) {
          // Extract Retry-After if available
          const retryAfterMatch = err.message.match(/retry[- ]after[:\s]+(\d+)/i);
          const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1]) : null;
          
          enterBackoff(retryAfterSeconds);
          
          return res.status(429).json({ 
            ok: false, 
            error: "Rate limited by Firewalla MSP. Please try again later.",
            retryAfter: retryAfterSeconds,
            backoff: true
          });
        }
        
        // Re-throw non-429 errors
        throw err;
      }
    }
    
    // SSH provider (default)
    const out = await sshRun(nodeToggleCmd(policyId, "disable"));
    
    // Parse JSON from last non-empty line
    const jsonLine = out.stdout.trim().split("\n").filter(l => l.trim()).pop();
    try {
      const firewalla = JSON.parse(jsonLine);
      
      // Update cache with new status after successful mutation
      updateCache({ ok: true, provider: "ssh", ...firewalla });
      
      res.json({ ok: true, provider: "ssh", policyId, firewalla });
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
    if (getProvider() === "msp") {
      const ruleId = getMspRuleId() || policyId;
      
      try {
        const firewalla = await mspResumeRule(ruleId);
        
        // Update cache with new status after successful mutation
        updateCache({ ok: true, provider: "msp", ...firewalla });
        
        return res.json({ ok: true, provider: "msp", policyId: ruleId, firewalla });
      } catch (err) {
        // Check for 429 rate limiting
        const is429 = err.message && (
          err.message.includes("429") || 
          err.message.toLowerCase().includes("rate limit") ||
          err.message.toLowerCase().includes("too many requests")
        );
        
        if (is429) {
          // Extract Retry-After if available
          const retryAfterMatch = err.message.match(/retry[- ]after[:\s]+(\d+)/i);
          const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1]) : null;
          
          enterBackoff(retryAfterSeconds);
          
          return res.status(429).json({ 
            ok: false, 
            error: "Rate limited by Firewalla MSP. Please try again later.",
            retryAfter: retryAfterSeconds,
            backoff: true
          });
        }
        
        // Re-throw non-429 errors
        throw err;
      }
    }
    
    // SSH provider (default)
    const out = await sshRun(nodeToggleCmd(policyId, "enable"));
    
    // Parse JSON from last non-empty line
    const jsonLine = out.stdout.trim().split("\n").filter(l => l.trim()).pop();
    try {
      const firewalla = JSON.parse(jsonLine);
      
      // Update cache with new status after successful mutation
      updateCache({ ok: true, provider: "ssh", ...firewalla });
      
      res.json({ ok: true, provider: "ssh", policyId, firewalla });
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
  
  console.log("[kidsStatus] provider=", getProvider());
  
  try {
    // Use the new caching layer with TTL, in-flight deduplication, and 429 backoff
    const result = await getCachedStatus(async () => {
      if (getProvider() === "msp") {
        const ruleId = getMspRuleId() || policyId;
        const mspResult = await mspGetRule(ruleId);
        // mspGetRule returns normalized format: { ok, pid, disabled, notes, msp }
        return { ...mspResult, provider: "msp" };
      } else {
        // SSH provider
        const out = await sshRun(nodeStatusCmd(policyId));
        const jsonLine = out.stdout.trim().split("\n").pop();
        const parsed = JSON.parse(jsonLine);
        return { ...parsed, provider: "ssh" };
      }
    });
    
    // Return 200 even if from cache/backoff - UI can check 'cached' and 'backoff' flags
    return res.json(result);
    
  } catch (e) {
    // Only reach here if fetch fails AND no cache available
    return res.status(500).json({ 
      ok: false, 
      error: String(e.message || e) 
    });
  }
}
