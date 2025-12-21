
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
  const [tab, setTab] = useState("planner"); // planner | recipes | receipts | grocery
  const fileRef = useRef(null);

  const [data, setData] = useState(() => migrateData(ctx.store.get(defaultData)));

  // Persist
  useEffect(() => {
    ctx.store.set(data);
  }, [ctx, data]);

  const settings = data.settings || defaultData().settings;

  // Planner state
  const [weekStart, setWeekStart] = useState(() => getWeekKey(new Date(), settings.weekStartsOnMonday));
  const [activeDay, setActiveDay] = useState(() => {
    const idx = (new Date().getDay() + 6) % 7;
    return DAYS[idx] || "Monday";
  });

  // ensure week exists
  useEffect(() => {
    setData((prev) => {
      const d = migrateData(prev);
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
  }, [weekStart]);

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
    setData((prev) => {
      const d = migrateData(prev);
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
    setData((prev) => {
      const d = migrateData(prev);
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

    setData((prev) => {
      const d = migrateData(prev);
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

    setData((prev) => {
      const d = migrateData(prev);
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
    setData((prev) => {
      const d = migrateData(prev);

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

    setData((prev) => {
      const d = migrateData(prev);
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
    setData((prev) => {
      const d = migrateData(prev);
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
    setData((prev) => {
      const d = migrateData(prev);
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
    setData((prev) => {
      const d = migrateData(prev);
      return { ...d, grocery: { ...d.grocery, items: d.grocery.items.filter((it) => it.id !== id) } };
    });
  };

  const clearDone = () => {
    setData((prev) => {
      const d = migrateData(prev);
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
      setData(imported);
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
                          className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
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

        {tab === "recipes" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Section
              title="Recipe library"
              right={
                <button className="btn btnPrimary" onClick={startNewRecipe}>
                  <Plus size={16} /> New
                </button>
              }
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-70" />
                  <input
                    ref={recipeSearchRef}
                    value={recipeSearch}
                    onChange={(e) => setRecipeSearch(e.target.value)}
                    placeholder="Search recipes or tags…"
                    className="w-full pl-9 rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2 max-h-[560px] overflow-auto pr-1">
                {filteredRecipes.length ? (
                  filteredRecipes.map((r) => (
                    <div key={r.id} className="rounded-2xl p-3 bg-white/5 border border-white/10">
                      <button className="w-full text-left" onClick={() => editRecipe(r)}>
                        <div className="font-medium truncate">{r.name}</div>
                        <div className="text-xs opacity-70 truncate">
                          {splitLines(r.ingredientsText).slice(0, 2).join(" • ") || "No ingredients"}
                        </div>
                        {!!(r.tags || []).length && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(r.tags || []).slice(0, 4).map((t) => (
                              <Pill key={t}>{t}</Pill>
                            ))}
                          </div>
                        )}
                      </button>

                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button className="btn" onClick={() => addItemsToGrocery(splitLines(r.ingredientsText), `recipe:${r.id}`)} title="Add ingredients to grocery list">
                          <ShoppingCart size={16} /> Add
                        </button>
                        <button className="btn" onClick={() => deleteRecipe(r.id)} title="Delete recipe">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyHint>No recipes yet. Add one!</EmptyHint>
                )}
              </div>
              <div className="mt-3 text-xs opacity-70">
                Pro tip: keep ingredients one per line. Use tags like “kid-friendly”, “freezer”, “quick”.
              </div>
            </Section>

            <div className="lg:col-span-2 flex flex-col gap-3">
              <Section
                title={editingRecipeId ? "Edit recipe" : "New recipe"}
                right={
                  <div className="flex items-center gap-2">
                    <button className="btn" onClick={autoFormatIngredients} title="Lightly reformat ingredient lines">
                      <Sparkles size={16} /> Format
                    </button>
                    <button className="btn btnPrimary" onClick={saveRecipe}>
                      <Check size={16} /> Save
                    </button>
                  </div>
                }
              >
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <div className="text-xs opacity-70 mb-1">Name</div>
                    <input
                      value={recipeName}
                      onChange={(e) => setRecipeName(e.target.value)}
                      placeholder="Taco night"
                      className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs opacity-70 mb-1">Tags (comma separated)</div>
                      <input
                        value={recipeTags}
                        onChange={(e) => setRecipeTags(e.target.value)}
                        placeholder="quick, weeknight, freezer"
                        className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-xs opacity-70 mb-1">Quick actions</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn"
                          onClick={() => addItemsToGrocery(splitLines(recipeIngredientsText), `recipe:${editingRecipeId || "draft"}`)}
                          title="Add current ingredients to grocery list"
                        >
                          <ShoppingCart size={16} /> Add ingredients
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-70 mb-1">Ingredients (one per line)</div>
                    <textarea
                      value={recipeIngredientsText}
                      onChange={(e) => setRecipeIngredientsText(e.target.value)}
                      placeholder={"2 lb chicken\n1 jar salsa\n8 tortillas"}
                      className="w-full rounded-2xl px-3 py-2 bg-white/10 border border-white/10 text-sm min-h-[240px]"
                    />
                    <div className="mt-2 text-xs opacity-70">
                      “Format” tries to normalize quantity/unit/item spacing. It won’t be perfect, but it keeps things tidy.
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-70 mb-1">Notes</div>
                    <textarea
                      value={recipeNotes}
                      onChange={(e) => setRecipeNotes(e.target.value)}
                      placeholder="Brands, substitutions, side dishes…"
                      className="w-full rounded-2xl px-3 py-2 bg-white/10 border border-white/10 text-sm min-h-[120px]"
                    />
                  </div>
                </div>
              </Section>
            </div>
          </div>
        )}

        {tab === "receipts" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Section
              title="Receipts"
              right={
                <button className="btn btnPrimary" onClick={startNewReceipt}>
                  <Plus size={16} /> New
                </button>
              }
            >
              <div className="space-y-2 max-h-[560px] overflow-auto pr-1">
                {data.receipts.length ? (
                  data.receipts.map((r) => (
                    <div key={r.id} className="rounded-2xl p-3 bg-white/5 border border-white/10">
                      <button className="w-full text-left" onClick={() => editReceipt(r)}>
                        <div className="font-medium truncate">{r.store || "Receipt"}</div>
                        <div className="text-xs opacity-70 truncate">
                          {(r.date || "").slice(0, 10) || "—"} • {splitLines(r.itemsText).length || 0} items
                          {r.total ? ` • total ${r.total}` : ""}
                        </div>
                      </button>

                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button className="btn" onClick={() => addReceiptToGroceries(r.id)} title="Add receipt items to grocery list">
                          <ShoppingCart size={16} /> Add items
                        </button>
                        <button className="btn" onClick={() => deleteReceipt(r.id)} title="Delete receipt">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyHint>No receipts yet. Add one to keep track of what you bought.</EmptyHint>
                )}
              </div>
              <div className="mt-3 text-xs opacity-70">
                Store receipts as plain text. Copy/paste item lines from an emailed receipt, or type them in.
              </div>
            </Section>

            <div className="lg:col-span-2 flex flex-col gap-3">
              <Section
                title={editingReceiptId ? "Edit receipt" : "New receipt"}
                right={
                  <button className="btn btnPrimary" onClick={saveReceipt}>
                    <Check size={16} /> Save
                  </button>
                }
              >
                <div className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs opacity-70 mb-1">Store</div>
                      <input
                        value={receiptStore}
                        onChange={(e) => setReceiptStore(e.target.value)}
                        placeholder="Costco"
                        className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-xs opacity-70 mb-1">Date</div>
                      <input
                        type="date"
                        value={receiptDate}
                        onChange={(e) => setReceiptDate(e.target.value)}
                        className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs opacity-70 mb-1">Total (optional)</div>
                      <input
                        value={receiptTotal}
                        onChange={(e) => setReceiptTotal(e.target.value)}
                        placeholder="$123.45"
                        className="w-full rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        className="btn"
                        onClick={() => addItemsToGrocery(splitLines(receiptItemsText), `receipt:${editingReceiptId || "draft"}`)}
                        title="Add current receipt items to grocery list"
                      >
                        <ShoppingCart size={16} /> Add items to grocery
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-70 mb-1">Items (one per line)</div>
                    <textarea
                      value={receiptItemsText}
                      onChange={(e) => setReceiptItemsText(e.target.value)}
                      placeholder={"bananas\nmilk\npaper towels"}
                      className="w-full rounded-2xl px-3 py-2 bg-white/10 border border-white/10 text-sm min-h-[240px]"
                    />
                  </div>

                  <div>
                    <div className="text-xs opacity-70 mb-1">Notes</div>
                    <textarea
                      value={receiptNotes}
                      onChange={(e) => setReceiptNotes(e.target.value)}
                      placeholder="Coupons, returns, pantry stock…"
                      className="w-full rounded-2xl px-3 py-2 bg-white/10 border border-white/10 text-sm min-h-[120px]"
                    />
                  </div>
                </div>
              </Section>
            </div>
          </div>
        )}

        {tab === "grocery" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Section
              title="Add items"
              right={
                <button className="btn" onClick={clearDone} title="Remove checked items">
                  <Trash2 size={16} /> Clear done
                </button>
              }
            >
              <div className="flex gap-2">
                <input
                  value={groceryDraft}
                  onChange={(e) => setGroceryDraft(e.target.value)}
                  placeholder="Add an item…"
                  className="flex-1 rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addGroceryDraft();
                  }}
                />
                <button className="btn btnPrimary" onClick={addGroceryDraft}>
                  <Plus size={16} /> Add
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn" onClick={addWeekGroceries}>
                  <Sparkles size={16} /> Add this week
                </button>
                <button className="btn" onClick={startNewRecipe}>
                  <BookOpen size={16} /> Add recipe
                </button>
                <button className="btn" onClick={startNewReceipt}>
                  <Receipt size={16} /> Add receipt
                </button>
              </div>

              <div className="mt-3 text-xs opacity-70">
                This grocery list lives in the Meals module. It also broadcasts “grocery:addItems” on the event bus for future integrations.
              </div>
            </Section>

            <div className="lg:col-span-2 flex flex-col gap-3">
              <Section
                title="Grocery list"
                right={
                  <div className="relative w-[220px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-70" />
                    <input
                      value={grocerySearch}
                      onChange={(e) => setGrocerySearch(e.target.value)}
                      placeholder="Filter…"
                      className="w-full pl-9 rounded-xl px-3 py-2 bg-white/10 border border-white/10 text-sm"
                    />
                  </div>
                }
              >
                <div className="space-y-2">
                  {filteredGrocery.length ? (
                    filteredGrocery.map((it) => (
                      <div
                        key={it.id}
                        className={`flex items-center justify-between gap-2 rounded-2xl px-3 py-2 border ${
                          it.done ? "bg-white/5 border-white/10 opacity-70" : "bg-white/10 border-white/10"
                        }`}
                      >
                        <button className="flex items-center gap-2 text-left flex-1" onClick={() => toggleGrocery(it.id)} title="Toggle done">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md border ${it.done ? "bg-white/20" : "bg-transparent"} border-white/20`}>
                            {it.done ? <Check size={14} /> : null}
                          </span>
                          <div className={`text-sm ${it.done ? "line-through opacity-70" : ""}`}>{it.text}</div>
                        </button>

                        <div className="flex items-center gap-2">
                          {it.source ? <Pill>{it.source.split(":")[0]}</Pill> : null}
                          <button className="btn" onClick={() => removeGrocery(it.id)} title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyHint>No items. Add from planner, recipes, or receipts.</EmptyHint>
                  )}
                </div>
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
