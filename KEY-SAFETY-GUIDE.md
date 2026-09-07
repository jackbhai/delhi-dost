# Key safety guide — Live Buses in Delhi DOST

This file answers one question: **"I have the live-data key. How do I use it so
that nobody else can access it?"**

Short answer: the key is stored once, on the server (Vercel), inside an
environment variable. It is never written into the app code, never shipped in
the built files, and never sent to a visitor's browser. Visitors only ever talk
to the app's own relay endpoint — the key itself never leaves the server.

---

## 1. The danger you are avoiding

If you paste the key into front-end code (e.g. a `fetch()` in the app or a
config file), then **any visitor can open DevTools, read the network request,
copy the key, and use it themselves** (or sell it). Even a "hidden" config file
is served to the browser, so hiding does not help.

The fix is the **relay pattern**: the browser calls *your* endpoint
`/api/live-bus`; that endpoint (a serverless function) holds the key in an
environment variable, calls the live service server-side, and returns only
clean JSON to the app.

```
Visitor's browser                 Your serverless relay                 Live feed
┌─────────────────┐   /api/live-bus   ┌──────────────────┐  fetch with   ┌──────────┐
│ Delhi DOST app   │ ───────────────► │ api/live-bus.mjs │  key from env │ live API │
│ (no key, ever)   │ ◄─────────────── │ OTLIVE_KEY       │ ───────────► │ (govt)   │
└─────────────────┘    JSON only      └──────────────────┘   (never to   └──────────┘
                                                              browser)
```

## 2. Set-up (5 minutes)

1. **Deploy** this project to Vercel (see README → Deploy).
2. In the Vercel dashboard open your project:
   **Settings → Environment Variables → Add New**:
   - Key: `OTDLIVE_KEY`
   - Value: your live-data key
   - Environments: Production (Preview is optional)
   - click **Save**.
3. **Redeploy** (Deployments → ⋮ → Redeploy) so the new variable is picked up.
4. Verify: open `https://YOUR-APP.vercel.app/api/live-bus` in a browser —
   you should see `{"ok":true,"count":N,"buses":[…]}`.
5. Open the app → **Live Buses** tile → the map fills with moving buses.

No key appears anywhere in this process except inside Vercel's dashboard.

## 3. Why nobody can steal it from your site

| Attack | Why it fails |
|---|---|
| Read the JS bundle / source | The key is not in the repo or the bundle — it only exists in the serverless runtime's environment |
| Watch network requests | The browser only calls `/api/live-bus`; no request contains the key |
| Read your GitHub repo | `.gitignore` excludes `.env*`; the key was never committed |
| Call the live service directly with their own key | They'd need *their own* key — nothing in your site gives them yours |
| Abuse your relay | They can consume your relay's quota, but they still never see the key; it cannot be extracted server-side |

## 4. Honest limits (read this)

- The relay endpoint is public by design (the app is a public site). Anyone
  could call `/api/live-bus` and burn a little of your **relay usage**. The
  app itself polls only every ~30 s per open tab, and responses carry a
  5-second cache header, so normal use is tiny. If you ever see heavy external
  use, you can add a simple app-level token later — but for a free-scale
  project this is normally a non-issue.
- Respect the live service's terms: no "unreasonable use", don't poll faster
  than ~10–15 s, and don't redistribute the raw feed. This app follows that.
- The key you were issued is for **non-commercial** use unless you selected
  otherwise. If you later add ads/monetisation, contact the issuing portal to
  confirm/upgrade permission first.
- If you ever suspect the key leaked (e.g. you pasted it into a public repo by
  mistake): remove it from the repo, delete the commit from history if public,
  and request a fresh key from the portal's contact page.

## 5. Local development

For local work the app runs fine without the key (Live Buses shows a friendly
"relay not reachable" card). To test the relay locally:

```bash
# option A — Vercel CLI (closest to production)
npm i -g vercel
vercel dev            # then open the printed localhost URL; it reads env vars
vercel env add OTLIVE_KEY   # add it first, or use `vercel env pull`

# option B — plain node, one-off
OTDLIVE_KEY=yourkey node api/live-bus.mjs  # (works as a function file; run via vercel dev for the full behaviour)
```

## 6. How the code is organised (if you want to review)

- `api/live-bus.mjs` — the only file that reads `process.env.OTDLIVE_KEY`.
  Fetches the live feed, decodes it (bundled minimal GTFS-RT reader — no
  external dependencies), returns small JSON: `id, label, route, trip, lat,
  lon, bearing, speed, status, stop, ts`.
  - `503` → key not configured (setup step 2 pending)
  - `502` → live service unreachable
  - `400` → payload could not be decoded
- `src/tools/live-bus.jsx` — the map + list screen. It calls `/api/live-bus`
  (same origin), never holds a key, and degrades gracefully when the relay is
  absent.
- `public/sw.js` explicitly **never caches** `/api/*`, so live data is always
  fresh and never stored on a visitor's device beyond the current screen.
- `src/core/live-check.js` — the Settings health panel includes a "Live Buses
  Relay" check that tells you exactly which state the setup is in.
