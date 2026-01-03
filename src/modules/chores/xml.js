// src/modules/chores/xml.js
import { normalizeChoresData, CHORES_SCHEMA_VERSION } from "./helpers.js";

const ROOT = "FamilyDashboard";
const MODULE_ID = "chores";

/**
 * Export the entire chores module state as XML (XML wrapper + JSON payload).
 * This is stable and future-proof: you can evolve the JSON schema while keeping the XML container.
 */
export function exportChoresToXml(data) {
  const normalized = normalizeChoresData(data);
  const payload = {
    moduleId: MODULE_ID,
    exportedAt: Date.now(),
    schemaVersion: CHORES_SCHEMA_VERSION,
    data: normalized,
  };

  const json = JSON.stringify(payload);

  // Minimal escaping is handled by CDATA; also split any accidental "]]>" sequences.
  const safeCdata = json.replaceAll("]]>", "]]]]><![CDATA[>");

  return `<?xml version="1.0" encoding="UTF-8"?>
<${ROOT} module="${MODULE_ID}" schemaVersion="${CHORES_SCHEMA_VERSION}">
  <exportedAt>${new Date(payload.exportedAt).toISOString()}</exportedAt>
  <json><![CDATA[${safeCdata}]]></json>
</${ROOT}>
`;
}

/**
 * Import from XML string. Returns a normalized chores data object.
 * - Validates root/module where possible
 * - Supports the JSON-in-XML format above
 */
export function importChoresFromXml(xmlText) {
  if (typeof xmlText !== "string" || !xmlText.trim()) {
    throw new Error("Empty XML.");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  // Detect parse errors
  const parseErr = doc.getElementsByTagName("parsererror")?.[0];
  if (parseErr) {
    throw new Error("Invalid XML.");
  }

  const root = doc.documentElement;
  if (!root || root.nodeName !== ROOT) {
    // allow older exports if you ever used a different root
    // but still try to locate <json>
  } else {
    const mod = root.getAttribute("module");
    if (mod && mod !== MODULE_ID) {
      throw new Error(`Wrong module in XML (found "${mod}").`);
    }
  }

  // Preferred: <json><![CDATA[ ... ]]></json>
  const jsonNode = doc.getElementsByTagName("json")?.[0];
  if (jsonNode) {
    const rawJson = (jsonNode.textContent || "").trim();
    if (!rawJson) throw new Error("XML contains an empty <json> payload.");

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("Could not parse JSON payload inside XML.");
    }

    // Expect { moduleId, schemaVersion, data }
    const importedData = parsed?.data ?? parsed;
    return normalizeChoresData(importedData);
  }

  // Fallback: if no <json>, treat the entire XML text as unsupported legacy.
  throw new Error("Unsupported XML format (missing <json> payload).");
}
