// =============================================================================
// GET /api/report — Nightly AI audit report (runs at 8pm ET daily)
// Analyzes accuracy + visual appearance, generates email, logs findings
// =============================================================================

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendNightlyReport } from '@/lib/email';
import { captureAllScreenshots, ScreenshotResult } from '@/lib/screenshot';
import { generateFixes, applyWebAppFixes, storeIosAppFixes, CodeFix } from '@/lib/auto-fix';

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
    // Use a subquery to pick the single best snapshot per location/date
    // (closest to 24h ahead) to avoid double-counting from multiple 3h audits
    const accuracy = await sql`
      WITH best_snapshot AS (
        SELECT DISTINCT ON (location_id, target_date)
          location_id, target_date, predicted_high, predicted_low,
          predicted_precip_accum, predicted_precip_type, hours_ahead
        FROM forecast_snapshots
        WHERE hours_ahead BETWEEN 12 AND 36
        ORDER BY location_id, target_date, ABS(hours_ahead - 24) ASC
      )
      SELECT
        l.name as location_name,
        l.id as location_id,
        AVG(ABS(bs.predicted_high - aw.actual_high)) as avg_temp_error_high,
        AVG(ABS(bs.predicted_low - aw.actual_low)) as avg_temp_error_low,
        AVG(ABS(bs.predicted_precip_accum - aw.actual_precip)) as avg_precip_error,
        COUNT(DISTINCT aw.date) as days_compared
      FROM locations l
      JOIN actual_weather aw ON aw.location_id = l.id AND aw.date >= ${weekAgo}
      JOIN best_snapshot bs ON bs.location_id = l.id AND bs.target_date = aw.date
      GROUP BY l.id, l.name
      ORDER BY l.sort_order
    ` as AccuracyRow[];

    // 2. Get detailed comparison data (one snapshot per location/date, closest to 24h out)
    const comparisons = await sql`
      WITH best_snapshot AS (
        SELECT DISTINCT ON (location_id, target_date)
          location_id, target_date, predicted_high, predicted_low,
          predicted_precip_prob, predicted_precip_accum, hours_ahead
        FROM forecast_snapshots
        WHERE hours_ahead BETWEEN 12 AND 36
        ORDER BY location_id, target_date, ABS(hours_ahead - 24) ASC
      )
      SELECT
        l.name as location_name,
        aw.date as target_date,
        bs.predicted_high, bs.predicted_low,
        bs.predicted_precip_prob, bs.predicted_precip_accum,
        aw.actual_high, aw.actual_low, aw.actual_precip
      FROM locations l
      JOIN actual_weather aw ON aw.location_id = l.id AND aw.date >= ${weekAgo}
      JOIN best_snapshot bs ON bs.location_id = l.id AND bs.target_date = aw.date
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

    // 4. Run all Claude analysis modules in parallel where possible
    const analyses: Record<string, string> = {
      data: '',
      visual: '',
      blending: '',
      meteorological: '',
      calibration: '',
      hourlyAccuracy: '',
      forecastStability: '',
      precipTiming: '',
      windAccuracy: '',
      conditionAccuracy: '',
      modelRanking: '',
      ux: '',
      dataVsDisplay: '',
    };
    const claudeKey = process.env.CLAUDE_API_KEY;

    if (claudeKey) {
      // Run independent analyses in parallel
      const tasks: Promise<void>[] = [];

      // A. Data accuracy analysis
      if (accuracy.length > 0) {
        tasks.push(
          callClaudeText(claudeKey, buildAuditPrompt(accuracy, comparisons))
            .then(r => { analyses.data = r; })
            .catch(e => { analyses.data = `Unavailable: ${e}`; })
        );
      } else {
        analyses.data = 'No accuracy data yet. Needs a few days of data collection.';
      }

      // B. Visual analysis with screenshots
      if (screenshots.length > 0) {
        tasks.push(
          callClaudeVision(claudeKey, screenshots)
            .then(r => { analyses.visual = r; })
            .catch(e => { analyses.visual = `Unavailable: ${e}`; })
        );
      } else {
        analyses.visual = '⚠️ SCREENSHOTS UNAVAILABLE — Puppeteer/Chromium failed in this environment. Visual analysis, UX review, and chart-vs-data comparison are running without images. Consider adding a screenshot capture service or enabling Chromium on Vercel Pro.';
      }

      // C. Blending & data processing
      tasks.push(
        analyzeBlending(claudeKey, sql, weekAgo)
          .then(r => { analyses.blending = r; })
          .catch(e => { analyses.blending = `Unavailable: ${e}`; })
      );

      // D. Meteorological intelligence (storm detection, precip type, diurnal bias, microclimate)
      tasks.push(
        analyzeMeteorological(claudeKey, sql, weekAgo, comparisons)
          .then(r => { analyses.meteorological = r; })
          .catch(e => { analyses.meteorological = `Unavailable: ${e}`; })
      );

      // E. Confidence calibration + model skill scoring + persistence comparison
      tasks.push(
        analyzeCalibration(claudeKey, sql, weekAgo)
          .then(r => { analyses.calibration = r; })
          .catch(e => { analyses.calibration = `Unavailable: ${e}`; })
      );

      // F. Hourly accuracy + Brier skill score
      tasks.push(
        analyzeHourlyAccuracy(claudeKey, sql, weekAgo)
          .then(r => { analyses.hourlyAccuracy = r; })
          .catch(e => { analyses.hourlyAccuracy = `Unavailable: ${e}`; })
      );

      // G. Forecast stability / flip-flop detection
      tasks.push(
        analyzeForecastStability(claudeKey, sql, weekAgo)
          .then(r => { analyses.forecastStability = r; })
          .catch(e => { analyses.forecastStability = `Unavailable: ${e}`; })
      );

      // H. Precipitation timing accuracy
      tasks.push(
        analyzePrecipTiming(claudeKey, sql, weekAgo)
          .then(r => { analyses.precipTiming = r; })
          .catch(e => { analyses.precipTiming = `Unavailable: ${e}`; })
      );

      // I. Wind forecast accuracy
      tasks.push(
        analyzeWindAccuracy(claudeKey, sql, weekAgo)
          .then(r => { analyses.windAccuracy = r; })
          .catch(e => { analyses.windAccuracy = `Unavailable: ${e}`; })
      );

      // J. Condition / icon accuracy
      tasks.push(
        analyzeConditionAccuracy(claudeKey, sql, weekAgo)
          .then(r => { analyses.conditionAccuracy = r; })
          .catch(e => { analyses.conditionAccuracy = `Unavailable: ${e}`; })
      );

      // K. Dynamic model ranking
      tasks.push(
        analyzeModelRanking(claudeKey, sql, weekAgo)
          .then(r => { analyses.modelRanking = r; })
          .catch(e => { analyses.modelRanking = `Unavailable: ${e}`; })
      );

      // L. UX/Display intelligence
      if (screenshots.length > 0) {
        tasks.push(
          analyzeUX(claudeKey, screenshots)
            .then(r => { analyses.ux = r; })
            .catch(e => { analyses.ux = `Unavailable: ${e}`; })
        );
      } else {
        analyses.ux = '⚠️ Skipped — requires screenshots. Will run once Puppeteer/Chromium is available.';
      }

      // G. Data-vs-Display consistency (does the chart show what the API says?)
      tasks.push(
        analyzeDataVsDisplay(claudeKey, sql, screenshots)
          .then(r => { analyses.dataVsDisplay = r; })
          .catch(e => { analyses.dataVsDisplay = `Unavailable: ${e}`; })
      );

      // Run in batches of 4 to avoid Anthropic API rate limits (13 total calls)
      const batchSize = 4;
      for (let b = 0; b < tasks.length; b += batchSize) {
        await Promise.all(tasks.slice(b, b + batchSize));
      }
    } else {
      Object.keys(analyses).forEach(k => { analyses[k] = 'Claude API key not configured.'; });
    }

    const combinedAnalysis = Object.entries(analyses)
      .map(([key, val]) => `## ${key}\n${val}`)
      .join('\n\n');

    // 5. Get recent AI changelog entries
    const recentChanges = await sql`
      SELECT * FROM ai_changelog
      WHERE created_at > ${new Date(now.getTime() - 24 * 3600000).toISOString()}
      ORDER BY created_at DESC
    `;

    // 6. Build and send email
    const emailHtml = buildEmailHtml(accuracy, comparisons, analyses, screenshots, recentChanges);
    const subject = `Nimbus Nightly Report — ${now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })}`;
    const sent = await sendNightlyReport(subject, emailHtml);

    // 6b. Log each analysis module to changelog
    const logEntries: { category: string; summary: string; key: string }[] = [
      { category: 'accuracy', summary: 'Blending & data processing review', key: 'blending' },
      { category: 'visual', summary: `Visual audit: ${screenshots.length} screenshots analyzed`, key: 'visual' },
      { category: 'accuracy', summary: 'Meteorological intelligence: storms, precip type, diurnal bias', key: 'meteorological' },
      { category: 'accuracy', summary: 'Confidence calibration & model skill scoring', key: 'calibration' },
      { category: 'accuracy', summary: 'Hourly forecast accuracy + Brier skill score', key: 'hourlyAccuracy' },
      { category: 'accuracy', summary: 'Forecast stability: flip-flop detection', key: 'forecastStability' },
      { category: 'accuracy', summary: 'Precipitation timing accuracy (hourly)', key: 'precipTiming' },
      { category: 'accuracy', summary: 'Wind forecast accuracy', key: 'windAccuracy' },
      { category: 'accuracy', summary: 'Condition/icon accuracy', key: 'conditionAccuracy' },
      { category: 'accuracy', summary: 'Dynamic model ranking (HRRR vs NBM vs GFS)', key: 'modelRanking' },
      { category: 'visual', summary: 'UX/Display: hierarchy, accessibility, layout', key: 'ux' },
      { category: 'bug_fix', summary: 'Data vs Display: API data vs chart rendering consistency', key: 'dataVsDisplay' },
    ];

    for (const entry of logEntries) {
      const text = analyses[entry.key];
      if (text && text.length > 50 && !text.includes('Unavailable') && !text.includes('not configured') && !text.includes('No ')) {
        await sql`
          INSERT INTO ai_changelog (category, summary, details, status)
          VALUES (${entry.category}, ${entry.summary}, ${text.slice(0, 5000)}, 'applied')
        `;
      }
    }

    // 8. Auto-fix pipeline: generate and apply code changes based on findings
    let fixResults: string[] = [];
    let appliedFixes: CodeFix[] = [];
    if (claudeKey) {
      try {
        const allFindings = Object.entries(analyses)
          .filter(([, v]) => v.length > 50 && !v.includes('Unavailable') && !v.includes('not configured'))
          .map(([k, v]) => `### ${k}\n${v}`)
          .join('\n\n');

        if (allFindings.length > 200) {
          appliedFixes = await generateFixes(claudeKey, allFindings,
            'The app uses Open-Meteo blended HRRR/NBM/GFS with consensus-weighted precipitation blending (preserves storm signals when models disagree). HRRR data is validated to reject zero-value failures. Web app is Next.js/TypeScript. iOS app is SwiftUI. Temperature uses weighted average, precipitation uses consensus-scaled approach with 30% floor to prevent storm signal loss.');

          if (appliedFixes.length > 0) {
            // Apply web app changes via GitHub API
            const webResults = await applyWebAppFixes(appliedFixes);
            fixResults.push(...webResults);

            // Store iOS changes for local application
            const iosResults = await storeIosAppFixes(appliedFixes);
            fixResults.push(...iosResults);
          }
        }
      } catch (err) {
        fixResults.push(`Auto-fix error: ${err}`);
      }
    }

    // 9. Log the report
    await sql`
      INSERT INTO ai_changelog (category, summary, details, status)
      VALUES ('report', ${`Nightly report — ${accuracy.length} locations, ${screenshots.length} screenshots, ${appliedFixes.length} fixes`},
              ${combinedAnalysis.slice(0, 5000)}, 'applied')
    `;

    return NextResponse.json({
      success: true,
      emailSent: sent,
      locationsAnalyzed: accuracy.length,
      comparisonsFound: comparisons.length,
      screenshotsCaptured: screenshots.length,
      analysisModules: Object.keys(analyses).filter(k => analyses[k].length > 50).length,
      fixesGenerated: appliedFixes.length,
      fixResults,
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

// MARK: - Data vs Display Consistency Analysis

async function analyzeDataVsDisplay(
  apiKey: string, sql: NeonSql, screenshots: ScreenshotResult[]
): Promise<string> {
  // Get the most recent raw forecast data to compare against what charts show
  const recentData = await sql`
    SELECT fs.location_id, l.name as location_name,
           fs.target_date, fs.predicted_precip_prob, fs.predicted_precip_accum,
           fs.predicted_precip_type, fs.predicted_condition,
           fs.predicted_high, fs.predicted_low,
           fs.raw_json
    FROM forecast_snapshots fs
    JOIN locations l ON l.id = fs.location_id
    WHERE fs.captured_at > ${new Date(Date.now() - 24 * 3600000).toISOString()}
    ORDER BY fs.captured_at DESC
    LIMIT 30
  `;

  if (!recentData.length) {
    return 'No recent forecast data to compare against display. Need at least one audit cycle.';
  }

  // Build a detailed data summary showing what the API says per-day
  const dataSummary: string[] = [];
  const locationDays: Record<string, string[]> = {};

  for (const row of recentData) {
    const locName = row.location_name as string;
    if (!locationDays[locName]) locationDays[locName] = [];

    const raw = row.raw_json as Record<string, unknown>;
    const hourlySlice = raw?.hourlySlice as Array<{ precipProbability: number; precipIntensity: number; precipType: string; time: string }> | undefined;

    // Find hours with precipitation in the hourly data
    let precipHours = 0;
    let maxHourlyPrecipProb = 0;
    if (hourlySlice) {
      for (const h of hourlySlice) {
        if (h.precipProbability > 0.1) precipHours++;
        if (h.precipProbability > maxHourlyPrecipProb) maxHourlyPrecipProb = h.precipProbability;
      }
    }

    locationDays[locName].push(
      `  ${row.target_date}: dailyPrecipProb=${((row.predicted_precip_prob as number) * 100).toFixed(0)}% ` +
      `accum=${(row.predicted_precip_accum as number)?.toFixed(2)}" type=${row.predicted_precip_type} ` +
      `condition=${row.predicted_condition} ` +
      `hourlyPrecipHours=${precipHours}/24 maxHourlyProb=${(maxHourlyPrecipProb * 100).toFixed(0)}%`
    );
  }

  for (const [loc, days] of Object.entries(locationDays)) {
    dataSummary.push(`### ${loc}\n${days.join('\n')}`);
  }

  // Build the prompt - include screenshots if available
  const content: Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }> = [];

  // Add screenshots for visual comparison
  for (const shot of screenshots.slice(0, 3)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: shot.imageBase64 },
    });
    content.push({ type: 'text', text: `[${shot.chartType} — ${shot.locationName}]` });
  }

  content.push({
    type: 'text',
    text: `You are debugging a weather app's chart rendering. Your job is to find cases where the API data says one thing but the chart displays something different.

## Raw API Data (What the weather API returned)
${dataSummary.join('\n\n')}

## Chart Code Logic
The app has several precipitation display thresholds that could cause data to be hidden:
- DailyWeatherChart: precipChartFraction=0.22, Gaussian smooth sigma=1.5, segments built from hourly data with threshold 0.05
- HourlyForecastCard: precipFraction=0.28, Gaussian smooth sigma=2.0, threshold 0.05
- PrecipitationGraphView: shows daily precipProbability directly (0-100%), Catmull-Rom interpolation
- Widget sparkline: precipSegments threshold=0.10 (HIGHER than app's 0.05)
- Widget medium/large: precipSegment threshold=0.08

## CRITICAL: Find These Specific Issues

1. **Missing Precipitation** — If the API says precipProbability=45% for a day but the chart shows NO blue area for that day, the rendering threshold or smoothing is hiding it. Identify which threshold is the culprit and what it should be changed to.

2. **Hourly vs Daily Mismatch** — If hourly data shows precipitation during hours 2-6 AM but the daily chart shows precipitation at noon, the chart is mapping data to the wrong time position.

3. **Gaussian Smoothing Artifacts** — The smoothing (sigma=1.5-2.0) can flatten small precipitation events to below the display threshold. If a 2-hour rain event with 60% probability gets smoothed to 15% and the threshold is 10%, it barely shows. Is the sigma too aggressive?

4. **Widget vs App Discrepancy** — The widget uses threshold 0.10 while the app uses 0.05. This means precipitation showing in the app could be invisible in the widget. Identify specific cases.

5. **Precipitation Type Color Issues** — If the type is "snow" but the chart shows blue (rain color), the type mapping is wrong.

6. **Zero-Padding Artifacts** — The segmented precipitation uses zero-padding at boundaries for smooth curves. This can make the start/end of rain periods look like they taper when the API says it starts/stops abruptly.

For each issue found, specify:
- The exact location/date where it occurs
- What the API data says
- What the chart likely shows
- The specific code parameter causing it (file, variable, threshold value)
- The recommended fix with new values

This is the MOST IMPORTANT analysis — users trust what they see on screen. If the graphs lie about when it will rain, that's a critical bug.`,
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

  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'No data-vs-display analysis generated';
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

// MARK: - Meteorological Intelligence Analysis

async function analyzeMeteorological(
  apiKey: string, sql: NeonSql, weekAgo: string, comparisons: SnapshotRow[]
): Promise<string> {
  // Get hourly-level data from raw_json for diurnal analysis
  const recentSnapshots = await sql`
    SELECT location_id, target_date, raw_json,
           predicted_high, predicted_low, predicted_precip_type,
           predicted_precip_accum, predicted_condition
    FROM forecast_snapshots
    WHERE captured_at > ${weekAgo}
    ORDER BY captured_at DESC LIMIT 20
  `;

  // Get actual data for precip type comparison
  const actuals = await sql`
    SELECT location_id, date, actual_high, actual_low, actual_precip,
           actual_condition, actual_precip_type
    FROM actual_weather
    WHERE date > ${weekAgo}
    ORDER BY date DESC LIMIT 20
  `;

  const prompt = `You are a meteorologist and atmospheric scientist reviewing a weather app's forecast performance.

## Context
The Nimbus weather app blends HRRR, NBM, and GFS models from Open-Meteo. It serves 3-5 US cities.

## Recent Forecast vs Actual Data
${comparisons.slice(0, 15).map(c =>
  `${c.location_name} ${c.target_date}: Pred H${Math.round(c.predicted_high)}/L${Math.round(c.predicted_low)} precip ${c.predicted_precip_accum?.toFixed(2)}" | Actual H${Math.round(c.actual_high)}/L${Math.round(c.actual_low)} precip ${c.actual_precip?.toFixed(2)}"`
).join('\n')}

## Predicted Conditions & Precip Types
${recentSnapshots.slice(0, 10).map(s =>
  `${s.target_date}: condition=${s.predicted_condition} precipType=${s.predicted_precip_type} accum=${(s.predicted_precip_accum as number)?.toFixed(2)}"`
).join('\n')}

## Actual Conditions
${actuals.slice(0, 10).map(a =>
  `${a.date}: condition=${a.actual_condition} precip=${(a.actual_precip as number)?.toFixed(2)}" type=${a.actual_precip_type || 'n/a'}`
).join('\n')}

## Analyze These Meteorological Factors:

1. **Diurnal Bias** — Is the app consistently missing morning lows or afternoon highs? Temperature models often have systematic time-of-day biases. Look at high/low errors — if lows are always over-predicted, the nighttime cooling model may be off.

2. **Storm Detection Accuracy** — Based on the precip data, did storms get predicted with correct timing and intensity? Were there surprise events or false alarms?

3. **Precipitation Type Accuracy** — The app uses a 34°F threshold to reclassify rain→snow. Based on the temperature and precip data, is this threshold correct? Should it vary by location (e.g., higher elevation = different transition temp)?

4. **Microclimate Awareness** — Are coastal cities (if any) behaving differently from inland ones? Should blend weights be location-dependent? For example, HRRR performs better for convective events common in the Southeast but may underperform for marine layer fog on the West Coast.

5. **Seasonal Patterns** — Are there emerging seasonal biases (e.g., spring temperature swings being under-predicted)?

6. **Persistence Comparison** — Would simply saying "tomorrow equals today" have been more accurate than our blended forecast for any location? This is the baseline every forecast must beat.

Be specific. Recommend concrete threshold changes, weight adjustments, or algorithmic improvements with actual numbers.`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Confidence Calibration & Model Skill Analysis

async function analyzeCalibration(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Get precip probability predictions vs outcomes
  const precipCalibration = await sql`
    SELECT
      l.name as location_name,
      fs.predicted_precip_prob,
      aw.actual_precip,
      fs.target_date
    FROM forecast_snapshots fs
    JOIN actual_weather aw ON aw.location_id = fs.location_id AND aw.date = fs.target_date
    JOIN locations l ON l.id = fs.location_id
    WHERE fs.captured_at > ${weekAgo}
      AND fs.hours_ahead BETWEEN 12 AND 36
    ORDER BY fs.target_date DESC
    LIMIT 60
  `;

  if (!precipCalibration.length) {
    return 'Not enough data for calibration analysis. Need several days of predicted vs actual comparisons.';
  }

  // Build calibration buckets
  const buckets: Record<string, { predicted: number; rainy: number; total: number }> = {};
  for (const row of precipCalibration) {
    const prob = row.predicted_precip_prob as number;
    const bucket = `${Math.round(prob * 10) * 10}%`; // 0%, 10%, 20%, ...
    if (!buckets[bucket]) buckets[bucket] = { predicted: prob, rainy: 0, total: 0 };
    buckets[bucket].total++;
    if ((row.actual_precip as number) > 0.01) buckets[bucket].rainy++;
  }

  const calibrationTable = Object.entries(buckets)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([bucket, data]) => `${bucket}: predicted=${bucket}, actual rain frequency=${data.total > 0 ? Math.round(data.rainy / data.total * 100) : 0}% (${data.rainy}/${data.total} days)`)
    .join('\n');

  // Get per-model accuracy if available
  const modelSnapshots = await sql`
    SELECT raw_json, target_date, location_id,
           predicted_high, predicted_low
    FROM forecast_snapshots
    WHERE captured_at > ${weekAgo}
      AND raw_json::text LIKE '%perModel%'
    ORDER BY captured_at DESC LIMIT 20
  `;

  let modelSkillSection = '';
  if (modelSnapshots.length > 0) {
    const modelErrors: Record<string, { tempErrors: number[]; precipErrors: number[] }> = {
      HRRR: { tempErrors: [], precipErrors: [] },
      NBM: { tempErrors: [], precipErrors: [] },
      GFS: { tempErrors: [], precipErrors: [] },
    };

    for (const snap of modelSnapshots) {
      const raw = snap.raw_json as Record<string, unknown>;
      const perModel = raw?.perModel as Record<string, { high: number; low: number; precipAccum: number }> | undefined;
      if (!perModel) continue;

      // Compare each model to the blended prediction
      const blendedHigh = snap.predicted_high as number;
      for (const [key, modelData] of Object.entries(perModel)) {
        if (!modelData) continue;
        const modelName = key.toUpperCase();
        if (modelErrors[modelName]) {
          modelErrors[modelName].tempErrors.push(Math.abs(modelData.high - blendedHigh));
        }
      }
    }

    modelSkillSection = Object.entries(modelErrors)
      .map(([model, errs]) => {
        const avgTemp = errs.tempErrors.length > 0
          ? (errs.tempErrors.reduce((a, b) => a + b, 0) / errs.tempErrors.length).toFixed(1)
          : 'N/A';
        return `${model}: avg deviation from blend = ±${avgTemp}°F (${errs.tempErrors.length} samples)`;
      })
      .join('\n');
  }

  const prompt = `You are a data scientist specializing in weather forecast verification and probabilistic calibration.

## Precipitation Probability Calibration
When we predict a certain % chance of rain, how often does it actually rain?
${calibrationTable}

## Model Skill (Deviation from Blended Output)
${modelSkillSection || 'Per-model data not yet available.'}

## Analyze:

1. **Probability Calibration Curve** — Is our precipitation probability well-calibrated? When we say 50% chance, does it rain ~50% of the time? If not, what correction curve should we apply? (e.g., "multiply raw probability by 0.8" or "use a logistic recalibration")

2. **Model Skill Scoring** — Which model (HRRR/NBM/GFS) is closest to reality? Should we auto-adjust blend weights based on recent per-model accuracy? Propose a simple adaptive weighting algorithm.

3. **Ensemble Spread as Uncertainty** — When HRRR says 0% and GFS says 80%, the blend says ~30%. Should the app instead show this as "uncertain — models disagree" rather than a false-precision 30%? How should model disagreement be communicated to users?

4. **Persistence Baseline** — In many locations, saying "tomorrow = today" beats NWP models for temperature within 24h. Is our blended forecast actually adding value over persistence? How can we measure and report this?

5. **Wet/Dry Bias** — Is the app over-predicting or under-predicting the number of rainy days? Does it predict too many small rain amounts or miss large events?

6. **Skill by Forecast Horizon** — Is our 1-day forecast much better than our 5-day forecast (as expected)? Or is there a specific horizon where accuracy drops sharply, suggesting a model handoff problem?

Recommend specific algorithmic changes with numbers. These will be implemented in the app's blending code.`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Hourly Accuracy & Brier Skill Score Analysis

async function analyzeHourlyAccuracy(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Compare hourly forecast snapshots against hourly actuals
  const hourlyComparison = await sql`
    SELECT
      l.name as location_name,
      hfs.target_hour,
      hfs.hours_ahead,
      hfs.predicted_temp,
      hfs.predicted_precip_prob,
      hfs.predicted_precip_accum,
      hfs.predicted_precip_type,
      ha.actual_temp,
      ha.actual_precip,
      ha.actual_snowfall,
      ha.weather_code
    FROM hourly_forecast_snapshots hfs
    JOIN hourly_actuals ha ON ha.location_id = hfs.location_id AND ha.hour = hfs.target_hour
    JOIN locations l ON l.id = hfs.location_id
    WHERE hfs.captured_at > ${weekAgo}
      AND hfs.hours_ahead BETWEEN 3 AND 36
    ORDER BY hfs.target_hour DESC
    LIMIT 200
  `;

  if (!hourlyComparison.length) {
    return 'Not enough hourly data yet for accuracy analysis. Need at least 2 days of hourly forecast snapshots + actuals. Data will be available soon as audits continue.';
  }

  // Calculate Brier skill score for precipitation probability
  // Brier score = mean((predicted_prob - actual_outcome)^2)
  // Perfect score = 0, climatology baseline ~0.25, worse than climatology > 0.25
  let brierSum = 0;
  let brierCount = 0;
  let tempErrorSum = 0;
  let tempErrorCount = 0;
  const hourBuckets: Record<string, { tempErrors: number[]; precipHits: number; precipMisses: number; falseAlarms: number; correctNulls: number }> = {};

  for (const row of hourlyComparison) {
    const predProb = row.predicted_precip_prob as number;
    const actualPrecip = row.actual_precip as number;
    const actualOutcome = actualPrecip > 0.005 ? 1 : 0; // Did it actually rain?
    const predTemp = row.predicted_temp as number;
    const actualTemp = row.actual_temp as number;
    const hrsAhead = row.hours_ahead as number;

    // Brier score
    brierSum += (predProb - actualOutcome) ** 2;
    brierCount++;

    // Temp error
    if (predTemp != null && actualTemp != null) {
      tempErrorSum += Math.abs(predTemp - actualTemp);
      tempErrorCount++;
    }

    // Bucket by forecast horizon
    const bucket = hrsAhead <= 6 ? '0-6h' : hrsAhead <= 12 ? '6-12h' : hrsAhead <= 24 ? '12-24h' : '24-36h';
    if (!hourBuckets[bucket]) hourBuckets[bucket] = { tempErrors: [], precipHits: 0, precipMisses: 0, falseAlarms: 0, correctNulls: 0 };
    hourBuckets[bucket].tempErrors.push(Math.abs(predTemp - actualTemp));

    // Contingency table for precip
    if (predProb > 0.3 && actualOutcome === 1) hourBuckets[bucket].precipHits++;
    else if (predProb <= 0.3 && actualOutcome === 1) hourBuckets[bucket].precipMisses++;
    else if (predProb > 0.3 && actualOutcome === 0) hourBuckets[bucket].falseAlarms++;
    else hourBuckets[bucket].correctNulls++;
  }

  const brierScore = brierCount > 0 ? brierSum / brierCount : null;
  const avgTempError = tempErrorCount > 0 ? tempErrorSum / tempErrorCount : null;

  // Build summary for Claude
  const bucketSummary = Object.entries(hourBuckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, data]) => {
      const avgTE = data.tempErrors.length > 0
        ? (data.tempErrors.reduce((s, v) => s + v, 0) / data.tempErrors.length).toFixed(1)
        : 'N/A';
      const total = data.precipHits + data.precipMisses + data.falseAlarms + data.correctNulls;
      const hitRate = total > 0 ? ((data.precipHits / Math.max(1, data.precipHits + data.precipMisses)) * 100).toFixed(0) : 'N/A';
      const falseAlarmRate = total > 0 ? ((data.falseAlarms / Math.max(1, data.falseAlarms + data.correctNulls)) * 100).toFixed(0) : 'N/A';
      return `  ${bucket}: avgTempError=${avgTE}°F, precipHitRate=${hitRate}%, falseAlarmRate=${falseAlarmRate}% (${total} hours)`;
    })
    .join('\n');

  // Sample of specific misses for Claude to analyze
  const significantMisses = hourlyComparison
    .filter(r => {
      const predProb = r.predicted_precip_prob as number;
      const actual = r.actual_precip as number;
      return (predProb > 0.5 && actual < 0.005) || (predProb < 0.15 && actual > 0.05);
    })
    .slice(0, 10)
    .map(r => `  ${r.location_name} ${new Date(r.target_hour as string).toLocaleString()}: predicted ${Math.round((r.predicted_precip_prob as number) * 100)}% prob / ${(r.predicted_precip_accum as number)?.toFixed(2)}" | actual ${(r.actual_precip as number)?.toFixed(2)}" (${r.hours_ahead}h ahead)`)
    .join('\n');

  const prompt = `You are a meteorologist and data scientist analyzing HOURLY forecast accuracy for the Nimbus weather app.

## Overall Metrics
- Brier Skill Score: ${brierScore != null ? brierScore.toFixed(4) : 'insufficient data'} (0=perfect, 0.25=climatology baseline, >0.25=worse than guessing)
- Average Temperature Error: ${avgTempError != null ? avgTempError.toFixed(1) + '°F' : 'insufficient data'}
- Total hourly comparisons: ${brierCount}

## Accuracy by Forecast Horizon
${bucketSummary}

## Significant Prediction Failures (missed events or false alarms)
${significantMisses || '  No significant failures found (good sign)'}

## Your Analysis
Evaluate as a meteorologist:

1. **Brier Score Interpretation** — Is ${brierScore?.toFixed(4)} good for a blended NWP model? Compare against typical values for operational forecasts (NWS: ~0.08-0.12 for 24h precipitation). If worse, what does it suggest about the blending?

2. **Skill Degradation by Lead Time** — How fast does skill drop from 0-6h to 24-36h? Is the degradation expected for the model types (HRRR=convective, NBM=calibrated, GFS=synoptic)?

3. **False Alarm vs Miss Balance** — Is the app over-predicting precip (many false alarms but few misses) or under-predicting (few false alarms but many misses)? For a weather app, which is worse? Recommend threshold adjustments.

4. **Temperature Error Patterns** — ${avgTempError?.toFixed(1)}°F average hourly error — is this acceptable? Does it worsen at specific horizons?

5. **Specific Failure Analysis** — For each missed event above, hypothesize what went wrong (model timing error? blending diluted signal? type misclassification?) and suggest a fix.

6. **Concrete Recommendations** — Suggest specific code changes:
   - Should the precipitation probability threshold for display change?
   - Should the Gaussian smoothing sigma change?
   - Should the blending weights be adjusted based on hourly performance?
   - Should the consensus-weighted precip blending be tuned (currently using 30% floor)?

Be specific with numbers and file/variable references.`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Forecast Stability / Flip-Flop Detection

async function analyzeForecastStability(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Compare consecutive audit snapshots for the same target date to measure forecast volatility
  const snapshots = await sql`
    SELECT
      l.name as location_name,
      fs.target_date,
      fs.captured_at,
      fs.predicted_high,
      fs.predicted_low,
      fs.predicted_precip_prob,
      fs.predicted_precip_accum
    FROM forecast_snapshots fs
    JOIN locations l ON l.id = fs.location_id
    WHERE fs.captured_at > ${weekAgo}
      AND fs.hours_ahead BETWEEN 12 AND 48
    ORDER BY l.name, fs.target_date, fs.captured_at
    LIMIT 300
  `;

  if (snapshots.length < 10) {
    return 'Not enough consecutive snapshots yet. Need multiple audit cycles for the same target dates.';
  }

  // Group by location + target_date, measure volatility across captures
  const groups: Record<string, { highs: number[]; lows: number[]; precipProbs: number[]; precipAccums: number[] }> = {};
  for (const s of snapshots) {
    const key = `${s.location_name}|${s.target_date}`;
    if (!groups[key]) groups[key] = { highs: [], lows: [], precipProbs: [], precipAccums: [] };
    groups[key].highs.push(s.predicted_high as number);
    groups[key].lows.push(s.predicted_low as number);
    groups[key].precipProbs.push(s.predicted_precip_prob as number);
    groups[key].precipAccums.push(s.predicted_precip_accum as number);
  }

  const volatility: string[] = [];
  let highFlipFlops = 0;
  let totalGroups = 0;

  for (const [key, g] of Object.entries(groups)) {
    if (g.highs.length < 2) continue;
    totalGroups++;
    const highRange = Math.max(...g.highs) - Math.min(...g.highs);
    const precipProbRange = Math.max(...g.precipProbs) - Math.min(...g.precipProbs);

    // Flag flip-flops: high temp swings >5°F or precip prob swings >30%
    if (highRange > 5 || precipProbRange > 0.3) {
      highFlipFlops++;
      volatility.push(
        `  ${key}: high swung ${highRange.toFixed(1)}°F (${Math.min(...g.highs).toFixed(0)}-${Math.max(...g.highs).toFixed(0)}), ` +
        `precip prob swung ${(precipProbRange * 100).toFixed(0)}% across ${g.highs.length} audits`
      );
    }
  }

  const flipFlopRate = totalGroups > 0 ? (highFlipFlops / totalGroups * 100).toFixed(0) : '0';

  const prompt = `You are a meteorologist evaluating forecast STABILITY for the Nimbus weather app.

## Forecast Volatility Summary
- Total location-date pairs analyzed: ${totalGroups}
- Pairs with significant flip-flops: ${highFlipFlops} (${flipFlopRate}%)
- Criteria: high temp swing >5°F OR precip probability swing >30% between audit cycles

## Specific Flip-Flop Cases
${volatility.slice(0, 15).join('\n') || '  No significant flip-flops detected.'}

## Analysis Required
1. **Is ${flipFlopRate}% flip-flop rate acceptable?** NWS operational forecasts typically show <10% volatility for 24h predictions. How does this compare?
2. **Temperature vs Precipitation stability** — Which is more volatile? Precip volatility is more damaging to user trust.
3. **Root cause** — Are flip-flops caused by model switching (HRRR drops out at 48h), blending instability, or genuine meteorological uncertainty?
4. **Recommendations** — Should we add temporal smoothing (weight recent audits more)? Should we use a rolling average across audit cycles for stability? Suggest specific damping strategies with parameters.
5. **User impact** — If a user checks at 8am and sees 60% rain, then checks at 2pm and sees 15% rain, that's a trust-destroying experience. Recommend a maximum acceptable change rate per audit cycle.`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Precipitation Timing Accuracy

async function analyzePrecipTiming(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Compare hourly precipitation predictions vs actuals to check timing
  const hourlyComps = await sql`
    SELECT
      l.name as location_name,
      hfs.target_hour,
      hfs.hours_ahead,
      hfs.predicted_precip_prob,
      hfs.predicted_precip_accum,
      ha.actual_precip,
      ha.actual_snowfall
    FROM hourly_forecast_snapshots hfs
    JOIN hourly_actuals ha ON ha.location_id = hfs.location_id AND ha.hour = hfs.target_hour
    JOIN locations l ON l.id = hfs.location_id
    WHERE hfs.captured_at > ${weekAgo}
      AND hfs.hours_ahead BETWEEN 3 AND 36
    ORDER BY l.name, hfs.target_hour
    LIMIT 300
  `;

  if (hourlyComps.length < 20) {
    return 'Not enough hourly data yet for timing analysis. Need at least 2 days of hourly snapshots + actuals.';
  }

  // Group by location and date, find predicted vs actual rain windows
  const byLocDate: Record<string, { hours: Array<{ hour: string; predProb: number; predAccum: number; actualPrecip: number }> }> = {};
  for (const row of hourlyComps) {
    const date = new Date(row.target_hour as string).toISOString().slice(0, 10);
    const key = `${row.location_name}|${date}`;
    if (!byLocDate[key]) byLocDate[key] = { hours: [] };
    byLocDate[key].hours.push({
      hour: new Date(row.target_hour as string).toLocaleTimeString('en-US', { hour: 'numeric' }),
      predProb: row.predicted_precip_prob as number,
      predAccum: row.predicted_precip_accum as number,
      actualPrecip: row.actual_precip as number,
    });
  }

  // Find timing mismatches
  const timingIssues: string[] = [];
  for (const [key, data] of Object.entries(byLocDate)) {
    const predictedRainHours = data.hours.filter(h => h.predProb > 0.3).map(h => h.hour);
    const actualRainHours = data.hours.filter(h => h.actualPrecip > 0.005).map(h => h.hour);

    if (predictedRainHours.length === 0 && actualRainHours.length === 0) continue;
    if (predictedRainHours.length === 0 && actualRainHours.length > 0) {
      timingIssues.push(`  ${key}: MISSED — no rain predicted but rained at ${actualRainHours.join(', ')}`);
    } else if (predictedRainHours.length > 0 && actualRainHours.length === 0) {
      timingIssues.push(`  ${key}: FALSE ALARM — predicted rain at ${predictedRainHours.join(', ')} but none fell`);
    } else if (predictedRainHours.length > 0 && actualRainHours.length > 0) {
      // Check if timing overlaps
      const overlap = predictedRainHours.filter(h => actualRainHours.includes(h));
      if (overlap.length === 0) {
        timingIssues.push(`  ${key}: TIMING ERROR — predicted rain at ${predictedRainHours.join(', ')} but actually rained at ${actualRainHours.join(', ')}`);
      }
    }
  }

  const prompt = `You are a meteorologist analyzing PRECIPITATION TIMING accuracy for the Nimbus weather app.

## Timing Analysis
- Total location-date pairs with precipitation data: ${Object.keys(byLocDate).length}
- Timing issues found: ${timingIssues.length}

## Specific Timing Problems
${timingIssues.slice(0, 15).join('\n') || '  No significant timing issues found.'}

## Analysis Required
1. **Timing error patterns** — Are storms consistently arriving early or late? A systematic bias (e.g., always 3h early) can be corrected.
2. **False alarms vs misses** — Count each type. For a weather app, a false alarm ("carry an umbrella" when it doesn't rain) is less harmful than a miss (user gets soaked).
3. **Model attribution** — HRRR excels at convective timing (0-12h) while GFS often has 6-12h timing errors. Is the blending strategy preserving HRRR's timing advantage?
4. **Recommendations** — Should we add a timing bias correction? For example, if precipitation consistently arrives 2h earlier than predicted, we could shift the hourly precipitation curve.
5. **Impact on graphs** — If the hourly precipitation chart shows rain starting at 3pm but it actually starts at noon, the user sees a "wrong" graph. How should we address this?`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Wind Forecast Accuracy

async function analyzeWindAccuracy(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Compare predicted wind vs actual wind speed
  const windComps = await sql`
    SELECT
      l.name as location_name,
      hfs.target_hour,
      hfs.hours_ahead,
      hfs.predicted_wind_speed,
      ha.actual_wind_speed
    FROM hourly_forecast_snapshots hfs
    JOIN hourly_actuals ha ON ha.location_id = hfs.location_id AND ha.hour = hfs.target_hour
    JOIN locations l ON l.id = hfs.location_id
    WHERE hfs.captured_at > ${weekAgo}
      AND hfs.hours_ahead BETWEEN 3 AND 36
      AND hfs.predicted_wind_speed IS NOT NULL
      AND ha.actual_wind_speed IS NOT NULL
    ORDER BY l.name, hfs.target_hour
    LIMIT 200
  `;

  if (windComps.length < 10) {
    return 'Not enough wind data yet for accuracy analysis. Need at least 2 days of hourly data.';
  }

  // Calculate wind error stats
  let totalError = 0;
  let overPredictions = 0;
  let underPredictions = 0;
  const byLocation: Record<string, { errors: number[]; biases: number[] }> = {};

  for (const row of windComps) {
    const pred = row.predicted_wind_speed as number;
    const actual = row.actual_wind_speed as number;
    const error = Math.abs(pred - actual);
    const bias = pred - actual; // positive = over-prediction
    totalError += error;
    if (bias > 2) overPredictions++;
    if (bias < -2) underPredictions++;

    const loc = row.location_name as string;
    if (!byLocation[loc]) byLocation[loc] = { errors: [], biases: [] };
    byLocation[loc].errors.push(error);
    byLocation[loc].biases.push(bias);
  }

  const avgError = totalError / windComps.length;
  const locationSummary = Object.entries(byLocation).map(([loc, d]) => {
    const avgE = d.errors.reduce((s, v) => s + v, 0) / d.errors.length;
    const avgB = d.biases.reduce((s, v) => s + v, 0) / d.biases.length;
    return `  ${loc}: MAE=${avgE.toFixed(1)} mph, bias=${avgB > 0 ? '+' : ''}${avgB.toFixed(1)} mph (${d.errors.length} hours)`;
  }).join('\n');

  const prompt = `You are a meteorologist analyzing WIND FORECAST accuracy for the Nimbus weather app.

## Wind Accuracy Summary
- Total hourly comparisons: ${windComps.length}
- Mean Absolute Error: ${avgError.toFixed(1)} mph
- Over-predictions (>2 mph high): ${overPredictions} (${(overPredictions / windComps.length * 100).toFixed(0)}%)
- Under-predictions (>2 mph low): ${underPredictions} (${(underPredictions / windComps.length * 100).toFixed(0)}%)

## By Location
${locationSummary}

## Analysis Required
1. **Is ${avgError.toFixed(1)} mph MAE acceptable?** Typical NWP wind MAE is 3-5 mph for surface winds. How does this compare?
2. **Bias direction** — Is the app systematically over-predicting or under-predicting wind? An over-prediction bias makes the app feel "alarmist."
3. **Location patterns** — Do coastal locations have worse wind accuracy (sea breeze effects)? Do inland locations have better accuracy?
4. **Gust prediction** — We display windGust in the UI. Are gusts more or less accurate than sustained wind?
5. **Recommendations** — Should we apply a wind bias correction? Should coastal locations use different model weights for wind (NBM often handles sea breeze better than GFS)?`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Condition / Icon Accuracy

async function analyzeConditionAccuracy(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Compare predicted condition against actual weather code
  const condComps = await sql`
    SELECT
      l.name as location_name,
      hfs.target_hour,
      hfs.predicted_condition,
      hfs.predicted_precip_type,
      ha.weather_code,
      ha.actual_precip,
      ha.actual_snowfall
    FROM hourly_forecast_snapshots hfs
    JOIN hourly_actuals ha ON ha.location_id = hfs.location_id AND ha.hour = hfs.target_hour
    JOIN locations l ON l.id = hfs.location_id
    WHERE hfs.captured_at > ${weekAgo}
      AND hfs.hours_ahead BETWEEN 3 AND 36
    ORDER BY l.name, hfs.target_hour
    LIMIT 200
  `;

  if (condComps.length < 10) {
    return 'Not enough data yet for condition accuracy analysis. Need at least 2 days of hourly data.';
  }

  // WMO code to broad category mapping
  function wmoCategory(code: number): string {
    if (code <= 1) return 'clear';
    if (code === 2) return 'partly-cloudy';
    if (code === 3) return 'cloudy';
    if (code >= 45 && code <= 48) return 'fog';
    if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return 'rain';
    if (code >= 56 && code <= 67) return 'sleet';
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
    if (code >= 95) return 'thunderstorm';
    return 'unknown';
  }

  function conditionCategory(cond: string): string {
    if (cond.includes('clear')) return 'clear';
    if (cond.includes('partly')) return 'partly-cloudy';
    if (cond === 'cloudy') return 'cloudy';
    if (cond === 'fog') return 'fog';
    if (cond === 'rain') return 'rain';
    if (cond === 'snow') return 'snow';
    if (cond === 'sleet') return 'sleet';
    if (cond === 'thunderstorm') return 'thunderstorm';
    return 'unknown';
  }

  let correct = 0;
  let precipCorrect = 0;
  let precipTotal = 0;
  const confusionPairs: Record<string, number> = {};

  for (const row of condComps) {
    const predicted = conditionCategory(row.predicted_condition as string);
    const actual = wmoCategory(row.weather_code as number);

    if (predicted === actual) {
      correct++;
    } else {
      const pair = `${predicted}→${actual}`;
      confusionPairs[pair] = (confusionPairs[pair] || 0) + 1;
    }

    // Specifically track precipitation icon accuracy
    const actualHasPrecip = (row.actual_precip as number) > 0.005;
    const predictedHasPrecip = ['rain', 'snow', 'sleet', 'thunderstorm'].includes(predicted);
    if (actualHasPrecip || predictedHasPrecip) {
      precipTotal++;
      if (predictedHasPrecip === actualHasPrecip) precipCorrect++;
    }
  }

  const overallAccuracy = (correct / condComps.length * 100).toFixed(0);
  const precipIconAccuracy = precipTotal > 0 ? (precipCorrect / precipTotal * 100).toFixed(0) : 'N/A';

  const topConfusions = Object.entries(confusionPairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pair, count]) => `  ${pair}: ${count} times`)
    .join('\n');

  const prompt = `You are evaluating WEATHER ICON ACCURACY for the Nimbus weather app.

## Condition Accuracy Summary
- Total hourly comparisons: ${condComps.length}
- Overall icon accuracy: ${overallAccuracy}%
- Precipitation icon accuracy: ${precipIconAccuracy}% (when either predicted or actual had precip)

## Most Common Misclassifications
${topConfusions || '  None found.'}

## Analysis Required
1. **Is ${overallAccuracy}% icon accuracy acceptable?** Consider that users glance at icons more than numbers. A wrong icon (showing sun when it's raining) destroys trust instantly.
2. **Precipitation icon errors** — At ${precipIconAccuracy}%, is the app correctly showing rain/snow icons when precipitation occurs? This is the most impactful icon accuracy metric.
3. **Common confusion pairs** — What do the misclassifications tell us? "partly-cloudy→rain" means we're missing rain onset. "rain→cloudy" means we're predicting rain that doesn't happen.
4. **WMO code mapping** — Are there WMO weather codes we're mapping incorrectly? Should the thresholds in wmoToCondition() be adjusted?
5. **Recommendations** — Suggest specific icon mapping or threshold changes to improve accuracy.`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - Dynamic Model Ranking

async function analyzeModelRanking(apiKey: string, sql: NeonSql, weekAgo: string): Promise<string> {
  // Compare per-model forecasts against actuals to rank HRRR/NBM/GFS
  const modelData = await sql`
    SELECT
      l.name as location_name,
      fs.target_date,
      fs.raw_json,
      aw.actual_high,
      aw.actual_low,
      aw.actual_precip,
      aw.actual_precip_type,
      fs.predicted_high as blended_high,
      fs.predicted_low as blended_low,
      fs.predicted_precip_accum as blended_precip
    FROM forecast_snapshots fs
    JOIN actual_weather aw ON aw.location_id = fs.location_id AND aw.date = fs.target_date
    JOIN locations l ON l.id = fs.location_id
    WHERE fs.captured_at > ${weekAgo}
      AND fs.hours_ahead BETWEEN 12 AND 36
      AND fs.raw_json::text LIKE '%perModel%'
    ORDER BY fs.target_date DESC
    LIMIT 50
  `;

  if (modelData.length < 5) {
    return 'Not enough per-model comparison data yet. Need several days of audits with per-model breakdowns.';
  }

  // Calculate error per model
  const modelErrors: Record<string, { tempErrors: number[]; precipErrors: number[]; count: number }> = {
    HRRR: { tempErrors: [], precipErrors: [], count: 0 },
    NBM: { tempErrors: [], precipErrors: [], count: 0 },
    GFS: { tempErrors: [], precipErrors: [], count: 0 },
    Blended: { tempErrors: [], precipErrors: [], count: 0 },
  };

  for (const row of modelData) {
    const raw = row.raw_json as Record<string, unknown>;
    const perModel = raw?.perModel as Record<string, { high: number; low: number; precipAccum: number }> | undefined;
    if (!perModel) continue;

    const actualHigh = row.actual_high as number;
    const actualLow = row.actual_low as number;
    const actualPrecip = row.actual_precip as number;

    // Blended
    modelErrors.Blended.tempErrors.push(Math.abs((row.blended_high as number) - actualHigh));
    modelErrors.Blended.precipErrors.push(Math.abs((row.blended_precip as number) - actualPrecip));
    modelErrors.Blended.count++;

    for (const [modelName, data] of Object.entries(perModel)) {
      if (!data || data.high === 0) continue; // Skip invalid data
      const key = modelName.toUpperCase();
      if (!modelErrors[key]) continue;
      modelErrors[key].tempErrors.push(Math.abs(data.high - actualHigh));
      modelErrors[key].precipErrors.push(Math.abs((data.precipAccum || 0) - actualPrecip));
      modelErrors[key].count++;
    }
  }

  const rankingTable = Object.entries(modelErrors)
    .filter(([, d]) => d.count > 0)
    .map(([model, d]) => {
      const avgTempErr = d.tempErrors.reduce((s, v) => s + v, 0) / d.tempErrors.length;
      const avgPrecipErr = d.precipErrors.reduce((s, v) => s + v, 0) / d.precipErrors.length;
      return `  ${model}: temp MAE=${avgTempErr.toFixed(1)}°F, precip MAE=${avgPrecipErr.toFixed(3)}" (${d.count} days)`;
    })
    .join('\n');

  const prompt = `You are a meteorologist ranking NWP MODEL PERFORMANCE for the Nimbus weather app.

## Per-Model Accuracy (Last 7 Days)
${rankingTable}

## Current Blending Weights
- 0-6h: HRRR=70%, NBM=25%, GFS=5%
- 6-18h: HRRR=40%, NBM=40%, GFS=20%
- 18-48h: HRRR=15%, NBM=55%, GFS=30%
- 48h+: NBM=40%, GFS=60%

## Analysis Required
1. **Model ranking** — Which model performed best this week for temperature? For precipitation? Is the blended result beating all individual models (it should)?
2. **Weight justification** — Do the current weights match observed performance? If NBM is beating HRRR for temperature even at 0-6h, maybe HRRR is over-weighted.
3. **Location-specific performance** — Do certain models perform better for certain locations? Coastal vs inland may favor different models.
4. **Precipitation skill** — Which model had the lowest precipitation MAE? This is critical since precipitation blending is the hardest to get right.
5. **Dynamic weight recommendations** — Based on this week's performance, suggest specific weight adjustments. Be conservative (±0.05 changes). The app uses consensus-weighted blending for precipitation, so weight changes primarily affect temperature blending.
6. **Blended vs best individual** — If the blended forecast is worse than the best individual model, the blending strategy needs adjustment. Is it adding value?`;

  return await callClaudeText(apiKey, prompt);
}

// MARK: - UX & Display Intelligence Analysis

async function analyzeUX(apiKey: string, screenshots: ScreenshotResult[]): Promise<string> {
  const content: Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }> = [];

  for (const shot of screenshots.slice(0, 4)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: shot.imageBase64 },
    });
    content.push({ type: 'text', text: `[${shot.chartType} — ${shot.locationName}]` });
  }

  content.push({
    type: 'text',
    text: `You are a UX expert, accessibility specialist, and information designer reviewing a weather app.

Evaluate these specific dimensions:

1. **Information Hierarchy** — Is the most critical info (imminent precipitation, severe weather alerts) visually dominant? Or is it buried below less important data? A user glancing for 2 seconds should see: current temp, "is it going to rain soon?", and any severe alerts.

2. **Temporal Consistency** — Do the hourly chart and daily chart tell a consistent visual story? If today shows rain in the hourly view, does the daily chart also show precipitation for today? Any visual contradictions?

3. **Accessibility — Contrast Ratios** — Are the text labels on charts readable against their backgrounds? Estimate WCAG contrast ratios. Flag any text that appears below 4.5:1 contrast. The charts use white text on dark blue backgrounds — is this sufficient?

4. **Accessibility — Color Blind Safety** — The temperature gradient goes blue→green→yellow→red. This is problematic for red-green color blindness (deuteranopia, ~8% of males). Suggest a color-blind-safe alternative that still feels natural for weather.

5. **Chart Density** — Are any charts showing too much data for their size? Is the hourly chart trying to show 48 hours in too small a space? Should some charts default to fewer hours with a "show more" option?

6. **Widget Legibility** — At widget sizes (especially the small 155×155pt), is the text readable? Are the sparkline charts too compressed to be useful, or do they effectively communicate trends?

7. **Dark Mode Optimization** — The app uses a dark theme. Are there any elements that would look better with slightly different opacity, blur, or color? Are the glassmorphic card borders visible enough?

8. **Interaction Affordance** — Can users tell which elements are tappable/clickable? Do the charts look interactive or static? Should there be hover states, cursor changes, or visual hints?

9. **Data-to-Ink Ratio** — Following Tufte's principles, is there any "chart junk" that could be removed? Are gridlines, axis labels, or decorative elements adding value or just noise?

10. **Emotional Design** — Does the app feel calm and trustworthy (important for weather apps) or cluttered and anxious? Weather apps should feel authoritative but not overwhelming.

Be brutally specific. Say "the precipitation area opacity should be 0.45 not 0.35" or "the hourly chart Y-axis labels are 10px, should be 12px". Vague feedback is not useful.`,
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
  return data.content?.[0]?.text || 'No UX analysis generated';
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
  analyses: Record<string, string>,
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

    ${screenshots.length > 0 ? `
    <h2>📊 Graph Screenshots</h2>
    <div class="card">
      ${inlineImages}
    </div>
    ` : ''}

    ${buildAnalysisSections(analyses)}

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
      <p>Analyses: Data Accuracy | Visual/Charts | Blending | Meteorological | Calibration | UX</p>
    </div>
  </div>
</body>
</html>`;
}

function buildAnalysisSections(analyses: Record<string, string>): string {
  const sections: { key: string; icon: string; title: string }[] = [
    { key: 'data', icon: '🤖', title: 'Data Accuracy Analysis' },
    { key: 'visual', icon: '🎨', title: 'Visual & Chart Analysis' },
    { key: 'blending', icon: '⚙️', title: 'Model Blending & Data Processing' },
    { key: 'meteorological', icon: '🌡️', title: 'Meteorological Intelligence' },
    { key: 'calibration', icon: '📐', title: 'Confidence Calibration & Model Skill' },
    { key: 'ux', icon: '📱', title: 'UX & Display Intelligence' },
    { key: 'dataVsDisplay', icon: '🔍', title: 'Data vs Display Consistency' },
  ];

  return sections
    .filter(s => analyses[s.key] && analyses[s.key].length > 30)
    .map(s => `
      <h2>${s.icon} ${s.title}</h2>
      <div class="card">
        <div class="analysis">${analyses[s.key].replace(/\n/g, '<br>')}</div>
      </div>
    `)
    .join('');
}
