// =============================================================================
// /api/errors — iOS app error log upload + retrieval
// POST: Upload batch of error logs from iOS app
// GET: Retrieve recent errors (for nightly AI analysis)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ErrorLogEntry {
  timestamp: string;     // ISO 8601
  level: string;         // error, warning, critical
  category?: string;     // networking, blending, ui, storm, etc.
  message: string;
  context?: string;      // additional context (stack trace, params, etc.)
}

interface UploadPayload {
  deviceId: string;
  appVersion?: string;
  osVersion?: string;
  errors: ErrorLogEntry[];
}

export async function POST(req: NextRequest) {
  try {
    const body: UploadPayload = await req.json();

    if (!body.deviceId || !body.errors?.length) {
      return NextResponse.json({ error: 'deviceId and errors[] required' }, { status: 400 });
    }

    // Limit to 100 errors per upload to prevent abuse
    const errors = body.errors.slice(0, 100);
    const sql = getDb();

    for (const err of errors) {
      await sql`
        INSERT INTO error_logs
          (device_id, timestamp, level, category, message, context, app_version, os_version)
        VALUES
          (${body.deviceId}, ${err.timestamp}, ${err.level || 'error'},
           ${err.category || null}, ${err.message},
           ${err.context || null}, ${body.appVersion || null}, ${body.osVersion || null})
      `;
    }

    return NextResponse.json({ success: true, uploaded: errors.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = req.nextUrl;
    const days = parseInt(searchParams.get('days') || '1');
    const level = searchParams.get('level'); // optional filter: error, warning, critical
    const since = new Date(Date.now() - days * 86400000).toISOString();

    let rows;
    if (level) {
      rows = await sql`
        SELECT * FROM error_logs
        WHERE timestamp > ${since} AND level = ${level}
        ORDER BY timestamp DESC
        LIMIT 200
      `;
    } else {
      rows = await sql`
        SELECT * FROM error_logs
        WHERE timestamp > ${since}
        ORDER BY timestamp DESC
        LIMIT 200
      `;
    }

    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
