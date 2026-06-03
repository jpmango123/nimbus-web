// =============================================================================
// RadarCore — platform-agnostic radar logic (NO UI, NO map SDK imports)
//
// This is the single source of truth for the radar feature's data model:
//   - the catalog of radar SOURCES (endpoint templates, tile size, opacity…)
//   - the NEXRAD single-site catalog + nearest-site selector (with hysteresis)
//   - the animation frame model (fetch timestamps, build per-frame tile URLs)
//   - pure functions: sourcesForViewport / framesForLoop / tileURL
//
// KEEP IN SYNC WITH iOS Swift port:  ios/RadarCore/Sources/RadarCore/RadarCore.swift
//   The two ports are intentionally STRUCTURALLY IDENTICAL — same type names,
//   same function names, same constants. If you change an endpoint, a site, an
//   opacity default, or a function signature here, mirror it there in the same
//   commit so the platforms never drift.
//
// Data-source notes (researched & verified for 2026 — see RADAR.md):
//   * IEM N0Q composite  — seamless CONUS mosaic, ~0.25km source, ~5min updates.
//   * IEM single-site N0B — sharpest free observed radar (~0.25km, 0.5° az).
//   * RainViewer          — smooth national loop, 2h past @ 10min, zoom <= 7.
//   * NOAA MRMS (WMS)     — reliability fallback when IEM tiles fail.
//
// IEM courtesy: client-cache tiles, do NOT poll the list JSON more than once
// per ~60s during playback, and never fire parallel mass requests.
// =============================================================================

// MARK: - Source catalog (the ONE place endpoint templates live)

/** Rolling "latest" composite (XYZ, 256px). Uses /cache/ for the live tile. */
export const IEM_COMPOSITE_TILE =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';

/** Time-aware composite (WMS-T): serves ANY 5-min UTC timestamp, so the loop
 *  can span hours (the relative `-mNNm` form is capped at 50 min). {bbox} is
 *  filled by MapLibre; {TIME} = ISO8601 (YYYY-MM-DDTHH:MM:SSZ). */
export const IEM_COMPOSITE_WMST =
  'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?service=WMS&version=1.1.1' +
  '&request=GetMap&layers=nexrad-n0q-wmst&styles=&bbox={bbox-epsg-3857}' +
  '&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true&time={TIME}';

/** Composite loop window/step (5-min aligned). 5-min is IEM's native cadence —
 *  the smoothest the data allows (no jumpy gaps). 2 h @ 5-min ≈ 25 frames:
 *  smooth, with plenty of storm motion. (Tune here: bigger window = more
 *  history but slower preload / more WMS load.) */
export const COMPOSITE_WINDOW_MIN = 120;
export const COMPOSITE_STEP_MIN = 5;
export const COMPOSITE_LAG_MIN = 5; // skip the freshest slot (may not be rendered yet)

/** Single-site latest frame (the trailing `-0` is "newest"). Uses /cache/. */
export const IEM_SINGLE_LATEST_TILE =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::{SITE}-N0B-0/{z}/{x}/{y}.png';

/** Single-site TIMESTAMPED frame. Stable URL -> use /c/ for better caching. */
export const IEM_SINGLE_FRAME_TILE =
  'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::{SITE}-N0B-{FRAME}/{z}/{x}/{y}.png';

/** Scan listing for single-site animation (returns up to 500 scans). */
export const IEM_SCAN_LIST =
  'https://mesonet.agron.iastate.edu/json/radar.py?operation=list&radar={SITE}&product=N0B&start={START}&end={END}';

/** RainViewer index — gives {host} + radar.past[] (2h @ 10min). */
export const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

/** RainViewer tile: color scheme 2, smooth(1) + snow(1). {HOST}+{PATH} from index. */
export const RAINVIEWER_FRAME_TILE = '{HOST}{PATH}/256/{z}/{x}/{y}/2/1_1.png';

/** NOAA MRMS quality-controlled base reflectivity (WMS GetMap, EPSG:3857). */
export const MRMS_WMS_TILE =
  'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.1.1' +
  '&request=GetMap&layers=conus_bref_qcd&styles=radar_reflectivity' +
  '&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true';

// MARK: - Tunable defaults (mirror exactly in Swift)

export const TILE_SIZE = 256; // CRITICAL: never 512 (MapLibre default) — misaligns/blurs IEM.

export const COMPOSITE_OPACITY = 0.75;
export const SINGLE_SITE_OPACITY = 0.85;
export const RAINVIEWER_OPACITY = 0.8;
export const MRMS_OPACITY = 0.75;

export const COMPOSITE_MAX_ZOOM = 11; // practical IEM N0Q limit
export const SINGLE_SITE_MAX_ZOOM = 12; // practical IEM N0B limit
export const SINGLE_SITE_MIN_ZOOM = 8; // only layer single-site at zoom >= 8
export const RAINVIEWER_MAX_ZOOM = 7; // RainViewer hard cap (Jan 2026)

export const FRAME_DURATION_MS = 500; // discrete fallback step (unused by the web crossfade engine)
export const CROSSFADE_STEP_MS = 850; // wall-time to advance ONE frame during the continuous crossfade
export const LAST_FRAME_PAUSE_MS = 1000; // dwell on the newest frame before looping

export const SINGLE_SITE_LOOKBACK_MIN = 90; // request ~last 60–90 min of scans
export const LIST_MIN_POLL_INTERVAL_MS = 60_000; // IEM courtesy: <= 1 list poll / 60s

export const SITE_SWITCH_HYSTERESIS_KM = 25; // new site must be this much closer to swap

// Health check (CONUS source failover to MRMS)
export const HEALTH_FAIL_THRESHOLD = 5; // consecutive-ish failures…
export const HEALTH_FAIL_WINDOW_MS = 30_000; // …within this window triggers fallback
export const HEALTH_RECOVERY_COOLDOWN_MS = 5 * 60_000; // try IEM again after this

export const ATTRIBUTION_IEM = 'Radar: Iowa Environmental Mesonet / NWS';
export const ATTRIBUTION_RAINVIEWER = 'Radar: RainViewer';
export const ATTRIBUTION_MRMS = 'Radar: NOAA / NWS MRMS';

// MARK: - Types

export type RadarSourceKind =
  | 'iem-composite'
  | 'iem-single-site'
  | 'rainviewer'
  | 'mrms-wms';

// 'composite' = animated 5-min IEM N0Q composite (CONUS-wide, all zooms; the
// default smooth loop). 'local' = animated single-site N0B (nearest US NEXRAD, hi-res).
// (RainViewer 'national' was retired — coarser 10-min frames, capped at zoom 7.)
export type LoopMode = 'local' | 'composite';

/** A renderable radar layer description. Platform adapters turn this into a
 *  MapLibre raster source + raster layer. Contains NO map SDK types. */
export interface RadarSource {
  id: string; // stable layer/source id
  kind: RadarSourceKind;
  urlTemplate: string; // XYZ (or WMS bbox) tile template, fully resolved except {z}/{x}/{y}
  tileSize: number;
  attribution: string;
  opacity: number;
  minzoom: number;
  maxzoom: number;
}

export interface NexradSite {
  id: string; // 3-letter ID WITHOUT leading "K" (e.g. "GYX")
  name: string;
  lat: number;
  lon: number;
}

/** One animation frame. Carries an opaque per-mode token used to build its
 *  tile URL. `timestamp` is epoch ms in UTC. */
export interface RadarFrame {
  timestamp: number;
  single?: { site: string; stamp: string }; // stamp = YYYYmmddHHMM (UTC) — local mode
  composite?: { time: string }; // ISO8601 UTC — composite mode (WMS-T TIME)
  national?: { host: string; path: string }; // retired (RainViewer); kept for reference
}

// MARK: - NEXRAD single-site catalog — full US WSR-88D network (155 sites).
// lat/lon are radar locations; nearest one is auto-selected.

export const NEXRAD_SITES: NexradSite[] = [
  { id: 'ABC', name: 'Anchorage, AK', lat: 60.7919, lon: -161.8764 },
  { id: 'ABR', name: 'Aberdeen, SD', lat: 45.4558, lon: -98.4131 },
  { id: 'ABX', name: 'Albuquerque, NM', lat: 35.1497, lon: -106.8239 },
  { id: 'ACG', name: 'Juneau, AK', lat: 56.8528, lon: -135.5292 },
  { id: 'AEC', name: 'Fairbanks, AK', lat: 64.5114, lon: -165.295 },
  { id: 'AHG', name: 'Anchorage, AK', lat: 60.7258, lon: -151.3514 },
  { id: 'AIH', name: 'Anchorage, AK', lat: 59.4614, lon: -146.3031 },
  { id: 'AKC', name: 'Anchorage, AK', lat: 58.6794, lon: -156.6294 },
  { id: 'AKQ', name: 'Wakefield, VA', lat: 36.9839, lon: -77.0072 },
  { id: 'AMA', name: 'Amarillo, TX', lat: 35.2333, lon: -101.7092 },
  { id: 'AMX', name: 'Miami, FL', lat: 25.6111, lon: -80.4128 },
  { id: 'APD', name: 'Fairbanks, AK', lat: 65.035, lon: -147.5017 },
  { id: 'APX', name: 'Lower Michigan, MI', lat: 44.9072, lon: -84.7197 },
  { id: 'ARX', name: 'La Crosse, WI', lat: 43.8228, lon: -91.1911 },
  { id: 'ATX', name: 'Seattle/Tacoma, WA', lat: 48.1944, lon: -122.4958 },
  { id: 'BBX', name: 'Sacramento, CA', lat: 39.4961, lon: -121.6317 },
  { id: 'BGM', name: 'Binghamton, NY', lat: 42.1997, lon: -75.9847 },
  { id: 'BHX', name: 'Eureka, CA', lat: 40.4983, lon: -124.2919 },
  { id: 'BIS', name: 'Bismarck, ND', lat: 46.7708, lon: -100.7606 },
  { id: 'BLX', name: 'Billings, MT', lat: 45.8539, lon: -108.6067 },
  { id: 'BMX', name: 'Birmingham, AL', lat: 33.1722, lon: -86.7697 },
  { id: 'BOX', name: 'Boston, MA', lat: 41.9558, lon: -71.1369 },
  { id: 'BRO', name: 'Brownsville, TX', lat: 25.9161, lon: -97.4189 },
  { id: 'BUF', name: 'Buffalo, NY', lat: 42.9489, lon: -78.7367 },
  { id: 'BYX', name: 'Miami, FL', lat: 24.5975, lon: -81.7031 },
  { id: 'CAE', name: 'Columbia, SC', lat: 33.9486, lon: -81.1183 },
  { id: 'CBW', name: 'Portland, ME', lat: 46.0392, lon: -67.8064 },
  { id: 'CBX', name: 'Boise, ID', lat: 43.4906, lon: -116.2356 },
  { id: 'CCX', name: 'Central Pennsylvania, PA', lat: 40.9231, lon: -78.0036 },
  { id: 'CLE', name: 'Cleveland, OH', lat: 41.4131, lon: -81.8597 },
  { id: 'CLX', name: 'Charleston, SC', lat: 32.6556, lon: -81.0422 },
  { id: 'CRP', name: 'Corpus Christi, TX', lat: 27.7842, lon: -97.5111 },
  { id: 'CXX', name: 'Burlington, VT', lat: 44.5111, lon: -73.1669 },
  { id: 'CYS', name: 'Cheyenne, WY', lat: 41.1519, lon: -104.8061 },
  { id: 'DAX', name: 'Sacramento, CA', lat: 38.5011, lon: -121.6778 },
  { id: 'DDC', name: 'Dodge City, KS', lat: 37.7608, lon: -99.9689 },
  { id: 'DFX', name: 'Austin/San Ant, TX', lat: 29.2728, lon: -100.2806 },
  { id: 'DIX', name: 'Philadelphia, PA', lat: 39.9469, lon: -74.4108 },
  { id: 'DLH', name: 'Duluth, MN', lat: 46.8369, lon: -92.2097 },
  { id: 'DMX', name: 'Des Moines, IA', lat: 41.7311, lon: -93.7228 },
  { id: 'DOX', name: 'Wakefield, VA', lat: 38.8256, lon: -75.4397 },
  { id: 'DTX', name: 'Detroit, MI', lat: 42.6997, lon: -83.4717 },
  { id: 'DVN', name: 'Quad Cities, IA', lat: 41.6117, lon: -90.5808 },
  { id: 'DYX', name: 'San Angelo, TX', lat: 32.5383, lon: -99.2544 },
  { id: 'EAX', name: 'K.C./Pleasant Hill, MO', lat: 38.8103, lon: -94.2644 },
  { id: 'EMX', name: 'Tucson, AZ', lat: 31.8936, lon: -110.6303 },
  { id: 'ENX', name: 'Albany, NY', lat: 42.5864, lon: -74.0639 },
  { id: 'EOX', name: 'Birmingham, AL', lat: 31.4606, lon: -85.4594 },
  { id: 'EPZ', name: 'El Paso, TX', lat: 31.8731, lon: -106.6981 },
  { id: 'ESX', name: 'Las Vegas, NV', lat: 35.7011, lon: -114.8914 },
  { id: 'EVX', name: 'Tallahassee, FL', lat: 30.5644, lon: -85.9214 },
  { id: 'EWX', name: 'Austin/San Antonio, TX', lat: 29.7039, lon: -98.0283 },
  { id: 'EYX', name: 'Las Vegas, NV', lat: 35.0978, lon: -117.5608 },
  { id: 'FCX', name: 'Roanoke, VA', lat: 37.0244, lon: -80.2739 },
  { id: 'FDR', name: 'Oklahoma City, OK', lat: 34.3622, lon: -98.9764 },
  { id: 'FDX', name: 'Albuquerque, NM', lat: 34.6353, lon: -103.63 },
  { id: 'FFC', name: 'Atlanta, GA', lat: 33.3636, lon: -84.5658 },
  { id: 'FSD', name: 'Sioux Falls, SD', lat: 43.5878, lon: -96.7294 },
  { id: 'FSX', name: 'Flagstaff, AZ', lat: 34.5744, lon: -111.1978 },
  { id: 'FTG', name: 'Denver/Boulder, CO', lat: 39.7867, lon: -104.5458 },
  { id: 'FWS', name: 'Dallas/Fort Worth, TX', lat: 32.5731, lon: -97.3031 },
  { id: 'GGW', name: 'Glasgow, MT', lat: 48.2064, lon: -106.625 },
  { id: 'GJX', name: 'Grand Junction, CO', lat: 39.0622, lon: -108.2139 },
  { id: 'GLD', name: 'Goodland, KS', lat: 39.3669, lon: -101.7003 },
  { id: 'GRB', name: 'Green Bay, WI', lat: 44.4983, lon: -88.1114 },
  { id: 'GRK', name: 'Dallas/Fort Worth, TX', lat: 30.7219, lon: -97.3831 },
  { id: 'GRR', name: 'Grand Rapids, MI', lat: 42.8939, lon: -85.5447 },
  { id: 'GSP', name: 'Greenville/Spartanburg, SC', lat: 34.8833, lon: -82.22 },
  { id: 'GUA', name: 'Guam, GU', lat: 13.4544, lon: -144.8083 },
  { id: 'GWX', name: 'Memphis, TN', lat: 33.8967, lon: -88.3289 },
  { id: 'GYX', name: 'Portland, ME', lat: 43.8914, lon: -70.2564 },
  { id: 'HDX', name: 'El Paso, TX', lat: 33.0764, lon: -106.1228 },
  { id: 'HGX', name: 'Houston/Galveston, TX', lat: 29.4719, lon: -95.0792 },
  { id: 'HKI', name: 'Honolulu, HI', lat: 21.8942, lon: -159.5522 },
  { id: 'HKM', name: 'Honolulu, HI', lat: 20.1256, lon: -155.7778 },
  { id: 'HMO', name: 'Honolulu, HI', lat: 21.1328, lon: -157.18 },
  { id: 'HNX', name: 'San Joaquin Valley, CA', lat: 36.3142, lon: -119.6322 },
  { id: 'HPX', name: 'Paducah, KY', lat: 36.7367, lon: -87.285 },
  { id: 'HTX', name: 'Birmingham, AL', lat: 34.9306, lon: -86.0833 },
  { id: 'HWA', name: 'Honolulu, HI', lat: 19.095, lon: -155.5689 },
  { id: 'ICT', name: 'Wichita, KS', lat: 37.6547, lon: -97.4428 },
  { id: 'ICX', name: 'Salt Lake City, UT', lat: 37.5908, lon: -112.8622 },
  { id: 'ILN', name: 'Cincinnati, OH', lat: 39.4203, lon: -83.8217 },
  { id: 'ILX', name: 'Central Illinois, IL', lat: 40.1506, lon: -89.3369 },
  { id: 'IND', name: 'Indianapolis, IN', lat: 39.7075, lon: -86.2803 },
  { id: 'INX', name: 'Tulsa, OK', lat: 36.175, lon: -95.5647 },
  { id: 'IWA', name: 'Phoenix, AZ', lat: 33.2892, lon: -111.67 },
  { id: 'IWX', name: 'Northern Indiana, IN', lat: 41.3589, lon: -85.7 },
  { id: 'JAN', name: 'Jackson, MS', lat: 32.3178, lon: -90.08 },
  { id: 'JAX', name: 'Jacksonville, FL', lat: 30.4847, lon: -81.7019 },
  { id: 'JGX', name: 'Atlanta, GA', lat: 32.6753, lon: -83.3511 },
  { id: 'JKL', name: 'Jackson, KY', lat: 37.5908, lon: -83.3131 },
  { id: 'JUA', name: 'San Juan, PR', lat: 18.1156, lon: -66.0781 },
  { id: 'LBB', name: 'Lubbock, TX', lat: 33.6542, lon: -101.8142 },
  { id: 'LCH', name: 'Lake Charles, LA', lat: 30.1253, lon: -93.2158 },
  { id: 'LIX', name: 'New Orleans/Baton Rouge, LA', lat: 30.3367, lon: -89.8256 },
  { id: 'LNX', name: 'North Platte, NE', lat: 41.9578, lon: -100.5764 },
  { id: 'LOT', name: 'Chicago, IL', lat: 41.6047, lon: -88.0847 },
  { id: 'LRX', name: 'Elko, NV', lat: 40.7397, lon: -116.8028 },
  { id: 'LSX', name: 'St. Louis, MO', lat: 38.6989, lon: -90.6828 },
  { id: 'LTX', name: 'Wilmington, NC', lat: 33.9894, lon: -78.4289 },
  { id: 'LVX', name: 'Louisville, KY', lat: 37.9753, lon: -85.9439 },
  { id: 'LWX', name: 'Baltimore, MD', lat: 38.9753, lon: -77.4778 },
  { id: 'LZK', name: 'Little Rock, AR', lat: 34.8364, lon: -92.2622 },
  { id: 'MAF', name: 'Midland/Odessa, TX', lat: 31.9433, lon: -102.1892 },
  { id: 'MAX', name: 'Medford, OR', lat: 42.0811, lon: -122.7172 },
  { id: 'MBX', name: 'Bismarck, ND', lat: 48.3925, lon: -100.865 },
  { id: 'MHX', name: 'Morehead City, NC', lat: 34.7761, lon: -76.8761 },
  { id: 'MKX', name: 'Milwaukee, WI', lat: 42.9678, lon: -88.5506 },
  { id: 'MLB', name: 'Melbourne, FL', lat: 28.1133, lon: -80.6542 },
  { id: 'MOB', name: 'Mobile, AL', lat: 30.6794, lon: -88.2397 },
  { id: 'MPX', name: 'Minneapolis, MN', lat: 44.8489, lon: -93.5656 },
  { id: 'MQT', name: 'Marquette, MI', lat: 46.5311, lon: -87.5483 },
  { id: 'MRX', name: 'Knoxville/Tri-Cities, TN', lat: 36.1686, lon: -83.4017 },
  { id: 'MSX', name: 'Missoula, MT', lat: 47.0411, lon: -113.9861 },
  { id: 'MTX', name: 'Salt Lake City, UT', lat: 41.2628, lon: -112.4478 },
  { id: 'MUX', name: 'San Francisco, CA', lat: 37.1553, lon: -121.8983 },
  { id: 'MVX', name: 'Eastern North Dakota, ND', lat: 47.5278, lon: -97.3256 },
  { id: 'MXX', name: 'Birmingham, AL', lat: 32.5367, lon: -85.7897 },
  { id: 'NKX', name: 'San Diego, CA', lat: 32.9189, lon: -117.0419 },
  { id: 'NQA', name: 'Memphis, TN', lat: 35.3447, lon: -89.8733 },
  { id: 'OAX', name: 'Omaha, NE', lat: 41.3203, lon: -96.3667 },
  { id: 'OHX', name: 'Nashville, TN', lat: 36.2472, lon: -86.5625 },
  { id: 'OKX', name: 'New York City, NY', lat: 40.8656, lon: -72.8639 },
  { id: 'OTX', name: 'Spokane, WA', lat: 47.6803, lon: -117.6267 },
  { id: 'PAH', name: 'Paducah, KY', lat: 37.0683, lon: -88.7719 },
  { id: 'PBZ', name: 'Pittsburgh, PA', lat: 40.5317, lon: -80.2181 },
  { id: 'PDT', name: 'Pendleton, OR', lat: 45.6906, lon: -118.8528 },
  { id: 'POE', name: 'Lake Charles, LA', lat: 31.1556, lon: -92.9758 },
  { id: 'PUX', name: 'Pueblo, CO', lat: 38.4594, lon: -104.1814 },
  { id: 'RAX', name: 'Raleigh/Durham, NC', lat: 35.6656, lon: -78.4897 },
  { id: 'RGX', name: 'Reno, NV', lat: 39.7542, lon: -119.4622 },
  { id: 'RIW', name: 'Riverton, WY', lat: 43.0661, lon: -108.4772 },
  { id: 'RLX', name: 'Charleston, WV', lat: 38.3111, lon: -81.7231 },
  { id: 'RMX', name: 'Rome, NY', lat: 43.4678, lon: -75.4578 },
  { id: 'RTX', name: 'Portland, OR', lat: 45.7147, lon: -122.9653 },
  { id: 'SFX', name: 'Pocatello/Idaho Falls, ID', lat: 43.1058, lon: -112.6861 },
  { id: 'SGF', name: 'Springfield, MO', lat: 37.2353, lon: -93.4006 },
  { id: 'SHV', name: 'Shreveport, LA', lat: 32.4508, lon: -93.8414 },
  { id: 'SJT', name: 'San Angelo, TX', lat: 31.3714, lon: -100.4925 },
  { id: 'SOX', name: 'San Diego, CA', lat: 33.8178, lon: -117.6358 },
  { id: 'SRX', name: 'Tulsa, OK', lat: 35.2906, lon: -94.3617 },
  { id: 'TBW', name: 'Tampa Bay Area, FL', lat: 27.7056, lon: -82.4017 },
  { id: 'TFX', name: 'Great Falls, MT', lat: 47.4597, lon: -111.3853 },
  { id: 'TLH', name: 'Tallahassee, FL', lat: 30.3975, lon: -84.3289 },
  { id: 'TLX', name: 'Oklahoma City, OK', lat: 35.3331, lon: -97.2778 },
  { id: 'TWX', name: 'Topeka, KS', lat: 38.9969, lon: -96.2325 },
  { id: 'TYX', name: 'Burlington, VT', lat: 43.7558, lon: -75.7633 },
  { id: 'UDX', name: 'Rapid City, SD', lat: 44.125, lon: -102.8297 },
  { id: 'UEX', name: 'Hastings, NE', lat: 40.3208, lon: -98.4419 },
  { id: 'VAX', name: 'Tallahassee, FL', lat: 30.8903, lon: -83.0017 },
  { id: 'VBX', name: 'Los Angeles, CA', lat: 34.8381, lon: -120.3969 },
  { id: 'VNX', name: 'Oklahoma City, OK', lat: 36.7408, lon: -98.1278 },
  { id: 'VTX', name: 'Los Angeles, CA', lat: 34.4117, lon: -119.1794 },
  { id: 'YUX', name: 'Phoenix, AZ', lat: 32.4953, lon: -114.6567 },
];

export const DEFAULT_SITE_ID = 'GYX';

export function defaultSite(): NexradSite {
  return NEXRAD_SITES.find((s) => s.id === DEFAULT_SITE_ID) ?? NEXRAD_SITES[0];
}

// MARK: - Geo helpers

/** Great-circle distance in km (haversine). */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Nearest NEXRAD site to a map center by great-circle distance. */
export function nearestSite(centerLat: number, centerLon: number): NexradSite {
  let best = NEXRAD_SITES[0];
  let bestKm = Infinity;
  for (const s of NEXRAD_SITES) {
    const km = haversineKm(centerLat, centerLon, s.lat, s.lon);
    if (km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  return best;
}

/** Pick a site with hysteresis: only swap away from `current` if another site
 *  is meaningfully (SITE_SWITCH_HYSTERESIS_KM) closer, so we don't thrash at
 *  boundaries. Pass `current = null` to pick fresh. */
export function selectSite(
  centerLat: number,
  centerLon: number,
  current: NexradSite | null,
  hysteresisKm: number = SITE_SWITCH_HYSTERESIS_KM
): NexradSite {
  const nearest = nearestSite(centerLat, centerLon);
  if (!current || current.id === nearest.id) return nearest;
  const curKm = haversineKm(centerLat, centerLon, current.lat, current.lon);
  const nearKm = haversineKm(centerLat, centerLon, nearest.lat, nearest.lon);
  return curKm - nearKm > hysteresisKm ? nearest : current;
}

// MARK: - Source builders

export function compositeSource(): RadarSource {
  return {
    id: 'radar-iem-composite',
    kind: 'iem-composite',
    urlTemplate: IEM_COMPOSITE_TILE,
    tileSize: TILE_SIZE,
    attribution: ATTRIBUTION_IEM,
    opacity: COMPOSITE_OPACITY,
    minzoom: 0,
    maxzoom: COMPOSITE_MAX_ZOOM,
  };
}

/** Single-site "latest" layer for a given site. */
export function singleSiteSource(site: NexradSite): RadarSource {
  return {
    id: 'radar-iem-single',
    kind: 'iem-single-site',
    urlTemplate: IEM_SINGLE_LATEST_TILE.replace('{SITE}', site.id),
    tileSize: TILE_SIZE,
    attribution: ATTRIBUTION_IEM,
    opacity: SINGLE_SITE_OPACITY,
    minzoom: SINGLE_SITE_MIN_ZOOM,
    maxzoom: SINGLE_SITE_MAX_ZOOM,
  };
}

export function rainviewerSource(): RadarSource {
  // urlTemplate still has {HOST}/{PATH}; resolved per-frame via tileURL().
  return {
    id: 'radar-rainviewer',
    kind: 'rainviewer',
    urlTemplate: RAINVIEWER_FRAME_TILE,
    tileSize: TILE_SIZE,
    attribution: ATTRIBUTION_RAINVIEWER,
    opacity: RAINVIEWER_OPACITY,
    minzoom: 0,
    maxzoom: RAINVIEWER_MAX_ZOOM,
  };
}

export function mrmsSource(): RadarSource {
  return {
    id: 'radar-mrms',
    kind: 'mrms-wms',
    urlTemplate: MRMS_WMS_TILE,
    tileSize: TILE_SIZE,
    attribution: ATTRIBUTION_MRMS,
    opacity: MRMS_OPACITY,
    minzoom: 0,
    maxzoom: COMPOSITE_MAX_ZOOM,
  };
}

/** Which static (live, non-animated) sources to display for a viewport.
 *  Composite is always present; the single-site layer is added ON TOP only at
 *  zoom >= SINGLE_SITE_MIN_ZOOM. The single-site is NEVER returned alone — the
 *  composite stays underneath to fill cone-of-silence / range-folding gaps. */
export function sourcesForViewport(
  centerLat: number,
  centerLon: number,
  zoom: number,
  currentSite: NexradSite | null = null
): RadarSource[] {
  const composite = compositeSource();
  if (zoom < SINGLE_SITE_MIN_ZOOM) return [composite];
  const site = selectSite(centerLat, centerLon, currentSite);
  return [composite, singleSiteSource(site)]; // order = draw order (composite first)
}

// MARK: - Frame model

/** Format epoch ms as the UTC YYYYmmddHHMM stamp IEM frame tiles expect. */
export function utcStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
  );
}

function isoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Build the ordered frame list for a loop mode.
 *  Returns frames oldest -> newest. On any fetch/parse failure returns [] so
 *  callers can gracefully fall back to the live "latest" layer. NEVER throws.
 *  NOTE: live JSON shapes could not be verified from the build sandbox (host
 *  allowlist) — parsing is defensive against the documented public formats. */
export async function framesForLoop(
  mode: LoopMode,
  site: NexradSite,
  fetchImpl: typeof fetch = fetch
): Promise<RadarFrame[]> {
  try {
    return mode === 'local' ? await localFrames(site, fetchImpl) : compositeFrames();
  } catch {
    return [];
  }
}

/** Composite loop frames — synthesized locally (no network listing) as 5-min
 *  aligned UTC timestamps spanning COMPOSITE_WINDOW_MIN back from ~now, in
 *  COMPOSITE_STEP_MIN steps. Oldest -> newest. */
export function compositeFrames(): RadarFrame[] {
  const fiveMin = 5 * 60_000;
  const stepMs = COMPOSITE_STEP_MIN * 60_000;
  // newest = now minus a small lag, floored to a 5-min boundary
  const newest = Math.floor((Date.now() - COMPOSITE_LAG_MIN * 60_000) / fiveMin) * fiveMin;
  const steps = Math.floor(COMPOSITE_WINDOW_MIN / COMPOSITE_STEP_MIN);
  const frames: RadarFrame[] = [];
  for (let k = steps; k >= 0; k--) {
    const t = newest - k * stepMs;
    frames.push({ timestamp: t, composite: { time: isoUtc(t) } });
  }
  return frames;
}

async function localFrames(site: NexradSite, fetchImpl: typeof fetch): Promise<RadarFrame[]> {
  const now = Date.now();
  const url = IEM_SCAN_LIST.replace('{SITE}', site.id)
    .replace('{START}', isoUtc(now - SINGLE_SITE_LOOKBACK_MIN * 60_000))
    .replace('{END}', isoUtc(now));
  const res = await fetchImpl(url);
  if (!res.ok) return [];
  const data: unknown = await res.json();

  // Documented shape: { "scans": [ { "ts": "2026-..Z" }, ... ] }. Be tolerant:
  // accept a bare array, items that are strings, or objects keyed ts/valid/time.
  const rawList: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { scans?: unknown[] })?.scans)
      ? (data as { scans: unknown[] }).scans
      : [];

  const frames: RadarFrame[] = [];
  for (const item of rawList) {
    const tsStr =
      typeof item === 'string'
        ? item
        : ((item as Record<string, unknown>)?.ts ??
            (item as Record<string, unknown>)?.valid ??
            (item as Record<string, unknown>)?.time) as string | undefined;
    if (!tsStr) continue;
    const epoch = Date.parse(tsStr);
    if (Number.isNaN(epoch)) continue;
    frames.push({ timestamp: epoch, single: { site: site.id, stamp: utcStamp(epoch) } });
  }
  frames.sort((a, b) => a.timestamp - b.timestamp);
  return frames;
}

/** Resolve a source + frame to a concrete {z}/{x}/{y} tile template.
 *  Pass frame = null to get the live "latest" template for that source. */
export function tileURL(source: RadarSource, frame: RadarFrame | null): string {
  switch (source.kind) {
    case 'iem-single-site':
      if (frame?.single) {
        return IEM_SINGLE_FRAME_TILE.replace('{SITE}', frame.single.site).replace(
          '{FRAME}',
          frame.single.stamp
        );
      }
      return source.urlTemplate; // already-resolved latest (-0)
    case 'rainviewer':
      if (frame?.national) {
        return RAINVIEWER_FRAME_TILE.replace('{HOST}', frame.national.host).replace(
          '{PATH}',
          frame.national.path
        );
      }
      return source.urlTemplate;
    case 'iem-composite':
      if (frame?.composite) {
        return IEM_COMPOSITE_WMST.replace('{TIME}', frame.composite.time);
      }
      return source.urlTemplate; // /cache/ XYZ latest (static live layer)
    case 'mrms-wms':
    default:
      return source.urlTemplate; // WMS uses its rolling-latest template
  }
}
