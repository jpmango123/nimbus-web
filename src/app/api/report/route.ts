// =============================================================================
// GET /api/report — Nightly AI audit report (runs at 8pm ET daily)
// Analyzes accuracy, generates email, optionally applies fixes
// =============================================================================

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendNightlyReport } from '@/lib/email';

export const maxDuration = 120; // Allow up to 2 min for AI analysis

interface AccuracyRow {
  location_name: string;
  location_id: number;
  avg_temp_error_high: number;
  avg_temp_error_low: number;
  avg_precip_error: number;
  days_compared: number;
}

interface SnapshotRow {
  location_name: string;
  target_date: string;
  predicted_high: number;
  predicted_low: number;
  predicted_precip_prob: number;
  predicted_precip_accum: number;
  actual_high: number;
  actual_low: number;
  actual_precip: number;
}

export async function GET() {
  try {
    const sql = getDb();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

    // 1. Calculate accuracy metrics per location (last 7 days)
    const accuracy = await sql`
      SELECT
        l.name as location_name,
        l.id as location_id,
        AVG(ABS(fs.predicted_high - aw.actual_high)) as avg_temp_error_high,
        AVG(ABS(fs.predicted_low - aw.actual_low)) as avg_temp_error_low,
        AVG(ABS(fs.predicted_precip_accum - aw.actual_precip)) as avg_precip_error,
        COUNT(DISTINCT aw.date) as days_compared
      FROM locations l
      JOIN actual_weather aw ON aw.location_id = l.id AND aw.date >= ${weekAgo}
      JOIN forecast_snapshots fs ON fs.location_id = l.id
        AND fs.target_date = aw.date
        AND fs.hours_ahead BETWEEN 12 AND 36
      GROUP BY l.id, l.name
      ORDER BY l.sort_order
    ` as AccuracyRow[];

    // 2. Get detailed comparison data
    const comparisons = await sql`
      SELECT
        l.name as location_name,
        aw.date as target_date,
        fs.predicted_high, fs.predicted_low,
        fs.predicted_precip_prob, fs.predicted_precip_accum,
        aw.actual_high, aw.actual_low, aw.actual_precip
      FROM locations l
      JOIN actual_weather aw ON aw.location_id = l.id AND aw.date >= ${weekAgo}
      JOIN forecast_snapshots fs ON fs.location_id = l.id
        AND fs.target_date = aw.date
        AND fs.hours_ahead BETWEEN 12 AND 36
      ORDER BY aw.date DESC, l.sort_order
      LIMIT 50
    ` as SnapshotRow[];

    // 3. Send to Claude API for analysis (if key configured)
    let aiAnalysis = '';
    const claudeKey = process.env.CLAUDE_API_KEY;

    if (claudeKey && accuracy.length > 0) {
      try {
        const prompt = buildAuditPrompt(accuracy, comparisons);
        aiAnalysis = await callClaudeAPI(claudeKey, prompt);
      } catch (err) {
        aiAnalysis = `AI analysis unavailable: ${err}`;
      }
    } else if (!claudeKey) {
      aiAnalysis = 'Claude API key not configured. Set CLAUDE_API_KEY in environment variables.';
    } else {
      aiAnalysis = 'No accuracy data available yet. The audit cron needs to run for a few days to collect comparison data.';
    }

    // 4. Get recent AI changelog entries
    const recentChanges = await sql`
      SELECT * FROM ai_changelog
      WHERE created_at > ${new Date(now.getTime() - 24 * 3600000).toISOString()}
      ORDER BY created_at DESC
    `;

    // 5. Build email HTML
    const emailHtml = buildEmailHtml(accuracy, comparisons, aiAnalysis, recentChanges);

    // 6. Send email
    const subject = `Nimbus Nightly Report — ${now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })}`;

    const sent = await sendNightlyReport(subject, emailHtml);

    // 7. Log the report
    await sql`
      INSERT INTO ai_changelog (category, summary, details, status)
      VALUES ('report', ${`Nightly report generated — ${accuracy.length} locations analyzed`},
              ${aiAnalysis.slice(0, 5000)}, 'applied')
    `;

    return NextResponse.json({
      success: true,
      emailSent: sent,
      locationsAnalyzed: accuracy.length,
      comparisonsFound: comparisons.length,
      aiAnalysisLength: aiAnalysis.length,
    });
  } catch (err) {
    console.error('[REPORT] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// MARK: - Claude API Call

async function callClaudeAPI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || 'No analysis generated';
}

function buildAuditPrompt(accuracy: AccuracyRow[], comparisons: SnapshotRow[]): string {
  return `You are analyzing weather forecast accuracy for the Nimbus weather app.

## Accuracy Summary (Last 7 Days)
${accuracy.map(a => `
### ${a.location_name}
- High temp MAE: ±${a.avg_temp_error_high?.toFixed(1) ?? 'N/A'}°F
- Low temp MAE: ±${a.avg_temp_error_low?.toFixed(1) ?? 'N/A'}°F
- Precip accumulation error: ±${a.avg_precip_error?.toFixed(2) ?? 'N/A'}"
- Days compared: ${a.days_compared}
`).join('')}

## Detailed Comparisons
${comparisons.slice(0, 20).map(c =>
  `${c.location_name} ${c.target_date}: Predicted H${Math.round(c.predicted_high)}/L${Math.round(c.predicted_low)} precip ${c.predicted_precip_accum?.toFixed(2)}" | Actual H${Math.round(c.actual_high)}/L${Math.round(c.actual_low)} precip ${c.actual_precip?.toFixed(2)}"`
).join('\n')}

## Instructions
Please analyze:
1. Overall accuracy assessment for each location
2. Systematic biases (consistently over/under-predicting?)
3. Precipitation calibration (when we say 60% chance, does it rain ~60% of the time?)
4. Specific suggestions for improvement (e.g., adjust model weights, change thresholds)
5. Any anomalies or concerning patterns

Keep your response concise and actionable. Focus on what can be fixed in code.`;
}

function buildEmailHtml(
  accuracy: AccuracyRow[],
  comparisons: SnapshotRow[],
  aiAnalysis: string,
  recentChanges: Record<string, unknown>[]
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1521; color: #e2e8f0; padding: 24px; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { color: #60a5fa; font-size: 24px; margin-bottom: 4px; }
    h2 { color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #1e293b; font-size: 13px; }
    th { color: #64748b; font-weight: 600; }
    td { color: #cbd5e1; }
    .card { background: #1e293b; border-radius: 12px; padding: 16px; margin: 12px 0; }
    .analysis { white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #94a3b8; }
    .change { padding: 8px 12px; border-left: 3px solid #3b82f6; margin: 8px 0; background: #1e293b40; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #1e293b; color: #475569; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>☁️ Nimbus Nightly Report</h1>
    <p style="color: #64748b; font-size: 13px;">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>

    <h2>📍 Accuracy Summary (7-Day)</h2>
    ${accuracy.length > 0 ? `
    <table>
      <tr><th>City</th><th>Temp MAE</th><th>Precip Error</th><th>Days</th></tr>
      ${accuracy.map(a => `
        <tr>
          <td>${a.location_name}</td>
          <td>±${a.avg_temp_error_high?.toFixed(1) ?? '—'}°F / ±${a.avg_temp_error_low?.toFixed(1) ?? '—'}°F</td>
          <td>±${a.avg_precip_error?.toFixed(2) ?? '—'}"</td>
          <td>${a.days_compared}</td>
        </tr>
      `).join('')}
    </table>
    ` : '<div class="card"><p style="color: #64748b;">No accuracy data yet. The system needs a few days of data collection.</p></div>'}

    <h2>🤖 AI Analysis</h2>
    <div class="card">
      <div class="analysis">${aiAnalysis.replace(/\n/g, '<br>')}</div>
    </div>

    ${recentChanges.length > 0 ? `
    <h2>🔧 Changes Made Today</h2>
    ${recentChanges.map(c => `
      <div class="change">
        <strong>[${c.category}]</strong> ${c.summary}
      </div>
    `).join('')}
    ` : ''}

    <div class="footer">
      <p>Nimbus Weather — Automated Nightly Report</p>
      <p>Data from Open-Meteo (HRRR/NBM/GFS blended) + NWS alerts</p>
    </div>
  </div>
</body>
</html>`;
}
