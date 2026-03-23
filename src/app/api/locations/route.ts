// =============================================================================
// /api/locations — CRUD for saved locations
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT * FROM locations ORDER BY sort_order ASC, id ASC`;
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[LOCATIONS] GET error:', err);
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, latitude, longitude, timezone } = body;

    if (!name || latitude == null || longitude == null) {
      return NextResponse.json({ error: 'name, latitude, longitude required' }, { status: 400 });
    }

    const sql = getDb();
    const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM locations`;
    const nextOrder = maxOrder[0].next_order;

    const rows = await sql`
      INSERT INTO locations (name, latitude, longitude, timezone, sort_order)
      VALUES (${name}, ${latitude}, ${longitude}, ${timezone || 'America/New_York'}, ${nextOrder})
      RETURNING *
    `;

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('[LOCATIONS] POST error:', err);
    return NextResponse.json({ error: 'Failed to save location' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const sql = getDb();
    await sql`DELETE FROM locations WHERE id = ${parseInt(id)}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[LOCATIONS] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
