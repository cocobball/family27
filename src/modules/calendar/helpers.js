// src/modules/calendar/helpers.js
// Calendar module helpers + data schema
// NOTE: Modules must never touch localStorage directly. Use ctx.store.*

export function defaultCalendarData() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return {
    version: 1,
    showChores: true,
    calendars: [
      { id: "family", name: "Family", enabled: true, archived: false },
      { id: "school", name: "School", enabled: true, archived: false },
      { id: "work", name: "Work", enabled: true, archived: false },
    ],
    events: [],
    prefs: {
      view: "month",          // "month" | "week" | "agenda"
      weekStart: 0,           // 0 = Sunday, 1 = Monday
      timeFormat: "12",       // "12" | "24"
      showWeekNumbers: false,
      defaultMonth: `${yyyy}-${mm}`, // informational (last open month)
    },
  };
}

export function uid(prefix = "ev") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// yyyy-mm-dd
export function parseDateStr(s) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function toDateStr(dt) {
  const y = dt.getFullYear();
  const m = pad2(dt.getMonth() + 1);
  const d = pad2(dt.getDate());
  return `${y}-${m}-${d}`;
}

export function addDaysStr(dateStr, deltaDays) {
  const dt = parseDateStr(dateStr);
  if (!dt) return dateStr;
  dt.setDate(dt.getDate() + deltaDays);
  return toDateStr(dt);
}

export function addMonthsStr(monthStr, deltaMonths) {
  // monthStr: yyyy-mm
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) return monthStr;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dt = new Date(y, mo, 1, 12, 0, 0, 0);
  dt.setMonth(dt.getMonth() + deltaMonths);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;
}

export function monthStrFromDate(dateStr) {
  if (!dateStr) return "";
  return dateStr.slice(0, 7);
}

export function startOfMonth(monthStr) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1, 12, 0, 0, 0);
}

export function endOfMonth(monthStr) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) return null;
  // day 0 of next month = last day of current month
  return new Date(Number(m[1]), Number(m[2]), 0, 12, 0, 0, 0);
}

export function startOfWeek(dt, weekStart = 0) {
  const d = new Date(dt);
  const dow = d.getDay(); // 0..6
  const delta = (dow - weekStart + 7) % 7;
  d.setDate(d.getDate() - delta);
  d.setHours(12, 0, 0, 0);
  return d;
}

export function endOfWeek(dt, weekStart = 0) {
  const s = startOfWeek(dt, weekStart);
  s.setDate(s.getDate() + 6);
  return s;
}

export function getMonthGrid(monthStr, weekStart = 0) {
  const s = startOfMonth(monthStr);
  const e = endOfMonth(monthStr);
  if (!s || !e) return { weeks: [], rangeStart: null, rangeEnd: null };

  const gridStart = startOfWeek(s, weekStart);
  const gridEnd = endOfWeek(e, weekStart);

  const days = [];
  let cur = new Date(gridStart);
  while (cur <= gridEnd) {
    days.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return { weeks, rangeStart: days[0], rangeEnd: days[days.length - 1] };
}

export function isSameDay(a, b) {
  return a === b;
}

export function dayLabel(dateStr) {
  const d = parseDateStr(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function monthLabel(monthStr) {
  const s = startOfMonth(monthStr);
  if (!s) return monthStr;
  return s.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function getDowLabels(weekStart = 0) {
  // Use a fixed week to produce stable labels
  const base = new Date(2024, 0, 7, 12, 0, 0, 0); // Sunday
  const labels = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + ((weekStart + i) % 7));
    labels.push(d.toLocaleDateString(undefined, { weekday: "short" }));
  }
  return labels;
}

export function timeToMinutes(t) {
  if (!t) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatTime(t, fmt = "12") {
  const mins = timeToMinutes(t);
  if (mins == null) return "";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  if (fmt === "24") return `${pad2(h24)}:${pad2(m)}`;
  const am = h24 < 12;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${pad2(m)}${am ? "a" : "p"}`;
}

export function eventEffectiveEndDate(ev) {
  if (ev?.endDate) return ev.endDate;
  // default: same-day event
  return ev?.startDate;
}

export function dateInInclusiveRange(dateStr, startDate, endDate) {
  if (!dateStr || !startDate) return false;
  const e = endDate ?? startDate;
  return dateStr >= startDate && dateStr <= e;
}

export function normalizeEvent(ev) {
  const now = new Date().toISOString();
  const out = { ...ev };
  out.id ??= uid("ev");
  out.title ??= "";
  out.calendarId ??= "family";
  out.startDate ??= todayStr();
  out.allDay ??= true;

  // Normalize times
  if (out.allDay) {
    out.startTime = null;
    out.endTime = null;
  } else {
    out.startTime ??= "09:00";
    out.endTime ??= "10:00";
  }

  out.createdAt ??= now;
  out.updatedAt ??= now;

  // Recurrence normalization
  if (out.recurrence) {
    const r = { ...out.recurrence };
    r.freq ??= "WEEKLY";
    r.interval = clamp(Number(r.interval ?? 1), 1, 30);
    if (r.byWeekday && !Array.isArray(r.byWeekday)) r.byWeekday = [];
    if (r.until && typeof r.until !== "string") r.until = null;
    out.recurrence = r;
  }

  return out;
}

export function sortEventsForDay(events, prefs) {
  const fmt = prefs?.timeFormat ?? "12";
  const items = [...events];
  items.sort((a, b) => {
    const aAll = !!a.allDay;
    const bAll = !!b.allDay;
    if (aAll !== bAll) return aAll ? -1 : 1;
    const am = timeToMinutes(a.startTime) ?? 0;
    const bm = timeToMinutes(b.startTime) ?? 0;
    if (am !== bm) return am - bm;
    return String(a.title).localeCompare(String(b.title));
  });
  return items;
}

export function buildOccurrencesByDay(events, rangeStart, rangeEnd) {
  // Returns: { [dateStr]: occurrence[] }
  // occurrence = { key, baseId, startDate, endDate, startTime, endTime, allDay, title, calendarId, location, notes, recurrence, _isOccurrence }
  const byDay = {};

  const addOcc = (occ, day) => {
    byDay[day] ??= [];
    byDay[day].push(occ);
  };

  const inRange = (d) => d >= rangeStart && d <= rangeEnd;

  for (const raw of events ?? []) {
    const ev = normalizeEvent(raw);

    const baseEnd = eventEffectiveEndDate(ev);
    const spans = ev.startDate && baseEnd && baseEnd !== ev.startDate;

    // Non-recurring: add across span inclusive
    if (!ev.recurrence) {
      if (!ev.startDate) continue;
      const start = ev.startDate;
      const end = baseEnd ?? start;
      if (end < rangeStart || start > rangeEnd) continue;

      let cur = start;
      while (cur <= end) {
        if (inRange(cur)) {
          addOcc({ ...ev, key: `${ev.id}_${cur}`, baseId: ev.id, _isOccurrence: false }, cur);
        }
        if (cur === end) break;
        cur = addDaysStr(cur, 1);
      }
      continue;
    }

    // Recurring: month-range friendly expansion.
    // We generate by scanning days in the visible range. This keeps perf stable on Pi.
    const r = ev.recurrence;
    const until = r.until && r.until.length === 10 ? r.until : null;

    const freq = String(r.freq ?? "WEEKLY").toUpperCase();
    const interval = clamp(Number(r.interval ?? 1), 1, 30);
    const byWeekday = Array.isArray(r.byWeekday) ? r.byWeekday : null; // 0..6

    // Determine event duration in days (inclusive)
    const durDays = (() => {
      const e = baseEnd ?? ev.startDate;
      if (!e || !ev.startDate) return 0;
      const a = parseDateStr(ev.startDate);
      const b = parseDateStr(e);
      if (!a || !b) return 0;
      const diff = Math.round((b - a) / (24 * 3600 * 1000));
      return clamp(diff, 0, 3650);
    })();

    const scanStart = rangeStart;
    const scanEnd = rangeEnd;

    let cur = scanStart;
    let safety = 0;
    while (cur <= scanEnd && safety++ < 500) {
      // must be on/after event start
      if (cur < ev.startDate) {
        cur = addDaysStr(cur, 1);
        continue;
      }
      if (until && cur > until) break;

      const curDt = parseDateStr(cur);
      const startDt = parseDateStr(ev.startDate);
      if (!curDt || !startDt) break;

      const isMatch = (() => {
        if (freq === "DAILY") {
          const diff = Math.round((curDt - startDt) / (24 * 3600 * 1000));
          return diff >= 0 && diff % interval === 0;
        }
        if (freq === "WEEKLY") {
          // optionally constrain by weekday list
          const dow = curDt.getDay();
          if (byWeekday && byWeekday.length && !byWeekday.includes(dow)) return false;

          const diffDays = Math.round((curDt - startDt) / (24 * 3600 * 1000));
          const diffWeeks = Math.floor(diffDays / 7);
          return diffWeeks >= 0 && diffWeeks % interval === 0;
        }
        if (freq === "MONTHLY") {
          // same day-of-month as start date
          if (curDt.getDate() !== startDt.getDate()) return false;
          const diffMonths = (curDt.getFullYear() - startDt.getFullYear()) * 12 + (curDt.getMonth() - startDt.getMonth());
          return diffMonths >= 0 && diffMonths % interval === 0;
        }
        if (freq === "YEARLY") {
          if (curDt.getDate() !== startDt.getDate()) return false;
          if (curDt.getMonth() !== startDt.getMonth()) return false;
          const diffYears = curDt.getFullYear() - startDt.getFullYear();
          return diffYears >= 0 && diffYears % interval === 0;
        }
        return false;
      })();

      if (isMatch) {
        const occEnd = durDays ? addDaysStr(cur, durDays) : cur;
        // add across span inclusive
        let spanCur = cur;
        while (spanCur <= occEnd) {
          if (inRange(spanCur)) {
            addOcc(
              { ...ev, key: `${ev.id}_${cur}`, baseId: ev.id, startDate: cur, endDate: occEnd, _isOccurrence: true },
              spanCur
            );
          }
          if (spanCur === occEnd) break;
          spanCur = addDaysStr(spanCur, 1);
        }
      }

      cur = addDaysStr(cur, 1);
    }
  }

  return byDay;
}
