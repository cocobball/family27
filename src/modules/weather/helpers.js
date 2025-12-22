export const WEATHER_SCHEMA_VERSION = 2;

export function defaultData() {
  return {
    version: WEATHER_SCHEMA_VERSION,
    // Default per request: 76063 (Mansfield, TX area)
    location: {
      zip: "76063",
      label: "76063",
      lat: 32.56913,
      lon: -97.14376,
      timezone: "America/Chicago",
    },
    units: {
      temperature: "fahrenheit",
      windSpeed: "mph",
      precipitation: "inch",
    },
    preferences: {
      // cache the API response to reduce network
      cacheMinutes: 20,
      // show 24 hours in hourly list
      hourlyHours: 24,
    },
    cache: {
      fetchedAt: null, // ISO
      data: null, // open-meteo payload
    },
  };
}

export function migrateWeatherDataIfNeeded(d) {
  if (!d || typeof d !== "object") return defaultData();

  const out = { ...defaultData(), ...d };
  out.version ??= WEATHER_SCHEMA_VERSION;

  // v1 -> v2 migration
  if (d.version === 1) {
    // old placeholder had no shape; just replace with defaults
    return defaultData();
  }

  // Ensure nested objects exist
  out.location = { ...defaultData().location, ...(d.location || {}) };
  out.units = { ...defaultData().units, ...(d.units || {}) };
  out.preferences = { ...defaultData().preferences, ...(d.preferences || {}) };
  out.cache = { ...defaultData().cache, ...(d.cache || {}) };

  // Validate required fields
  out.location.zip = String(out.location.zip || "76063").trim() || "76063";
  out.location.timezone ||= "America/Chicago";
  if (typeof out.location.lat !== "number" || typeof out.location.lon !== "number") {
    out.location.lat = defaultData().location.lat;
    out.location.lon = defaultData().location.lon;
  }

  return out;
}

export function formatUpdated(iso) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// Open-Meteo weather codes: https://open-meteo.com/en/docs
export const WEATHER_CODE = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤️" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫️" },
  48: { label: "Rime fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  53: { label: "Drizzle", icon: "🌦️" },
  55: { label: "Heavy drizzle", icon: "🌧️" },
  56: { label: "Freezing drizzle", icon: "🌧️" },
  57: { label: "Freezing drizzle", icon: "🌧️" },
  61: { label: "Light rain", icon: "🌧️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy rain", icon: "🌧️" },
  66: { label: "Freezing rain", icon: "🌧️" },
  67: { label: "Freezing rain", icon: "🌧️" },
  71: { label: "Light snow", icon: "🌨️" },
  73: { label: "Snow", icon: "🌨️" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "🌨️" },
  80: { label: "Rain showers", icon: "🌦️" },
  81: { label: "Rain showers", icon: "🌦️" },
  82: { label: "Violent showers", icon: "⛈️" },
  85: { label: "Snow showers", icon: "🌨️" },
  86: { label: "Snow showers", icon: "❄️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
  96: { label: "Thunderstorm + hail", icon: "⛈️" },
  99: { label: "Thunderstorm + hail", icon: "⛈️" },
};

export function describeWeatherCode(code) {
  const c = Number(code);
  return WEATHER_CODE[c] || { label: "Unknown", icon: "🌡️" };
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function isCacheFresh(fetchedAtIso, cacheMinutes) {
  if (!fetchedAtIso) return false;
  const t = new Date(fetchedAtIso).getTime();
  if (Number.isNaN(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs < cacheMinutes * 60 * 1000;
}
