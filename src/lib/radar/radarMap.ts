// =============================================================================
// radarMap.ts — WEB platform adapter (MapLibre GL JS glue ONLY)
//
// Translates RadarCore output (RadarSource / RadarFrame) into MapLibre raster
// source + layer add/remove/opacity calls. Contains NO radar business logic —
// no endpoint strings, no site math, no frame fetching. That all lives in
// RadarCore.ts. (iOS equivalent: RadarMapController.swift over MapLibre Native.)
//
// Layer ordering: every radar layer is inserted BEFORE `LABELS_LAYER_ID` so the
// basemap's place labels stay readable on top of the radar imagery.
//
// Animation approach (chosen): a PRE-ADDED PER-FRAME LAYER STACK toggled via
// raster-opacity. Each frame is its own raster source+layer added at opacity 0
// but visibility:'visible', so MapLibre eagerly loads its tiles for the current
// viewport (preloading). Playback then just flips raster-opacity between frames
// — no source.setTiles() reload, so there is zero per-frame network flicker.
// (setTiles() on a single source would re-request and blink on each step.)
// Frames are built once per loop refresh, not continuously — IEM-courtesy safe.
// =============================================================================

import type {
  Map as MLMap,
  RasterSourceSpecification,
  RasterLayerSpecification,
  RasterTileSource,
} from 'maplibre-gl';
import type { RadarFrame, RadarSource } from './RadarCore';
import { tileURL } from './RadarCore';

/** The basemap layer id that radar must stay beneath (place labels overlay). */
export const LABELS_LAYER_ID = 'carto-labels';

interface ManagedLayer {
  baseOpacity: number; // RadarSource.opacity (the layer's "full" opacity)
}

export class RadarMapController {
  private map: MLMap;
  private labelsBefore: string | undefined;
  private master = 1; // opacity slider 0..1
  private visible = true; // radar on/off toggle
  private layers = new Map<string, ManagedLayer>(); // layerId -> meta
  private frameLayerIds: string[] = []; // ordered frame stack (oldest..newest)
  private activeFrame = -1;

  constructor(map: MLMap) {
    this.map = map;
    // Anchor radar beneath labels if that layer exists; else beneath the first
    // symbol layer; else on top.
    this.labelsBefore = map.getLayer(LABELS_LAYER_ID)
      ? LABELS_LAYER_ID
      : map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
  }

  // ---- low-level helpers ---------------------------------------------------

  private rasterSourceSpec(tiles: string, tileSize: number, attribution: string, maxzoom: number): RasterSourceSpecification {
    return { type: 'raster', tiles: [tiles], tileSize, attribution, maxzoom };
  }

  private ensureLayer(
    id: string,
    tiles: string,
    src: RadarSource,
    opacity: number
  ): void {
    if (!this.map.getSource(id)) {
      this.map.addSource(id, this.rasterSourceSpec(tiles, src.tileSize, src.attribution, src.maxzoom));
    }
    if (!this.map.getLayer(id)) {
      const layer: RasterLayerSpecification = {
        id,
        type: 'raster',
        source: id,
        minzoom: src.minzoom,
        maxzoom: src.maxzoom,
        paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
      };
      this.map.addLayer(layer, this.labelsBefore);
    }
    this.layers.set(id, { baseOpacity: src.opacity });
  }

  private removeLayer(id: string): void {
    if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(id)) this.map.removeSource(id);
    this.layers.delete(id);
  }

  private applyOpacity(id: string, factor: number): void {
    const meta = this.layers.get(id);
    if (!meta || !this.map.getLayer(id)) return;
    const eff = this.visible ? meta.baseOpacity * this.master * factor : 0;
    this.map.setPaintProperty(id, 'raster-opacity', eff);
    this.map.setLayoutProperty(id, 'visibility', this.visible ? 'visible' : 'none');
  }

  // ---- static (live) layers ------------------------------------------------

  /** Add/update the always-on CONUS composite (or MRMS fallback) layer. */
  setComposite(src: RadarSource): void {
    // If a previous composite of a different id exists, drop it.
    for (const id of [...this.layers.keys()]) {
      if (id.startsWith('radar-composite') && id !== this.compositeId(src)) this.removeLayer(id);
    }
    const id = this.compositeId(src);
    this.ensureLayer(id, tileURL(src, null), src, src.opacity * this.master);
    this.applyOpacity(id, 1);
  }

  private compositeId(src: RadarSource): string {
    return `radar-composite-${src.kind}`;
  }

  /** Remove any composite layer (used by National mode, where RainViewer is
   *  itself a national mosaic and an IEM composite underneath is redundant). */
  removeComposite(): void {
    for (const id of [...this.layers.keys()]) {
      if (id.startsWith('radar-composite')) this.removeLayer(id);
    }
  }

  /** Add/update or remove the single-site "latest" layer (above composite). */
  setSingleSite(src: RadarSource | null): void {
    const id = 'radar-single';
    if (!src) {
      this.removeLayer(id);
      return;
    }
    // Re-create on site change so tiles point at the right {SITE}.
    if (this.map.getSource(id)) {
      (this.map.getSource(id) as RasterTileSource).setTiles([tileURL(src, null)]);
      this.layers.set(id, { baseOpacity: src.opacity });
    } else {
      this.ensureLayer(id, tileURL(src, null), src, src.opacity * this.master);
    }
    this.applyOpacity(id, 1);
  }

  // ---- animation frame stack ----------------------------------------------

  /** Pre-add one raster layer per frame (opacity 0, visible -> preloads tiles).
   *  `src` is the animated source kind (single-site or rainviewer). */
  buildFrameStack(src: RadarSource, frames: RadarFrame[]): void {
    this.clearFrameStack();
    frames.forEach((frame, i) => {
      const id = `radar-frame-${i}`;
      this.ensureLayer(id, tileURL(src, frame), src, 0);
      this.frameLayerIds.push(id);
    });
    this.activeFrame = frames.length - 1; // newest visible by default
    this.showFrameIndex(this.activeFrame);
  }

  showFrameIndex(index: number): void {
    this.activeFrame = index;
    this.frameLayerIds.forEach((id, i) => this.applyOpacity(id, i === index ? 1 : 0));
  }

  clearFrameStack(): void {
    for (const id of this.frameLayerIds) this.removeLayer(id);
    this.frameLayerIds = [];
    this.activeFrame = -1;
  }

  frameCount(): number {
    return this.frameLayerIds.length;
  }

  // ---- global controls -----------------------------------------------------

  setMasterOpacity(value: number): void {
    this.master = Math.max(0, Math.min(1, value));
    this.refreshAll();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.refreshAll();
  }

  private refreshAll(): void {
    for (const id of this.layers.keys()) {
      const isFrame = this.frameLayerIds.includes(id);
      const factor = isFrame ? (id === this.frameLayerIds[this.activeFrame] ? 1 : 0) : 1;
      this.applyOpacity(id, factor);
    }
  }

  destroy(): void {
    this.clearFrameStack();
    for (const id of [...this.layers.keys()]) this.removeLayer(id);
  }
}
