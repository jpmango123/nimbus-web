# Nimbus iOS — RadarCore (Swift)

`ios/RadarCore/` is a standalone SwiftPM package containing the **Swift port of
the web `RadarCore`** (`src/lib/radar/RadarCore.ts`). It is the platform-agnostic
radar logic — source catalog, NEXRAD site list, nearest-site selection with
hysteresis, the animation frame model, and the pure `sourcesForViewport` /
`framesForLoop` / `tileURL` functions — with **no UI and no map SDK imports**.

The two ports are intentionally **structurally identical**: same type names,
same function names, same constants. Each file carries a
`KEEP IN SYNC WITH …` header. If you change an endpoint, a site, an opacity
default, or a signature in one, mirror it in the other in the same commit.

## Build / test (on a Mac, or any machine with the Swift toolchain)

```bash
cd ios/RadarCore
swift test        # runs RadarCoreTests (pure logic, no network — fetch is injected)
```

> ⚠️ These Swift files were authored in a Linux CI container where the Swift
> toolchain could not be installed (the host allowlist blocks
> `download.swift.org`) **and an iOS Simulator cannot run on Linux at all**
> (Simulator requires macOS + Xcode). So the package is **not yet compiled** —
> build it on your Mac. The logic mirrors the TypeScript port, which is
> type-checked and lint-clean.

## Wiring it into the iOS app (next steps, on your Mac)

1. Add `RadarCore` to your app — either:
   - drag `Sources/RadarCore/RadarCore.swift` into the Xcode project, or
   - add this folder as a local Swift package dependency.
2. Build the thin adapter **`RadarMapController.swift`** over **MapLibre Native**
   (the iOS twin of `src/lib/radar/radarMap.ts`). It should contain *only* map
   SDK glue — add/remove raster sources + layers, set opacities — and translate
   `RadarSource` / `RadarFrame` from `RadarCore` into MapLibre Native calls.
   Mirror the web adapter's behaviour:
   - raster sources with `tileSize: 256`, inserted **below** the basemap's
     symbol (label) layers;
   - the **flicker-free animation**: a pre-added per-frame layer stack, all
     preloaded, animated by a **constant-intensity crossfade** driven by
     `CADisplayLink` (the iOS equivalent of the web `requestAnimationFrame`
     loop) — older frame fully opaque underneath, newer frame faded in on top,
     using `CROSSFADE_STEP_MS` / `LAST_FRAME_PAUSE_MS`.
3. Build the control panel (toggle / opacity / play-pause / scrubber / loop-mode
   / dBZ legend / attribution) to match the web `RadarControls`.

See `../RADAR.md` for the full rationale (layering, animation choice, MRMS
fallback, IEM courtesy constraints, and the data-shape verification note).
