# Nimbus iOS — Claude Code context

iOS counterpart to the `nimbus-web` web app. You're most likely here to build the
**radar feature**. Start with `ios/README.md` (full plan + paste-in prompt) and
`ios/RadarCore/Sources/RadarCore/RadarCore.swift` (the shared logic, already
written and tested).

> Copy this file to your **iOS app repo root as `CLAUDE.md`** so it auto-loads
> when you open that project directly.

## Commands

- **Test the shared core** (no app/simulator needed):
  `cd ios/RadarCore && swift test`
- **List schemes** (find the app's scheme name first):
  `xcodebuild -list`
- **Build for simulator** (replace `<Scheme>`):
  `xcodebuild -scheme <Scheme> -destination 'platform=iOS Simulator,name=iPhone 16' build`
- **Run app tests**:
  `xcodebuild test -scheme <Scheme> -destination 'platform=iOS Simulator,name=iPhone 16'`
- **Boot a simulator to view the app**:
  `xcrun simctl boot "iPhone 16"; open -a Simulator`

## Rules

- `RadarCore.swift` MUST stay **1:1** with
  `nimbus-web/src/lib/radar/RadarCore.ts` — same type names, function names, and
  constants. Edit both together; both carry `KEEP IN SYNC` headers.
- The adapter (`RadarMapController`) is **MapLibre Native glue only** — no radar
  logic, no endpoint strings, no site math. That all lives in `RadarCore`.
- This MapLibre Native / Swift / iOS SDK may differ from your training data —
  **check the installed SDK's headers/docs before coding against its API.**

## Radar gotchas (learned on the web build — don't repeat them)

- **256** tile size on every raster source (wrong size mis-aligns/blurs IEM).
- Animate with a **true dissolve** (old frame fades out `1-f`, new fades in `f`).
  Holding the old frame opaque freezes motion — only edges "glow."
- **Preload all frames before playing** (the main cure for stop-and-go).
- **5-min** composite steps = IEM's native cadence; bigger steps look jumpy.
- Ensure the `MLNMapView` has **real bounds** before adding layers (a 0-size
  container renders tiles to nothing).
- Verify MapLibre Native supports the WMS **`{bbox-epsg-3857}`** token for the
  composite WMS-T loop; if not, fall back to the relative `-mNNm` XYZ composite
  tiles (50-min loop) or compute the bbox per tile.
- Truly fluid motion needs optical-flow interpolation = a server. Out of scope
  (no backend). Dissolve + 5-min frames is the client-side ceiling.
