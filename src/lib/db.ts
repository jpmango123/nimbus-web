// =============================================================================
// Database Client — Neon Postgres (Vercel Integration)
// =============================================================================

import { neon } from '@neondatabase/serverless';

export function getDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return sql;
}

// MARK: - Schema Setup (run once via /api/setup)

export const SCHEMA_SQL = `
-- Saved locations
CREATE TABLE IF NOT EXISTS locations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'America/New_York',
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Forecast snapshots (captured every 3 hours by audit cron)
CREATE TABLE IF NOT EXISTS forecast_snapshots (
    id                      SERIAL PRIMARY KEY,
    location_id             INT REFERENCES locations(id) ON DELETE CASCADE,
    captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    target_date             DATE NOT NULL,
    hours_ahead             INT,
    predicted_high          DOUBLE PRECISION,
    predicted_low           DOUBLE PRECISION,
    predicted_precip_prob   DOUBLE PRECISION,
    predicted_precip_type   TEXT,
    predicted_precip_accum  DOUBLE PRECISION,
    predicted_condition     TEXT,
    raw_json                JSONB
);

-- Actual observed weather (fetched after the fact from Open-Meteo Historical)
CREATE TABLE IF NOT EXISTS actual_weather (
    id              SERIAL PRIMARY KEY,
    location_id     INT REFERENCES locations(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    actual_high     DOUBLE PRECISION,
    actual_low      DOUBLE PRECISION,
    actual_precip   DOUBLE PRECISION,
    actual_precip_type TEXT,
    actual_condition TEXT,
    actual_wind_speed DOUBLE PRECISION,
    source          TEXT DEFAULT 'open-meteo-historical',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(location_id, date)
);

-- AI changelog
CREATE TABLE IF NOT EXISTS ai_changelog (
    id          SERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    category    TEXT NOT NULL,
    summary     TEXT NOT NULL,
    details     TEXT,
    files_changed TEXT[],
    diff        TEXT,
    status      TEXT DEFAULT 'applied'
);

-- Graph screenshots
CREATE TABLE IF NOT EXISTS screenshots (
    id          SERIAL PRIMARY KEY,
    location_id INT REFERENCES locations(id) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chart_type  TEXT NOT NULL,
    image_url   TEXT,
    metadata    JSONB
);

-- Hourly forecast snapshots (stores the 48h forecast curve at each audit)
-- This lets us compare "what the graph showed" vs what actually happened
CREATE TABLE IF NOT EXISTS hourly_forecast_snapshots (
    id              SERIAL PRIMARY KEY,
    location_id     INT REFERENCES locations(id) ON DELETE CASCADE,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    target_hour     TIMESTAMPTZ NOT NULL,
    hours_ahead     INT NOT NULL,
    predicted_temp  DOUBLE PRECISION,
    predicted_precip_prob   DOUBLE PRECISION,
    predicted_precip_accum  DOUBLE PRECISION,
    predicted_precip_type   TEXT,
    predicted_wind_speed    DOUBLE PRECISION,
    predicted_condition     TEXT
);

-- Hourly actual weather (for graph accuracy comparison)
CREATE TABLE IF NOT EXISTS hourly_actuals (
    id              SERIAL PRIMARY KEY,
    location_id     INT REFERENCES locations(id) ON DELETE CASCADE,
    hour            TIMESTAMPTZ NOT NULL,
    actual_temp     DOUBLE PRECISION,
    actual_precip   DOUBLE PRECISION,
    actual_snowfall DOUBLE PRECISION,
    actual_wind_speed DOUBLE PRECISION,
    weather_code    INT,
    source          TEXT DEFAULT 'open-meteo-historical',
    UNIQUE(location_id, hour)
);

-- Migrations (safe to re-run)
ALTER TABLE actual_weather ADD COLUMN IF NOT EXISTS actual_precip_type TEXT;
ALTER TABLE actual_weather ADD COLUMN IF NOT EXISTS actual_wind_speed DOUBLE PRECISION;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_snapshots_location_date ON forecast_snapshots(location_id, target_date);
CREATE INDEX IF NOT EXISTS idx_actual_location_date ON actual_weather(location_id, date);
CREATE INDEX IF NOT EXISTS idx_changelog_created ON ai_changelog(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_screenshots_location ON screenshots(location_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_snapshots_loc_hour ON hourly_forecast_snapshots(location_id, target_hour);
CREATE INDEX IF NOT EXISTS idx_hourly_snapshots_captured ON hourly_forecast_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_actuals_loc_hour ON hourly_actuals(location_id, hour);
`;

export async function setupDatabase() {
  const sql = getDb();
  // Use sql.query() for dynamic SQL strings (tagged templates only work for static)
  const statements = SCHEMA_SQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await sql.query(stmt);
  }
  return { success: true };
}
