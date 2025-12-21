# Family Home Dashboard (v1.3)

Touch-first, always-on "dashboard OS" window manager for Raspberry Pi 5 + 1920×1080 touchscreen.

## Run

```bash
npm install
npm run dev
```

## Core rules

- One localStorage key: `family_dashboard_db_v1`
- SystemBar always renders (never blank dashboard)
- Modules are drop-in: add `src/modules/<id>/index.js` exporting `moduleDef`
- Modules default OFF; enable in Settings → Modules

## Add a module

1. Copy `src/modules/template/` to `src/modules/<yourId>/`
2. Update `<yourId>/index.js`:
   - `id`, `title`, `icon`, `Component`, optional `defaultData`, optional `dependencies`
3. Run the app → Settings → Modules → enable + Ensure Window

## Architecture (quick)

- `src/App.jsx` = window manager only
- `src/core/dashboardStore.js` = unified storage API
- `src/core/moduleLoader.js` = glob discovery + validation + dependency ordering
- `src/ui/*` = window system + settings UI

## Export / Import

Settings → Data:
- Export ZIP: `manifest.json`, `meta.json`, `assets/`
- Import ZIP: safe if modules are missing (data preserved)
