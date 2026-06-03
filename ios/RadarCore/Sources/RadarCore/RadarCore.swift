// =============================================================================
// RadarCore — platform-agnostic radar logic (NO UI, NO map SDK imports)
//
// Swift port of the web RadarCore. This is the single source of truth for the
// radar feature's data model on iOS:
//   - the catalog of radar SOURCES (endpoint templates, tile size, opacity…)
//   - the NEXRAD single-site catalog + nearest-site selector (with hysteresis)
//   - the animation frame model (fetch timestamps, build per-frame tile URLs)
//   - pure functions: sourcesForViewport / framesForLoop / tileURL
//
// KEEP IN SYNC WITH web TypeScript port:  src/lib/radar/RadarCore.ts
//   The two ports are intentionally STRUCTURALLY IDENTICAL — same type names,
//   same function names, same constants. If you change an endpoint, a site, an
//   opacity default, or a function signature here, mirror it there in the same
//   commit so the platforms never drift.
//
// NOTE: this package was authored on Linux where the Swift toolchain could not
// be installed (host allowlist blocks download.swift.org). Build/test it on a
// Mac (`swift test`) or in Xcode. The logic mirrors the verified TS port.
// =============================================================================

import Foundation

// MARK: - Source catalog (the ONE place endpoint templates live)

/// Rolling "latest" composite (XYZ, 256px). Uses /cache/ for the live tile.
public let IEM_COMPOSITE_TILE =
    "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png"

/// Time-aware composite (WMS-T): serves ANY 5-min UTC timestamp, so the loop can
/// span hours (the relative `-mNNm` form is capped at 50 min). {bbox} filled by
/// the map SDK; {TIME} = ISO8601 (YYYY-MM-DDTHH:MM:SSZ).
public let IEM_COMPOSITE_WMST =
    "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?service=WMS&version=1.1.1"
    + "&request=GetMap&layers=nexrad-n0q-wmst&styles=&bbox={bbox-epsg-3857}"
    + "&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true&time={TIME}"

/// Composite loop window/step (5-min aligned). 5-min = IEM native cadence (the
/// smoothest the data allows). 2 h @ 5-min ≈ 25 frames.
public let COMPOSITE_WINDOW_MIN = 120
public let COMPOSITE_STEP_MIN = 5
public let COMPOSITE_LAG_MIN = 5

/// Single-site latest frame (the trailing `-0` is "newest"). Uses /cache/.
public let IEM_SINGLE_LATEST_TILE =
    "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::{SITE}-N0B-0/{z}/{x}/{y}.png"

/// Single-site TIMESTAMPED frame. Stable URL -> use /c/ for better caching.
public let IEM_SINGLE_FRAME_TILE =
    "https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::{SITE}-N0B-{FRAME}/{z}/{x}/{y}.png"

/// Scan listing for single-site animation (returns up to 500 scans).
public let IEM_SCAN_LIST =
    "https://mesonet.agron.iastate.edu/json/radar.py?operation=list&radar={SITE}&product=N0B&start={START}&end={END}"

/// RainViewer index — gives {host} + radar.past[] (2h @ 10min).
public let RAINVIEWER_INDEX = "https://api.rainviewer.com/public/weather-maps.json"

/// RainViewer tile: color scheme 2, smooth(1) + snow(1). {HOST}+{PATH} from index.
public let RAINVIEWER_FRAME_TILE = "{HOST}{PATH}/256/{z}/{x}/{y}/2/1_1.png"

/// NOAA MRMS quality-controlled base reflectivity (WMS GetMap, EPSG:3857).
public let MRMS_WMS_TILE =
    "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.1.1"
    + "&request=GetMap&layers=conus_bref_qcd&styles=radar_reflectivity"
    + "&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true"

// MARK: - Tunable defaults (mirror exactly in TypeScript)

public let TILE_SIZE = 256 // CRITICAL: never 512 — misaligns/blurs IEM.

public let COMPOSITE_OPACITY = 0.75
public let SINGLE_SITE_OPACITY = 0.85
public let RAINVIEWER_OPACITY = 0.8
public let MRMS_OPACITY = 0.75

public let COMPOSITE_MAX_ZOOM = 11
public let SINGLE_SITE_MAX_ZOOM = 12
public let SINGLE_SITE_MIN_ZOOM = 8
public let RAINVIEWER_MAX_ZOOM = 7

public let FRAME_DURATION_MS = 500.0      // discrete fallback step
public let CROSSFADE_STEP_MS = 850.0      // wall-time to advance one frame (continuous crossfade)
public let LAST_FRAME_PAUSE_MS = 1000.0   // dwell on the newest frame before looping

public let SINGLE_SITE_LOOKBACK_MIN = 90.0
public let LIST_MIN_POLL_INTERVAL_MS = 60_000.0

public let SITE_SWITCH_HYSTERESIS_KM = 25.0

public let HEALTH_FAIL_THRESHOLD = 5
public let HEALTH_FAIL_WINDOW_MS = 30_000.0
public let HEALTH_RECOVERY_COOLDOWN_MS = 5 * 60_000.0

public let ATTRIBUTION_IEM = "Radar: Iowa Environmental Mesonet / NWS"
public let ATTRIBUTION_RAINVIEWER = "Radar: RainViewer"
public let ATTRIBUTION_MRMS = "Radar: NOAA / NWS MRMS"

// MARK: - Types

public enum RadarSourceKind: String, Sendable, Equatable {
    case iemComposite = "iem-composite"
    case iemSingleSite = "iem-single-site"
    case rainviewer
    case mrmsWMS = "mrms-wms"
}

// 'composite' = animated 5-min IEM N0Q composite (CONUS-wide, all zooms; the
// default smooth loop). 'local' = animated single-site N0B (New England hi-res).
// (RainViewer 'national' was retired — coarser 10-min frames, capped at zoom 7.)
public enum LoopMode: String, Sendable, Equatable {
    case local
    case composite
}

/// A renderable radar layer description. Platform adapters turn this into a
/// MapLibre raster source + raster layer. Contains NO map SDK types.
public struct RadarSource: Sendable, Equatable {
    public let id: String
    public let kind: RadarSourceKind
    public let urlTemplate: String
    public let tileSize: Int
    public let attribution: String
    public let opacity: Double
    public let minzoom: Int
    public let maxzoom: Int

    public init(id: String, kind: RadarSourceKind, urlTemplate: String, tileSize: Int,
                attribution: String, opacity: Double, minzoom: Int, maxzoom: Int) {
        self.id = id; self.kind = kind; self.urlTemplate = urlTemplate; self.tileSize = tileSize
        self.attribution = attribution; self.opacity = opacity; self.minzoom = minzoom; self.maxzoom = maxzoom
    }
}

public struct NexradSite: Sendable, Equatable {
    /// 3-letter ID WITHOUT leading "K" (e.g. "GYX").
    public let id: String
    public let name: String
    public let lat: Double
    public let lon: Double

    public init(id: String, name: String, lat: Double, lon: Double) {
        self.id = id; self.name = name; self.lat = lat; self.lon = lon
    }
}

/// One animation frame. Carries an opaque per-mode token used to build its tile
/// URL. `timestamp` is epoch milliseconds in UTC (matches the TS `number`).
public struct RadarFrame: Sendable, Equatable {
    public struct Single: Sendable, Equatable {
        public let site: String
        public let stamp: String // YYYYmmddHHMM (UTC)
    }
    public struct Composite: Sendable, Equatable {
        public let time: String // ISO8601 UTC (WMS-T TIME)
    }
    public struct National: Sendable, Equatable {
        public let host: String
        public let path: String
    }
    public let timestamp: Double
    public let single: Single?
    public let composite: Composite?
    public let national: National?

    public init(timestamp: Double, single: Single? = nil, composite: Composite? = nil,
                national: National? = nil) {
        self.timestamp = timestamp; self.single = single; self.composite = composite
        self.national = national
    }
}

// MARK: - NEXRAD single-site catalog (New England). lat/lon are radar locations.

public let NEXRAD_SITES: [NexradSite] = [
    NexradSite(id: "GYX", name: "Gray/Portland, ME", lat: 43.891, lon: -70.256), // home; default
    NexradSite(id: "BOX", name: "Boston, MA", lat: 41.956, lon: -71.137),
    NexradSite(id: "CBW", name: "Caribou, ME", lat: 46.039, lon: -67.806),
    NexradSite(id: "ENX", name: "Albany, NY", lat: 42.586, lon: -74.064),
    NexradSite(id: "OKX", name: "Upton/NYC, NY", lat: 40.866, lon: -72.864),
]

public let DEFAULT_SITE_ID = "GYX"

public func defaultSite() -> NexradSite {
    NEXRAD_SITES.first(where: { $0.id == DEFAULT_SITE_ID }) ?? NEXRAD_SITES[0]
}

// MARK: - Geo helpers

/// Great-circle distance in km (haversine).
public func haversineKm(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
    let R = 6371.0
    let toRad = { (d: Double) in d * Double.pi / 180 }
    let dLat = toRad(bLat - aLat)
    let dLon = toRad(bLon - aLon)
    let lat1 = toRad(aLat)
    let lat2 = toRad(bLat)
    let h = pow(sin(dLat / 2), 2) + pow(sin(dLon / 2), 2) * cos(lat1) * cos(lat2)
    return 2 * R * asin(min(1, sqrt(h)))
}

/// Nearest NEXRAD site to a map center by great-circle distance.
public func nearestSite(_ centerLat: Double, _ centerLon: Double) -> NexradSite {
    var best = NEXRAD_SITES[0]
    var bestKm = Double.infinity
    for s in NEXRAD_SITES {
        let km = haversineKm(centerLat, centerLon, s.lat, s.lon)
        if km < bestKm { bestKm = km; best = s }
    }
    return best
}

/// Pick a site with hysteresis: only swap away from `current` if another site is
/// meaningfully (SITE_SWITCH_HYSTERESIS_KM) closer, so we don't thrash at
/// boundaries. Pass `current = nil` to pick fresh.
public func selectSite(_ centerLat: Double, _ centerLon: Double, current: NexradSite?,
                       hysteresisKm: Double = SITE_SWITCH_HYSTERESIS_KM) -> NexradSite {
    let nearest = nearestSite(centerLat, centerLon)
    guard let current, current.id != nearest.id else { return nearest }
    let curKm = haversineKm(centerLat, centerLon, current.lat, current.lon)
    let nearKm = haversineKm(centerLat, centerLon, nearest.lat, nearest.lon)
    return curKm - nearKm > hysteresisKm ? nearest : current
}

// MARK: - Source builders

public func compositeSource() -> RadarSource {
    RadarSource(id: "radar-iem-composite", kind: .iemComposite, urlTemplate: IEM_COMPOSITE_TILE,
                tileSize: TILE_SIZE, attribution: ATTRIBUTION_IEM, opacity: COMPOSITE_OPACITY,
                minzoom: 0, maxzoom: COMPOSITE_MAX_ZOOM)
}

/// Single-site "latest" layer for a given site.
public func singleSiteSource(_ site: NexradSite) -> RadarSource {
    RadarSource(id: "radar-iem-single", kind: .iemSingleSite,
                urlTemplate: IEM_SINGLE_LATEST_TILE.replacingOccurrences(of: "{SITE}", with: site.id),
                tileSize: TILE_SIZE, attribution: ATTRIBUTION_IEM, opacity: SINGLE_SITE_OPACITY,
                minzoom: SINGLE_SITE_MIN_ZOOM, maxzoom: SINGLE_SITE_MAX_ZOOM)
}

public func rainviewerSource() -> RadarSource {
    // urlTemplate still has {HOST}/{PATH}; resolved per-frame via tileURL().
    RadarSource(id: "radar-rainviewer", kind: .rainviewer, urlTemplate: RAINVIEWER_FRAME_TILE,
                tileSize: TILE_SIZE, attribution: ATTRIBUTION_RAINVIEWER, opacity: RAINVIEWER_OPACITY,
                minzoom: 0, maxzoom: RAINVIEWER_MAX_ZOOM)
}

public func mrmsSource() -> RadarSource {
    RadarSource(id: "radar-mrms", kind: .mrmsWMS, urlTemplate: MRMS_WMS_TILE, tileSize: TILE_SIZE,
                attribution: ATTRIBUTION_MRMS, opacity: MRMS_OPACITY, minzoom: 0, maxzoom: COMPOSITE_MAX_ZOOM)
}

/// Which static (live, non-animated) sources to display for a viewport.
/// Composite is always present; the single-site layer is added ON TOP only at
/// zoom >= SINGLE_SITE_MIN_ZOOM. The single-site is NEVER returned alone — the
/// composite stays underneath to fill cone-of-silence / range-folding gaps.
public func sourcesForViewport(_ centerLat: Double, _ centerLon: Double, _ zoom: Double,
                               currentSite: NexradSite? = nil) -> [RadarSource] {
    let composite = compositeSource()
    if zoom < Double(SINGLE_SITE_MIN_ZOOM) { return [composite] }
    let site = selectSite(centerLat, centerLon, current: currentSite)
    return [composite, singleSiteSource(site)] // order = draw order (composite first)
}

// MARK: - Frame model

/// Now in epoch milliseconds (UTC).
private func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

/// Format epoch ms as the UTC YYYYmmddHHMM stamp IEM frame tiles expect.
public func utcStamp(_ epochMs: Double) -> String {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let date = Date(timeIntervalSince1970: epochMs / 1000)
    let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    func p2(_ n: Int) -> String { String(format: "%02d", n) }
    return "\(c.year!)\(p2(c.month!))\(p2(c.day!))\(p2(c.hour!))\(p2(c.minute!))"
}

private func isoUtc(_ epochMs: Double) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime] // no fractional seconds -> trailing Z
    return f.string(from: Date(timeIntervalSince1970: epochMs / 1000))
}

/// Lenient ISO8601 parse -> epoch ms, or nil. Mirrors JS Date.parse leniency.
private func parseEpochMs(_ s: String) -> Double? {
    let withFrac = ISO8601DateFormatter()
    withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = withFrac.date(from: s) { return d.timeIntervalSince1970 * 1000 }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let d = plain.date(from: s) { return d.timeIntervalSince1970 * 1000 }
    return nil
}

/// Fetcher injected for testability (mirrors the TS `fetchImpl` parameter).
public typealias RadarDataFetcher = @Sendable (URL) async throws -> Data

public func defaultRadarFetcher(_ url: URL) async throws -> Data {
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
}

/// Build the ordered frame list for a loop mode. Returns frames oldest -> newest.
/// On any fetch/parse failure returns [] so callers can gracefully fall back to
/// the live "latest" layer. NEVER throws.
public func framesForLoop(_ mode: LoopMode, _ site: NexradSite,
                          fetch: RadarDataFetcher = defaultRadarFetcher) async -> [RadarFrame] {
    do {
        return mode == .local ? try await localFrames(site, fetch) : compositeFrames()
    } catch {
        return []
    }
}

/// Composite loop frames — synthesized locally (no network listing) as 5-min
/// aligned UTC timestamps spanning COMPOSITE_WINDOW_MIN back from ~now, in
/// COMPOSITE_STEP_MIN steps. Oldest -> newest.
public func compositeFrames() -> [RadarFrame] {
    let fiveMin = 5.0 * 60_000
    let stepMs = Double(COMPOSITE_STEP_MIN) * 60_000
    let newest = (((nowMs() - Double(COMPOSITE_LAG_MIN) * 60_000) / fiveMin).rounded(.down)) * fiveMin
    let steps = COMPOSITE_WINDOW_MIN / COMPOSITE_STEP_MIN
    var frames: [RadarFrame] = []
    for k in stride(from: steps, through: 0, by: -1) {
        let t = newest - Double(k) * stepMs
        frames.append(RadarFrame(timestamp: t, composite: .init(time: isoUtc(t))))
    }
    return frames
}

private func localFrames(_ site: NexradSite, _ fetch: RadarDataFetcher) async throws -> [RadarFrame] {
    let now = nowMs()
    let urlStr = IEM_SCAN_LIST
        .replacingOccurrences(of: "{SITE}", with: site.id)
        .replacingOccurrences(of: "{START}", with: isoUtc(now - SINGLE_SITE_LOOKBACK_MIN * 60_000))
        .replacingOccurrences(of: "{END}", with: isoUtc(now))
    guard let url = URL(string: urlStr) else { return [] }
    let data = try await fetch(url)
    let json = try? JSONSerialization.jsonObject(with: data)

    // Documented shape: { "scans": [ { "ts": "...Z" }, ... ] }. Be tolerant:
    // accept a bare array, items that are strings, or objects keyed ts/valid/time.
    let rawList: [Any]
    if let arr = json as? [Any] { rawList = arr }
    else if let obj = json as? [String: Any], let scans = obj["scans"] as? [Any] { rawList = scans }
    else { rawList = [] }

    var frames: [RadarFrame] = []
    for item in rawList {
        var tsStr: String?
        if let s = item as? String { tsStr = s }
        else if let o = item as? [String: Any] {
            tsStr = (o["ts"] ?? o["valid"] ?? o["time"]) as? String
        }
        guard let tsStr, let epoch = parseEpochMs(tsStr) else { continue }
        frames.append(RadarFrame(timestamp: epoch,
                                 single: .init(site: site.id, stamp: utcStamp(epoch))))
    }
    frames.sort { $0.timestamp < $1.timestamp }
    return frames
}

/// Resolve a source + frame to a concrete {z}/{x}/{y} tile template.
/// Pass frame = nil to get the live "latest" template for that source.
public func tileURL(_ source: RadarSource, _ frame: RadarFrame?) -> String {
    switch source.kind {
    case .iemSingleSite:
        if let s = frame?.single {
            return IEM_SINGLE_FRAME_TILE
                .replacingOccurrences(of: "{SITE}", with: s.site)
                .replacingOccurrences(of: "{FRAME}", with: s.stamp)
        }
        return source.urlTemplate // already-resolved latest (-0)
    case .rainviewer:
        if let n = frame?.national {
            return RAINVIEWER_FRAME_TILE
                .replacingOccurrences(of: "{HOST}", with: n.host)
                .replacingOccurrences(of: "{PATH}", with: n.path)
        }
        return source.urlTemplate
    case .iemComposite:
        if let cmp = frame?.composite {
            return IEM_COMPOSITE_WMST.replacingOccurrences(of: "{TIME}", with: cmp.time)
        }
        return source.urlTemplate // /cache/ XYZ latest (static live layer)
    case .mrmsWMS:
        return source.urlTemplate // WMS uses its rolling-latest template
    }
}
