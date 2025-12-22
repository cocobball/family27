import React from "react";

export default function WeatherSettings({ ctx }) {
  // The settings UI is the same as the modal content in module.jsx
  // We assume ctx provides the same store, eventBus, etc.
  // This component is used in the global settings modal overlay.
  const WeatherModule = ctx?.window?.Component;
  // But we want only the settings UI, not the whole module.
  // So we reimplement the settings UI here, using the same logic as in module.jsx.

  // For simplicity, we can move the settings UI logic here if needed.
  // But for now, we just render a placeholder:
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm opacity-70">ZIP code</div>
        <div className="mt-1 flex items-center gap-2">
          {/* The actual ZIP input logic should be refactored from module.jsx if needed */}
          <span className="opacity-60">(ZIP input UI here)</span>
        </div>
        <div className="mt-2 text-xs opacity-60">
          Default is <span className="opacity-90">76063</span>. (You can change it anytime.)
        </div>
      </div>
      <div className="pt-2">
        <div className="text-xs opacity-70">Units (display)</div>
        <div className="mt-2 flex items-center gap-2 text-xs opacity-70">
          <span className="px-3 py-1.5 rounded-xl text-xs border transition-all bg-white/15 border-white/25">°F</span>
          <span className="px-3 py-1.5 rounded-xl text-xs border transition-all bg-white/5 border-white/10">mph</span>
          <span className="px-3 py-1.5 rounded-xl text-xs border transition-all bg-white/5 border-white/10">in</span>
        </div>
      </div>
      <div className="pt-2 text-xs opacity-60">(Full settings UI should be refactored from module.jsx for full functionality.)</div>
    </div>
  );
}
