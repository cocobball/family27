
import { useState, useEffect, useRef } from "react";

export default function WeatherSettings({ ctx }) {
  const { store } = ctx;
  const [db, setDb] = useState(() => store.get(() => ({ version: 1 })));
  const [zipInput, setZipInput] = useState(db.location?.zip || "");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const abortRef = useRef(null);
  const prefs = db.preferences || {};

  useEffect(() => {
    setZipInput(db.location?.zip || "");
  }, [db.location?.zip]);

  const persist = (patch) => {
    setDb((prev) => {
      const next = { ...prev, ...patch };
      store.set(next);
      return next;
    });
  };

  const persistNested = (path, value) => {
    persist({ [path]: value });
  };

  const setZip = async () => {
    const z = String(zipInput || "").trim();
    if (!/^[0-9]{5}$/.test(z)) {
      setStatus({ state: "error", message: "ZIP must be 5 digits." });
      return;
    }

    abortRef.current?.abort?.();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus({ state: "loading", message: "Looking up ZIP…" });
      // Use the same geocodeZip as in module.jsx
      const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(z)}`, { signal: controller.signal });
      if (!res.ok) throw new Error("ZIP lookup failed.");
      const data = await res.json();
      const place = data?.places?.[0];
      const lat = Number(place?.latitude);
      const lon = Number(place?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("ZIP lookup returned invalid coordinates.");
      const labelParts = [place["place name"], place["state abbreviation"]].filter(Boolean);
      const loc = {
        zip: z,
        label: labelParts.length ? `${z} • ${labelParts.join(", ")}` : z,
        lat,
        lon,
        timezone: "America/Chicago",
      };
      const next = {
        ...db,
        location: loc,
        cache: { fetchedAt: null, data: null },
      };
      setDb(next);
      store.set(next);
      setStatus({ state: "idle", message: "" });
    } catch (e) {
      if (e?.name === "AbortError") return;
      setStatus({ state: "error", message: e?.message || "ZIP update failed." });
    }
  };

  return (
    <div className="space-y-4">
      {status.state === "error" ? (
        <div className="flex items-start gap-2 text-sm rounded-2xl border border-red-400/30 bg-red-500/10 p-3">
          <span className="text-red-200">⚠️</span>
          <div className="text-red-100/90">{status.message}</div>
        </div>
      ) : null}
      <div>
        <div className="text-sm opacity-70">ZIP code</div>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={zipInput}
            onChange={(e) => setZipInput(e.target.value)}
            className="w-[110px] px-3 py-2 rounded-xl bg-white/10 border border-white/15 outline-none"
            inputMode="numeric"
            pattern="\\d{5}"
          />
          <button
            onClick={setZip}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-sm"
            title="Set ZIP"
          >
            Set
          </button>
          <button
            onClick={() => {
              setZipInput("76063");
              persist({
                ...db,
                location: {
                  zip: "76063",
                  label: "76063",
                  lat: 32.56913,
                  lon: -97.14376,
                  timezone: "America/Chicago",
                },
                cache: { fetchedAt: null, data: null },
              });
            }}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-xs"
            title="Reset to 76063"
          >
            Reset
          </button>
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
    </div>
  );
}
