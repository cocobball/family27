export const STARTER_ENABLED = ["calendar", "events"];

export function createDefaultLayout() {
  // Columns store window IDs in order.
  return {
    columns: {
      left: { id: "left", order: [] },
      middle: { id: "middle", order: [] },
      right: { id: "right", order: [] },
    },
    windows: {},
    moduleVisibility: {},
  };
}

/**
 * Window template.
 * NOTE: Windows are layout; modules are code.
 */
export function createWindowForModule(moduleId) {
  const id = `win_${moduleId}`;

  // Standard new window template (v1.4)
  const base = {
    id,
    moduleId,
    column: "middle",
    span: 1,           // number of columns to span (currently supports 1 or 2 from the LEFT column)
    h: 0.35,           // fraction of column height
    minimized: false,
    hidden: false,
    popup: false,
    resizable: true,
    draggable: true,
  };

  // Starter layout defaults (safe: only affects brand new windows)
  if (moduleId === "calendar") {
    return { ...base, column: "left", span: 2, h: 0.7 };
  }
  if (moduleId === "events") {
    return { ...base, column: "right", span: 1, h: 0.7 };
  }

  return base;
}
