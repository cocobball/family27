// CollapsibleSection: reusable panel section with persistent collapsed state
function CollapsibleSection({ ctx, sectionKey, title, rightSlot, children, defaultCollapsed = false }) {
  // Get and persist collapsed state in ctx.store.ui.collapsedSections
  const [rev, setRev] = useState(0);
  const collapsedSections = ctx?.store?.get?.()?.ui?.collapsedSections || {};
  const collapsed = collapsedSections[sectionKey] ?? defaultCollapsed;
  const setCollapsed = (val) => {
    const cur = ctx?.store?.get?.() || {};
    const ui = { ...(cur.ui || {}), collapsedSections: { ...(cur.ui?.collapsedSections || {}), [sectionKey]: val } };
    ctx?.store?.set?.({ ...cur, ui });
    setRev((r) => r + 1);
  };

  // Animate height/opacity
  const [show, setShow] = useState(!collapsed);
  useEffect(() => setShow(!collapsed), [collapsed]);
  return (
    <div className="rounded-xl border border-white/15 bg-white/5">
      <div className="flex items-center justify-between px-3 py-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <div className="font-medium text-sm flex-1 truncate">{title}</div>
        {rightSlot}
        <button
          className="iconBtn !w-8 !h-8 !rounded-lg ml-2"
          tabIndex={-1}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={e => { e.stopPropagation(); setCollapsed(!collapsed); }}
          type="button"
        >
          <ChevronRight size={18} className={"transition-transform duration-200 " + (collapsed ? "rotate-0" : "rotate-90")} />
        </button>
      </div>
      <div
        className="transition-all duration-300 ease-in-out overflow-hidden"
        style={{
          maxHeight: show ? 500 : 0,
          opacity: show ? 1 : 0,
          pointerEvents: show ? 'auto' : 'none',
        }}
      >
        <div className="px-3 pb-2 pt-1">{children}</div>
      </div>
    </div>
  );
}
// src/modules/calendar/module.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  List,
  Rows3,
  Repeat,
  Trash2,
  Check,
  X,
} from "lucide-react";

import {
  addDaysStr,
  addMonthsStr,
  buildOccurrencesByDay,
  dayLabel,
  defaultCalendarData,
  formatTime,
  getDowLabels,
  getMonthGrid,
  monthLabel,
  monthStrFromDate,
  normalizeEvent,
  sortEventsForDay,
  todayStr,
  uid,
} from "./helpers.js";

// Local lightweight chores helpers to avoid importing the chores module and
// keep the integration optional (read from ctx.sharedState when available).
const CHORES_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dateFromYMDLocal(ymd) {
  if (!ymd || typeof ymd !== "string") return new Date();
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function getWeekKeyLocal(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday=0..Sunday=6
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getChoresForDateWithDoneLocal(choresData, dateOrStr) {
  if (!choresData) return [];
  const dateObj = typeof dateOrStr === "string" ? dateFromYMDLocal(dateOrStr) : new Date(dateOrStr);
  const wk = getWeekKeyLocal(dateObj);
  const doneMap = choresData.doneByWeek?.[wk] || {};
  const dayName = CHORES_DAYS[(dateObj.getDay() + 6) % 7] || "Monday";
  return (choresData.chores || [])
    .filter((c) => c.day === dayName)
    .map((c) => ({ ...c, done: !!doneMap[c.id] }));
}

// XML helpers (module-local)
function escapeXml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeDownloadText(filename, text) {
  const blob = new Blob([text], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function xmlText(node, tag) {
  const el = node.getElementsByTagName(tag)[0];
  if (!el) return null;
  return el.textContent == null ? null : el.textContent.trim();
}

function parseBool(str, fallback = false) {
  if (str == null) return fallback;
  const s = String(str).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return fallback;
}

function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);

  // IMPORTANT: call defaultFn() to pass a value to ctx.store.get
  const data = useMemo(() => ctx.store.get(defaultFn()), [ctx, defaultFn, rev]);

  // IMPORTANT: don't rely on ctx.store.patch (may not exist / may not merge the way we expect)
  // Use a safe merge and then ctx.store.set(next)
  const patch = useCallback(
    (partial) => {
      const cur = ctx.store.get(defaultFn());
      const next = { ...(cur || {}), ...(partial || {}) };
      ctx.store.set(next);
      setRev((r) => r + 1);
      return next;
    },
    [ctx, defaultFn]
  );

  const set = useCallback(
    (val) => {
      ctx.store.set(val);
      setRev((r) => r + 1);
    },
    [ctx]
  );

  const refresh = useCallback(() => setRev((r) => r + 1), []);

  return { data, patch, set, refresh };
}

function useContainerWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function IconPill({ active, onClick, icon: Icon, label }) {
  return (
    <button
      className={"btn !px-3 !py-2 inline-flex items-center gap-2 " + (active ? "btnPrimary" : "")}
      onClick={onClick}
      aria-pressed={active}
      type="button"
    >
      <Icon size={16} />
      <span className="text-sm">{label}</span>
    </button>
  );
}

function EventChip({ occ, prefs, onClick }) {
  const time = occ.allDay ? "All day" : formatTime(occ.startTime, prefs.timeFormat);
  return (
    <button
      className="w-full text-left rounded-xl px-2 py-1 active:translate-y-[1px]"
      style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}
      onClick={onClick}
      title={occ.title}
      type="button"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="text-[10px] opacity-70 shrink-0">{time}</div>
        <div className="text-xs font-medium truncate">{occ.title || "(Untitled)"}</div>
        {occ.important && <div className="text-yellow-300 text-sm ml-1">⭐</div>}
      </div>
    </button>
  );
}

function DayCell({ dateStr, inMonth, isToday, isSelected, occs, prefs, onSelect, onQuickAdd }) {
  return (
    <div
      className={
        "relative rounded-2xl border p-2 flex flex-col gap-1 overflow-hidden" +
        (inMonth ? "" : " opacity-60")
      }
      style={{ borderColor: "var(--cal-border)", background: isSelected ? "var(--cal-panel2)" : "var(--cal-panel)" }}
      onClick={() => onSelect(dateStr)}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={
            "text-xs font-semibold " +
            (isToday ? "text-[color-mix(in srgb, var(--accent) 70%, white)]" : "")
          }
        >
          {Number(dateStr.slice(8, 10))}
        </div>
        <button
          className="iconBtn !w-8 !h-8 !rounded-xl"
          onClick={(e) => {
            e.stopPropagation();
            onQuickAdd(dateStr);
          }}
          aria-label="Add event"
          type="button"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-1">
        {occs && occs.length ? (
          <>
            {occs.slice(0, 2).map((occ) => (
              <div key={occ.key} className="min-w-0">
                <div className="text-[10px] opacity-70 truncate">
                  {occ.allDay ? "All day" : formatTime(occ.startTime, prefs.timeFormat)}
                </div>
                <div className="text-xs truncate">{occ.title || "(Untitled)"}</div>
              </div>
            ))}
            {occs.length > 2 && <div className="text-[10px] opacity-70">+{occs.length - 2} more</div>}
          </>
        ) : (
          <div className="text-[10px] opacity-50">—</div>
        )}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, children, footer }) {
  return (
    <div className="absolute inset-0 z-20 p-3" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="h-full w-full glass rounded-[1.75rem] overflow-hidden flex flex-col">
        <div className="h-14 px-4 flex items-center justify-between border-b hairline">
          <div className="font-semibold">{title}</div>
          <button className="iconBtn" onClick={onClose} aria-label="Close" type="button">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="border-t hairline p-4">{footer}</div>}
      </div>
    </div>
  );
}

function EventEditor({ prefs, calendars, initial, isEdit, onCancel, onSave, onDelete }) {
  const [ev, setEv] = useState(() => normalizeEvent(initial));
  const [repeat, setRepeat] = useState(() => {
    const r = ev.recurrence;
    if (!r) return "none";
    return String(r.freq ?? "WEEKLY").toLowerCase();
  });

  useEffect(() => setEv(normalizeEvent(initial)), [initial]);

  const calOptions = calendars.filter((c) => !c.archived);
  const canSave = (ev.title ?? "").trim().length > 0 && !!ev.startDate;

  const setField = (k, v) => setEv((s) => ({ ...s, [k]: v }));

  const toggleDow = (dow) => {
    setEv((s) => {
      const r = s.recurrence ?? { freq: "WEEKLY", interval: 1, byWeekday: [] };
      const list = Array.isArray(r.byWeekday) ? [...r.byWeekday] : [];
      const idx = list.indexOf(dow);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(dow);
      list.sort((a, b) => a - b);
      return { ...s, recurrence: { ...r, byWeekday: list } };
    });
  };

  const applyRepeat = (mode) => {
    setRepeat(mode);
    if (mode === "none") {
      setEv((s) => ({ ...s, recurrence: null }));
      return;
    }
    const freq = mode.toUpperCase();
    setEv((s) => {
      const base = s.recurrence ?? {};
      const next = { ...base, freq, interval: Number(base.interval ?? 1) };
      if (freq === "WEEKLY") {
        const dow = new Date(s.startDate + "T12:00:00").getDay();
        next.byWeekday = Array.isArray(base.byWeekday) && base.byWeekday.length ? base.byWeekday : [dow];
      } else {
        delete next.byWeekday;
      }
      return { ...s, recurrence: next };
    });
  };

  const footer = (
    <div className="flex items-center justify-between gap-2">
      {isEdit ? (
        <button className="btn" onClick={() => onDelete(ev)} title="Delete" type="button">
          <Trash2 size={16} /> Delete
        </button>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-2">
        <button className="btn" onClick={onCancel} type="button">
          <X size={16} /> Cancel
        </button>
        <button
          className={"btn " + (canSave ? "btnPrimary" : "opacity-50 pointer-events-none")}
          onClick={() => onSave(normalizeEvent({ ...ev, updatedAt: new Date().toISOString() }))}
          type="button"
        >
          <Check size={16} /> {isEdit ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );

  return (
    <ModalShell title={isEdit ? "Edit event" : "Add event"} onClose={onCancel} footer={footer}>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="text-xs opacity-70">Title</div>
          <input
            className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
            value={ev.title ?? ""}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="Soccer practice"
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm opacity-80 select-none">
            <input type="checkbox" checked={!!ev.important} onChange={() => setField("important", !ev.important)} />
            Important
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Calendar</div>
            <select
              className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
              value={ev.calendarId ?? "family"}
              onChange={(e) => setField("calendarId", e.target.value)}
            >
              {calOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">All day</div>
            <button
              className={"btn w-full justify-center " + (ev.allDay ? "btnPrimary" : "")}
              onClick={() => setField("allDay", !ev.allDay)}
              type="button"
            >
              <CalendarDays size={16} /> {ev.allDay ? "All day" : "Timed"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Start</div>
            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                value={ev.startDate ?? ""}
                onChange={(e) => setField("startDate", e.target.value)}
              />
              {!ev.allDay && (
                <input
                  type="time"
                  className="w-32 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                  value={ev.startTime ?? "09:00"}
                  onChange={(e) => setField("startTime", e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">End</div>
            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                value={ev.endDate ?? ev.startDate ?? ""}
                onChange={(e) => setField("endDate", e.target.value)}
              />
              {!ev.allDay && (
                <input
                  type="time"
                  className="w-32 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                  value={ev.endTime ?? "10:00"}
                  onChange={(e) => setField("endTime", e.target.value)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs opacity-70 flex items-center gap-2">
            <Repeat size={14} /> Repeat
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["none", "None"],
              ["daily", "Daily"],
              ["weekly", "Weekly"],
              ["monthly", "Monthly"],
              ["yearly", "Yearly"],
            ].map(([k, label]) => (
              <button
                key={k}
                className={"btn !px-3 !py-2 " + (repeat === k ? "btnPrimary" : "")}
                onClick={() => applyRepeat(k)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {repeat !== "none" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="text-xs opacity-70">Every</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="w-24 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                    value={Number(ev.recurrence?.interval ?? 1)}
                    onChange={(e) =>
                      setEv((s) => ({
                        ...s,
                        recurrence: { ...(s.recurrence ?? {}), interval: Number(e.target.value || 1) },
                      }))
                    }
                  />
                  <div className="text-sm opacity-80">
                    {repeat === "daily"
                      ? "day(s)"
                      : repeat === "weekly"
                      ? "week(s)"
                      : repeat === "monthly"
                      ? "month(s)"
                      : "year(s)"}
                  </div>
                </div>
              </div>

              {repeat === "weekly" && (
                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs opacity-70">On</div>
                  <div className="flex flex-wrap gap-2">
                    {["S", "M", "T", "W", "T", "F", "S"].map((lab, i) => {
                      const d = i;
                      const active = (ev.recurrence?.byWeekday ?? []).includes(d);
                      return (
                        <button
                          key={i}
                          className={"btn !px-3 !py-2 " + (active ? "btnPrimary" : "")}
                          onClick={() => toggleDow(d)}
                          type="button"
                        >
                          {lab}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <div className="text-xs opacity-70">Until</div>
                <input
                  type="date"
                  className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                  value={ev.recurrence?.until ?? ""}
                  onChange={(e) =>
                    setEv((s) => ({
                      ...s,
                      recurrence: { ...(s.recurrence ?? {}), until: e.target.value || null },
                    }))
                  }
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-xs opacity-70">Location</div>
          <input
            className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
            value={ev.location ?? ""}
            onChange={(e) => setField("location", e.target.value)}
            placeholder="Gym / School / Home"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs opacity-70">Notes</div>
          <textarea
            className="w-full min-h-24 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
            value={ev.notes ?? ""}
            onChange={(e) => setField("notes", e.target.value)}
            placeholder="Bring cleats. Carpool with ..."
          />
        </div>
      </div>
    </ModalShell>
  );
}

export default function CalendarModule({ ctx }) {
  const rootRef = useRef(null);
  const width = useContainerWidth(rootRef);
  const isWide = width >= 720;

  const { data, patch } = useModuleData(ctx, defaultCalendarData);

  const prefs = data.prefs ?? defaultCalendarData().prefs;
  const calendars = data.calendars ?? defaultCalendarData().calendars;
  const events = data.events ?? [];

  // IMPORTANT: selected date must have a safe default
  const shared = ctx.sharedState.get?.() || {};
  const initialSelected = shared.selectedDate || todayStr();

  const [sel, setSel] = useState(initialSelected);
  const [choresForSelectedDate, setChoresForSelectedDate] = useState(shared.choresForSelectedDate || []);
  const [month, setMonth] = useState(() => monthStrFromDate(initialSelected) || todayStr().slice(0, 7));

  // UI settings stored IN module data (so we never overwrite the store)
  const showChores = data.ui?.showChores ?? true;
  const showImportant = data.ui?.showImportant ?? true;
  const showMeals = data.ui?.showMeals ?? false;
  const choresView = data.ui?.choresView ?? "day"; // "day" | "week" | "month"
  const palette = data.ui?.calendarPalette ?? "default";

  // Editor modal state
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    const unsub = ctx.sharedState.subscribe((s) => {
      const nextSel = s.selectedDate || todayStr();
      setSel(nextSel);
      setChoresForSelectedDate(s.choresForSelectedDate || []);

      const m = monthStrFromDate(nextSel);
      if (m) setMonth((cur) => (cur === m ? cur : m));
    });
    return unsub;
  }, [ctx]);

  // Persist last open month in prefs
  useEffect(() => {
    if (prefs.defaultMonth !== month) {
      patch({ prefs: { ...prefs, defaultMonth: month } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const { weeks, rangeStart, rangeEnd } = useMemo(() => getMonthGrid(month, prefs.weekStart ?? 0), [month, prefs.weekStart]);

  const occurrencesByDay = useMemo(
    () => (rangeStart && rangeEnd ? buildOccurrencesByDay(events, rangeStart, rangeEnd) : {}),
    [events, rangeStart, rangeEnd]
  );

  const enabledCalIds = useMemo(() => {
    const ids = new Set();
    for (const c of calendars) if (c.enabled && !c.archived) ids.add(c.id);
    return ids;
  }, [calendars]);

  const filteredOccurrencesByDay = useMemo(() => {
    if (!enabledCalIds.size) return {};
    const out = {};
    for (const [day, list] of Object.entries(occurrencesByDay)) {
      const keep = list.filter((o) => enabledCalIds.has(o.calendarId ?? "family"));
      if (keep.length) out[day] = keep;
    }
    return out;
  }, [occurrencesByDay, enabledCalIds]);

  const filteredSelectedOccs = useMemo(() => {
    const list = filteredOccurrencesByDay[sel] ?? [];
    return sortEventsForDay(list, prefs);
  }, [filteredOccurrencesByDay, sel, prefs]);

  const onSelectDate = useCallback(
    (dateStr) => {
      setSel(dateStr);
      ctx.sharedState.set({ selectedDate: dateStr });
      ctx.eventBus.emit("selectedDate:changed", dateStr);

      const m = monthStrFromDate(dateStr);
      if (m) setMonth((cur) => (cur === m ? cur : m));
    },
    [ctx]
  );

  const onGoToday = useCallback(() => onSelectDate(todayStr()), [onSelectDate]);
  const onPrevMonth = useCallback(() => setMonth((m) => addMonthsStr(m, -1)), []);
  const onNextMonth = useCallback(() => setMonth((m) => addMonthsStr(m, 1)), []);

  const setView = useCallback((view) => patch({ prefs: { ...prefs, view } }), [patch, prefs]);

  const openAdd = useCallback(
    (dateStr) => {
      const next = normalizeEvent({
        id: uid("ev"),
        title: "",
        calendarId: calendars.find((c) => c.enabled && !c.archived)?.id ?? "family",
        startDate: dateStr ?? sel ?? todayStr(),
        endDate: dateStr ?? sel ?? todayStr(),
        allDay: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recurrence: null,
      });
      setEditor({ mode: "add", initialEvent: next });
    },
    [calendars, sel]
  );

  const openEdit = useCallback(
    (occ) => {
      const base = events.find((e) => e.id === (occ.baseId ?? occ.id)) ?? occ;
      setEditor({ mode: "edit", baseId: base.id, initialEvent: base });
    },
    [events]
  );

  const saveEvent = useCallback(
    (ev) => {
      const next = normalizeEvent(ev);
      patch({
        events: (() => {
          const list = [...events];
          const idx = list.findIndex((e) => e.id === next.id);
          if (idx >= 0) list[idx] = next;
          else list.push(next);
          return list;
        })(),
      });
      setEditor(null);
    },
    [events, patch]
  );

  const deleteEvent = useCallback(
    (ev) => {
      patch({ events: events.filter((e) => e.id !== ev.id) });
      setEditor(null);
    },
    [events, patch]
  );



  const dayHeader = useMemo(() => dayLabel(sel), [sel]);
  const dowLabels = useMemo(() => getDowLabels(prefs.weekStart ?? 0), [prefs.weekStart]);
  const view = prefs.view ?? "month";

  const themeVars = useMemo(() => {
    const themes = {
      default: {
        '--cal-panel': 'rgba(255, 255, 255, 0.05)',
        '--cal-panel2': 'rgba(255, 255, 255, 0.08)',
        '--cal-border': 'rgba(255, 255, 255, 0.15)',
        '--cal-text': 'inherit',
        '--cal-muted': 'rgba(255, 255, 255, 0.7)',
      },
      light: {
        '--cal-panel': 'rgba(255, 255, 255, 0.85)',
        '--cal-panel2': 'rgba(255, 255, 255, 0.95)',
        '--cal-border': 'rgba(0, 0, 0, 0.12)',
        '--cal-text': 'rgba(0, 0, 0, 0.87)',
        '--cal-muted': 'rgba(0, 0, 0, 0.6)',
      },
      frost: {
        '--cal-panel': 'rgba(200, 220, 255, 0.12)',
        '--cal-panel2': 'rgba(200, 220, 255, 0.18)',
        '--cal-border': 'rgba(200, 220, 255, 0.25)',
        '--cal-text': 'rgba(220, 240, 255, 0.95)',
        '--cal-muted': 'rgba(200, 220, 255, 0.7)',
      },
      midnight: {
        '--cal-panel': 'rgba(0, 0, 0, 0.4)',
        '--cal-panel2': 'rgba(0, 0, 0, 0.5)',
        '--cal-border': 'rgba(100, 100, 150, 0.3)',
        '--cal-text': 'rgba(200, 200, 220, 0.95)',
        '--cal-muted': 'rgba(150, 150, 170, 0.7)',
      },
      contrast: {
        '--cal-panel': 'rgba(0, 0, 0, 0.9)',
        '--cal-panel2': 'rgba(255, 255, 255, 0.95)',
        '--cal-border': 'rgba(255, 255, 0, 0.5)',
        '--cal-text': 'rgba(255, 255, 255, 1)',
        '--cal-muted': 'rgba(255, 255, 100, 0.85)',
      },
    };
    return themes[palette] || themes.default;
  }, [palette]);



  const main = (
    <div className={"flex-1 overflow-hidden flex " + (isWide ? "flex-row gap-3" : "flex-col gap-3")}>
      <div className="flex-1 overflow-hidden glass rounded-2xl p-3 flex flex-col" style={{ background: "var(--cal-panel2)", border: "1px solid var(--cal-border)" }}>
        {/* Month header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays size={18} className="opacity-80 shrink-0" />
            <div className="font-semibold truncate">{monthLabel(month)}</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="iconBtn" onClick={onPrevMonth} aria-label="Previous month" type="button">
              <ChevronLeft size={18} />
            </button>
            <button className="btn" onClick={onGoToday} type="button">
              Today
            </button>
            <button className="iconBtn" onClick={onNextMonth} aria-label="Next month" type="button">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* View toggle */}
        <div className="pt-3 flex flex-wrap gap-2">
          <IconPill active={view === "month"} onClick={() => setView("month")} icon={Rows3} label="Month" />
          <IconPill active={view === "week"} onClick={() => setView("week")} icon={CalendarDays} label="Week" />
          <IconPill active={view === "agenda"} onClick={() => setView("agenda")} icon={List} label="Agenda" />
          <button className="btn !px-3 !py-2 inline-flex items-center gap-2" onClick={() => openAdd(sel)} type="button">
            <Plus size={16} /> Add
          </button>
        </div>

        <div className="pt-3 border-t hairline" />

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {view === "month" && (
            <div className="space-y-2">
              <div className="grid grid-cols-7 gap-2">
                {dowLabels.map((d) => (
                  <div key={d} className="text-[11px] opacity-70 px-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {weeks.flat().map((d) => (
                  <DayCell
                    key={d}
                    dateStr={d}
                    inMonth={monthStrFromDate(d) === month}
                    isToday={d === todayStr()}
                    isSelected={d === sel}
                    occs={filteredOccurrencesByDay[d] ?? []}
                    prefs={prefs}
                    onSelect={onSelectDate}
                    onQuickAdd={openAdd}
                  />
                ))}
              </div>
            </div>
          )}

          {view === "week" && (
            <WeekList
              weekStartDate={(() => {
                const dt = new Date(sel + "T12:00:00");
                const ws = prefs.weekStart ?? 0;
                const dow = dt.getDay();
                const delta = (dow - ws + 7) % 7;
                dt.setDate(dt.getDate() - delta);
                return dt.toISOString().slice(0, 10);
              })()}
              prefs={prefs}
              occurrencesByDay={filteredOccurrencesByDay}
              selectedDate={sel}
              onSelect={onSelectDate}
              onAdd={openAdd}
              onEdit={openEdit}
            />
          )}

          {view === "agenda" && (
            <AgendaRange
              startDate={rangeStart}
              endDate={rangeEnd}
              prefs={prefs}
              occurrencesByDay={filteredOccurrencesByDay}
              selectedDate={sel}
              onSelect={onSelectDate}
              onAdd={openAdd}
              onEdit={openEdit}
            />
          )}
        </div>
      </div>

      {/* Day agenda pane */}
      <div className={(isWide ? "w-[360px]" : "") + " glass rounded-2xl p-3 flex flex-col overflow-hidden"} style={{ background: "var(--cal-panel2)", border: "1px solid var(--cal-border)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs opacity-70">Selected day</div>
            <div className="font-semibold truncate">{dayHeader}</div>
          </div>
          <button className="btn !px-3 !py-2 inline-flex items-center gap-2" onClick={() => openAdd(sel)} type="button">
            <Plus size={16} /> Add
          </button>
        </div>

        <div className="pt-3 border-t hairline" />

        <div className="mt-3">
          {/* Important this month */}
          {showImportant && (() => {
            const items = [];
            for (const [day, list] of Object.entries(filteredOccurrencesByDay)) {
              if (monthStrFromDate(day) !== month) continue;
              for (const o of list) if (o.important) items.push({ day, occ: o });
            }
            items.sort((a, b) =>
              a.day === b.day
                ? (a.occ.startTime || "").localeCompare(b.occ.startTime || "")
                : a.day.localeCompare(b.day)
            );
            if (!items.length) return null;
            return (
              <CollapsibleSection ctx={ctx} sectionKey="important" title="Important dates">
                <div className="space-y-2">
                  {items.map(({ day, occ }) => (
                    <div key={occ.key} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}>
                      <div className="text-xs opacity-70">{dayLabel(day)}</div>
                      <div className="font-medium">{occ.title}</div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            );
          })()}

          {/* Chores and Meals area (day view) */}
          {choresView === "day" && (showChores || showMeals) && (() => {
            // Get meals data directly from localStorage (not sharedState)
            let mealsData = null;
            try {
              const raw = localStorage.getItem("family_dashboard_db_v1");
              if (raw) {
                const db = JSON.parse(raw);
                mealsData = db?.modules?.meals || null;
              }
            } catch {}
            // Chores
            const chores = showChores ? choresForSelectedDate : [];
            // Meals
            let meals = [];
            if (showMeals && mealsData && mealsData.planner && mealsData.planner.weeks) {
              // Find the week key and day name
              const weekStartsOnMonday = mealsData.settings?.weekStartsOnMonday ?? true;
              const getWeekKey = (dateStr) => {
                const d = new Date(dateStr + "T12:00:00");
                d.setHours(0, 0, 0, 0);
                let day = d.getDay();
                if (weekStartsOnMonday) {
                  day = (day + 6) % 7;
                }
                d.setDate(d.getDate() - day);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                return `${y}-${m}-${dd}`;
              };
              const weekKey = getWeekKey(sel);
              const dayName = (() => {
                const d = new Date(sel + "T12:00:00");
                return ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][(d.getDay() + 6) % 7];
              })();
              const dayObj = mealsData.planner.weeks?.[weekKey]?.days?.[dayName] || {};
              // SLOTS: breakfast, lunch, dinner
              const slotLabels = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
              meals = Object.entries(slotLabels)
                .map(([slot, label]) => {
                  const entry = dayObj[slot];
                  if (!entry) return null;
                  if (entry.type === "recipe" && entry.id && Array.isArray(mealsData.recipes)) {
                    const recipe = mealsData.recipes.find((r) => r.id === entry.id);
                    return recipe ? { name: recipe.name, notes: recipe.notes, slot: label } : null;
                  }
                  if (entry.type === "text" && entry.text) {
                    return { name: entry.text, slot: label };
                  }
                  return null;
                })
                .filter(Boolean);
            }
            if (!chores.length && !meals.length) return null;
            return (
              <div className="mt-4 space-y-2">
                {chores.length > 0 && (
                  <CollapsibleSection ctx={ctx} sectionKey="chores" title="Chores">
                    <div className="space-y-2">
                      {chores.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-xl px-3 py-2 text-sm flex items-center justify-between"
                          style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}
                        >
                          <div className={c.done ? "line-through opacity-70" : ""}>
                            <span className="opacity-80">{c.person}:</span> {c.name}
                          </div>
                          <div className="text-xs opacity-70">{c.done ? "done" : ""}</div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleSection>
                )}
                {meals.length > 0 && (
                  <CollapsibleSection ctx={ctx} sectionKey="meals" title="Meals">
                    <div className="space-y-2">
                      {meals.map((m, i) => (
                        <div key={i} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}>
                          <div className="font-medium">{m.slot ? `${m.slot}: ` : ""}{m.name || "(Meal)"}</div>
                          {m.notes && <div className="text-xs opacity-60">{m.notes}</div>}
                        </div>
                      ))}
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            );
          })()}

          {/* Chores area (week/month view) */}
          {choresView !== "day" && showChores && (() => {
            const sharedNow = ctx.sharedState.get?.() || {};
            const choresData = sharedNow.choresData || null;
            // week or month: build grouped list
            const days = [];
            if (choresView === "week") {
              // compute week start from sel and prefs.weekStart
              const dt = new Date(sel + "T12:00:00");
              const ws = prefs.weekStart ?? 0;
              const dow = dt.getDay();
              const delta = (dow - ws + 7) % 7;
              dt.setDate(dt.getDate() - delta);
              for (let i = 0; i < 7; i++) days.push(addDaysStr(dt.toISOString().slice(0, 10), i));
            } else {
              // month: use rangeStart..rangeEnd
              if (rangeStart && rangeEnd) {
                let cur = rangeStart;
                while (cur <= rangeEnd) {
                  days.push(cur);
                  cur = addDaysStr(cur, 1);
                }
              }
            }

            const grouped = {};
            for (const d of days) {
              const list = choresData ? getChoresForDateWithDoneLocal(choresData, d) : [];
              if (list && list.length) grouped[d] = list;
            }

            const keys = Object.keys(grouped);
            if (!keys.length) return null;

            return (
              <div className="mt-4 space-y-2">
                <div className="text-sm opacity-80">Chores</div>
                <div className="space-y-2">
                  {keys.map((d) => (
                    <div key={d} className="space-y-1">
                      <div className="text-xs opacity-70">{dayLabel(d)}</div>
                      <div className="space-y-1">
                        {grouped[d].map((c) => (
                          <div
                            key={c.id}
                            className="rounded-xl px-3 py-2 text-sm flex items-center justify-between"
                            style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}
                          >
                            <div className={c.done ? "line-through opacity-70" : ""}>
                              <span className="opacity-80">{c.person}:</span> {c.name}
                            </div>
                            <div className="text-xs opacity-70">{c.done ? "done" : ""}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Meals area (week/month view) */}
          {choresView !== "day" && showMeals && (() => {
            const sharedNow = ctx.sharedState.get?.() || {};
            const mealsData = sharedNow.mealsData || null;
            if (!mealsData) return null;
            const days = [];
            if (choresView === "week") {
              const dt = new Date(sel + "T12:00:00");
              const ws = prefs.weekStart ?? 0;
              const dow = dt.getDay();
              const delta = (dow - ws + 7) % 7;
              dt.setDate(dt.getDate() - delta);
              for (let i = 0; i < 7; i++) days.push(addDaysStr(dt.toISOString().slice(0, 10), i));
            } else {
              if (rangeStart && rangeEnd) {
                let cur = rangeStart;
                while (cur <= rangeEnd) {
                  days.push(cur);
                  cur = addDaysStr(cur, 1);
                }
              }
            }
            // Helper to get meals for a date string
            function getMealsForDate(dateStr) {
              if (!mealsData.days) return [];
              const day = mealsData.days.find((d) => d.date === dateStr);
              if (!day || !Array.isArray(day.meals)) return [];
              return day.meals;
            }
            const grouped = {};
            for (const d of days) {
              const meals = getMealsForDate(d);
              if (meals && meals.length) grouped[d] = meals;
            }
            const keys = Object.keys(grouped);
            if (!keys.length) return null;
            return (
              <div className="mt-4 space-y-2">
                <div className="text-sm opacity-80">Meals</div>
                <div className="space-y-2">
                  {keys.map((d) => (
                    <div key={d} className="space-y-1">
                      <div className="text-xs opacity-70">{dayLabel(d)}</div>
                      <div className="space-y-1">
                        {grouped[d].map((m, i) => (
                          <div key={i} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}>
                            <div className="font-medium">{m.name || "(Meal)"}</div>
                            {m.time && <div className="text-xs opacity-70">{m.time}</div>}
                            {m.notes && <div className="text-xs opacity-60">{m.notes}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Meals area */}
          {showMeals && (() => {
            const sharedNow = ctx.sharedState.get?.() || {};
            const mealsData = sharedNow.mealsData || null;
            if (!mealsData) return null;

            // Helper to get meals for a date string
            function getMealsForDate(dateStr) {
              if (!mealsData.days) return [];
              const day = mealsData.days.find((d) => d.date === dateStr);
              if (!day || !Array.isArray(day.meals)) return [];
              return day.meals;
            }

            // For day view, show meals for selected day
            if (choresView === "day") {
              const meals = getMealsForDate(sel);
              return meals.length ? (
                <div className="mt-4 space-y-2">
                  <div className="text-sm opacity-80">Meals</div>
                  <div className="space-y-2">
                    {meals.map((m, i) => (
                      <div key={i} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}>
                        <div className="font-medium">{m.name || "(Meal)"}</div>
                        {m.time && <div className="text-xs opacity-70">{m.time}</div>}
                        {m.notes && <div className="text-xs opacity-60">{m.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            }

            // For week/month, group by day
            const days = [];
            if (choresView === "week") {
              const dt = new Date(sel + "T12:00:00");
              const ws = prefs.weekStart ?? 0;
              const dow = dt.getDay();
              const delta = (dow - ws + 7) % 7;
              dt.setDate(dt.getDate() - delta);
              for (let i = 0; i < 7; i++) days.push(addDaysStr(dt.toISOString().slice(0, 10), i));
            } else {
              if (rangeStart && rangeEnd) {
                let cur = rangeStart;
                while (cur <= rangeEnd) {
                  days.push(cur);
                  cur = addDaysStr(cur, 1);
                }
              }
            }

            const grouped = {};
            for (const d of days) {
              const meals = getMealsForDate(d);
              if (meals && meals.length) grouped[d] = meals;
            }
            const keys = Object.keys(grouped);
            if (!keys.length) return null;

            return (
              <div className="mt-4 space-y-2">
                <div className="text-sm opacity-80">Meals</div>
                <div className="space-y-2">
                  {keys.map((d) => (
                    <div key={d} className="space-y-1">
                      <div className="text-xs opacity-70">{dayLabel(d)}</div>
                      <div className="space-y-1">
                        {grouped[d].map((m, i) => (
                          <div key={i} className="rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-sm">
                            <div className="font-medium">{m.name || "(Meal)"}</div>
                            {m.time && <div className="text-xs opacity-70">{m.time}</div>}
                            {m.notes && <div className="text-xs opacity-60">{m.notes}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        <DayAgendaPane
          selectedDate={sel}
          prefs={prefs}
          selectedOccs={filteredSelectedOccs}
          occurrencesByDay={filteredOccurrencesByDay}
          onEdit={openEdit}
        />

        <div className="pt-3 border-t hairline" />

        <CalendarToggles calendars={calendars} onChange={(next) => patch({ calendars: next })} />
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="h-full relative flex flex-col gap-3" style={{ ...themeVars, color: "var(--cal-text)", background: "var(--cal-panel)" }}>
      {main}

      {editor && (
        <EventEditor
          prefs={prefs}
          calendars={calendars}
          initial={editor.initialEvent}
          isEdit={editor.mode === "edit"}
          onCancel={() => setEditor(null)}
          onSave={saveEvent}
          onDelete={deleteEvent}
        />
      )}
    </div>
  );
}

function buildUpcomingDaysWithEvents(occurrencesByDay, startDateStr, prefs, maxDaysToScan = 60, maxDaysToShow = 4) {
  const out = [];
  let cur = addDaysStr(startDateStr, 1);
  let safety = 0;

  while (safety++ < maxDaysToScan && out.length < maxDaysToShow) {
    const occs = sortEventsForDay(occurrencesByDay[cur] ?? [], prefs);
    if (occs.length) out.push({ day: cur, occs });
    cur = addDaysStr(cur, 1);
  }

  return out;
}

function DayAgendaPane({
  selectedDate,
  prefs,
  selectedOccs,
  occurrencesByDay,
  onEdit,
}) {
  const upcoming = useMemo(
    () => buildUpcomingDaysWithEvents(occurrencesByDay, selectedDate, prefs, 90, 4),
    [occurrencesByDay, selectedDate, prefs]
  );

  return (
    <div className="flex-1 overflow-auto space-y-3 mt-3">
      {/* Selected day events */}
      <div className="space-y-2">
        {selectedOccs.length ? (
          selectedOccs.map((occ) => (
            <EventChip key={occ.key} occ={occ} prefs={prefs} onClick={() => onEdit(occ)} />
          ))
        ) : (
          <div className="text-sm opacity-70">No events for this day.</div>
        )}
      </div>

      {/* Upcoming days with events */}
      {upcoming.length > 0 && (
        <div className="pt-2 border-t hairline space-y-3">
          <div className="text-xs opacity-70">Up next</div>

          {upcoming.map(({ day, occs }) => (
            <div
              key={day}
              className="rounded-2xl px-3 py-3"
              style={{ background: "var(--cal-panel)", border: "1px solid var(--cal-border)" }}
            >
              <div className="font-semibold text-sm mb-2">{dayLabel(day)}</div>
              <div className="space-y-2">
                {occs.map((occ) => (
                  <EventChip key={occ.key} occ={occ} prefs={prefs} onClick={() => onEdit(occ)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* If nothing upcoming */}
      {upcoming.length === 0 && selectedOccs.length === 0 && (
        <div className="text-xs opacity-60">
          No upcoming events found.
        </div>
      )}
    </div>
  );
}

function CalendarToggles({ calendars, onChange }) {
  const list = calendars ?? [];
  const toggle = (id) => {
    onChange(list.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  };

  return (
    <div className="space-y-2">
      <div className="text-xs opacity-70">Calendars</div>
      <div className="flex flex-wrap gap-2">
        {list
          .filter((c) => !c.archived)
          .map((c) => (
            <button
              key={c.id}
              className={"btn !px-3 !py-2 " + (c.enabled ? "btnPrimary" : "")}
              onClick={() => toggle(c.id)}
              type="button"
            >
              {c.name}
            </button>
          ))}
      </div>
      <div className="text-[11px] opacity-60">Toggle calendars on/off without deleting data.</div>
    </div>
  );
}

function WeekList({ weekStartDate, prefs, occurrencesByDay, selectedDate, onSelect, onAdd, onEdit }) {
  const days = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 7; i++) arr.push(addDaysStr(weekStartDate, i));
    return arr;
  }, [weekStartDate]);

  return (
    <div className="space-y-2">
      {days.map((d) => {
        const occs = sortEventsForDay(occurrencesByDay[d] ?? [], prefs);
        return (
          <div
            key={d}
            className={
              "rounded-2xl border border-white/10 p-3 " + (d === selectedDate ? "bg-white/10" : "bg-white/5")
            }
          >
            <div className="flex items-center justify-between gap-2">
              <button className="text-left min-w-0" onClick={() => onSelect(d)} type="button">
                <div className="font-semibold truncate">{dayLabel(d)}</div>
              </button>
              <button className="btn !px-3 !py-2" onClick={() => onAdd(d)} type="button">
                <Plus size={16} /> Add
              </button>
            </div>
            <div className="pt-2 space-y-2">
              {occs.length ? (
                occs.map((occ) => <EventChip key={occ.key} occ={occ} prefs={prefs} onClick={() => onEdit(occ)} />)
              ) : (
                <div className="text-sm opacity-70">No events.</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaRange({ startDate, endDate, prefs, occurrencesByDay, selectedDate, onSelect, onAdd, onEdit }) {
  const days = useMemo(() => {
    if (!startDate || !endDate) return [];
    const out = [];
    let cur = startDate;
    let safety = 0;
    while (cur <= endDate && safety++ < 90) {
      out.push(cur);
      cur = addDaysStr(cur, 1);
    }
    return out;
  }, [startDate, endDate]);

  return (
    <div className="space-y-2">
      {days.map((d) => {
        const occs = sortEventsForDay(occurrencesByDay[d] ?? [], prefs);
        const has = occs.length > 0;
        return (
          <div
            key={d}
            className={
              "rounded-2xl border border-white/10 p-3 " + (d === selectedDate ? "bg-white/10" : "bg-white/5")
            }
          >
            <div className="flex items-center justify-between gap-2">
              <button className="text-left min-w-0" onClick={() => onSelect(d)} type="button">
                <div className="font-semibold truncate">{dayLabel(d)}</div>
                <div className="text-xs opacity-70">{has ? `${occs.length} event(s)` : "No events"}</div>
              </button>
              <button className="btn !px-3 !py-2" onClick={() => onAdd(d)} type="button">
                <Plus size={16} /> Add
              </button>
            </div>
            {has && (
              <div className="pt-2 space-y-2">
                {occs.map((occ) => <EventChip key={occ.key} occ={occ} prefs={prefs} onClick={() => onEdit(occ)} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
