'use client';

// =============================================================================
// RadarControls — presentational UI for the radar feature (web).
// Pure props in / callbacks out. No map SDK, no RadarCore logic.
// Parity target: the iOS radar control panel.
// =============================================================================

import type { LoopMode } from '@/lib/radar/RadarCore';

interface Props {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  opacity: number;
  onOpacity: (v: number) => void;
  playing: boolean;
  onPlayPause: () => void;
  frameCount: number;
  frameIndex: number;
  onScrub: (i: number) => void;
  timestampLabel: string;
  loopMode: LoopMode;
  onLoopMode: (m: LoopMode) => void;
  suggestedMode: LoopMode;
  siteName: string;
  usingBackup: boolean;
  status: string | null;
  attribution: string;
  onRefresh: () => void;
}

// IEM N0Q / N0B dBZ color ramp (approx stops, light->heavy).
const DBZ_RAMP: Array<{ c: string; dbz: string }> = [
  { c: '#04e9e7', dbz: '5' },
  { c: '#019ff4', dbz: '15' },
  { c: '#0300f4', dbz: '25' },
  { c: '#02fd02', dbz: '30' },
  { c: '#01c501', dbz: '35' },
  { c: '#fdf802', dbz: '45' },
  { c: '#fd9500', dbz: '50' },
  { c: '#fd0000', dbz: '55' },
  { c: '#bc0000', dbz: '60' },
  { c: '#f800fd', dbz: '70' },
];

export default function RadarControls(p: Props) {
  return (
    <div className="absolute left-3 right-3 bottom-3 z-10 mx-auto max-w-2xl">
      <div className="rounded-xl border border-white/10 bg-[#0d1521]/85 backdrop-blur-xl p-3 space-y-3 shadow-xl">
        {/* Top row: toggle, loop-mode, play/pause */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => p.onToggle(!p.enabled)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              p.enabled
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'text-white/50 border border-white/10 hover:bg-white/5'
            }`}
          >
            {p.enabled ? '◉ Radar On' : '○ Radar Off'}
          </button>

          {/* Loop mode switch */}
          <div className="flex rounded-full border border-white/10 overflow-hidden text-xs">
            {(['local', 'national'] as LoopMode[]).map((m) => (
              <button
                key={m}
                onClick={() => p.onLoopMode(m)}
                className={`px-3 py-1.5 transition-all ${
                  p.loopMode === m ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/5'
                }`}
                title={m === p.suggestedMode ? 'Suggested for this zoom' : undefined}
              >
                {m === 'local' ? 'Local (hi-res)' : 'National (smooth)'}
                {m === p.suggestedMode && m !== p.loopMode ? ' ·' : ''}
              </button>
            ))}
          </div>

          <button
            onClick={p.onPlayPause}
            disabled={!p.enabled}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 transition-all"
          >
            {p.playing ? '❚❚ Pause' : '▶ Play'}
          </button>

          <button
            onClick={p.onRefresh}
            title="Refresh radar (also retries primary source)"
            className="px-2 py-1.5 rounded-full text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
          >
            ⟳
          </button>

          <span className="text-xs text-white/60 ml-auto tabular-nums">{p.timestampLabel}</span>
        </div>

        {/* Timeline scrubber */}
        <input
          type="range"
          min={0}
          max={Math.max(0, p.frameCount - 1)}
          value={p.frameIndex < 0 ? 0 : p.frameIndex}
          onChange={(e) => p.onScrub(Number(e.target.value))}
          disabled={!p.enabled || p.frameCount === 0}
          className="w-full accent-blue-400 disabled:opacity-40"
        />

        {/* Opacity slider */}
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className="w-14">Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={p.opacity}
            onChange={(e) => p.onOpacity(Number(e.target.value))}
            disabled={!p.enabled}
            className="flex-1 accent-blue-400 disabled:opacity-40"
          />
          <span className="w-8 tabular-nums text-right">{Math.round(p.opacity * 100)}%</span>
        </div>

        {/* Legend (dBZ ramp) */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 w-14">dBZ</span>
          <div className="flex flex-1 h-2 rounded overflow-hidden">
            {DBZ_RAMP.map((s) => (
              <div key={s.dbz} className="flex-1" style={{ backgroundColor: s.c }} title={`${s.dbz} dBZ`} />
            ))}
          </div>
          <span className="text-[10px] text-white/40 tabular-nums">5→70</span>
        </div>

        {/* Footer: site, status, attribution */}
        <div className="flex items-center justify-between text-[10px] text-white/40">
          <span>
            {p.loopMode === 'local' ? `Site: ${p.siteName}` : 'National mosaic'}
            {p.usingBackup && <span className="ml-2 text-amber-400">⚠ using backup radar</span>}
            {p.status && <span className="ml-2 text-white/60">{p.status}</span>}
          </span>
          <span>{p.attribution}</span>
        </div>
      </div>
    </div>
  );
}
