// src/modules/chores/helpers.js

export const CHORES_SCHEMA_VERSION = 1;

export const PEOPLE_DEFAULTS = ["Cory", "Anna", "Brady", "Harvey"];
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function defaultChoresData() {
  return {
    version: CHORES_SCHEMA_VERSION,
    people: PEOPLE_DEFAULTS,
    chores: [], // { id, day, person, name, createdAt }
    doneByWeek: {}, // { [weekKey]: { [choreId]: true } }
  };
}

export function normalizeChoresData(raw) {
  const base = defaultChoresData();
  const s = raw && typeof raw === "object" ? raw : base;

  const people = Array.isArray(s.people) ? s.people : [];
  const chores = Array.isArray(s.chores) ? s.chores : [];
  const doneByWeek = s.doneByWeek && typeof s.doneByWeek === "object" ? s.doneByWeek : {};

  const mergedPeople = Array.from(new Set([...PEOPLE_DEFAULTS, ...people])).filter(Boolean);

  return {
    ...base,
    ...s,
    people: mergedPeople,
    chores,
    doneByWeek,
  };
}

/**
 * Week key based on Monday start (YYYY-MM-DD for Monday of that week)
 */
export function getWeekKey(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday=0..Sunday=6
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function getDayName(d = new Date()) {
  const idx = (new Date(d).getDay() + 6) % 7;
  return DAYS[idx] || "Monday";
}

/**
 * selectedDate in your sharedState is a YYYY-MM-DD string.
 */
export function dateFromYMD(ymd) {
  if (!ymd || typeof ymd !== "string") return new Date();
  // Construct local date safely
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function groupChoresByDay(chores) {
  const byDay = {};
  for (const d of DAYS) byDay[d] = [];
  for (const c of chores || []) {
    if (!byDay[c.day]) byDay[c.day] = [];
    byDay[c.day].push(c);
  }
  for (const d of Object.keys(byDay)) {
    byDay[d].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  return byDay;
}

export function groupChoresByPerson(chores, people) {
  const map = {};
  for (const p of people || []) map[p] = [];
  for (const c of chores || []) {
    if (!map[c.person]) map[c.person] = [];
    map[c.person].push(c);
  }
  for (const p of Object.keys(map)) {
    map[p].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  return map;
}

export function getChoresForDate(data, date) {
  const s = normalizeChoresData(data);
  const dayName = getDayName(date);
  return s.chores.filter((c) => c.day === dayName);
}

export function getChoresForDateWithDone(data, date) {
  const s = normalizeChoresData(data);
  const wk = getWeekKey(date);
  const doneMap = s.doneByWeek?.[wk] || {};
  return getChoresForDate(s, date).map((c) => ({ ...c, done: !!doneMap[c.id] }));
}
