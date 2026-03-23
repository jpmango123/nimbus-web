// =============================================================================
// GET /api/historical — Query forecast vs actual comparison data
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const locationId = searchParams.get('locationId');
  const days = parseInt(searchParams.get('days') || '7');

  try {
    const sql = getDb();
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    if (locationId) {
      const rows = await sql`
        SELECT
          aw.date,
          aw.actual_high, aw.actual_low, aw.actual_precip, aw.actual_condition,
          fs.predicted_high, fs.predicted_low, fs.predicted_precip_prob,
          fs.predicted_precip_accum, fs.predicted_condition, fs.hours_ahead
        FROM actual_weather aw
        JOIN forecast_snapshots fs ON fs.location_id = aw.location_id
          AND fs.target_date = aw.date
          AND fs.hours_ahead BETWEEN 12 AND 36
        WHERE aw.location_id = ${parseInt(locationId)}
          AND aw.date >= ${since}
        ORDER BY aw.date DESC
      `;
      return NextResponse.json(rows);
    }

    // All locations summary
    const rows = await sql`
      SELECT
        l.name as location_name,
        l.id as location_id,
        AVG(ABS(fs.predicted_high - aw.actual_high)) as avg_temp_error,
        AVG(ABS(fs.predicted_precip_accum - aw.actual_precip)) as avg_precip_error,
        COUNT(DISTINCT aw.date) as days_compared
      FROM locations l
      JOIN actual_weather aw ON aw.location_id = l.id AND aw.date >= ${since}
      JOIN forecast_snapshots fs ON fs.location_id = l.id
        AND fs.target_date = aw.date
        AND fs.hours_ahead BETWEEN 12 AND 36
      GROUP BY l.id, l.name
      ORDER BY l.sort_order
    `;

    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
