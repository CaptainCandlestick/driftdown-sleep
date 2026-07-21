# DriftDown — Sleep Sound

A binaural-beat sleep sound player you run from your iPhone's browser. No app store, no build step — plain HTML/CSS/JS using the Web Audio API.

**Live:** https://captaincandlestick.github.io/driftdown-sleep/ — works from your phone anytime, no laptop required.

## What it does

Generates two sine tones live (one per ear) with a small, slowly-changing frequency difference between them — the "binaural beat." Over the course of a session the beat glides from alpha/theta rates down toward theta/delta, roughly following the rhythm a brain follows when it falls asleep naturally. An optional noise bed plays underneath to mask the tone and soften it — **pink noise** by default (steady pink noise during sleep has been linked to increased slow-oscillation activity and more deep/N3 sleep) or **brown noise** (deeper, softer), switchable from Advanced settings.

Three sessions:
- 🌊 **Quick Wind-Down** (~20 min) — alpha → theta, for settling a busy mind.
- 🌙 **Deep Sleep Onset** (~45 min) — full alpha → theta → delta glide.
- ✨ **All Night** (up to 8 hrs) — steady low-volume delta, for staying asleep.

A 4-question check on first launch just picks a sensible default; you can always start any session manually.

The player screen shows a live **Left / Right / Beat Hz readout** under the timer — this is the exact frequency the app has scheduled for right now, so you can confirm the tone matches the intended protocol (e.g. Deep Sleep Onset should start around Left 176 Hz / Right 184 Hz / Beat 8 Hz and drift down toward Beat 2.5 Hz). For an independent check of what's actually reaching your ears, a tone/spectrum-analyzer app can measure it against this readout. Above the timer, a **breathing orb** pulses in sync with the session — faster during the alpha wind-down, slowing to a long, calm breath as the beat drifts down toward delta.

The in-app "How this actually works" screen links the actual research this is based on (Sleep Foundation, a 2025 PMC meta-analysis on acoustic stimulation for insomnia, a theta-binaural/insomnia study, and the pink-noise/slow-oscillation research) and says plainly that the evidence is mixed — this is a sound tool, not a medical treatment.

Visual theme is **Calm Teal** — dark slate-teal background with a soft mint accent, chosen from a set of three directions (Aurora / Midnight Noir / Calm Teal) reviewed side-by-side before picking.

## Running it

Just open the live link above in **Safari** on your iPhone (not Chrome — this relies on iOS-specific Web Audio/PWA behavior). It's hosted on GitHub Pages, so no laptop/local server needed.

For local development instead, from this folder:

```
python3 -m http.server 8000
```

Then, on your iPhone (same Wi-Fi network), go to `http://<this-computer's-LAN-IP>:8000`.

**Headphones are required** — binaural beats only work over stereo left/right separation.

Optional: Share → **Add to Home Screen** for an app-like icon and full-screen launch.

## Known limitations

- **Screen must stay unlocked during a session.** iOS suspends Web Audio when the tab is backgrounded/locked, so this can't yet survive a fully locked screen. The app requests a Wake Lock on session start so the display won't auto-lock — dim it or leave the phone face-down instead of pressing the lock button.
- **Offline/installable caching (the service worker) only registers over HTTPS or `localhost`.** The GitHub Pages link is HTTPS, so this works there; testing over `http://<lan-ip>:8000` skips that layer.
- True lock-screen playback (screen off, still playing) would need a different architecture — pre-rendering a session to an actual audio file and playing it through a standard `<audio src="...">` element, which iOS treats as real background media. Not implemented yet.

### If the app looks stuck on an old version

The service worker uses a network-first strategy (always prefers the live file when online, only falling back to its cache offline), so redeploys should normally show up automatically. If a device ever seems stuck on a stale version anyway: remove it from the Home Screen, then on the iPhone go to **Settings → Apps → Safari → Advanced → Website Data**, find the site, delete it, and re-add it fresh — that fully unregisters the old service worker and cache.

## Files

- `index.html` / `styles.css` — screens: intro/disclaimer, science info, assessment, session picker, player.
- `app.js` — protocol definitions, the `BinauralEngine` (Web Audio graph + scheduling), UI wiring, Wake Lock, breathing-orb pulse timing.
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA install/offline support.
