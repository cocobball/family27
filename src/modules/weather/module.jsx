import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw, MapPin, AlertTriangle, Settings, X } from "lucide-react";
import {
  clamp,
  describeWeatherCode,
  formatUpdated,
  isCacheFresh,
  migrateWeatherDataIfNeeded,
} from "./helpers.js";

/**
 * Weather Module (Open-Meteo + Zippopotam.us)
 *
 * - Defaults to ZIP 76063 (per request)
 * - Current conditions, hourly (next N hours), and 7-day forecast
 * - Caches responses in db.modules.weather via ctx.store
 * - Allows changing ZIP (optional): auto-geocodes ZIP via Zippopotam.us
 */

function pillClass(active) {
  return (
    "px-3 py-1.5 rounded-xl text-xs border transition-all " +
    (active ? "bg-white/15 border-white/25" : "bg-white/5 border-white/10 hover:bg-white/10")
  );
}

function cardClass() {
  return "bg-white/10 backdrop-blur-xl rounded-3xl p-5 border border-white/15 shadow-2xl";
}

function formatTemp(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${Math.round(Number(v))}°`;
}

function formatPct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${Math.round(Number(v))}%`;
}

function formatWind(speed, dir) {
  if (speed === null || speed === undefined || Number.isNaN(Number(speed))) return "—";
  const s = Math.round(Number(speed));
  if (dir === null || dir === undefined || Number.isNaN(Number(dir))) return `${s} mph`;
  return `${s} mph • ${Math.round(Number(dir))}°`;
}

function formatIn(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  // for inches, 2 decimals is fine
  return `${Number(v).toFixed(2)} in`;
}

function nowLocalIso() {
  return new Date().toISOString();
}

async function geocodeZip(zip, signal) {
  const z = String(zip || "").trim();
  if (!/^[0-9]{5}$/.test(z)) throw new Error("ZIP must be 5 digits.");
  const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(z)}`, { signal });
  if (!res.ok) throw new Error("ZIP lookup failed.");
  const data = await res.json();
  const place = data?.places?.[0];
  const lat = Number(place?.latitude);
  const lon = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("ZIP lookup returned invalid coordinates.");
  const labelParts = [place["place name"], place["state abbreviation"]].filter(Boolean);
  return {
    zip: z,
    label: labelParts.length ? `${z} • ${labelParts.join(", ")}` : z,
    lat,
    lon,
    // keep America/Chicago default (TX). if user changes zip later, still acceptable for most US zips;
    // Open-Meteo can infer timezone if we pass timezone=auto, but we'd rather keep consistent.
    timezone: "America/Chicago",
  };
}

async function fetchForecast({ lat, lon, timezone, units }, signal) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: timezone || "America/Chicago",
    temperature_unit: units?.temperature || "fahrenheit",
    wind_speed_unit: units?.windSpeed || "mph",
    precipitation_unit: units?.precipitation || "inch",
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Weather fetch failed.");
  return await res.json();
}

export default function WeatherModule({ ctx }) {
  const { store } = ctx;

  const [db, setDb] = useState(() => migrateWeatherDataIfNeeded(store.get(() => ({ version: 1 }))));
  const [status, setStatus] = useState({ state: "idle", message: "" }); // idle | loading | error
  const abortRef = useRef(null);

  // persist any local changes back into db.modules.weather
  const persist = (patch) => {
    setDb((prev) => {
      const next = migrateWeatherDataIfNeeded({ ...prev, ...patch });
      store.set(next);
      return next;
    });
  };

  const persistNested = (path, value) => {
    // shallow helper: only used for known top-level keys
    persist({ [path]: value });
  };

  const location = db.location;
  const cache = db.cache;
  const prefs = db.preferences;

  const current = cache?.data?.current || null;
  const hourly = cache?.data?.hourly || null;
  const daily = cache?.data?.daily || null;

  const fresh = isCacheFresh(cache?.fetchedAt, prefs.cacheMinutes);

  const [zipInput, setZipInput] = useState(location.zip);

  // Removed in-body settings modal/state; settings are now only in the global modal

  useEffect(() => {
    setZipInput(location.zip);
  }, [location.zip]);

  const doRefresh = async ({ force = false } = {}) => {
    if (!force && fresh && cache?.data) return;

    abortRef.current?.abort?.();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus({ state: "loading", message: "Updating…" });
      const data = await fetchForecast(
        { lat: location.lat, lon: location.lon, timezone: location.timezone, units: db.units },
        controller.signal
      );
      const next = {
        ...db,
        cache: { fetchedAt: nowLocalIso(), data },
      };
      setDb(next);
      store.set(next);
      setStatus({ state: "idle", message: "" });
    } catch (e) {
      if (e?.name === "AbortError") return;
      setStatus({ state: "error", message: e?.message || "Update failed." });
    }
  };

  // initial refresh on mount if stale
  useEffect(() => {
    doRefresh({ force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const loc = await geocodeZip(z, controller.signal);
      const next = {
        ...db,
        location: loc,
        cache: { fetchedAt: null, data: null },
      };
      setDb(next);
      store.set(next);
      setStatus({ state: "idle", message: "" });
      // fetch new location
      await doRefresh({ force: true });
    } catch (e) {
      if (e?.name === "AbortError") return;
      setStatus({ state: "error", message: e?.message || "ZIP update failed." });
    }
  };

  const currentDesc = useMemo(() => {
    const code = current?.weather_code;
    return describeWeatherCode(code);
  }, [current]);

  const nextHours = useMemo(() => {
    if (!hourly?.time?.length) return [];
    const times = hourly.time;
    const temps = hourly.temperature_2m || [];
    const pprob = hourly.precipitation_probability || [];
    const precip = hourly.precipitation || [];
    const wcode = hourly.weather_code || [];
    const wind = hourly.wind_speed_10m || [];

    // Find the first hour that is >= now
    const now = Date.now();
    let startIdx = 0;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]).getTime();
      if (Number.isFinite(t) && t >= now - 30 * 60 * 1000) {
        startIdx = i;
        break;
      }
    }

    const count = clamp(Number(prefs.hourlyHours || 24), 6, 48);
    const out = [];
    for (let i = startIdx; i < times.length && out.length < count; i++) {
      const dt = new Date(times[i]);
      out.push({
        key: times[i],
        label: dt.toLocaleTimeString(undefined, { hour: "numeric" }),
        temp: temps[i],
        pop: pprob[i],
        precip: precip[i],
        code: wcode[i],
        wind: wind[i],
      });
    }
    return out;
  }, [hourly, prefs.hourlyHours]);

  const nextDays = useMemo(() => {
    if (!daily?.time?.length) return [];
    const out = [];
    for (let i = 0; i < daily.time.length; i++) {
      const dt = new Date(daily.time[i]);
      out.push({
        key: daily.time[i],
        day: dt.toLocaleDateString(undefined, { weekday: "short" }),
        max: daily.temperature_2m_max?.[i],
        min: daily.temperature_2m_min?.[i],
        pop: daily.precipitation_probability_max?.[i],
        precip: daily.precipitation_sum?.[i],
        code: daily.weather_code?.[i],
        sunrise: daily.sunrise?.[i],
        sunset: daily.sunset?.[i],
      });
    }
    return out;
  }, [daily]);


  return (
    <div className="relative overflow-hidden rounded-[1.75rem]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1600')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.18,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 800px at 30% 10%, rgba(255,255,255,0.10), rgba(0,0,0,0) 60%)," +
            "linear-gradient(rgba(8,10,16,0.70), rgba(8,10,16,0.90))",
        }}
      />
      <div className="relative z-10 space-y-4 p-1">

      {status.state === "error" ? (
        <div className="flex items-start gap-2 text-sm rounded-2xl border border-red-400/30 bg-red-500/10 p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-red-200" />
          <div className="text-red-100/90">{status.message}</div>
        </div>
      ) : null}

      {/* Settings moved to modal for cleaner dashboard */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cardClass()}>
          <div className="text-sm opacity-70">Now</div>
          {current ? (
            <div className="mt-3">
              <div className="flex items-center gap-3">
                <div className="text-4xl">{currentDesc.icon}</div>
                <div>
                  <div className="text-3xl font-semibold">{formatTemp(current.temperature_2m)}</div>
                  <div className="text-sm opacity-75">{currentDesc.label}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
                  <div className="text-xs opacity-70">Feels like</div>
                  <div className="font-semibold">{formatTemp(current.apparent_temperature)}</div>
                </div>
                <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
                  <div className="text-xs opacity-70">Humidity</div>
                  <div className="font-semibold">{formatPct(current.relative_humidity_2m)}</div>
                </div>
                <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
                  <div className="text-xs opacity-70">Wind</div>
                  <div className="font-semibold">{formatWind(current.wind_speed_10m, current.wind_direction_10m)}</div>
                </div>
                <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
                  <div className="text-xs opacity-70">Precip</div>
                  <div className="font-semibold">{formatIn(current.precipitation)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm opacity-70">No data yet — hit refresh.</div>
          )}
        </div>

        <div className={"lg:col-span-2 " + cardClass()}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm opacity-70">Next {clamp(Number(prefs.hourlyHours || 24), 6, 48)} hours</div>
              <div className="text-xs opacity-60">Temp • precip chance • brief</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={pillClass(prefs.hourlyHours === 12)}
                onClick={() => persistNested("preferences", { ...prefs, hourlyHours: 12 })}
              >
                12h
              </button>
              <button
                className={pillClass(prefs.hourlyHours === 24)}
                onClick={() => persistNested("preferences", { ...prefs, hourlyHours: 24 })}
              >
                24h
              </button>
              <button
                className={pillClass(prefs.hourlyHours === 36)}
                onClick={() => persistNested("preferences", { ...prefs, hourlyHours: 36 })}
              >
                36h
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            {nextHours.length ? (
              nextHours.map((h) => {
                const d = describeWeatherCode(h.code);
                return (
                  <div key={h.key} className="bg-white/5 rounded-2xl p-3 border border-white/10">
                    <div className="text-xs opacity-70">{h.label}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-lg font-semibold">{formatTemp(h.temp)}</div>
                      <div className="text-lg">{d.icon}</div>
                    </div>
                    <div className="text-xs opacity-70 mt-1">PoP {formatPct(h.pop)}</div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm opacity-70 col-span-full">No hourly data.</div>
            )}
          </div>
        </div>
      </div>

      <div className={cardClass()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm opacity-70">5-day forecast</div>
            <div className="text-xs opacity-60">High / Low • precip chance • total precip</div>
          </div>
          <div className="text-xs opacity-60">
            Cache: {prefs.cacheMinutes}m{" "}
            <button
              className="ml-2 underline underline-offset-2 hover:opacity-90"
              onClick={() => persistNested("preferences", { ...prefs, cacheMinutes: 5 })}
              title="Cache 5 minutes"
            >
              5m
            </button>
            <button
              className="ml-2 underline underline-offset-2 hover:opacity-90"
              onClick={() => persistNested("preferences", { ...prefs, cacheMinutes: 20 })}
              title="Cache 20 minutes"
            >
              20m
            </button>
            <button
              className="ml-2 underline underline-offset-2 hover:opacity-90"
              onClick={() => persistNested("preferences", { ...prefs, cacheMinutes: 60 })}
              title="Cache 60 minutes"
            >
              60m
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-2">
          {nextDays.length ? (
            nextDays.slice(0, 5).map((d) => {
              const desc = describeWeatherCode(d.code);
              return (
                <div key={d.key} className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{d.day}</div>
                    <div className="text-xl">{desc.icon}</div>
                  </div>
                  <div className="text-xs opacity-70">{desc.label}</div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="text-lg font-semibold">{formatTemp(d.max)}</div>
                    <div className="text-sm opacity-70">{formatTemp(d.min)}</div>
                  </div>
                  <div className="mt-2 text-xs opacity-70">PoP {formatPct(d.pop)} • {formatIn(d.precip)}</div>
                </div>
              );
            })
          ) : (
            <div className="text-sm opacity-70">No daily data.</div>
          )}
        </div>
      </div>

      <div className="text-xs opacity-60">
        Data source: Open‑Meteo forecast API (no key). ZIP lookup: Zippopotam.us.
      </div>
      {/* All settings UI is now in the global modal via SettingsComponent */}
      </div>
    </div>
  );
}
