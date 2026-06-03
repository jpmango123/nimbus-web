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
// default smooth loop). 'local' = animated single-site N0B (nearest US NEXRAD, hi-res).
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

// MARK: - NEXRAD single-site catalog — full US WSR-88D network (155 sites).
// lat/lon are radar locations; nearest one is auto-selected.

public let NEXRAD_SITES: [NexradSite] = [
    NexradSite(id: "ABC", name: "Anchorage, AK", lat: 60.7919, lon: -161.8764),
    NexradSite(id: "ABR", name: "Aberdeen, SD", lat: 45.4558, lon: -98.4131),
    NexradSite(id: "ABX", name: "Albuquerque, NM", lat: 35.1497, lon: -106.8239),
    NexradSite(id: "ACG", name: "Juneau, AK", lat: 56.8528, lon: -135.5292),
    NexradSite(id: "AEC", name: "Fairbanks, AK", lat: 64.5114, lon: -165.295),
    NexradSite(id: "AHG", name: "Anchorage, AK", lat: 60.7258, lon: -151.3514),
    NexradSite(id: "AIH", name: "Anchorage, AK", lat: 59.4614, lon: -146.3031),
    NexradSite(id: "AKC", name: "Anchorage, AK", lat: 58.6794, lon: -156.6294),
    NexradSite(id: "AKQ", name: "Wakefield, VA", lat: 36.9839, lon: -77.0072),
    NexradSite(id: "AMA", name: "Amarillo, TX", lat: 35.2333, lon: -101.7092),
    NexradSite(id: "AMX", name: "Miami, FL", lat: 25.6111, lon: -80.4128),
    NexradSite(id: "APD", name: "Fairbanks, AK", lat: 65.035, lon: -147.5017),
    NexradSite(id: "APX", name: "Lower Michigan, MI", lat: 44.9072, lon: -84.7197),
    NexradSite(id: "ARX", name: "La Crosse, WI", lat: 43.8228, lon: -91.1911),
    NexradSite(id: "ATX", name: "Seattle/Tacoma, WA", lat: 48.1944, lon: -122.4958),
    NexradSite(id: "BBX", name: "Sacramento, CA", lat: 39.4961, lon: -121.6317),
    NexradSite(id: "BGM", name: "Binghamton, NY", lat: 42.1997, lon: -75.9847),
    NexradSite(id: "BHX", name: "Eureka, CA", lat: 40.4983, lon: -124.2919),
    NexradSite(id: "BIS", name: "Bismarck, ND", lat: 46.7708, lon: -100.7606),
    NexradSite(id: "BLX", name: "Billings, MT", lat: 45.8539, lon: -108.6067),
    NexradSite(id: "BMX", name: "Birmingham, AL", lat: 33.1722, lon: -86.7697),
    NexradSite(id: "BOX", name: "Boston, MA", lat: 41.9558, lon: -71.1369),
    NexradSite(id: "BRO", name: "Brownsville, TX", lat: 25.9161, lon: -97.4189),
    NexradSite(id: "BUF", name: "Buffalo, NY", lat: 42.9489, lon: -78.7367),
    NexradSite(id: "BYX", name: "Miami, FL", lat: 24.5975, lon: -81.7031),
    NexradSite(id: "CAE", name: "Columbia, SC", lat: 33.9486, lon: -81.1183),
    NexradSite(id: "CBW", name: "Portland, ME", lat: 46.0392, lon: -67.8064),
    NexradSite(id: "CBX", name: "Boise, ID", lat: 43.4906, lon: -116.2356),
    NexradSite(id: "CCX", name: "Central Pennsylvania, PA", lat: 40.9231, lon: -78.0036),
    NexradSite(id: "CLE", name: "Cleveland, OH", lat: 41.4131, lon: -81.8597),
    NexradSite(id: "CLX", name: "Charleston, SC", lat: 32.6556, lon: -81.0422),
    NexradSite(id: "CRP", name: "Corpus Christi, TX", lat: 27.7842, lon: -97.5111),
    NexradSite(id: "CXX", name: "Burlington, VT", lat: 44.5111, lon: -73.1669),
    NexradSite(id: "CYS", name: "Cheyenne, WY", lat: 41.1519, lon: -104.8061),
    NexradSite(id: "DAX", name: "Sacramento, CA", lat: 38.5011, lon: -121.6778),
    NexradSite(id: "DDC", name: "Dodge City, KS", lat: 37.7608, lon: -99.9689),
    NexradSite(id: "DFX", name: "Austin/San Ant, TX", lat: 29.2728, lon: -100.2806),
    NexradSite(id: "DIX", name: "Philadelphia, PA", lat: 39.9469, lon: -74.4108),
    NexradSite(id: "DLH", name: "Duluth, MN", lat: 46.8369, lon: -92.2097),
    NexradSite(id: "DMX", name: "Des Moines, IA", lat: 41.7311, lon: -93.7228),
    NexradSite(id: "DOX", name: "Wakefield, VA", lat: 38.8256, lon: -75.4397),
    NexradSite(id: "DTX", name: "Detroit, MI", lat: 42.6997, lon: -83.4717),
    NexradSite(id: "DVN", name: "Quad Cities, IA", lat: 41.6117, lon: -90.5808),
    NexradSite(id: "DYX", name: "San Angelo, TX", lat: 32.5383, lon: -99.2544),
    NexradSite(id: "EAX", name: "K.C./Pleasant Hill, MO", lat: 38.8103, lon: -94.2644),
    NexradSite(id: "EMX", name: "Tucson, AZ", lat: 31.8936, lon: -110.6303),
    NexradSite(id: "ENX", name: "Albany, NY", lat: 42.5864, lon: -74.0639),
    NexradSite(id: "EOX", name: "Birmingham, AL", lat: 31.4606, lon: -85.4594),
    NexradSite(id: "EPZ", name: "El Paso, TX", lat: 31.8731, lon: -106.6981),
    NexradSite(id: "ESX", name: "Las Vegas, NV", lat: 35.7011, lon: -114.8914),
    NexradSite(id: "EVX", name: "Tallahassee, FL", lat: 30.5644, lon: -85.9214),
    NexradSite(id: "EWX", name: "Austin/San Antonio, TX", lat: 29.7039, lon: -98.0283),
    NexradSite(id: "EYX", name: "Las Vegas, NV", lat: 35.0978, lon: -117.5608),
    NexradSite(id: "FCX", name: "Roanoke, VA", lat: 37.0244, lon: -80.2739),
    NexradSite(id: "FDR", name: "Oklahoma City, OK", lat: 34.3622, lon: -98.9764),
    NexradSite(id: "FDX", name: "Albuquerque, NM", lat: 34.6353, lon: -103.63),
    NexradSite(id: "FFC", name: "Atlanta, GA", lat: 33.3636, lon: -84.5658),
    NexradSite(id: "FSD", name: "Sioux Falls, SD", lat: 43.5878, lon: -96.7294),
    NexradSite(id: "FSX", name: "Flagstaff, AZ", lat: 34.5744, lon: -111.1978),
    NexradSite(id: "FTG", name: "Denver/Boulder, CO", lat: 39.7867, lon: -104.5458),
    NexradSite(id: "FWS", name: "Dallas/Fort Worth, TX", lat: 32.5731, lon: -97.3031),
    NexradSite(id: "GGW", name: "Glasgow, MT", lat: 48.2064, lon: -106.625),
    NexradSite(id: "GJX", name: "Grand Junction, CO", lat: 39.0622, lon: -108.2139),
    NexradSite(id: "GLD", name: "Goodland, KS", lat: 39.3669, lon: -101.7003),
    NexradSite(id: "GRB", name: "Green Bay, WI", lat: 44.4983, lon: -88.1114),
    NexradSite(id: "GRK", name: "Dallas/Fort Worth, TX", lat: 30.7219, lon: -97.3831),
    NexradSite(id: "GRR", name: "Grand Rapids, MI", lat: 42.8939, lon: -85.5447),
    NexradSite(id: "GSP", name: "Greenville/Spartanburg, SC", lat: 34.8833, lon: -82.22),
    NexradSite(id: "GUA", name: "Guam, GU", lat: 13.4544, lon: -144.8083),
    NexradSite(id: "GWX", name: "Memphis, TN", lat: 33.8967, lon: -88.3289),
    NexradSite(id: "GYX", name: "Portland, ME", lat: 43.8914, lon: -70.2564),
    NexradSite(id: "HDX", name: "El Paso, TX", lat: 33.0764, lon: -106.1228),
    NexradSite(id: "HGX", name: "Houston/Galveston, TX", lat: 29.4719, lon: -95.0792),
    NexradSite(id: "HKI", name: "Honolulu, HI", lat: 21.8942, lon: -159.5522),
    NexradSite(id: "HKM", name: "Honolulu, HI", lat: 20.1256, lon: -155.7778),
    NexradSite(id: "HMO", name: "Honolulu, HI", lat: 21.1328, lon: -157.18),
    NexradSite(id: "HNX", name: "San Joaquin Valley, CA", lat: 36.3142, lon: -119.6322),
    NexradSite(id: "HPX", name: "Paducah, KY", lat: 36.7367, lon: -87.285),
    NexradSite(id: "HTX", name: "Birmingham, AL", lat: 34.9306, lon: -86.0833),
    NexradSite(id: "HWA", name: "Honolulu, HI", lat: 19.095, lon: -155.5689),
    NexradSite(id: "ICT", name: "Wichita, KS", lat: 37.6547, lon: -97.4428),
    NexradSite(id: "ICX", name: "Salt Lake City, UT", lat: 37.5908, lon: -112.8622),
    NexradSite(id: "ILN", name: "Cincinnati, OH", lat: 39.4203, lon: -83.8217),
    NexradSite(id: "ILX", name: "Central Illinois, IL", lat: 40.1506, lon: -89.3369),
    NexradSite(id: "IND", name: "Indianapolis, IN", lat: 39.7075, lon: -86.2803),
    NexradSite(id: "INX", name: "Tulsa, OK", lat: 36.175, lon: -95.5647),
    NexradSite(id: "IWA", name: "Phoenix, AZ", lat: 33.2892, lon: -111.67),
    NexradSite(id: "IWX", name: "Northern Indiana, IN", lat: 41.3589, lon: -85.7),
    NexradSite(id: "JAN", name: "Jackson, MS", lat: 32.3178, lon: -90.08),
    NexradSite(id: "JAX", name: "Jacksonville, FL", lat: 30.4847, lon: -81.7019),
    NexradSite(id: "JGX", name: "Atlanta, GA", lat: 32.6753, lon: -83.3511),
    NexradSite(id: "JKL", name: "Jackson, KY", lat: 37.5908, lon: -83.3131),
    NexradSite(id: "JUA", name: "San Juan, PR", lat: 18.1156, lon: -66.0781),
    NexradSite(id: "LBB", name: "Lubbock, TX", lat: 33.6542, lon: -101.8142),
    NexradSite(id: "LCH", name: "Lake Charles, LA", lat: 30.1253, lon: -93.2158),
    NexradSite(id: "LIX", name: "New Orleans/Baton Rouge, LA", lat: 30.3367, lon: -89.8256),
    NexradSite(id: "LNX", name: "North Platte, NE", lat: 41.9578, lon: -100.5764),
    NexradSite(id: "LOT", name: "Chicago, IL", lat: 41.6047, lon: -88.0847),
    NexradSite(id: "LRX", name: "Elko, NV", lat: 40.7397, lon: -116.8028),
    NexradSite(id: "LSX", name: "St. Louis, MO", lat: 38.6989, lon: -90.6828),
    NexradSite(id: "LTX", name: "Wilmington, NC", lat: 33.9894, lon: -78.4289),
    NexradSite(id: "LVX", name: "Louisville, KY", lat: 37.9753, lon: -85.9439),
    NexradSite(id: "LWX", name: "Baltimore, MD", lat: 38.9753, lon: -77.4778),
    NexradSite(id: "LZK", name: "Little Rock, AR", lat: 34.8364, lon: -92.2622),
    NexradSite(id: "MAF", name: "Midland/Odessa, TX", lat: 31.9433, lon: -102.1892),
    NexradSite(id: "MAX", name: "Medford, OR", lat: 42.0811, lon: -122.7172),
    NexradSite(id: "MBX", name: "Bismarck, ND", lat: 48.3925, lon: -100.865),
    NexradSite(id: "MHX", name: "Morehead City, NC", lat: 34.7761, lon: -76.8761),
    NexradSite(id: "MKX", name: "Milwaukee, WI", lat: 42.9678, lon: -88.5506),
    NexradSite(id: "MLB", name: "Melbourne, FL", lat: 28.1133, lon: -80.6542),
    NexradSite(id: "MOB", name: "Mobile, AL", lat: 30.6794, lon: -88.2397),
    NexradSite(id: "MPX", name: "Minneapolis, MN", lat: 44.8489, lon: -93.5656),
    NexradSite(id: "MQT", name: "Marquette, MI", lat: 46.5311, lon: -87.5483),
    NexradSite(id: "MRX", name: "Knoxville/Tri-Cities, TN", lat: 36.1686, lon: -83.4017),
    NexradSite(id: "MSX", name: "Missoula, MT", lat: 47.0411, lon: -113.9861),
    NexradSite(id: "MTX", name: "Salt Lake City, UT", lat: 41.2628, lon: -112.4478),
    NexradSite(id: "MUX", name: "San Francisco, CA", lat: 37.1553, lon: -121.8983),
    NexradSite(id: "MVX", name: "Eastern North Dakota, ND", lat: 47.5278, lon: -97.3256),
    NexradSite(id: "MXX", name: "Birmingham, AL", lat: 32.5367, lon: -85.7897),
    NexradSite(id: "NKX", name: "San Diego, CA", lat: 32.9189, lon: -117.0419),
    NexradSite(id: "NQA", name: "Memphis, TN", lat: 35.3447, lon: -89.8733),
    NexradSite(id: "OAX", name: "Omaha, NE", lat: 41.3203, lon: -96.3667),
    NexradSite(id: "OHX", name: "Nashville, TN", lat: 36.2472, lon: -86.5625),
    NexradSite(id: "OKX", name: "New York City, NY", lat: 40.8656, lon: -72.8639),
    NexradSite(id: "OTX", name: "Spokane, WA", lat: 47.6803, lon: -117.6267),
    NexradSite(id: "PAH", name: "Paducah, KY", lat: 37.0683, lon: -88.7719),
    NexradSite(id: "PBZ", name: "Pittsburgh, PA", lat: 40.5317, lon: -80.2181),
    NexradSite(id: "PDT", name: "Pendleton, OR", lat: 45.6906, lon: -118.8528),
    NexradSite(id: "POE", name: "Lake Charles, LA", lat: 31.1556, lon: -92.9758),
    NexradSite(id: "PUX", name: "Pueblo, CO", lat: 38.4594, lon: -104.1814),
    NexradSite(id: "RAX", name: "Raleigh/Durham, NC", lat: 35.6656, lon: -78.4897),
    NexradSite(id: "RGX", name: "Reno, NV", lat: 39.7542, lon: -119.4622),
    NexradSite(id: "RIW", name: "Riverton, WY", lat: 43.0661, lon: -108.4772),
    NexradSite(id: "RLX", name: "Charleston, WV", lat: 38.3111, lon: -81.7231),
    NexradSite(id: "RMX", name: "Rome, NY", lat: 43.4678, lon: -75.4578),
    NexradSite(id: "RTX", name: "Portland, OR", lat: 45.7147, lon: -122.9653),
    NexradSite(id: "SFX", name: "Pocatello/Idaho Falls, ID", lat: 43.1058, lon: -112.6861),
    NexradSite(id: "SGF", name: "Springfield, MO", lat: 37.2353, lon: -93.4006),
    NexradSite(id: "SHV", name: "Shreveport, LA", lat: 32.4508, lon: -93.8414),
    NexradSite(id: "SJT", name: "San Angelo, TX", lat: 31.3714, lon: -100.4925),
    NexradSite(id: "SOX", name: "San Diego, CA", lat: 33.8178, lon: -117.6358),
    NexradSite(id: "SRX", name: "Tulsa, OK", lat: 35.2906, lon: -94.3617),
    NexradSite(id: "TBW", name: "Tampa Bay Area, FL", lat: 27.7056, lon: -82.4017),
    NexradSite(id: "TFX", name: "Great Falls, MT", lat: 47.4597, lon: -111.3853),
    NexradSite(id: "TLH", name: "Tallahassee, FL", lat: 30.3975, lon: -84.3289),
    NexradSite(id: "TLX", name: "Oklahoma City, OK", lat: 35.3331, lon: -97.2778),
    NexradSite(id: "TWX", name: "Topeka, KS", lat: 38.9969, lon: -96.2325),
    NexradSite(id: "TYX", name: "Burlington, VT", lat: 43.7558, lon: -75.7633),
    NexradSite(id: "UDX", name: "Rapid City, SD", lat: 44.125, lon: -102.8297),
    NexradSite(id: "UEX", name: "Hastings, NE", lat: 40.3208, lon: -98.4419),
    NexradSite(id: "VAX", name: "Tallahassee, FL", lat: 30.8903, lon: -83.0017),
    NexradSite(id: "VBX", name: "Los Angeles, CA", lat: 34.8381, lon: -120.3969),
    NexradSite(id: "VNX", name: "Oklahoma City, OK", lat: 36.7408, lon: -98.1278),
    NexradSite(id: "VTX", name: "Los Angeles, CA", lat: 34.4117, lon: -119.1794),
    NexradSite(id: "YUX", name: "Phoenix, AZ", lat: 32.4953, lon: -114.6567),
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
