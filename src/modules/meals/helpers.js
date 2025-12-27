
// Meals module helpers: data schema, migrations, parsing utilities

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SLOTS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

/**
 * Data schema v2
 * db.modules.meals = {
 *   version: 2,
 *   recipes: Array<{
 *     id, name, ingredientsText, notes, servings?, tags?: string[], createdAt, updatedAt
 *   }>,
 *   receipts: Array<{
 *     id, store, date, itemsText, notes?, total?, createdAt, updatedAt
 *   }>,
 *   planner: {
 *     weeks: {
 *       [weekKey: string]: {
 *         days: {
 *           [dayName]: {
 *             breakfast?: SlotEntry,
 *             lunch?: SlotEntry,
 *             dinner?: SlotEntry
 *           }
 *         }
 *       }
 *     }
 *   },
 *   grocery: {
 *     items: Array<{ id, text, done, createdAt, source?: string }>
 *   },
 *   settings: {
 *     weekStartsOnMonday: true,
 *     autoDedupeGrocery: true,
 *   }
 * }
 *
 * SlotEntry = { type: "recipe"|"text", id?: string, text?: string }
 */

export function defaultData() {
  return {
    version: 2,
    recipes: [],
    receipts: [],
    planner: { weeks: {} },
    grocery: { items: [] },
    settings: { weekStartsOnMonday: true, autoDedupeGrocery: true },
    ui: { lastTab: "planner", lastWeekStart: null, lastActiveDay: "Monday" },
  };
}

export function migrateData(input) {
  const d = input && typeof input === "object" ? input : {};
  // v1 placeholder -> v2
  if (!d.version || d.version < 2) {
    const next = defaultData();
    // attempt to lift any legacy fields if someone pasted earlier component
    if (Array.isArray(d.meals)) {
      next.recipes = d.meals.map((m) => ({
        id: m.id ?? crypto.randomUUID(),
        name: m.name ?? "Untitled",
        ingredientsText: m.ingredients ?? "",
        notes: m.notes ?? "",
        servings: m.servings ?? 0,
        tags: Array.isArray(m.tags) ? m.tags : [],
        createdAt: m.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }
    if (d.weeks && typeof d.weeks === "object") {
      // legacy: weeks[weekKey] = { days: { Monday: { breakfastMealId, lunchMealId, dinnerMealId } } }
      const weeks = {};
      for (const [wk, wkObj] of Object.entries(d.weeks)) {
        const days = wkObj?.days ?? {};
        const outDays = {};
        for (const [dayName, entry] of Object.entries(days)) {
          const out = {};
          if (entry?.breakfastMealId) out.breakfast = { type: "recipe", id: entry.breakfastMealId };
          if (entry?.lunchMealId) out.lunch = { type: "recipe", id: entry.lunchMealId };
          if (entry?.dinnerMealId) out.dinner = { type: "recipe", id: entry.dinnerMealId };
          // old: { type:"library", mealId:"..." } => dinner
          if (entry?.type === "library" && entry?.mealId) out.dinner = { type: "recipe", id: entry.mealId };
          if (Object.keys(out).length) outDays[dayName] = out;
        }
        weeks[wk] = { days: outDays };
      }
      next.planner.weeks = weeks;
    }
    return next;
  }

  // normalize missing branches
  return {
    ...defaultData(),
    ...d,
    planner: {
      weeks: d.planner?.weeks && typeof d.planner.weeks === "object" ? d.planner.weeks : {},
    },
    grocery: {
      items: Array.isArray(d.grocery?.items) ? d.grocery.items : [],
    },
    recipes: Array.isArray(d.recipes) ? d.recipes : [],
    receipts: Array.isArray(d.receipts) ? d.receipts : [],
    settings: {
      ...defaultData().settings,
      ...(d.settings || {}),
    },
  };
}

// --- Date helpers ---
// Week key = YYYY-MM-DD for the week start (Monday by default)
export function getWeekKey(date = new Date(), weekStartsOnMonday = true) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // Sun=0..Sat=6
  let offset;
  if (weekStartsOnMonday) {
    // Monday=0..Sunday=6
    offset = (day + 6) % 7;
  } else {
    // Sunday start
    offset = day;
  }
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function addDays(weekStartStr, dayIndex) {
  const [y, m, d] = String(weekStartStr).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + dayIndex);
  return dt;
}

export function fmtRangeLabel(weekStartStr) {
  const start = addDays(weekStartStr, 0);
  const end = addDays(weekStartStr, 6);
  const fmt = (dt) => dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function normalizeLine(line) {
  return String(line ?? "").trim().replace(/\s+/g, " ");
}

export function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
}

export function countAndDedupe(lines) {
  const map = new Map();
  for (const l of lines) {
    const key = l.toLowerCase();
    map.set(key, { text: l, count: (map.get(key)?.count || 0) + 1 });
  }
  return Array.from(map.values()).map((v) => (v.count > 1 ? `${v.text} (x${v.count})` : v.text));
}

/**
 * Very lightweight ingredient parser.
 * Accepts "2 lb chicken breast" or "1x tomatoes" etc.
 * Returns { qty, unit, item } (strings). Keep it permissive to avoid fighting users.
 */
export function parseIngredientLine(line) {
  const raw = normalizeLine(line);
  if (!raw) return { qty: "", unit: "", item: "" };

  // Split by commas to ignore trailing notes: "milk, skim"
  const main = raw.split(",")[0].trim();

  // Pattern: qty (number or fraction) + optional unit + rest
  const m = main.match(/^(\d+(?:[\/.]\d+)?(?:\s*\d+\/\d+)?)\s*(x|×)?\s*([a-zA-Z]+)?\s*(.*)$/);
  if (m) {
    const qty = (m[1] || "").trim();
    const unit = (m[3] || "").trim();
    const item = (m[4] || "").trim();
    // if we parsed qty but no item, treat whole thing as item
    if (qty && !item) return { qty: "", unit: "", item: raw };
    return { qty, unit, item: item || raw };
  }

  return { qty: "", unit: "", item: raw };
}

export function stringifyIngredient({ qty, unit, item }) {
  const q = normalizeLine(qty);
  const u = normalizeLine(unit);
  const it = normalizeLine(item);
  return [q, u, it].filter(Boolean).join(" ").trim();
}

export function safeText(t) {
  return String(t ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
}

// Export/Import payloads (JSON + XML)
export function buildExportPayload(data) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    ...data,
  };
}

export function toXML(data) {
  const payload = buildExportPayload(data);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<familyDashboardMeals version="${payload.version}" exportedAt="${safeText(payload.exportedAt)}">\n` +
    `  <recipes>\n` +
    (payload.recipes || [])
      .map(
        (r) =>
          `    <recipe id="${safeText(r.id)}">\n` +
          `      <name>${safeText(r.name)}</name>\n` +
          `      <ingredients>${safeText(r.ingredientsText || "")}</ingredients>\n` +
          `      <notes>${safeText(r.notes || "")}</notes>\n` +
          `      <servings>${safeText(r.servings ?? "")}</servings>\n` +
          `      <tags>${safeText((r.tags || []).join(","))}</tags>\n` +
          `    </recipe>`
      )
      .join("\n") +
    `\n  </recipes>\n` +
    `  <receipts>\n` +
    (payload.receipts || [])
      .map(
        (r) =>
          `    <receipt id="${safeText(r.id)}">\n` +
          `      <store>${safeText(r.store || "")}</store>\n` +
          `      <date>${safeText(r.date || "")}</date>\n` +
          `      <items>${safeText(r.itemsText || "")}</items>\n` +
          `      <notes>${safeText(r.notes || "")}</notes>\n` +
          `      <total>${safeText(r.total ?? "")}</total>\n` +
          `    </receipt>`
      )
      .join("\n") +
    `\n  </receipts>\n` +
    `  <planner>\n` +
    Object.entries(payload.planner?.weeks || {})
      .map(([wk, wkObj]) => {
        const days = wkObj?.days || {};
        const dayXml = [];
        for (const [dayName, entry] of Object.entries(days)) {
          for (const k of ["breakfast", "lunch", "dinner"]) {
            const slot = entry?.[k];
            if (!slot) continue;
            dayXml.push(
              `    <day week="${safeText(wk)}" name="${safeText(dayName)}" slot="${safeText(k)}" type="${safeText(slot.type)}" ref="${safeText(slot.id || "")}">${safeText(slot.text || "")}</day>`
            );
          }
        }
        return dayXml.join("\n");
      })
      .filter(Boolean)
      .join("\n") +
    `\n  </planner>\n` +
    `  <grocery>\n` +
    (payload.grocery?.items || [])
      .map((i) => `    <item id="${safeText(i.id)}" done="${i.done ? "1" : "0"}">${safeText(i.text || "")}</item>`)
      .join("\n") +
    `\n  </grocery>\n` +
    `  <settings weekStartsOnMonday="${payload.settings?.weekStartsOnMonday ? "1" : "0"}" autoDedupeGrocery="${payload.settings?.autoDedupeGrocery ? "1" : "0"}" />\n` +
    `</familyDashboardMeals>\n`;

  return xml;
}

export function parseXML(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(String(xmlText || ""), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("XML parse error");

  const recipes = Array.from(xml.querySelectorAll("recipe")).map((node) => ({
    id: node.getAttribute("id") || crypto.randomUUID(),
    name: node.querySelector("name")?.textContent || "Untitled",
    ingredientsText: node.querySelector("ingredients")?.textContent || "",
    notes: node.querySelector("notes")?.textContent || "",
    servings: Number(node.querySelector("servings")?.textContent || 0) || 0,
    tags: String(node.querySelector("tags")?.textContent || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const receipts = Array.from(xml.querySelectorAll("receipt")).map((node) => ({
    id: node.getAttribute("id") || crypto.randomUUID(),
    store: node.querySelector("store")?.textContent || "",
    date: node.querySelector("date")?.textContent || "",
    itemsText: node.querySelector("items")?.textContent || "",
    notes: node.querySelector("notes")?.textContent || "",
    total: node.querySelector("total")?.textContent || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const weeks = {};
  const dayNodes = Array.from(xml.querySelectorAll("planner day"));
  for (const n of dayNodes) {
    const wk = n.getAttribute("week");
    const name = n.getAttribute("name");
    const slot = (n.getAttribute("slot") || "").toLowerCase();
    const type = (n.getAttribute("type") || "text").toLowerCase();
    const ref = n.getAttribute("ref") || "";
    const text = n.textContent || "";

    if (!wk || !name || !slot) continue;
    if (!weeks[wk]) weeks[wk] = { days: {} };
    if (!weeks[wk].days[name]) weeks[wk].days[name] = {};
    weeks[wk].days[name][slot] = type === "recipe" ? { type: "recipe", id: ref } : { type: "text", text };
  }

  const groceryItems = Array.from(xml.querySelectorAll("grocery item")).map((n) => ({
    id: n.getAttribute("id") || crypto.randomUUID(),
    text: n.textContent || "",
    done: n.getAttribute("done") === "1",
    createdAt: new Date().toISOString(),
    source: "import",
  }));

  const settingsNode = xml.querySelector("settings");
  const settings = {
    weekStartsOnMonday: settingsNode?.getAttribute("weekStartsOnMonday") !== "0",
    autoDedupeGrocery: settingsNode?.getAttribute("autoDedupeGrocery") !== "0",
  };

  return migrateData({ version: 2, recipes, receipts, planner: { weeks }, grocery: { items: groceryItems }, settings });
}

export function parseImportText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Empty file");
  if (trimmed.startsWith("<")) return parseXML(trimmed);
  const obj = JSON.parse(trimmed);
  return migrateData(obj);
}
