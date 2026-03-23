'use client';

// =============================================================================
// Changelog Page — Shows all AI-made changes with diffs
// =============================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ChangelogEntry {
  id: number;
  created_at: string;
  category: string;
  summary: string;
  details: string | null;
  files_changed: string[] | null;
  diff: string | null;
  status: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  bug_fix: '#EF4444',
  accuracy: '#3B82F6',
  visual: '#A855F7',
  performance: '#22C55E',
  report: '#6B7280',
};

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/changelog')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setEntries(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => e.category === filter);

  const categories = ['all', ...new Set(entries.map(e => e.category))];

  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#0d1521]/80 border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/50 hover:text-white/80 text-sm">← Back</Link>
            <h1 className="text-lg font-semibold">AI Changelog</h1>
          </div>
          <div className="text-xs text-white/40">{entries.length} entries</div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Filter bar */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                filter === cat
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'text-white/50 hover:text-white/70 bg-white/5'
              }`}
            >
              {cat === 'all' ? 'All' : cat.replace('_', ' ')}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-white/40 text-sm text-center py-20 animate-pulse">Loading changelog...</div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-20">
            <div className="text-3xl mb-4">📋</div>
            <div className="text-white/50 text-lg">No changes yet</div>
            <div className="text-white/30 text-sm mt-2">
              The AI audit system will log changes here as it makes improvements.
              <br />Make sure the nightly cron is configured in vercel.json.
            </div>
          </div>
        )}

        {/* Entries */}
        <div className="space-y-3">
          {filtered.map(entry => (
            <div
              key={entry.id}
              className="rounded-xl bg-white/5 border border-white/10 p-4 cursor-pointer hover:bg-white/[0.07] transition-colors"
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[entry.category] || '#6B7280' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-white/30 font-bold">
                      {entry.category.replace('_', ' ')}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      entry.status === 'applied' ? 'bg-green-500/10 text-green-400' :
                      entry.status === 'reverted' ? 'bg-red-500/10 text-red-400' :
                      'bg-yellow-500/10 text-yellow-400'
                    }`}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="text-sm text-white/80 mt-1">{entry.summary}</div>
                </div>
                <div className="text-xs text-white/30 flex-shrink-0">
                  {new Date(entry.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric',
                  })}
                </div>
              </div>

              {expandedId === entry.id && (
                <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
                  {entry.details && (
                    <div className="text-xs text-white/50 whitespace-pre-wrap">{entry.details}</div>
                  )}
                  {entry.files_changed && entry.files_changed.length > 0 && (
                    <div>
                      <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Files Changed</div>
                      <div className="space-y-1">
                        {entry.files_changed.map((f, i) => (
                          <div key={i} className="text-xs text-blue-300/60 font-mono">{f}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {entry.diff && (
                    <div>
                      <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Diff</div>
                      <pre className="text-[11px] text-white/40 font-mono bg-black/30 rounded-lg p-3 overflow-x-auto max-h-60">
                        {entry.diff}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
