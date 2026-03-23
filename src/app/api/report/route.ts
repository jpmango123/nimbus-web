// =============================================================================
// GET /api/report — Nightly AI audit report (runs at 8pm ET daily)
// Analyzes accuracy + visual appearance, generates email, logs findings
// =============================================================================

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendNightlyReport } from '@/lib/email';
import { captureAllScreenshots, ScreenshotResult } from '@/lib/screenshot';

export const maxDuration = 300; // 5 min for screenshots + AI analysis

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

interface LocationRow {
  id: number;
  name: string;
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

    // 3. Capture screenshots of all charts and widgets
    const locations = await sql`SELECT id, name FROM locations ORDER BY sort_order` as LocationRow[];
    let screenshots: ScreenshotResult[] = [];
    try {
      screenshots = await captureAllScreenshots(locations);
      console.log(`[REPORT] Captured ${screenshots.length} screenshots`);
    } catch (err) {
      console.error('[REPORT] Screenshot capture failed:', err);
    }

    // 4. Send to Claude API for analysis (data + visual)
    let aiDataAnalysis = '';
    let aiVisualAnalysis = '';
    let aiBlendingAnalysis = '';
    const claudeKey = process.env.CLAUDE_API_KEY;

    if (claudeKey) {
      // Data accuracy analysis
      if (accuracy.length > 0) {
        try {
          const prompt = buildAuditPrompt(accuracy, comparisons);
          aiDataAnalysis = await callClaudeText(claudeKey, prompt);
        } catch (err) {
          aiDataAnalysis = `Data analysis unavailable: ${err}`;
        }
      } else {
        aiDataAnalysis = 'No accuracy data available yet. The audit cron needs to run for a few days to collect comparison data.';
      }

      // Visual analysis with screenshots
      if (screenshots.length > 0) {
        try {
          aiVisualAnalysis = await callClaudeVision(claudeKey, screenshots);
        } catch (err) {
          aiVisualAnalysis = `Visual analysis unavailable: ${err}`;
        }
      } else {
        aiVisualAnalysis = 'No screenshots captured. Visual analysis will be available once Chromium is available in the deployment environment.';
      }

      // Blending & data processing analysis
      try {
        aiBlendingAnalysis = await analyzeBlending(claudeKey, sql, weekAgo);
      } catch (err) {
        aiBlendingAnalysis = `Blending analysis unavailable: ${err}`;
      }
    } else {
      aiDataAnalysis = 'Claude API key not configured.';
      aiVisualAnalysis = 'Claude API key not configured.';
    }

    const combinedAnalysis = `## Data Accuracy Analysis\n${aiDataAnalysis}\n\n## Visual & Graph Analysis\n${aiVisualAnalysis}\n\n## Blending & Data Processing\n${aiBlendingAnalysis}`;

    // 5. Get recent AI changelog entries
    const recentChanges = await sql`
      SELECT * FROM ai_changelog
      WHERE created_at > ${new Date(now.getTime() - 24 * 3600000).toISOString()}
      ORDER BY created_at DESC
    `;

    // 6. Build and send email
    const emailHtml = buildEmailHtml(accuracy, comparisons, aiDataAnalysis, aiVisualAnalysis, aiBlendingAnalysis, screenshots, recentChanges);
    const subject = `Nimbus Nightly Report — ${now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })}`;
    const sent = await sendNightlyReport(subject, emailHtml);

    // 6b. Log blending analysis
    if (aiBlendingAnalysis && aiBlendingAnalysis.length > 50 && !aiBlendingAnalysis.includes('unavailable') && !aiBlendingAnalysis.includes('not configured')) {
      await sql`
        INSERT INTO ai_changelog (category, summary, details, status)
        VALUES ('accuracy', ${`Blending analysis: model weights and data processing review`},
                ${aiBlendingAnalysis.slice(0, 5000)}, 'applied')
      `;
    }

    // 7. Log visual findings to changelog
    if (aiVisualAnalysis && aiVisualAnalysis.length > 50 && !aiVisualAnalysis.includes('unavailable') && !aiVisualAnalysis.includes('not configured')) {
      await sql`
        INSERT INTO ai_changelog (category, summary, details, status)
        VALUES ('visual', ${`Visual audit: ${screenshots.length} screenshots analyzed`},
                ${aiVisualAnalysis.slice(0, 5000)}, 'applied')
      `;
    }

    // 8. Log the report
    await sql`
      INSERT INTO ai_changelog (category, summary, details, status)
      VALUES ('report', ${`Nightly report — ${accuracy.length} locations, ${screenshots.length} screenshots`},
              ${combinedAnalysis.slice(0, 5000)}, 'applied')
    `;

    return NextResponse.json({
      success: true,
      emailSent: sent,
      locationsAnalyzed: accuracy.length,
      comparisonsFound: comparisons.length,
      screenshotsCaptured: screenshots.length,
      aiDataAnalysisLength: aiDataAnalysis.length,
      aiVisualAnalysisLength: aiVisualAnalysis.length,
    });
  } catch (err) {
    console.error('[REPORT] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// MARK: - Claude API Calls

async function callClaudeText(apiKey: string, prompt: string): Promise<string> {
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

  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'No analysis generated';
}

/** Send screenshots to Claude vision for visual evaluation */
async function callClaudeVision(apiKey: string, screenshots: ScreenshotResult[]): Promise<string> {
  // Build message with images + analysis prompt
  const content: Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }> = [];

  // Add each screenshot as an image
  for (const shot of screenshots.slice(0, 6)) { // Limit to 6 images to stay within token budget
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: shot.imageBase64,
      },
    });
    content.push({
      type: 'text',
      text: `[Screenshot: ${shot.chartType} — ${shot.locationName}]`,
    });
  }

  // Add the analysis prompt
  content.push({
    type: 'text',
    text: `You are a weather app UI/UX expert reviewing the Nimbus Weather web app. These screenshots show the dashboard and widget views.

Please evaluate:

1. **Chart Readability** — Are the temperature curves smooth and easy to follow? Are labels readable? Is the Y-axis scaling appropriate?
2. **Precipitation Graphs** — Do the precipitation area fills look correct? Are the gradient opacities working well? Do the Catmull-Rom curves look smooth or jagged?
3. **Color & Contrast** — Is the temperature-to-color mapping working correctly (blue=cold, green=mild, yellow=warm, red=hot)? Are precip overlays visible but not overwhelming?
4. **Widget Appearance** — Do the small/medium/large widgets look like proper iOS widgets? Are they the right proportions? Is text legible at widget sizes?
5. **Data Display** — Are there any obvious data glitches (e.g., impossible temperatures, flat lines that should have variation, missing data)?
6. **Layout & Spacing** — Are charts well-spaced? Any overlapping elements? Any charts that look cramped or too spread out?
7. **Specific Improvements** — List concrete, actionable changes (e.g., "increase precipitation area opacity from 0.35 to 0.45", "add more Y-axis labels to the daily chart", "the hourly chart needs night shading").

Be specific with numbers and values. These recommendations will be used to improve both the web app and the iOS app.
Focus on what looks wrong or could look better — don't just describe what you see.`,
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) throw new Error(`Claude Vision API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'No visual analysis generated';
}

// MARK: - Blending & Data Processing Analysis

type NeonSql = ReturnType<typeof getDb>;

async function analyzeBlending(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Pull recent snapshots that include per-model data
  const snapshots = await sql`
    SELECT location_id, target_date, predicted_high, predicted_low,
           predicted_precip_accum, raw_json
    FROM forecast_snapshots
    WHERE captured_at > ${weekAgo}
      AND raw_json::text LIKE '%perModel%'
    ORDER BY captured_at DESC
    LIMIT 30
  `;

  if (!snapshots.length) {
    return 'No per-model comparison data available yet. Will analyze once the audit has captured a few rounds of HRRR/NBM/GFS data side by side.';
  }

  // Build a summary of model divergence
  const modelComparisons: string[] = [];
  for (const snap of snapshots.slice(0, 10)) {
    const raw = snap.raw_json as Record<string, unknown>;
    const perModel = raw?.perModel as Record<string, { high: number; low: number; precipAccum: number }> | undefined;
    if (!perModel) continue;

    const parts = [];
    if (perModel.hrrr) parts.push(`HRRR H${Math.round(perModel.hrrr.high)}/L${Math.round(perModel.hrrr.low)} precip ${perModel.hrrr.precipAccum?.toFixed(2)}"`);
    if (perModel.nbm) parts.push(`NBM H${Math.round(perModel.nbm.high)}/L${Math.round(perModel.nbm.low)} precip ${perModel.nbm.precipAccum?.toFixed(2)}"`);
    if (perModel.gfs) parts.push(`GFS H${Math.round(perModel.gfs.high)}/L${Math.round(perModel.gfs.low)} precip ${perModel.gfs.precipAccum?.toFixed(2)}"`);

    modelComparisons.push(
      `${snap.target_date}: Blended H${Math.round(snap.predicted_high as number)}/L${Math.round(snap.predicted_low as number)} precip ${(snap.predicted_precip_accum as number)?.toFixed(2)}" | ${parts.join(' | ')}`
    );
  }

  const prompt = `You are a meteorologist and data scientist evaluating how a weather app blends multiple weather models.

## Current Blending Strategy
The app uses Open-Meteo to fetch 3 NWP models and blends them with these weights by forecast horizon:
- 0-6h ahead: HRRR=60%, NBM=30%, GFS=10% (HRRR assimilates radar, best near-term)
- 6-18h: HRRR=40%, NBM=40%, GFS=20%
- 18-48h: HRRR=15%, NBM=55%, GFS=30%
- 48h+: NBM=40%, GFS=60% (HRRR drops out)
- 192h+: GFS=100%

## Per-Model vs Blended Output (Recent Snapshots)
${modelComparisons.join('\n')}

## Your Analysis
Please evaluate as a meteorologist:

1. **Model Divergence** — How much do HRRR, NBM, GFS disagree? When they disagree significantly, which model tends to be right?
2. **Weight Optimization** — Are the current blend weights optimal? Should they be adjusted? Consider that HRRR excels at convective/precip timing, NBM is calibrated for temperature, GFS has global coverage.
3. **Precipitation Handling** — Is the app treating precipitation probability and accumulation correctly? Are there artifacts from averaging probabilities across models (e.g., 3 models at 0%, 0%, 90% averaging to 30% instead of recognizing one model sees a storm)?
4. **Data Processing Improvements** — Suggest specific improvements to how the app processes the raw model data:
   - Should it use ensemble spreads differently?
   - Should precipitation use max-of-models instead of weighted average?
   - Should temperature blending use a different strategy than precip blending?
   - Are there bias corrections that could be applied per-model?
5. **Missing Data Handling** — When one model is unavailable, the others get redistributed weights. Is this the right approach or should there be a fallback hierarchy?

Be specific with numbers and implementation suggestions. These will be used to improve the iOS and web app code.`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Prompts

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

// MARK: - Email HTML

function buildEmailHtml(
  accuracy: AccuracyRow[],
  comparisons: SnapshotRow[],
  aiDataAnalysis: string,
  aiVisualAnalysis: string,
  aiBlendingAnalysis: string,
  screenshots: ScreenshotResult[],
  recentChanges: Record<string, unknown>[]
): string {
  // Embed up to 3 screenshots inline in the email
  const inlineImages = screenshots.slice(0, 3).map(s =>
    `<div style="margin: 8px 0;">
      <div style="color: #64748b; font-size: 11px; margin-bottom: 4px;">${s.chartType} — ${s.locationName}</div>
      <img src="data:image/png;base64,${s.imageBase64}" style="max-width: 100%; border-radius: 8px; border: 1px solid #1e293b;" />
    </div>`
  ).join('');

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

    <h2>🤖 Data Analysis</h2>
    <div class="card">
      <div class="analysis">${aiDataAnalysis.replace(/\n/g, '<br>')}</div>
    </div>

    ${screenshots.length > 0 ? `
    <h2>📊 Graph Screenshots</h2>
    <div class="card">
      ${inlineImages}
    </div>

    <h2>🎨 Visual Analysis</h2>
    <div class="card">
      <div class="analysis">${aiVisualAnalysis.replace(/\n/g, '<br>')}</div>
    </div>
    ` : ''}

    ${aiBlendingAnalysis && aiBlendingAnalysis.length > 50 ? `
    <h2>⚙️ Model Blending & Data Processing</h2>
    <div class="card">
      <div class="analysis">${aiBlendingAnalysis.replace(/\n/g, '<br>')}</div>
    </div>
    ` : ''}

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
      <p>Data: Open-Meteo (HRRR/NBM/GFS blended) + NWS alerts | Visual: Puppeteer + Claude Vision</p>
    </div>
  </div>
</body>
</html>`;
}
