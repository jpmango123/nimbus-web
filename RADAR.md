# Nimbus Radar

High-resolution weather radar for the Nimbus web app (and, by design, a 1:1
Swift port for iOS). Built around hosted public tile/WMS endpoints — **no
backend, no proxy, no API keys, no build-time fetching of radar data.**

## Architecture: shared core + thin adapter

```
RadarCore (pure logic, no UI / no map SDK)   src/lib/radar/RadarCore.ts
    │   sources catalog · NEXRAD site list · constants
    │   nearestSite / selectSite (hysteresis)
    │   framesForLoop · tileURL · sourcesForViewport
    ▼
radarMap.ts (web adapter — MapLibre GL JS glue only)   src/lib/radar/radarMap.ts
    ▼
RadarView.tsx (map host + animation loop + health check)   src/components/radar/RadarView.tsx
RadarControls.tsx (presentational UI + dBZ legend)         src/components/radar/RadarControls.tsx
/radar page                                                src/app/radar/page.tsx
```

`RadarCore.ts` is the **single source of truth** for endpoints, the site list,
opacities, zoom thresholds, and timing. It carries a
`// KEEP IN SYNC WITH iOS Swift port: Nimbus/Sources/Radar/RadarCore.swift`
header. The intended iOS port mirrors the **same type names, function names, and
constants** (struct/enum + async functions) so the two platforms never drift.
The adapters (`radarMap.ts` here; `RadarMapController.swift` on iOS) contain
**no radar business logic** — only map-SDK source/layer glue.

> iOS note: the web side is fully implemented here. The **Swift port of
> `RadarCore`** lives in `ios/RadarCore/` (a SwiftPM package with unit tests) —
> see `ios/README.md`. The iOS map adapter (`RadarMapController` over MapLibre
> Native) and controls still need to be wired up on a Mac; the iOS app itself is
> not in this repo.

## Endpoints used (exact, no keys)

| Purpose | Endpoint |
| --- | --- |
| CONUS composite (always on) | `…/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png` |
| Single-site latest (N0B) | `…/cache/tile.py/1.0.0/ridge::{SITE}-N0B-0/{z}/{x}/{y}.png` |
| Single-site timestamped frame | `…/c/tile.py/1.0.0/ridge::{SITE}-N0B-{YYYYmmddHHMM}/{z}/{x}/{y}.png` |
| Single-site scan list | `…/json/radar.py?operation=list&radar={SITE}&product=N0B&start={ISO}&end={ISO}` |
| National loop index | `https://api.rainviewer.com/public/weather-maps.json` |
| National loop tile | `{host}{path}/256/{z}/{x}/{y}/2/1_1.png` (scheme 2, smooth+snow) |
| Reliability fallback (WMS) | NOAA MRMS `conus_bref_qcd` GetMap, EPSG:3857, 256×256 |

- All raster sources use **`tileSize: 256`** (never MapLibre's 512 default — it
  misaligns/blurs IEM tiles).
- `{SITE}` is the 3-letter NEXRAD ID **without the leading "K"**.
- Timestamped single-site frames use the **`/c/`** path (stable → better client
  caching); only the rolling `-0` "latest" layers use `/cache/`.
- RainViewer is **capped at zoom 7** and is only used in National mode (zoomed
  out). `radar.past[].time` is epoch **seconds**.

### Basemap (also key-free)

CARTO `dark_nolabels` raster base + `dark_only_labels` raster overlay. Radar
layers are inserted **before** the `carto-labels` layer so place names stay
readable on top of the radar (`LABELS_LAYER_ID` in `radarMap.ts`; falls back to
the first symbol layer, then top-of-stack).

## Why composite + single-site layering

- **N0Q composite** is a seamless CONUS mosaic (~0.25 km source, ~5-min updates)
  — great context, no single-radar artifacts, but soft when you zoom in.
- **N0B single-site** is the sharpest free *observed* radar (~0.25 km gates,
  0.5° azimuth) but has per-radar artifacts (cone of silence, range folding).

So the single-site layer is drawn **on top of** the composite, and **only at
zoom ≥ 8**. The composite always stays underneath to fill the single-site's
gaps — the single-site is **never shown alone**. The active single site is the
nearest NEXRAD to the map center (great-circle), with **25 km hysteresis** so it
doesn't thrash at boundaries. New England catalog: GYX (home/default), BOX, CBW,
ENX, OKX.

## Animation

Two user-toggleable loop modes (the UI *suggests* Local when zoomed in near a
New England site, otherwise Composite — but never auto-switches):

- **Composite (smooth · US)** — the default, primary loop. Uses IEM's time-aware
  **WMS-T** composite (`n0q-t.cgi`, layer `nexrad-n0q-wmst`), which serves any
  5-min UTC timestamp — so the loop spans a full **3 hours** (`COMPOSITE_WINDOW_MIN`
  = 180) in **15-min steps** (`COMPOSITE_STEP_MIN`, ≈13 frames). Long enough to
  see real storm motion; light enough to stay a good IEM citizen. Timestamps are
  synthesized locally (5-min aligned, small lag) — **no scan listing**. Works
  CONUS-wide at all zooms. The animated frame stack *is* the composite (the
  static `/cache/` composite layer is removed while it plays). The relative
  `-mNNm` form is capped at 50 min, which is why we use WMS-T for the long loop.
- **Local (hi-res)** — animated single-site **N0B** for the nearest New England
  site (lists scans via `radar.py?operation=list`, builds `…-N0B-{stamp}` tiles),
  with the static composite kept underneath to fill gaps. Only renders at
  zoom ≥ 8 and only over New England, so the UI shows a hint elsewhere.

> **Why not RainViewer?** It was retired: only ~13 frames at **10-min** spacing
> and **capped at zoom 7** — the coarsest option on every axis. The IEM 5-min
> composite is denser, zoomable, and works everywhere, so it's strictly better
> for smoothness. (RainViewer endpoint constants remain in the catalog for
> reference but are no longer wired into a mode.)

### Smoothness: continuous constant-intensity crossfade (no stop-and-go)

The goal is one flowing loop, not a slideshow. Three levers (the consensus
technique for web-map radar — see the MapLibre "animate a series of images"
example, the RainViewer API example, and `weather-radar-card`):

1. **Pre-added per-frame layer stack.** Each frame is its own raster
   source+layer, added at `raster-opacity` 0 but `visibility:'visible'` so
   MapLibre eagerly loads its tiles for the viewport. We never call
   `source.setTiles()` during playback (that re-requests tiles and blinks each
   step). `raster-fade-duration` is 0 so we own the blending.
2. **Full preload before playing.** `buildAndPlay` awaits `waitTilesLoaded()`
   (`map.areTilesLoaded()` / `idle`) before starting, so the loop never stalls
   on a network fetch mid-flight — the other big cause of stutter.
3. **`requestAnimationFrame`, time-based.** A float playhead `pos ∈ [0, n)`
   advances by `dt / CROSSFADE_STEP_MS` each tick (frame-rate-independent, no
   `setInterval` drift). `floor(pos)` is the frame; the fraction is the blend.

**Dissolve crossfade:** the outgoing frame fades OUT (`1 - f`) while the
incoming frame fades IN (`f`) — `showFrameBlend([[i, 1-f], [i+1, f]])`. This is
required for perceived **motion**: holding the old frame opaque (an earlier
attempt) freezes persistent echoes in place so storms don't appear to move (only
the leading edge "glows"); a true dissolve lets old echoes leave and new ones
arrive, so cells move/morph between scans. The mild brightness dip at the 50%
blend point is the normal radar-loop look and is well worth the motion. React
state (scrubber/label) updates only on whole-frame changes, not every tick.
There is a ~1 s dwell on the newest frame before the wrap. The scrubber
auto-pauses and seeks; the timestamp label is the displayed frame in
**device-local** time.

> **Honest limit:** this is a smooth *dissolve*, not true echo *motion*
> interpolation. Making rain physically glide between scans (Windy/MyRadar
> style) needs per-pixel optical-flow morphing computed on a **server** — not
> possible from raster tiles with no backend. Crossfade + preload + rAF is the
> smoothest achievable on this stack. If you ever add even a tiny serverless
> function, optical-flow frame interpolation (e.g. RainViewer's interpolated
> frames, or a Farneback/TVL1 flow warp) is the next step up.

## Reliability fallback (health check)

`RadarView` listens to MapLibre `error` events for IEM radar sources
(`radar-composite-iem*`, `radar-single`, local `radar-frame*`). If **≥ 5
failures within 30 s** occur, the active CONUS source switches to **NOAA MRMS**
(`conus_bref_qcd` WMS, public domain, ~1 km), a small **"⚠ using backup radar"**
indicator appears, and a 5-min cooldown starts. Recovery to IEM happens on a
manual **⟳ refresh** (after the cooldown). MapLibre's `{bbox-epsg-3857}` token
drives the WMS GetMap requests directly — no proxy.

## IEM courtesy constraints (please keep)

- Tiles are **client-cached** by the browser; timestamped frames use the stable
  `/c/` path to maximize cache hits.
- The scan-list JSON is polled **at most once per 60 s** (`listCacheRef` +
  `LIST_MIN_POLL_INTERVAL_MS`); frames are built **once per loop refresh**, not
  continuously.
- No aggressive prefetch beyond the current viewport, no parallel mass requests.
  This is a personal, low-volume app — it stays that way.

## ⚠ Verification gap (read before trusting the JSON parsing)

The endpoint **URL templates are exactly as specified** in the brief — none were
invented. However, the build/CI sandbox blocks `mesonet.agron.iastate.edu` and
`api.rainviewer.com` (host allowlist), so the **live JSON response shapes could
not be verified here**. The parsers in `framesForLoop` are written **defensively
against the documented public formats**:

- IEM list: accepts `{ scans: [...] }` or a bare array; items may be ISO strings
  or objects keyed `ts` / `valid` / `time`.
- RainViewer: `host` + `radar.past[].{time,path}`.

On any unexpected shape, parsing returns `[]` and the UI **gracefully falls back
to the live "latest" layer** instead of crashing. **Please confirm the real
shapes in the browser** (devtools → Network) on first run; if a field name
differs, adjust the small parsers in `RadarCore.ts` (`localFrames` /
`nationalFrames`) — do not change the URL templates.

## Testing

1. `npm run dev`, open `/radar` (also linked from the dashboard nav).
2. **Static composite:** load shows the N0Q composite over New England.
3. **Single-site:** zoom to ≥ 8 near the coast — GYX N0B layers on top; pan
   toward Boston and confirm the site swaps to BOX (with hysteresis).
4. **Animation:** Play in Composite mode (smooth 50-min US loop, works anywhere);
   over New England at zoom ≥ 8, switch to Local for the sharp single-site loop.
   Scrub the timeline; check the timestamp.
5. **Opacity / toggle:** slider and Radar On/Off behave.
6. **Fallback:** to exercise it, temporarily break the IEM host and confirm the
   "using backup radar" indicator + MRMS imagery, then ⟳ to recover.
