// =============================================================================
// Screenshot Service — Captures chart images for AI visual evaluation
// Uses puppeteer-core + @sparticuz/chromium for serverless environments
// =============================================================================

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Always use the production URL — VERCEL_URL points to the deployment URL
// which has Deployment Protection (shows login page instead of the app).
const APP_URL = process.env.VERCEL_APP_URL || 'https://nimbus-web-xi.vercel.app';

export interface ScreenshotResult {
  chartType: string;
  locationName: string;
  imageBase64: string;  // base64 PNG for sending to Claude vision
  width: number;
  height: number;
}

/**
 * Capture screenshots of all weather charts for a location.
 * Returns base64-encoded PNGs ready for Claude vision analysis.
 */
export async function captureLocationScreenshots(
  locationIdx: number,
  locationName: string
): Promise<ScreenshotResult[]> {
  const results: ScreenshotResult[] = [];

  let browser;
  try {
    // Disable GPU/WebGL for serverless (reduces memory)
    chromium.setGraphicsMode = false;
    console.log(`[SCREENSHOT] Chromium args: ${chromium.args.join(' ').slice(0, 200)}`);

    let executablePath: string;
    try {
      executablePath = await chromium.executablePath();
      console.log(`[SCREENSHOT] Chromium path resolved: ${executablePath}`);
    } catch (pathErr) {
      console.error(`[SCREENSHOT] executablePath() failed: ${pathErr}`);
      throw pathErr;
    }

    console.log(`[SCREENSHOT] Launching Puppeteer...`);
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 480, height: 900, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    });
    console.log(`[SCREENSHOT] Browser launched successfully`);

    const page = await browser.newPage();

    // Navigate to the main dashboard for this location
    await page.goto(`${APP_URL}/?loc=${locationIdx}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for charts to render
    await page.waitForSelector('.recharts-wrapper', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000)); // extra settle time for animations

    // Take full page screenshot
    const fullPage = await page.screenshot({
      fullPage: true,
      type: 'png',
      encoding: 'base64',
    });
    results.push({
      chartType: 'full-dashboard',
      locationName,
      imageBase64: fullPage as string,
      width: 480,
      height: 900,
    });

    // Navigate to widget simulator
    await page.goto(`${APP_URL}/widget?loc=${locationIdx}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForSelector('.recharts-wrapper', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const widgetPage = await page.screenshot({
      fullPage: true,
      type: 'png',
      encoding: 'base64',
    });
    results.push({
      chartType: 'widgets',
      locationName,
      imageBase64: widgetPage as string,
      width: 480,
      height: 900,
    });

    console.log(`[SCREENSHOT] Captured ${results.length} screenshots for ${locationName}`);
  } catch (err) {
    console.error(`[SCREENSHOT] Error capturing ${locationName}:`, err);
    // Re-throw so the caller can log the error to the DB
    throw err;
  } finally {
    if (browser) await browser.close();
  }

  return results;
}

/**
 * Capture screenshots for all locations and widgets.
 * Limit to first 3 locations to stay within function timeout.
 */
export async function captureAllScreenshots(
  locations: { id: number; name: string }[]
): Promise<ScreenshotResult[]> {
  const all: ScreenshotResult[] = [];
  let firstError: Error | null = null;
  // Limit to 3 locations to avoid timeout (each takes ~15-20s)
  for (let i = 0; i < Math.min(locations.length, 3); i++) {
    try {
      const shots = await captureLocationScreenshots(i, locations[i].name);
      all.push(...shots);
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err : new Error(String(err));
      console.error(`[SCREENSHOT] Failed for ${locations[i].name}: ${err}`);
    }
  }
  // If we got zero screenshots and had errors, throw so the report can log it
  if (all.length === 0 && firstError) {
    throw firstError;
  }
  return all;
}
