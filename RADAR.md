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

> iOS note: only the web side was implemented in this session (the iOS app is
> not in this repo / not reachable from this scope). `RadarCore.ts` is shaped to
> port directly to Swift.

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

Two user-toggleable loop modes; the UI auto-*suggests* Local at zoom ≥ 8 and
National at zoom < 8, but the user can override.

- **Local (hi-res):** lists recent scans via `radar.py?operation=list`
  (last ~90 min), builds per-frame `…-N0B-{stamp}` tiles, composite stays
  underneath.
- **National (smooth):** RainViewer `radar.past[]` (2 h @ 10-min steps); the IEM
  composite is removed in this mode (RainViewer is itself a national mosaic).

**Flicker-free approach (chosen):** a **pre-added per-frame layer stack toggled
by `raster-opacity`**. Each frame is its own raster source+layer added at
opacity 0 but `visibility:'visible'`, so MapLibre eagerly loads its tiles for the
current viewport (preload). Playback just flips `raster-opacity` between frames
— no `source.setTiles()` reload, so there is **zero per-frame network flicker**.
(`setTiles()` on a single source re-requests tiles and blinks each step.)
`raster-fade-duration` is 0 to keep frame switches crisp.

Playback: preload on `map.once('idle')`, then ~500 ms/frame, with a ~1 s dwell
on the newest frame before looping. A timeline scrubber lets you scrub frames
(auto-pauses), and the timestamp label shows the displayed frame in
**device-local** time (converted from UTC).

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
4. **Animation:** Play in Local mode (sharp local loop); zoom out and Play in
   National mode (smooth 2 h loop). Scrub the timeline; check the timestamp.
5. **Opacity / toggle:** slider and Radar On/Off behave.
6. **Fallback:** to exercise it, temporarily break the IEM host and confirm the
   "using backup radar" indicator + MRMS imagery, then ⟳ to recover.
