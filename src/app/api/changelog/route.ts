// =============================================================================
// GET /api/changelog — Fetch all AI changelog entries
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = req.nextUrl;
    const limit = parseInt(searchParams.get('limit') || '100');

    const rows = await sql`
      SELECT * FROM ai_changelog
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json(rows);
  } catch (err) {
    // Return empty array if DB not configured
    return NextResponse.json([]);
  }
}
