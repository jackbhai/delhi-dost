# Delhi DOST

Delhi ka apna travel companion — **Bus · Metro · Train · Live Buses · Journey Planner**, sab kuch ek chhote, fast PWA mein. No login, no ads, offline-first.

> Inspired by the OmniTools project but rebuilt as a **travel-only app** with its own
> identity, colour system and a secure live-bus relay.

---

## Features

| App section | What it does |
|---|---|
| **Bus** | Har Delhi route (1,335+ route numbers), stop-wise timetables, "next bus right now", fare slabs, get-off alerts |
| **Metro** | Saari 287 stations, lines, fares (25 Aug 2025 slabs), first/last train, station ↔ bus links |
| **Train** | Live running status, schedules, trains between two stations, long-journey planner |
| **Live Buses** | Real bus positions on a map + route filter (needs the relay + key — see KEY-SAFETY-GUIDE.md) |
| **Plan Journey** | Multi-modal planner: bus + metro + walking combined, with map and step-by-step alerts |
| **Near Me** | ATM / food / fuel / hospitals around you |
| **Travel Guide / Emergency / Dial Codes** | City info, SOS helplines (India & world), country calling codes |
| **Essentials** | Weather + AQI, PIN-code post offices, currency, world clock |
| **Settings** | Themes (7 + custom), tap sounds, install-as-app, live health check |

- 5 tools run fully **offline** (bus + metro data is bundled in the app).
- Live tools auto-try the next channel if one is unreachable.
- PWA: installs on home screen, works offline after first visit.

---

## Project layout

```
api/live-bus.mjs          # serverless relay — the ONLY place the live key lives
api/live-bus.test.mjs     # protobuf round-trip test (npm run test:livebus)
public/
  sw.js                   # service worker (network-first shell)
  manifest.webmanifest    # PWA manifest (Delhi DOST)
  icon.svg / icon-192.png / icon-512.png
src/
  App.jsx                 # app shell, registry, home grid, bottom nav
  styles/theme.css        # design system (fonts + palette)
  styles/dost.css         # Delhi DOST polish layer
  core/…                  # engines: bus-route, metro-route, trains, trip, geo…
  tools/…                 # screen components for every feature
  data/*.json             # bus, metro & station datasets
```

---

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000 (Vite dev server)
```

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
npm run test:livebus
```

## Deploy (Vercel, with the live-buses feature)

1. Push this folder to a GitHub repo.
2. On Vercel: **Add New → Project → Import** the repo.
   - Framework preset: **Vite** (auto-detected), build `npm run build`, output `dist`.
3. **Before/right after deploy** set one environment variable:
   - Name: `OTDLIVE_KEY`
   - Value: your live-data key (from the key you were issued)
   - Scope: Production (+ Preview if you like)
4. Deploy → open your site → **Live Buses** tile. Done.

How the key stays safe, what to do if something fails, and every security detail:
→ **[KEY-SAFETY-GUIDE.md](./KEY-SAFETY-GUIDE.md)**

> Note: maps show a small "© OpenStreetMap" credit — that is the map tiles'
> licence requirement and cannot be removed; it applies to every app using
> those free tiles. Nothing else about data origins is shown anywhere.

## Notes

- Bus & metro datasets are **bundled snapshots** (built from official public
  operator publications); schedules are matched against the device clock.
  Live vehicle positions come only from the relay feature described above.
- Station names and routes may change — dataset date is shown in-app
  ("built …"). Rebuild/refresh data whenever operators announce changes.
