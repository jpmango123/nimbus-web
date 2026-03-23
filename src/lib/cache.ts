// =============================================================================
// Cache Layer — Upstash Redis (Vercel Integration)
// =============================================================================

import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  return redis;
}

const WEATHER_TTL = 900; // 15 minutes

export async function getCachedWeather(locationKey: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get<string>(`weather:${locationKey}`);
  } catch {
    return null;
  }
}

export async function setCachedWeather(locationKey: string, data: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(`weather:${locationKey}`, data, { ex: WEATHER_TTL });
  } catch {
    // Silent fail for cache
  }
}
