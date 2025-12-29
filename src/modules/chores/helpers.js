// src/modules/chores/helpers.js

export const CHORES_SCHEMA_VERSION = 3;

export const PEOPLE_DEFAULTS = ["Cory", "Anna", "Brady", "Harvey"];
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function defaultChoresData() {
  return {
    version: CHORES_SCHEMA_VERSION,

    // core
    people: PEOPLE_DEFAULTS,
    chores: [], // { id, day, person, name, reward?: { minutes:number, points:number }, createdAt }

    // completion (weekly)
    doneByWeek: {}, // { [weekKey]: { [choreId]: true } }

    // reward bookkeeping (weekly; used for idempotent award + reversible debit)
    rewardGrantsByWeek: {}, // { [weekKey]: { [choreId]: { minutes?:true, points?:true, grantedAt:number } } }
    weeklyBonusGrantsByWeek: {}, // { [weekKey]: { [person]: { minutes:number, points:number, grantedAt:number } } }

    // one-off helper tasks (not weekly recurring chores)
    helperTasks: [], // { id, title, assignedTo: ["harvey","brady"], reward:{minutes,points}, expiresAt?:number|null, status:"active"|"expired"|"completed", createdAt:number, completedAt?:number|null, completedBy?:string[] }
    helperGrants: {}, // { [helperId]: { [kidId]: { minutes?:true, points?:true, grantedAt:number } } }

    // UI
    viewMode: "day", // "day" | "week"

    // settings
    settings: {
      weeklyBonusByPerson: {
        Harvey: { minutes: 0, points: 0 },
        Brady: { minutes: 0, points: 0 },
      },
    },
  };
}

export function normalizeChoresData(raw) {
  const base = defaultChoresData();
  const s = raw && typeof raw === "object" ? raw : base;

  const people = Array.isArray(s.people) ? s.people : [];
  const chores = Array.isArray(s.chores) ? s.chores : [];
  const doneByWeek = s.doneByWeek && typeof s.doneByWeek === "object" ? s.doneByWeek : {};

  const rewardGrantsByWeek =
    s.rewardGrantsByWeek && typeof s.rewardGrantsByWeek === "object" ? s.rewardGrantsByWeek : {};
  const weeklyBonusGrantsByWeek =
    s.weeklyBonusGrantsByWeek && typeof s.weeklyBonusGrantsByWeek === "object"
      ? s.weeklyBonusGrantsByWeek
      : {};

  const helperTasks = Array.isArray(s.helperTasks) ? s.helperTasks : [];
  const helperGrants = s.helperGrants && typeof s.helperGrants === "object" ? s.helperGrants : {};

  const settings = s.settings && typeof s.settings === "object" ? s.settings : {};
  const weeklyBonusByPerson =
    settings.weeklyBonusByPerson && typeof settings.weeklyBonusByPerson === "object"
      ? settings.weeklyBonusByPerson
      : {};

  const mergedPeople = Array.from(new Set([...PEOPLE_DEFAULTS, ...people])).filter(Boolean);

  return {
    ...base,
    ...s,
    people: mergedPeople,
    chores: chores.map((c) => normalizeChore(c)).filter(Boolean),
    doneByWeek,
    rewardGrantsByWeek,
    weeklyBonusGrantsByWeek,
    helperTasks: helperTasks.map((t) => normalizeHelperTask(t)).filter(Boolean),
    helperGrants,
    settings: {
      ...base.settings,
      ...settings,
      weeklyBonusByPerson: {
        ...base.settings.weeklyBonusByPerson,
        ...weeklyBonusByPerson,
      },
    },
  };
}

function normalizeChore(c) {
  if (!c || typeof c !== "object") return null;
  const reward = c.reward && typeof c.reward === "object" ? c.reward : {};
  const minutes = Number(reward.minutes || 0) || 0;
  const points = Number(reward.points || 0) || 0;

  return {
    id: String(c.id || ""),
    day: String(c.day || "Monday"),
    person: String(c.person || PEOPLE_DEFAULTS[0]),
    name: String(c.name || ""),
    createdAt: Number(c.createdAt || 0) || 0,
    reward: { minutes, points },
  };
}

function normalizeHelperTask(t) {
  if (!t || typeof t !== "object") return null;

  const reward = t.reward && typeof t.reward === "object" ? t.reward : {};
  const minutes = Number(reward.minutes || 0) || 0;
  const points = Number(reward.points || 0) || 0;

  const assignedTo = Array.isArray(t.assignedTo) ? t.assignedTo.map(String) : [];
  const status = t.status === "completed" || t.status === "expired" ? t.status : "active";

  const expiresAt = t.expiresAt === null || t.expiresAt === undefined ? null : Number(t.expiresAt) || null;

  const completedBy = Array.isArray(t.completedBy) ? t.completedBy.map(String) : [];

  return {
    id: String(t.id || ""),
    title: String(t.title || ""),
    assignedTo: assignedTo.filter((x) => x === "harvey" || x === "brady"),
    reward: { minutes, points },
    expiresAt,
    status,
    createdAt: Number(t.createdAt || 0) || 0,
    completedAt: t.completedAt ? Number(t.completedAt) || null : null,
    completedBy,
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

export function dateFromYMD(ymd) {
  if (!ymd || typeof ymd !== "string") return new Date();
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function groupChoresByDay(chores) {
  const byDay = {};
  for (const d of DAYS) byDay[d] = [];
  for (const c of chores || []) {
    if (!c) continue;
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
    if (!c) continue;
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
  return (s.chores || []).filter((c) => c && c.day === dayName);
}

export function getChoresForDateWithDone(data, date) {
  const s = normalizeChoresData(data);
  const wk = getWeekKey(date);
  const doneMap = s.doneByWeek?.[wk] || {};
  return getChoresForDate(s, date).map((c) => ({ ...c, done: !!doneMap[c.id] }));
}

export function isHelperExpired(task, nowMs = Date.now()) {
  if (!task) return false;
  if (task.status === "completed") return false;
  if (task.expiresAt && nowMs > task.expiresAt) return true;
  return task.status === "expired";
}
