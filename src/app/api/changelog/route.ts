// =============================================================================
// /api/changelog — Fetch and update AI changelog entries
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = req.nextUrl;
    const limit = parseInt(searchParams.get('limit') || '100');
    const status = searchParams.get('status');

    let rows;
    if (status) {
      rows = await sql`
        SELECT * FROM ai_changelog
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * FROM ai_changelog
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();

    if (body.action === 'update_status') {
      const ids = String(body.ids).split(',').map((id: string) => parseInt(id.trim())).filter((id: number) => !isNaN(id));
      const newStatus = body.status || 'applied';
      const buildResult = body.buildResult || null;
      const buildOutput = body.buildOutput || null;

      for (const id of ids) {
        const details = buildResult === 'failed'
          ? `Build failed. Output: ${buildOutput || 'no output'}`
          : null;

        if (details) {
          await sql`
            UPDATE ai_changelog
            SET status = ${newStatus}, details = COALESCE(details, '') || ${'\n\n[Build Result] ' + details}
            WHERE id = ${id}
          `;
        } else {
          await sql`
            UPDATE ai_changelog SET status = ${newStatus} WHERE id = ${id}
          `;
        }
      }

      return NextResponse.json({ success: true, updated: ids.length });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
