// =============================================================================
// GET /api/setup — Initialize database tables (run once)
// =============================================================================

import { NextResponse } from 'next/server';
import { setupDatabase } from '@/lib/db';

export async function GET() {
  try {
    await setupDatabase();
    return NextResponse.json({ success: true, message: 'Database tables created' });
  } catch (err) {
    console.error('[SETUP] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
