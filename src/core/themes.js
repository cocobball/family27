export const defaultThemeId = "darkGlass";

export const themes = [
  {
    id: "darkGlass",
    name: "Dark Glass",
    vars: {
      "--bg0": "#0b1020",
      "--bg1": "#0a1226",
      "--panel": "rgba(255,255,255,0.08)",
      "--panel2": "rgba(255,255,255,0.12)",
      "--text": "rgba(255,255,255,0.92)",
      "--muted": "rgba(255,255,255,0.65)",
      "--border": "rgba(255,255,255,0.14)",
      "--accent": "#7c5cff",
      "--accent2": "#31d0aa",
      "--shadow": "rgba(0,0,0,0.35)",
    },
    swatches: ["#0b1020", "#7c5cff", "#31d0aa"],
  },
  {
    id: "slate",
    name: "Slate",
    vars: {
      "--bg0": "#0a0f1a",
      "--bg1": "#111a2b",
      "--panel": "rgba(255,255,255,0.07)",
      "--panel2": "rgba(255,255,255,0.11)",
      "--text": "rgba(255,255,255,0.92)",
      "--muted": "rgba(255,255,255,0.64)",
      "--border": "rgba(255,255,255,0.13)",
      "--accent": "#60a5fa",
      "--accent2": "#22c55e",
      "--shadow": "rgba(0,0,0,0.38)",
    },
    swatches: ["#111a2b", "#60a5fa", "#22c55e"],
  },
  {
    id: "warm",
    name: "Warm",
    vars: {
      "--bg0": "#120c0a",
      "--bg1": "#1b1410",
      "--panel": "rgba(255,255,255,0.08)",
      "--panel2": "rgba(255,255,255,0.12)",
      "--text": "rgba(255,255,255,0.93)",
      "--muted": "rgba(255,255,255,0.67)",
      "--border": "rgba(255,255,255,0.14)",
      "--accent": "#fb923c",
      "--accent2": "#f97316",
      "--shadow": "rgba(0,0,0,0.38)",
    },
    swatches: ["#1b1410", "#fb923c", "#f97316"],
  },
  {
    id: "switzerland",
    name: "Switzerland",
    // Swiss-inspired: clean white/neutral with strong red accent
    vars: {
      "--bg0": "#0b0e12",
      "--bg1": "#0f141b",
      "--panel": "rgba(255,255,255,0.09)",
      "--panel2": "rgba(255,255,255,0.13)",
      "--text": "rgba(255,255,255,0.93)",
      "--muted": "rgba(255,255,255,0.66)",
      "--border": "rgba(255,255,255,0.16)",
      "--accent": "#e11d48",
      "--accent2": "#f43f5e",
      "--shadow": "rgba(0,0,0,0.40)",
    },
    swatches: ["#0f141b", "#e11d48", "#f43f5e"],
  },
  {
    id: "netherlands",
    name: "Netherlands",
    // Dutch-inspired: deep blue + orange accent
    vars: {
      "--bg0": "#070c16",
      "--bg1": "#0b1633",
      "--panel": "rgba(255,255,255,0.08)",
      "--panel2": "rgba(255,255,255,0.12)",
      "--text": "rgba(255,255,255,0.93)",
      "--muted": "rgba(255,255,255,0.66)",
      "--border": "rgba(255,255,255,0.14)",
      "--accent": "#f97316",
      "--accent2": "#60a5fa",
      "--shadow": "rgba(0,0,0,0.40)",
    },
    swatches: ["#0b1633", "#f97316", "#60a5fa"],
  },
  {
    id: "organic_earth",
    name: "Organic Earth",
    // Earth tones: moss, clay, sand
    vars: {
      "--bg0": "#0b0f0b",
      "--bg1": "#10180f",
      "--panel": "rgba(255,255,255,0.075)",
      "--panel2": "rgba(255,255,255,0.115)",
      "--text": "rgba(255,255,255,0.92)",
      "--muted": "rgba(255,255,255,0.66)",
      "--border": "rgba(255,255,255,0.14)",
      "--accent": "#84cc16",
      "--accent2": "#a16207",
      "--shadow": "rgba(0,0,0,0.40)",
    },
    swatches: ["#10180f", "#84cc16", "#a16207"],
  },
];

export function getThemeById(id) {
  return themes.find((t) => t.id === id) ?? themes.find((t) => t.id === defaultThemeId);
}

export function applyThemeVars(themeId) {
  const theme = getThemeById(themeId);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
}
