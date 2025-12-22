// src/modules/calendar/settings.jsx
import React, { useMemo, useRef, useState } from "react";
import { Plus, Trash2, Upload, Download } from "lucide-react";
import { defaultCalendarData, uid } from "./helpers.js";

// XML helpers for import/export
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

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function normalizeEvent(ev) {
  return {
    id: ev.id || uid("ev"),
    title: ev.title || "",
    calendarId: ev.calendarId || "family",
    allDay: !!ev.allDay,
    startDate: ev.startDate || todayStr(),
    endDate: ev.endDate || ev.startDate || todayStr(),
    startTime: ev.allDay ? null : (ev.startTime || "09:00"),
    endTime: ev.allDay ? null : (ev.endTime || "10:00"),
    important: !!ev.important,
    location: ev.location || "",
    notes: ev.notes || "",
    createdAt: ev.createdAt || new Date().toISOString(),
    updatedAt: ev.updatedAt || new Date().toISOString(),
    recurrence: ev.recurrence || null,
  };
}

function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);
  const data = useMemo(() => ctx.store.get(defaultFn), [ctx, defaultFn, rev]);
  const patch = (partial) => {
    ctx.store.patch(partial);
    setRev((r) => r + 1);
  };
  return { data, patch };
}

export default function CalendarSettings({ ctx }) {
  const { data, patch } = useModuleData(ctx, defaultCalendarData);
  const prefs = data.prefs ?? defaultCalendarData().prefs;
  const calendars = data.calendars ?? defaultCalendarData().calendars;
  const events = data.events ?? [];

  const updatePrefs = (p) => patch({ prefs: { ...prefs, ...p } });
  
  // UI settings
  const showChores = data.ui?.showChores ?? true;
  const showImportant = data.ui?.showImportant ?? true;
  const showMeals = data.ui?.showMeals ?? false;
  const choresView = data.ui?.choresView ?? "day";
  
  const updateUI = (partial) => patch({ ui: { ...(data.ui || {}), ...partial } });
  
  // File import/export
  const fileInputRef = useRef(null);
  
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleFileChange = async (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const doc = new DOMParser().parseFromString(text, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) {
        window.alert("Import failed: invalid XML.");
        if (fileInputRef.current) fileInputRef.current.value = null;
        return;
      }

      const nodes = doc.getElementsByTagName("event");
      const imported = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const title = xmlText(node, "title") || "";
        const calendarId = xmlText(node, "calendarId") || "family";
        const allDay = parseBool(xmlText(node, "allDay"), false);
        const startDate = xmlText(node, "startDate") || todayStr();
        const endDate = xmlText(node, "endDate") || startDate;
        let startTime = xmlText(node, "startTime");
        let endTime = xmlText(node, "endTime");
        if (allDay) {
          startTime = null;
          endTime = null;
        } else {
          startTime = startTime || "09:00";
          endTime = endTime || "10:00";
        }
        const important = parseBool(xmlText(node, "important"), false);
        const location = xmlText(node, "location") || "";
        const notes = xmlText(node, "notes") || "";
        const createdAt = xmlText(node, "createdAt") || new Date().toISOString();
        const updatedAt = xmlText(node, "updatedAt") || new Date().toISOString();

        // recurrence
        const recEl = node.getElementsByTagName("recurrence")[0];
        let recurrence = null;
        if (recEl) {
          const freq = xmlText(recEl, "freq");
          const interval = parseInt(xmlText(recEl, "interval") || "1", 10) || 1;
          const until = xmlText(recEl, "until") || null;
          const byWeekdayStr = xmlText(recEl, "byWeekday");
          const byWeekday = byWeekdayStr
            ? byWeekdayStr
                .split(",")
                .map((n) => Number(n))
                .filter((x) => !Number.isNaN(x))
            : null;
          recurrence = {
            freq: freq || "WEEKLY",
            interval,
            ...(until ? { until } : {}),
            ...(byWeekday ? { byWeekday } : {}),
          };
        }

        const ev = normalizeEvent({
          id: uid("ev"),
          title,
          calendarId,
          allDay,
          startDate,
          endDate,
          startTime,
          endTime,
          important,
          location,
          notes,
          createdAt,
          updatedAt,
          recurrence: recurrence || null,
        });

        imported.push(ev);
      }

      if (imported.length) {
        patch({ events: [...events, ...imported] });
        window.alert(`Imported ${imported.length} event(s).`);
      } else {
        window.alert("No events found to import.");
      }
    } catch (err) {
      console.error(err);
      window.alert("Import failed: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = null;
    }
  };

  const handleExport = () => {
    const rows = [];
    rows.push('<?xml version="1.0" encoding="UTF-8"?>\n<events>');
    for (const ev of events) {
      rows.push("  <event>");
      rows.push(`    <id>${escapeXml(ev.id)}</id>`);
      rows.push(`    <title>${escapeXml(ev.title)}</title>`);
      rows.push(`    <calendarId>${escapeXml(ev.calendarId)}</calendarId>`);
      rows.push(`    <allDay>${ev.allDay ? "true" : "false"}</allDay>`);
      rows.push(`    <startDate>${escapeXml(ev.startDate)}</startDate>`);
      rows.push(`    <endDate>${escapeXml(ev.endDate ?? ev.startDate)}</endDate>`);
      rows.push(`    <startTime>${escapeXml(ev.startTime ?? "")}</startTime>`);
      rows.push(`    <endTime>${escapeXml(ev.endTime ?? "")}</endTime>`);
      rows.push(`    <important>${ev.important ? "true" : "false"}</important>`);
      rows.push(`    <location>${escapeXml(ev.location ?? "")}</location>`);
      rows.push(`    <notes>${escapeXml(ev.notes ?? "")}</notes>`);
      rows.push(`    <createdAt>${escapeXml(ev.createdAt ?? "")}</createdAt>`);
      rows.push(`    <updatedAt>${escapeXml(ev.updatedAt ?? "")}</updatedAt>`);
      if (ev.recurrence) {
        rows.push("    <recurrence>");
        rows.push(`      <freq>${escapeXml(ev.recurrence.freq ?? "")}</freq>`);
        rows.push(`      <interval>${String(ev.recurrence.interval ?? 1)}</interval>`);
        rows.push(`      <until>${escapeXml(ev.recurrence.until ?? "")}</until>`);
        const bw = Array.isArray(ev.recurrence.byWeekday) ? ev.recurrence.byWeekday.join(",") : "";
        rows.push(`      <byWeekday>${escapeXml(bw)}</byWeekday>`);
        rows.push("    </recurrence>");
      }
      rows.push("  </event>");
    }
    rows.push("</events>");
    const xml = rows.join("\n");
    safeDownloadText("family-calendar-events.xml", xml);
  };

  const addCalendar = () => {
    const id = uid("cal");
    patch({
      calendars: [...calendars, { id, name: "New calendar", enabled: true, archived: false }],
    });
  };

  const renameCalendar = (id, name) => {
    patch({ calendars: calendars.map((c) => (c.id === id ? { ...c, name } : c)) });
  };

  const toggleArchive = (id) => {
    patch({ calendars: calendars.map((c) => (c.id === id ? { ...c, archived: !c.archived } : c)) });
  };

  const deleteCalendar = (id) => {
    // Failure-safe: do NOT delete events. Reassign to "family".
    const nextEvents = events.map((e) => (e.calendarId === id ? { ...e, calendarId: "family" } : e));
    patch({
      events: nextEvents,
      calendars: calendars.map((c) => (c.id === id ? { ...c, archived: true, enabled: false } : c)),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold">Calendar Settings</div>
        <div className="text-sm opacity-75">Applies instantly and persists in the unified dashboard DB.</div>
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Display</div>

        <label className="flex items-center gap-2 text-sm opacity-90 select-none">
          <input
            type="checkbox"
            checked={!!showChores}
            onChange={(e) => updateUI({ showChores: e.target.checked })}
          />
          Show chores
        </label>

        <label className="flex items-center gap-2 text-sm opacity-90 select-none">
          <input
            type="checkbox"
            checked={!!showImportant}
            onChange={(e) => updateUI({ showImportant: e.target.checked })}
          />
          Show important
        </label>

        <label className="flex items-center gap-2 text-sm opacity-90 select-none">
          <input
            type="checkbox"
            checked={!!showMeals}
            onChange={(e) => updateUI({ showMeals: e.target.checked })}
          />
          Show meals
        </label>

        <div className="pt-2 space-y-2">
          <div className="text-xs opacity-70">Chores view</div>
          <div className="flex flex-wrap gap-2">
            {[
              ["day", "Day"],
              ["week", "Week"],
              ["month", "Month"],
            ].map(([k, label]) => (
              <button
                key={k}
                className={"btn !px-3 !py-2 " + (choresView === k ? "btnPrimary" : "")}
                onClick={() => updateUI({ choresView: k })}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Import / Export</div>
        <div className="flex flex-wrap gap-2">
          <button className="btn !px-3 !py-2 inline-flex items-center gap-2" onClick={handleImportClick} type="button">
            <Upload size={16} /> Import XML
          </button>
          <button className="btn !px-3 !py-2 inline-flex items-center gap-2" onClick={handleExport} type="button">
            <Download size={16} /> Export XML
          </button>
        </div>
        <div className="text-[11px] opacity-60">Import appends events (does not overwrite). Export downloads all events.</div>
        
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="font-semibold">Preferences</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Week starts on</div>
            <div className="flex gap-2">
              <button
                className={"btn flex-1 " + ((prefs.weekStart ?? 0) === 0 ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ weekStart: 0 })}
              >
                Sunday
              </button>
              <button
                className={"btn flex-1 " + ((prefs.weekStart ?? 0) === 1 ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ weekStart: 1 })}
              >
                Monday
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Time format</div>
            <div className="flex gap-2">
              <button
                className={"btn flex-1 " + ((prefs.timeFormat ?? "12") === "12" ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ timeFormat: "12" })}
              >
                12-hour
              </button>
              <button
                className={"btn flex-1 " + ((prefs.timeFormat ?? "12") === "24" ? "btnPrimary" : "")}
                onClick={() => updatePrefs({ timeFormat: "24" })}
              >
                24-hour
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs opacity-70">Default view</div>
          <select
            className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
            value={prefs.view ?? "month"}
            onChange={(e) => updatePrefs({ view: e.target.value })}
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="agenda">Agenda</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!prefs.showWeekNumbers}
            onChange={(e) => updatePrefs({ showWeekNumbers: e.target.checked })}
          />
          Show week numbers (reserved)
        </label>
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Calendars</div>
          <button className="btn" onClick={addCalendar}>
            <Plus size={16} /> Add calendar
          </button>
        </div>

        <div className="space-y-3">
          {calendars.map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/10 p-3 bg-white/5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-base"
                  value={c.name}
                  onChange={(e) => renameCalendar(c.id, e.target.value)}
                />
                <button className="btn" onClick={() => toggleArchive(c.id)}>
                  {c.archived ? "Unarchive" : "Archive"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="text-xs opacity-70">
                  id: <span className="opacity-90">{c.id}</span>
                  {c.archived ? " • archived" : ""}
                </div>

                <button className="btn" onClick={() => deleteCalendar(c.id)} title="Archive + disable and reassign events">
                  <Trash2 size={16} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs opacity-70">
          Removing a calendar does not delete events — events are reassigned to “Family”.
        </div>
      </div>
    </div>
  );
}
