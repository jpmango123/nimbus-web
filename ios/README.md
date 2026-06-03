# Nimbus iOS — Radar Implementation Guide

This folder hands the **finished, tuned** web radar design over to the iOS app.
It exists so that — on your Mac, with Claude Code — you can build the iOS radar
in one focused session. The hard design/debugging work is already done on the
web side; iOS is a port of a known-good architecture.

> **The iOS app is not in this repo.** Copy what you need from here into the
> Nimbus iOS project (see "Integration" below), or open both folders together.

---

## ⚡️ Paste this to Claude Code tonight (starting prompt)

> Read `ios/RadarCore/` and `ios/README.md` from the nimbus-web checkout (I'll
> point you at it). Then implement the radar feature in my Nimbus **iOS** app,
> which already shows a **MapLibre Native** map. Port it from the finished web
> version:
> 1. Add the `RadarCore` Swift package (or copy `RadarCore.swift`) and run
>    `swift test` to confirm the logic.
> 2. Build `RadarMapController` (MapLibre Native adapter) — raster sources/layers
>    only, **no business logic** — mirroring `src/lib/radar/radarMap.ts`.
> 3. Build the animation engine on a `CADisplayLink` mirroring the web
>    `requestAnimationFrame` loop: a **pre-added per-frame raster layer stack**,
>    fully **preloaded**, animated by a **true dissolve crossfade** (old frame
>    fades out `1-f`, new fades in `f`), with a **playback-speed** control.
> 4. Build the SwiftUI/UIKit control panel (toggle, opacity, play/pause, timeline
>    scrubber, **speed slider**, loop-mode Composite/Local, dBZ legend,
>    attribution).
> Tell me where the map is initialized first, then implement in that order,
> summarizing after each step. Keep `RadarCore.swift` byte-for-byte in step with
> `src/lib/radar/RadarCore.ts` (same names/constants).

---

## What's already done (in this folder)

- **`RadarCore/Sources/RadarCore/RadarCore.swift`** — the platform-agnostic core,
  a 1:1 mirror of `src/lib/radar/RadarCore.ts`: source catalog, NEXRAD site list,
  nearest-site selection + hysteresis, the frame model, and the pure
  `sourcesForViewport` / `framesForLoop` / `tileURL` functions. **No UI, no map
  SDK.** Already reflects every tuning decision below.
- **`RadarCore/Tests/RadarCoreTests/`** — XCTest coverage (site selection,
  viewport, composite frame generation, `tileURL`, graceful parsing). Run
  `cd ios/RadarCore && swift test` on your Mac to confirm.

## The final architecture (what to build on top)

Two animated loop modes + a reliability fallback, all from hosted public
endpoints, **no backend, no API keys**:

1. **Composite (smooth · US) — the default.** Animated **IEM time-aware WMS-T**
   composite (`IEM_COMPOSITE_WMST`, layer `nexrad-n0q-wmst`). `framesForLoop(.composite,…)`
   synthesizes **5-min-aligned UTC timestamps over a 2-hour window**
   (`COMPOSITE_WINDOW_MIN`=120, `COMPOSITE_STEP_MIN`=5 → ~25 frames). `tileURL`
   turns each frame into a WMS `GetMap` with `{bbox-epsg-3857}` + `TIME`.
   CONUS-wide, works at all zooms. ⚠️ **Verify MapLibre Native supports the
   `{bbox-epsg-3857}` token** in raster source tile URLs (it does in GL JS;
   confirm on iOS). If not, render the bbox per tile yourself or fall back to the
   relative `-mNNm` XYZ tiles (50-min loop).
2. **Local (hi-res).** Animated single-site **N0B** for the **nearest US NEXRAD**
   (`framesForLoop(.local,…)` lists scans via `IEM_SCAN_LIST`, builds
   `…-N0B-{stamp}` tiles), with the static composite kept underneath. Renders at
   **zoom ≥ 8**; show a hint if zoomed out or far from any site.
3. **Fallback.** If IEM composite tiles repeatedly error
   (`HEALTH_FAIL_THRESHOLD`=5 within `HEALTH_FAIL_WINDOW_MS`=30 s), switch the
   CONUS source to **NOAA MRMS** (`mrmsSource()`), show a "using backup radar"
   indicator, recover after `HEALTH_RECOVERY_COOLDOWN_MS` / manual refresh.

Basemap: insert all radar raster layers **below the basemap's label (symbol)
layers** so place names stay readable (MapLibre Native: `style.insertLayer(_,
below:)` before the first symbol layer).

## Animation engine (port of `radarMap.ts` + the loop in `RadarView.tsx`)

This is the part that took the most tuning — replicate it exactly.

- **Pre-added per-frame layer stack.** For each frame, add its own
  `MLNRasterTileSource` + `MLNRasterStyleLayer` at **opacity 0 but visible**, so
  tiles eagerly load. Never swap tile URLs on one source mid-play (it blinks).
- **Full preload before playing.** Wait until all frame tiles are loaded
  (`MLNMapViewDelegate` `mapViewDidFinishLoadingMap` / tile-load callbacks; poll
  an "all loaded" condition up to ~20 s) before starting the loop — this is the
  main thing that removes stop-and-go stutter.
- **`CADisplayLink`** is the iOS `requestAnimationFrame`. Keep a float playhead
  `pos ∈ [0, n)`. Each tick (`dt` = seconds since last × 1000 ms):
  ```
  pos += dt * speed / CROSSFADE_STEP_MS      // CROSSFADE_STEP_MS = 850
  let i = floor(pos), f = pos - i
  ```
- **True dissolve crossfade** (critical — a "hold old frame opaque" approach
  freezes motion; we learned this the hard way):
  ```
  forward (i < n-1):  layer[i].opacity   = (1 - f) * base
                      layer[i+1].opacity =      f  * base
  wrap   (i == n-1):  layer[n-1].opacity = (1 - f) * base
                      layer[0].opacity   =      f  * base
  all other frame layers: opacity 0
  ```
  `base = source.opacity * masterOpacity` (opacity slider). Only touch layers
  whose opacity changed each tick.
- **Dwell** ~`LAST_FRAME_PAUSE_MS`/speed (1000 ms ÷ speed) on the newest frame
  before looping; update the timestamp label only when the displayed whole-frame
  index changes (not every tick).
- **Speed control:** a **log slider 0.25×–4×, 1× centered**:
  `speed = 0.25 * pow(16, t)` for slider `t ∈ [0,1]`. Read it live so dragging
  changes pace without restarting.

## UI controls (parity with `RadarControls.tsx`)

Radar on/off · opacity slider · play/pause · timeline **scrubber** (auto-pauses,
seeks) · **speed slider** · loop-mode switch (**Composite** / **Local**) ·
**dBZ legend** (the N0Q/N0B color ramp) · **attribution** ("Iowa Environmental
Mesonet / NWS", or "NOAA / NWS MRMS" on fallback) · timestamp label in
**device-local** time. Suggest Local only when zoomed in (≥8) near a radar
site; don't auto-switch.

## Tuned constants (already in `RadarCore.swift` — don't re-derive)

`TILE_SIZE`=256 · `COMPOSITE_OPACITY`=0.75 · `SINGLE_SITE_OPACITY`=0.85 ·
`SINGLE_SITE_MIN_ZOOM`=8 · `CROSSFADE_STEP_MS`=850 · `LAST_FRAME_PAUSE_MS`=1000 ·
`COMPOSITE_WINDOW_MIN`=120 · `COMPOSITE_STEP_MIN`=5 · `COMPOSITE_LAG_MIN`=5 ·
`SITE_SWITCH_HYSTERESIS_KM`=25 · health 5/30 s, cooldown 5 min. Site catalog:
full US WSR-88D network (155 sites in `NEXRAD_SITES`); GYX is the home default.

## Lessons from the web build (avoid these traps)

- **Tiles can load but render nothing if the map container has zero height** — on
  iOS make sure the `MLNMapView` has real bounds before adding layers.
- **256 tile size everywhere.** Wrong size mis-aligns/blurs IEM tiles.
- **No motion if you hold the old frame opaque.** Use the dissolve above.
- **Jumpy if frames are too far apart.** 5-min steps are IEM's native cadence —
  the smoothest the data allows. Bigger steps look like teleporting.
- **Truly fluid motion needs optical-flow interpolation = a server.** Out of
  scope (no backend). Dissolve + 5-min frames is the ceiling client-side.
- **Be a good IEM citizen:** don't poll the scan list more than once/60 s; build
  frames once per play; don't mass-prefetch beyond what preload needs.

## Integration

Either:
- **Copy** `RadarCore/Sources/RadarCore/RadarCore.swift` into the iOS app target
  (simplest), or
- add `ios/RadarCore` as a **local Swift package** dependency.

Then build `RadarMapController.swift` (adapter) + the SwiftUI controls against
your existing MapLibre Native map. Keep `RadarCore.swift` and
`src/lib/radar/RadarCore.ts` edited together (both carry `KEEP IN SYNC` headers).

See `../RADAR.md` for the full web rationale (endpoints, layering, dissolve,
fallback, IEM courtesy, and the sandbox data-verification note).
