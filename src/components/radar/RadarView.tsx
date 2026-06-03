'use client';

// =============================================================================
// RadarView — web map host for the radar feature.
//
// Owns the MapLibre GL JS map + the RadarMapController adapter, and drives:
//   - live composite (+ single-site when zoomed in) display
//   - two-mode animation (Local hi-res / National smooth)
//   - moveend-driven nearest-site selection (with hysteresis) and loop-mode
//     auto-suggestion
//   - IEM -> MRMS health-check failover
// All radar *logic* comes from RadarCore; all *map* calls go through the adapter.
//
// maplibre-gl is imported dynamically inside the effect so nothing touches
// `window` during SSR (robust across Next 16 / Turbopack — no ssr:false needed).
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';
import {
  CROSSFADE_STEP_MS,
  HEALTH_FAIL_THRESHOLD,
  HEALTH_FAIL_WINDOW_MS,
  HEALTH_RECOVERY_COOLDOWN_MS,
  LAST_FRAME_PAUSE_MS,
  LIST_MIN_POLL_INTERVAL_MS,
  SINGLE_SITE_MIN_ZOOM,
  compositeSource,
  defaultSite,
  framesForLoop,
  haversineKm,
  mrmsSource,
  nearestSite,
  rainviewerSource,
  selectSite,
  singleSiteSource,
  type LoopMode,
  type NexradSite,
  type RadarFrame,
  type RadarSource,
} from '@/lib/radar/RadarCore';
import { RadarMapController } from '@/lib/radar/radarMap';
import RadarControls from './RadarControls';

// Key-free dark basemap: CARTO no-labels base, with a labels-only overlay on
// top so radar (inserted before the labels layer) never hides place names.
const subdomains = ['a', 'b', 'c', 'd'];
const cartoTiles = (style: string) =>
  subdomains.map((s) => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`);

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'carto-base': {
      type: 'raster',
      tiles: cartoTiles('dark_nolabels'),
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
    'carto-labels': { type: 'raster', tiles: cartoTiles('dark_only_labels'), tileSize: 256 },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0d1521' } },
    { id: 'carto-base', type: 'raster', source: 'carto-base' },
    { id: 'carto-labels', type: 'raster', source: 'carto-labels' },
  ],
};

interface MapErrorEvent {
  sourceId?: string;
}

export default function RadarView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ctrlRef = useRef<RadarMapController | null>(null);

  // continuous-crossfade animation engine (refs avoid stale-closure churn)
  const rafRef = useRef<number | null>(null);
  const posRef = useRef(0); // float playhead in [0, n): integer = frame, frac = crossfade
  const lastTsRef = useRef(0); // performance.now() of previous tick
  const dwellUntilRef = useRef(0); // hold newest frame until this time
  const displayIdxRef = useRef(-1); // last frame index pushed to the label/scrubber
  const framesRef = useRef<RadarFrame[]>([]);
  const playingRef = useRef(false);
  const loopModeRef = useRef<LoopMode>('local');
  const siteRef = useRef<NexradSite>(defaultSite());
  const enabledRef = useRef(true);
  const modeManualRef = useRef(false);
  const stackKeyRef = useRef<string | null>(null);
  const listCacheRef = useRef<{ key: string; time: number; frames: RadarFrame[] } | null>(null);

  // health-check refs
  const failTimesRef = useRef<number[]>([]);
  const usingBackupRef = useRef(false);
  const cooldownUntilRef = useRef(0);

  // UI state (mirrors of refs that need to render)
  const [enabled, setEnabled] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [loopMode, setLoopMode] = useState<LoopMode>('local');
  const [suggestedMode, setSuggestedMode] = useState<LoopMode>('local');
  const [site, setSite] = useState<NexradSite>(defaultSite());
  const [frameCount, setFrameCount] = useState(0);
  const [frameIndex, setFrameIndex] = useState(-1);
  const [usingBackup, setUsingBackup] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [timestampLabel, setTimestampLabel] = useState('—');

  // -- helpers (read live map state via refs; no React deps) -----------------

  const view = () => {
    const m = mapRef.current;
    const c = m?.getCenter();
    return { lat: c?.lat ?? siteRef.current.lat, lon: c?.lng ?? siteRef.current.lon, zoom: m?.getZoom() ?? 7 };
  };

  // Local (single-site) radar only covers the New England catalog and only
  // renders at zoom >= 8. Returns a hint when the current view can't show it,
  // so "Local doesn't move" is explained rather than looking broken.
  const localCoverageHint = (): string | null => {
    const { lat, lon, zoom } = view();
    if (zoom < SINGLE_SITE_MIN_ZOOM) return `Local hi-res appears at zoom ≥ ${SINGLE_SITE_MIN_ZOOM} — zoom in`;
    const site = nearestSite(lat, lon);
    if (haversineKm(lat, lon, site.lat, site.lon) > 500)
      return `Local hi-res covers New England (nearest: ${site.name}) — pan home or use National`;
    return null;
  };

  const activeComposite = (): RadarSource =>
    usingBackupRef.current ? mrmsSource() : compositeSource();

  const stopAnim = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const updateLabel = (f: RadarFrame | undefined) => {
    if (!f) return setTimestampLabel('—');
    setTimestampLabel(
      new Date(f.timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    );
  };

  const enterLive = () => {
    const c = ctrlRef.current;
    if (!c) return;
    stopAnim();
    c.clearFrameStack();
    stackKeyRef.current = null;
    c.setComposite(activeComposite());
    const { zoom } = view();
    c.setSingleSite(
      loopModeRef.current === 'local' && zoom >= SINGLE_SITE_MIN_ZOOM
        ? singleSiteSource(siteRef.current)
        : null
    );
    if (loopModeRef.current === 'local') setStatus(localCoverageHint());
  };

  const getFrames = async (mode: LoopMode, s: NexradSite): Promise<RadarFrame[]> => {
    const key = mode === 'local' ? `local:${s.id}` : 'national';
    const cache = listCacheRef.current;
    // IEM courtesy: reuse a recent listing rather than re-polling within 60s.
    if (cache && cache.key === key && Date.now() - cache.time < LIST_MIN_POLL_INTERVAL_MS) {
      return cache.frames;
    }
    const frames = await framesForLoop(mode, s);
    listCacheRef.current = { key, time: Date.now(), frames };
    return frames;
  };

  // Render a continuous playhead position as a true DISSOLVE crossfade: the
  // outgoing frame fades OUT (1 - f) while the incoming frame fades IN (f).
  // This is essential for perceived motion — holding the old frame opaque would
  // freeze persistent echoes in place (only edges would "glow"); fading it out
  // lets storms actually move/morph from one scan to the next.
  const renderPos = (pos: number) => {
    const c = ctrlRef.current;
    const n = framesRef.current.length;
    if (!c || n === 0) return;
    if (n === 1) {
      c.showFrameBlend([[0, 1]]);
      return;
    }
    let i = Math.floor(pos);
    const f = pos - i;
    if (i >= n) i = 0;
    if (i < n - 1) {
      c.showFrameBlend([
        [i, 1 - f],
        [i + 1, f],
      ]);
    } else {
      // wrap segment (newest -> oldest)
      c.showFrameBlend([
        [n - 1, 1 - f],
        [0, f],
      ]);
    }
    // Throttle React updates to whole-frame changes (not every rAF tick).
    const disp = i < n - 1 ? (f < 0.5 ? i : i + 1) : f < 0.5 ? n - 1 : 0;
    if (disp !== displayIdxRef.current) {
      displayIdxRef.current = disp;
      setFrameIndex(disp);
      updateLabel(framesRef.current[disp]);
    }
  };

  const loop = (now: number) => {
    if (!playingRef.current) return;
    const n = framesRef.current.length;
    if (n < 2) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    const dt = now - lastTsRef.current;
    lastTsRef.current = now;
    if (now >= dwellUntilRef.current) {
      const prev = posRef.current;
      let next = prev + dt / CROSSFADE_STEP_MS;
      if (prev < n - 1 && next >= n - 1) {
        // reached the newest frame: snap and dwell before the wrap dissolve
        next = n - 1;
        dwellUntilRef.current = now + LAST_FRAME_PAUSE_MS;
      } else if (next >= n) {
        next -= n; // past the wrap dissolve -> back to the oldest frame
      }
      posRef.current = next;
    }
    renderPos(posRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const startLoop = (fromNewest: boolean) => {
    stopAnim();
    const n = framesRef.current.length;
    if (fromNewest && n > 0) {
      posRef.current = n - 1;
      dwellUntilRef.current = performance.now() + LAST_FRAME_PAUSE_MS; // hold newest first
    }
    lastTsRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);
  };

  // Wait until ALL freshly-added frame tiles are loaded before playing, so the
  // loop never stalls mid-flight (a major cause of the "stop-and-go" feel on
  // mobile). Polls areTilesLoaded rather than a single 'idle' event.
  const waitTilesLoaded = () =>
    new Promise<void>((resolve) => {
      const m = mapRef.current;
      if (!m) return resolve();
      const started = Date.now();
      const tick = () => {
        if (!playingRef.current) return resolve(); // user paused while preloading
        if (m.areTilesLoaded() || Date.now() - started > 12000) return resolve();
        setTimeout(tick, 200);
      };
      setTimeout(tick, 300); // let tile requests start before first check
    });

  const buildAndPlay = async () => {
    const c = ctrlRef.current;
    const m = mapRef.current;
    if (!c || !m) return;
    const mode = loopModeRef.current;
    const s = siteRef.current;
    setStatus('loading frames…');
    const frames = await getFrames(mode, s);
    if (frames.length === 0) {
      setStatus('no recent frames — showing latest');
      playingRef.current = false;
      setPlaying(false);
      enterLive();
      return;
    }
    setStatus(null);
    framesRef.current = frames;
    setFrameCount(frames.length);

    const animated: RadarSource = mode === 'local' ? singleSiteSource(s) : rainviewerSource();
    c.setSingleSite(null); // avoid duplicate with the animated frames
    if (mode === 'national') c.removeComposite(); // RainViewer is itself a national mosaic
    else c.setComposite(activeComposite()); // local: keep composite underneath (fills gaps)

    c.buildFrameStack(animated, frames);
    stackKeyRef.current = `${mode}:${mode === 'local' ? s.id : 'national'}`;
    displayIdxRef.current = frames.length - 1;
    setFrameIndex(frames.length - 1);
    updateLabel(frames[frames.length - 1]);

    // Preload ALL frame tiles before playing so the loop never stalls.
    setStatus('preloading…');
    await waitTilesLoaded();
    setStatus(mode === 'local' ? localCoverageHint() : null);
    if (playingRef.current) startLoop(true);
  };

  const play = () => {
    if (!enabledRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    const mode = loopModeRef.current;
    const key = `${mode}:${mode === 'local' ? siteRef.current.id : 'national'}`;
    if (stackKeyRef.current === key && (ctrlRef.current?.frameCount() ?? 0) > 0) {
      startLoop(false); // resume existing stack from the current playhead
    } else {
      void buildAndPlay();
    }
  };

  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    stopAnim();
  };

  // -- health check ----------------------------------------------------------

  const recordFailure = () => {
    const now = Date.now();
    const times = failTimesRef.current.filter((t) => now - t < HEALTH_FAIL_WINDOW_MS);
    times.push(now);
    failTimesRef.current = times;
    if (
      times.length >= HEALTH_FAIL_THRESHOLD &&
      !usingBackupRef.current &&
      now > cooldownUntilRef.current
    ) {
      usingBackupRef.current = true;
      setUsingBackup(true);
      cooldownUntilRef.current = now + HEALTH_RECOVERY_COOLDOWN_MS;
      failTimesRef.current = [];
      ctrlRef.current?.setComposite(mrmsSource());
      setStatus('switched to backup (MRMS)');
    }
  };

  const refresh = () => {
    // Manual refresh doubles as the IEM recovery path.
    if (usingBackupRef.current && Date.now() > cooldownUntilRef.current) {
      usingBackupRef.current = false;
      setUsingBackup(false);
      setStatus('retrying primary radar');
    }
    failTimesRef.current = [];
    listCacheRef.current = null; // force a fresh listing on next play
    if (playingRef.current) void buildAndPlay();
    else enterLive();
  };

  // -- control handlers ------------------------------------------------------

  const onToggle = (v: boolean) => {
    enabledRef.current = v;
    setEnabled(v);
    ctrlRef.current?.setVisible(v);
    if (!v) pause();
  };
  const onOpacity = (v: number) => {
    setOpacity(v);
    ctrlRef.current?.setMasterOpacity(v);
  };
  const onPlayPause = () => (playingRef.current ? pause() : play());
  const onScrub = (i: number) => {
    pause();
    if ((ctrlRef.current?.frameCount() ?? 0) > 0) {
      posRef.current = i;
      displayIdxRef.current = i;
      setFrameIndex(i);
      ctrlRef.current?.showFrameIndex(i);
      updateLabel(framesRef.current[i]);
    }
  };
  const onLoopMode = (m: LoopMode) => {
    modeManualRef.current = true;
    loopModeRef.current = m;
    setLoopMode(m);
    stackKeyRef.current = null;
    if (playingRef.current) void buildAndPlay();
    else enterLive();
  };

  // -- map lifecycle ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;

    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;
      const home = defaultSite();
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASE_STYLE,
        center: [home.lon, home.lat],
        zoom: 7,
        maxZoom: 12,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

      map.on('load', () => {
        if (!map) return;
        ctrlRef.current = new RadarMapController(map);
        ctrlRef.current.setMasterOpacity(1);
        enterLive();
        // resize insurance (in case the container sizes after init on mobile)
        map.resize();
        requestAnimationFrame(() => map?.resize());
        setTimeout(() => map?.resize(), 600);
      });

      // Health check: count IEM tile errors (composite / single-site / local frames).
      map.on('error', (e: unknown) => {
        const sid = (e as MapErrorEvent)?.sourceId;
        if (!sid) return;
        const isIem =
          sid.startsWith('radar-composite-iem') ||
          sid === 'radar-single' ||
          (sid.startsWith('radar-frame') && loopModeRef.current === 'local');
        if (isIem) recordFailure();
      });

      map.on('moveend', () => {
        const { lat, lon, zoom } = view();
        const suggested: LoopMode = zoom >= SINGLE_SITE_MIN_ZOOM ? 'local' : 'national';
        setSuggestedMode(suggested);

        // nearest-site selection with hysteresis
        const newSite = selectSite(lat, lon, siteRef.current);
        const siteChanged = newSite.id !== siteRef.current.id;
        if (siteChanged) {
          siteRef.current = newSite;
          setSite(newSite);
        }

        // auto loop-mode suggestion (unless the user picked one)
        const modeChanged = !modeManualRef.current && suggested !== loopModeRef.current;
        if (modeChanged) {
          loopModeRef.current = suggested;
          setLoopMode(suggested);
          stackKeyRef.current = null;
        }

        if (playingRef.current) {
          if (siteChanged || modeChanged) void buildAndPlay();
        } else {
          enterLive(); // refresh single-site visibility for the new zoom/site
        }
      });
    })();

    return () => {
      cancelled = true;
      stopAnim();
      ctrlRef.current?.destroy();
      ctrlRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // Mount-once: the map and all handlers read live state via refs, so this
    // effect intentionally has no reactive dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0">
      {/* MapLibre forces `.maplibregl-map { position: relative }` onto this
          container, which would neutralize `inset-0`; use explicit h/w-full
          (parent is a definite-height box) so the canvas gets real height. */}
      <div ref={containerRef} className="h-full w-full" />
      <RadarControls
        enabled={enabled}
        onToggle={onToggle}
        opacity={opacity}
        onOpacity={onOpacity}
        playing={playing}
        onPlayPause={onPlayPause}
        frameCount={frameCount}
        frameIndex={frameIndex}
        onScrub={onScrub}
        timestampLabel={timestampLabel}
        loopMode={loopMode}
        onLoopMode={onLoopMode}
        suggestedMode={suggestedMode}
        siteName={site.name}
        usingBackup={usingBackup}
        status={status}
        attribution={
          loopMode === 'local' || !usingBackup
            ? 'Iowa Environmental Mesonet / NWS'
            : 'NOAA / NWS MRMS'
        }
        onRefresh={refresh}
      />
    </div>
  );
}
