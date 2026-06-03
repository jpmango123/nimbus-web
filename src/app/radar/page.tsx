'use client';

// =============================================================================
// /radar — full-screen high-resolution weather radar map.
// =============================================================================

import Link from 'next/link';
import RadarView from '@/components/radar/RadarView';

export default function RadarPage() {
  return (
    <main className="fixed inset-0 flex flex-col">
      {/* Slim header (kept short so the map gets the screen) */}
      <nav className="flex items-center justify-between border-b border-white/5 bg-[#0d1521]/80 px-4 py-2 backdrop-blur-xl">
        <Link href="/" className="text-sm font-semibold">
          <span className="text-blue-400">☁️</span> Nimbus
        </Link>
        <span className="text-xs text-white/50">Radar</span>
        <Link
          href="/"
          className="rounded px-2 py-1 text-xs text-white/50 transition-all hover:bg-white/5 hover:text-white/80"
        >
          ← Back
        </Link>
      </nav>

      {/* Map fills the rest */}
      <div className="relative flex-1">
        <RadarView />
      </div>
    </main>
  );
}
