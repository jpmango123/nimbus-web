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
// default smooth loop). 'local' = animated single-site N0B (New England hi-res).
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

// MARK: - NEXRAD single-site catalog (New England). lat/lon are radar locations.

export const NEXRAD_SITES: NexradSite[] = [
  { id: 'GYX', name: 'Gray/Portland, ME', lat: 43.891, lon: -70.256 }, // home region; default
  { id: 'BOX', name: 'Boston, MA', lat: 41.956, lon: -71.137 },
  { id: 'CBW', name: 'Caribou, ME', lat: 46.039, lon: -67.806 },
  { id: 'ENX', name: 'Albany, NY', lat: 42.586, lon: -74.064 },
  { id: 'OKX', name: 'Upton/NYC, NY', lat: 40.866, lon: -72.864 },
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
