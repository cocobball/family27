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

export function createWindowForModule(moduleId) {
  // Standard new window template (v1.3)
  const id = `win_${moduleId}`;
  return {
    id,
    moduleId,
    column: "middle",
    h: 0.35,          // fraction of column height
    minimized: false,
    hidden: false,
    popup: false,
    resizable: true,
    draggable: true,
  };
}
