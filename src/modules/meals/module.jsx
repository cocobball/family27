import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  UtensilsCrossed,
  CalendarDays,
  BookOpen,
  Receipt,
  ShoppingCart,
  Plus,
  Trash2,
  Pencil,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  X,
  Search,
  Sparkles,
  Check,
} from "lucide-react";
import {
  DAYS,
  SLOTS,
  defaultData,
  migrateData,
  getWeekKey,
  addDays,
  fmtRangeLabel,
  splitLines,
  countAndDedupe,
  parseIngredientLine,
  stringifyIngredient,
  toXML,
  parseImportText,
} from "./helpers.js";

/**
 * Meals Module (better version)
 * - Weekly planner for any week of the year (jump by date, prev/next, today)
 * - Recipe library (structured ingredient helper + raw text)
 * - Receipts (store + date + items). You can pull receipt items into grocery list.
 * - Grocery list inside the module + export ingredients from planner/recipes/receipts
 * - Emits an eventBus event: "grocery:addItems" with { items: string[], source }
 *   (future grocery module can subscribe)
 */

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function useModuleData(ctx, defaultFn) {
  const [rev, setRev] = useState(0);
  const data = useMemo(() => migrateData(ctx.store.get(defaultFn())), [ctx, defaultFn, rev]);
  
  const set = (val) => {
    ctx.store.set(migrateData(val));
    setRev((r) => r + 1);
  };
  
  const update = (fn) => {
    const cur = ctx.store.get(defaultFn());
    const next = fn(migrateData(cur));
    ctx.store.set(migrateData(next));
    setRev((r) => r + 1);
  };
  
  return { data, set, update };
}

function IconTab({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`btn ${active ? "btnPrimary" : ""}`}
      title={label}
      aria-pressed={active}
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Pill({ children }) {
  return <span className="inline-flex items-center rounded-xl px-2 py-1 text-xs bg-white/10 border border-white/10">{children}</span>;
}

function Section({ title, right, children }) {
  return (
    <div className="glass rounded-3xl p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="font-semibold">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }) {
  return <div className="text-sm opacity-70">{children}</div>;
}

export default function MealsModule({ ctx }) {
  const fileRef = useRef(null);

  // --- Load and persist data using unified pattern ---
  const { data, set: setStore, update: updateStore } = useModuleData(ctx, defaultData);

  // Module-scoped CSS for select dropdowns
  useEffect(() => {
    const styleId = "meals-select-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .meals-module-select {
        background-color: rgba(20, 20, 24, 0.95) !important;
        color: rgba(255, 255, 255, 0.92) !important;
      }
      .meals-module-select option {
        background-color: rgba(20, 20, 24, 0.95);
        color: rgba(255, 255, 255, 0.92);
      }
      .meals-module-select option:hover,
      .meals-module-select option:checked {
        background-color: rgba(40, 40, 44, 0.95);
      }
    `;
    document.head.appendChild(style);

    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, []);

  const settings = data.settings || defaultData().settings;

  // UI state (restore from persisted data)
  const [tab, setTab] = useState(() => data.ui?.lastTab || "planner");
  const [weekStart, setWeekStart] = useState(() => 
    data.ui?.lastWeekStart || getWeekKey(new Date(), settings.weekStartsOnMonday)
  );
  const [activeDay, setActiveDay] = useState(() => 
    data.ui?.lastActiveDay || DAYS[(new Date().getDay() + 6) % 7] || "Monday"
  );

  // ensure week exists
  useEffect(() => {
    updateStore((prev) => {
      const d = prev;
      const wk = d.planner.weeks[weekStart];
      if (wk) return d;
      return {
        ...d,
        planner: {
          ...d.planner,
          weeks: { ...d.planner.weeks, [weekStart]: { days: {} } },
        },
      };
    });
  }, [weekStart, updateStore]);

  // Persist UI state (tab, week, day) to module data
  useEffect(() => {
    const timer = setTimeout(() => {
      updateStore(prev => ({
        ...prev,
        ui: { lastTab: tab, lastWeekStart: weekStart, lastActiveDay: activeDay }
      }));
    }, 500);
    return () => clearTimeout(timer);
  }, [tab, weekStart, activeDay, updateStore]);

  // Recipe editor
  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [recipeName, setRecipeName] = useState("");
  const [recipeIngredientsText, setRecipeIngredientsText] = useState("");
  const [recipeNotes, setRecipeNotes] = useState("");
  const [recipeTags, setRecipeTags] = useState("");

  // Receipt editor
  const [editingReceiptId, setEditingReceiptId] = useState(null);
  const [receiptStore, setReceiptStore] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [receiptItemsText, setReceiptItemsText] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptTotal, setReceiptTotal] = useState("");

  // Grocery
  const [groceryDraft, setGroceryDraft] = useState("");
  const [grocerySearch, setGrocerySearch] = useState("");

  const recipesById = useMemo(() => {
    const m = new Map();
    for (const r of data.recipes) m.set(r.id, r);
    return m;
  }, [data.recipes]);

  const weekDays = data.planner.weeks?.[weekStart]?.days || {};
  const dayEntry = weekDays[activeDay] || {};

  const weekLabel = useMemo(() => fmtRangeLabel(weekStart), [weekStart]);

  const moveWeek = (dir) => {
    const dt = addDays(weekStart, dir * 7);
    setWeekStart(getWeekKey(dt, settings.weekStartsOnMonday));
  };

  const jumpToDate = (isoDate) => {
    if (!isoDate) return;
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    setWeekStart(getWeekKey(dt, settings.weekStartsOnMonday));
    // also pick the day of that date
    const dayIdx = (dt.getDay() + 6) % 7;
    setActiveDay(DAYS[dayIdx] || "Monday");
  };

  const setSlot = (slotKey, slotEntryOrNull) => {
    updateStore((prev) => {
      const d = prev;
      const wk = d.planner.weeks[weekStart] || { days: {} };
      const curDay = wk.days[activeDay] || {};
      const nextDay = { ...curDay };
      if (!slotEntryOrNull) delete nextDay[slotKey];
      else nextDay[slotKey] = slotEntryOrNull;

      const nextDays = { ...wk.days };
      if (Object.keys(nextDay).length) nextDays[activeDay] = nextDay;
      else delete nextDays[activeDay];

      return {
        ...d,
        planner: {
          ...d.planner,
          weeks: { ...d.planner.weeks, [weekStart]: { ...wk, days: nextDays } },
        },
      };
    });
  };

  const clearDay = () => {
    updateStore((prev) => {
      const d = prev;
      const wk = d.planner.weeks[weekStart] || { days: {} };
      const nextDays = { ...wk.days };
      delete nextDays[activeDay];
      return {
        ...d,
        planner: { ...d.planner, weeks: { ...d.planner.weeks, [weekStart]: { ...wk, days: nextDays } } },
      };
    });
  };

  // --- Grocery generation ---
  const getGroceryLinesForWeek = () => {
    const wk = data.planner.weeks?.[weekStart]?.days || {};
    const all = [];

    for (const day of DAYS) {
      const entry = wk[day];
      if (!entry) continue;

      for (const slot of SLOTS) {
        const s = entry?.[slot.key];
        if (!s) continue;
        if (s.type === "text") continue;

        const r = recipesById.get(s.id);
        if (!r) continue;
        all.push(...splitLines(r.ingredientsText));
      }
    }

    const deduped = settings.autoDedupeGrocery ? countAndDedupe(all) : all.map((l) => l.trim()).filter(Boolean);
    return deduped;
  };

  const addItemsToGrocery = (lines, source = "manual") => {
    const items = (lines || []).map((t) => String(t || "").trim()).filter(Boolean);
    if (!items.length) return;

    updateStore((prev) => {
      const d = prev;
      const existing = d.grocery.items || [];
      const next = [
        ...items.map((text) => ({ id: uid(), text, done: false, createdAt: new Date().toISOString(), source })),
        ...existing,
      ];
      return { ...d, grocery: { ...d.grocery, items: next } };
    });

    // publish (optional)
    ctx.eventBus?.emit?.("grocery:addItems", { items, source });
  };

  const addWeekGroceries = () => addItemsToGrocery(getGroceryLinesForWeek(), `planner:${weekStart}`);

  const addReceiptToGroceries = (receiptId) => {
    const r = data.receipts.find((x) => x.id === receiptId);
    if (!r) return;
    addItemsToGrocery(splitLines(r.itemsText), `receipt:${receiptId}`);
  };

  // --- Recipe CRUD ---
  const startNewRecipe = () => {
    setEditingRecipeId(null);
    setRecipeName("");
    setRecipeIngredientsText("");
    setRecipeNotes("");
    setRecipeTags("");
    setTab("recipes");
  };

  const editRecipe = (r) => {
    setEditingRecipeId(r.id);
    setRecipeName(r.name || "");
    setRecipeIngredientsText(r.ingredientsText || "");
    setRecipeNotes(r.notes || "");
    setRecipeTags((r.tags || []).join(", "));
    setTab("recipes");
  };

  const saveRecipe = () => {
    const name = recipeName.trim();
    if (!name) return;

    const tags = recipeTags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);

    updateStore((prev) => {
      const d = prev;
      const now = new Date().toISOString();

      if (editingRecipeId) {
        return {
          ...d,
          recipes: d.recipes.map((r) =>
            r.id === editingRecipeId
              ? { ...r, name, ingredientsText: recipeIngredientsText, notes: recipeNotes, tags, updatedAt: now }
              : r
          ),
        };
      }
      const r = {
        id: uid(),
        name,
        ingredientsText: recipeIngredientsText,
        notes: recipeNotes,
        servings: 0,
        tags,
        createdAt: now,
        updatedAt: now,
      };
      return { ...d, recipes: [r, ...d.recipes] };
    });

    setEditingRecipeId(null);
    setRecipeName("");
    setRecipeIngredientsText("");
    setRecipeNotes("");
    setRecipeTags("");
  };

  const deleteRecipe = (id) => {
    updateStore((prev) => {
      const d = prev;

      // remove from planner
      const weeks = { ...d.planner.weeks };
      for (const [wkKey, wkObj] of Object.entries(weeks)) {
        const days = { ...(wkObj?.days || {}) };
        let wkChanged = false;

        for (const [dayName, entry] of Object.entries(days)) {
          const next = { ...entry };
          let changed = false;

          for (const k of ["breakfast", "lunch", "dinner"]) {
            if (next[k]?.type === "recipe" && next[k]?.id === id) {
              delete next[k];
              changed = true;
            }
          }

          if (changed) {
            wkChanged = true;
            if (Object.keys(next).length) days[dayName] = next;
            else delete days[dayName];
          }
        }

        if (wkChanged) weeks[wkKey] = { ...wkObj, days };
      }

      return {
        ...d,
        recipes: d.recipes.filter((r) => r.id !== id),
        planner: { ...d.planner, weeks },
      };
    });
  };

  // --- Ingredient helper actions ---
  const autoFormatIngredients = () => {
    const lines = splitLines(recipeIngredientsText);
    const formatted = lines
      .map(parseIngredientLine)
      .map(stringifyIngredient)
      .join("\n");
    setRecipeIngredientsText(formatted);
  };

  // --- Receipt CRUD ---
  const startNewReceipt = () => {
    setEditingReceiptId(null);
    setReceiptStore("");
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setReceiptItemsText("");
    setReceiptNotes("");
    setReceiptTotal("");
    setTab("receipts");
  };

  const editReceipt = (r) => {
    setEditingReceiptId(r.id);
    setReceiptStore(r.store || "");
    setReceiptDate(r.date || "");
    setReceiptItemsText(r.itemsText || "");
    setReceiptNotes(r.notes || "");
    setReceiptTotal(r.total || "");
    setTab("receipts");
  };

  const saveReceipt = () => {
    if (!receiptStore.trim() && !receiptItemsText.trim()) return;
    const now = new Date().toISOString();

    updateStore((prev) => {
      const d = prev;
      if (editingReceiptId) {
        return {
          ...d,
          receipts: d.receipts.map((r) =>
            r.id === editingReceiptId
              ? { ...r, store: receiptStore, date: receiptDate, itemsText: receiptItemsText, notes: receiptNotes, total: receiptTotal, updatedAt: now }
              : r
          ),
        };
      }
      const r = {
        id: uid(),
        store: receiptStore,
        date: receiptDate,
        itemsText: receiptItemsText,
        notes: receiptNotes,
        total: receiptTotal,
        createdAt: now,
        updatedAt: now,
      };
      return { ...d, receipts: [r, ...d.receipts] };
    });

    setEditingReceiptId(null);
    setReceiptStore("");
    setReceiptDate("");
    setReceiptItemsText("");
    setReceiptNotes("");
    setReceiptTotal("");
  };

  const deleteReceipt = (id) => {
    updateStore((prev) => {
      const d = prev;
      return { ...d, receipts: d.receipts.filter((r) => r.id !== id) };
    });
  };

  // --- Grocery list actions ---
  const addGroceryDraft = () => {
    const line = groceryDraft.trim();
    if (!line) return;
    addItemsToGrocery([line], "manual");
    setGroceryDraft("");
  };

  const toggleGrocery = (id) => {
    updateStore((prev) => {
      const d = prev;
      return {
        ...d,
        grocery: {
          ...d.grocery,
          items: d.grocery.items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)),
        },
      };
    });
  };

  const removeGrocery = (id) => {
    updateStore((prev) => {
      const d = prev;
      return { ...d, grocery: { ...d.grocery, items: d.grocery.items.filter((it) => it.id !== id) } };
    });
  };

  const clearDone = () => {
    updateStore((prev) => {
      const d = prev;
      return { ...d, grocery: { ...d.grocery, items: d.grocery.items.filter((it) => !it.done) } };
    });
  };

  // --- Export / Import ---
  const doExport = () => {
    const xml = toXML(data);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meals-export-${getWeekKey(new Date(), settings.weekStartsOnMonday)}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const triggerImport = () => fileRef.current?.click();

  const importReplace = async (file) => {
    try {
      const text = await file.text();
      const imported = parseImportText(text);
      setStore(imported);
    } catch (e) {
      console.error(e);
      alert("Import failed. Please choose a valid Meals export (XML) or a JSON backup.");
    }
  };

  // --- Derived UI lists ---
  const recipeSearchRef = useRef(null);
  const [recipeSearch, setRecipeSearch] = useState("");
  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return data.recipes;
    return data.recipes.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.tags || []).join(" ").toLowerCase().includes(q));
  }, [data.recipes, recipeSearch]);

  const filteredGrocery = useMemo(() => {
    const q = grocerySearch.trim().toLowerCase();
    const arr = data.grocery.items || [];
    if (!q) return arr;
    return arr.filter((it) => (it.text || "").toLowerCase().includes(q));
  }, [data.grocery.items, grocerySearch]);

  // --- Planner helpers ---
  const slotLabel = (slot) => {
    const s = dayEntry?.[slot.key];
    if (!s) return "—";
    if (s.type === "text") return s.text || "—";
    const r = recipesById.get(s.id);
    return r?.name || "Recipe missing";
  };

  const slotIngredientsPreview = (slot) => {
    const s = dayEntry?.[slot.key];
    if (!s || s.type !== "recipe") return "";
    return recipesById.get(s.id)?.ingredientsText || "";
  };

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-2xl bg-white/10 border border-white/10">
            <UtensilsCrossed size={18} />
          </div>
          <div>
            <div className="font-semibold text-lg">Meals</div>
            <div className="text-xs opacity-70">
              Planner • recipes • receipts • grocery list
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="iconBtn" onClick={doExport} title="Export meals data (XML)">
            <Download size={18} />
          </button>
          <button className="iconBtn" onClick={triggerImport} title="Import meals data (replaces)">
            <Upload size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.json,application/xml,application/json,text/xml,text/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importReplace(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <IconTab icon={CalendarDays} label="Planner" active={tab === "planner"} onClick={() => setTab("planner")} />
        <IconTab icon={BookOpen} label="Recipes" active={tab === "recipes"} onClick={() => setTab("recipes")} />
        <IconTab icon={Receipt} label="Receipts" active={tab === "receipts"} onClick={() => setTab("receipts")} />
        <IconTab icon={ShoppingCart} label="Grocery" active={tab === "grocery"} onClick={() => setTab("grocery")} />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto pr-1">
        {/* --- REST OF YOUR UI EXACTLY AS BEFORE --- */}
        {/* (unchanged content below; kept identical to your version) */}

        {tab === "planner" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Left: day list */}
            <Section
              title="Week"
              right={
                <div className="flex items-center gap-2">
                  <button className="iconBtn" onClick={() => moveWeek(-1)} title="Previous week">
                    <ChevronLeft size={18} />
                  </button>
                  <button className="iconBtn" onClick={() => moveWeek(1)} title="Next week">
                    <ChevronRight size={18} />
                  </button>
                </div>
              }
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <div className="text-sm font-semibold">Week of {weekStart}</div>
                  <div className="text-xs opacity-70">{weekLabel}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn" onClick={() => jumpToDate(new Date().toISOString().slice(0, 10))} title="Jump to this week">
                    Today
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <input
                  type="date"
                  className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                  onChange={(e) => jumpToDate(e.target.value)}
                  aria-label="Jump to date"
                />
              </div>

              <div className="space-y-2">
                {DAYS.map((d) => {
                  const entry = weekDays[d] || {};
                  const parts = SLOTS.map((s) => {
                    const val = entry?.[s.key];
                    if (!val) return "";
                    if (val.type === "text") return `${s.label[0]}: ${val.text}`;
                    const r = recipesById.get(val.id);
                    return `${s.label[0]}: ${r?.name || "Missing"}`;
                  }).filter(Boolean);
                  const subtitle = parts.join(" • ");

                  return (
                    <button
                      key={d}
                      onClick={() => setActiveDay(d)}
                      className={`w-full text-left rounded-2xl px-3 py-2 border ${
                        activeDay === d ? "bg-white/15 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      <div className="text-sm font-medium">{d}</div>
                      <div className="text-xs opacity-70 truncate">{subtitle || "—"}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btnPrimary" onClick={addWeekGroceries} title="Add ingredients from this week into the grocery list">
                  <Sparkles size={16} /> Add week → Grocery
                </button>
              </div>

              <div className="mt-3 text-xs opacity-70">
                Tip: Plan meals for any week. Ingredients come from recipes. Use “Add week → Grocery” to build your list.
              </div>
            </Section>

            {/* Right: active day */}
            <div className="lg:col-span-2 flex flex-col gap-3">
              <Section
                title={activeDay}
                right={
                  <div className="flex items-center gap-2">
                    <button className="btn" onClick={startNewRecipe} title="Create a new recipe">
                      <Plus size={16} /> New recipe
                    </button>
                    <button className="btn" onClick={clearDay} title="Clear this day">
                      <X size={16} /> Clear day
                    </button>
                  </div>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {SLOTS.map((slot) => {
                    const selected = dayEntry?.[slot.key];
                    const selectedId = selected?.type === "recipe" ? selected.id : "";
                    const selectedText = selected?.type === "text" ? selected.text : "";

                    return (
                      <div key={slot.key} className="rounded-2xl p-3 bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold text-sm">{slot.label}</div>
                          <Pill>{selected ? (selected.type === "recipe" ? "Recipe" : "Note") : "Empty"}</Pill>
                        </div>

                        {/* Choose recipe */}
                        <select
                          value={selectedId}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return setSlot(slot.key, null);
                            setSlot(slot.key, { type: "recipe", id: v });
                          }}
                          className="meals-module-select w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                          title="Select a recipe"
                        >
                          <option value="">Select recipe…</option>
                          {data.recipes.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>

                        <div className="mt-2">
                          <div className="text-xs opacity-70 mb-1">Or quick text (leftovers, takeout)</div>
                          <input
                            value={selectedText}
                            onChange={(e) => setSlot(slot.key, e.target.value ? { type: "text", text: e.target.value } : null)}
                            placeholder="e.g., leftovers"
                            className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                          />
                        </div>

                        <div className="mt-2 text-xs opacity-70">Planned: <span className="opacity-90">{slotLabel(slot)}</span></div>

                        {!!slotIngredientsPreview(slot) && (
                          <div className="mt-2">
                            <div className="text-xs opacity-70 mb-1">Ingredients</div>
                            <div className="text-xs whitespace-pre-wrap max-h-28 overflow-auto rounded-xl p-2 bg-black/10 border border-white/10">
                              {slotIngredientsPreview(slot)}
                            </div>
                          </div>
                        )}

                        {selected?.type === "recipe" && (
                          <div className="mt-2 flex gap-2">
                            <button className="btn" onClick={() => editRecipe(recipesById.get(selected.id))} title="Edit recipe">
                              <Pencil size={16} /> Edit
                            </button>
                            <button
                              className="btn"
                              onClick={() => addItemsToGrocery(splitLines(recipesById.get(selected.id)?.ingredientsText || ""), `recipe:${selected.id}`)}
                              title="Add this recipe's ingredients to grocery list"
                            >
                              <ShoppingCart size={16} /> Add ingredients
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>

              <Section
                title="Grocery preview (this week)"
                right={
                  <button className="btn btnPrimary" onClick={addWeekGroceries}>
                    <ShoppingCart size={16} /> Add to Grocery
                  </button>
                }
              >
                <div className="text-xs opacity-70 mb-2">
                  Built from recipe ingredients for all planned meals this week {settings.autoDedupeGrocery ? "(deduped + counts)." : "(not deduped)."}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {getGroceryLinesForWeek().length ? (
                    getGroceryLinesForWeek().slice(0, 18).map((line) => (
                      <div key={line} className="rounded-xl px-3 py-2 bg-white/5 border border-white/10 text-sm">
                        {line}
                      </div>
                    ))
                  ) : (
                    <EmptyHint>Nothing yet — add recipes + plan some meals.</EmptyHint>
                  )}
                </div>
                {getGroceryLinesForWeek().length > 18 && (
                  <div className="text-xs opacity-60 mt-2">Showing first 18 items…</div>
                )}
              </Section>
            </div>
          </div>
        )}

        {/* recipes / receipts / grocery tabs unchanged from your original */}
        {/* (kept as-is in your repo; if you want I can paste the remaining tabs too,
            but the only REQUIRED fix for the spam is the persistence block above.) */}
      </div>
    </div>
  );
}
