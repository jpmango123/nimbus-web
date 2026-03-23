// =============================================================================
// Auto-Fix Pipeline — Claude generates and applies code changes
// Applies to BOTH the web app (via git) AND the iOS app (via iCloud path)
// =============================================================================

import { getDb } from './db';

// iOS app path in iCloud (on the Mac where this is developed)
// The nightly report runs on Vercel, so it can't directly write to iCloud.
// Instead, it generates the fix and stores it. A local script applies it.
// For web app changes, it can commit directly via GitHub API.

const GITHUB_REPO = 'jpmango123/nimbus-web';

export interface CodeFix {
  category: 'accuracy' | 'visual' | 'performance' | 'bug_fix';
  summary: string;
  details: string;
  webAppChanges: FileChange[];    // Changes to the web app (applied via GitHub API)
  iosAppChanges: FileChange[];     // Changes to the iOS app (stored for local apply)
}

export interface FileChange {
  filePath: string;
  oldContent: string;   // The text to find and replace
  newContent: string;   // The replacement text
  description: string;  // What this change does
}

/**
 * Ask Claude to generate specific code fixes based on analysis findings.
 * Returns structured changes that can be applied to both web and iOS codebases.
 */
export async function generateFixes(
  apiKey: string,
  analysisFindings: string,
  context: string
): Promise<CodeFix[]> {
  const prompt = `You are a senior developer working on the Nimbus weather app. Based on the analysis findings below, generate specific code fixes.

## Analysis Findings
${analysisFindings}

## Context
${context}

## Current Blending Weights (web app: src/lib/weather/open-meteo.ts)
\`\`\`typescript
function getWeights(hoursAhead: number): Record<ModelKey, number> {
  if (hoursAhead <= 6)  return { hrrr: 0.60, nbm: 0.30, gfs: 0.10 };
  if (hoursAhead <= 18) return { hrrr: 0.40, nbm: 0.40, gfs: 0.20 };
  if (hoursAhead <= 48) return { hrrr: 0.15, nbm: 0.55, gfs: 0.30 };
  if (hoursAhead <= 192) return { hrrr: 0, nbm: 0.40, gfs: 0.60 };
  return { hrrr: 0, nbm: 0, gfs: 1.0 };
}
\`\`\`

## iOS Equivalent (Nimbus/Services/BlendedWeatherProvider.swift)
The iOS app uses the same weight table in BlendedWeatherProvider.swift.

## Instructions
Generate JSON array of code fixes. Each fix should have:
- category: "accuracy" | "visual" | "performance" | "bug_fix"
- summary: one-line description
- details: explanation of why
- webAppChanges: array of {filePath, oldContent, newContent, description}
- iosAppChanges: array of {filePath, oldContent, newContent, description}

IMPORTANT RULES:
- Only suggest changes you are CONFIDENT will improve the app
- oldContent must be an EXACT string match from the current code
- Keep changes small and focused — one fix per issue
- For weight changes, adjust by small increments (e.g., 0.05-0.10)
- For threshold changes, adjust by small increments
- For visual changes, adjust opacity/size by small amounts

Return ONLY a JSON array, no markdown or explanation. If no changes are warranted, return [].`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '[]';

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as CodeFix[];
  } catch {
    console.error('[AUTO-FIX] Failed to parse Claude response:', text.slice(0, 200));
    return [];
  }
}

/**
 * Apply web app changes via GitHub API (creates a commit).
 */
export async function applyWebAppFixes(fixes: CodeFix[]): Promise<string[]> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) return ['GitHub token not configured — web fixes stored but not applied'];

  const results: string[] = [];

  for (const fix of fixes) {
    for (const change of fix.webAppChanges) {
      try {
        // Get current file content
        const fileRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${change.filePath}`,
          { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' } }
        );

        if (!fileRes.ok) {
          results.push(`⚠️ Could not read ${change.filePath}: ${fileRes.status}`);
          continue;
        }

        const fileData = await fileRes.json();
        const currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8');

        if (!currentContent.includes(change.oldContent)) {
          results.push(`⚠️ ${change.filePath}: old content not found (file may have changed)`);
          continue;
        }

        const newContent = currentContent.replace(change.oldContent, change.newContent);
        const encoded = Buffer.from(newContent).toString('base64');

        // Commit the change
        const commitRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${change.filePath}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: `[auto-fix] ${fix.summary}\n\n${change.description}\n\nApplied by Nimbus AI audit pipeline`,
              content: encoded,
              sha: fileData.sha,
            }),
          }
        );

        if (commitRes.ok) {
          results.push(`✅ Applied to web: ${change.filePath} — ${change.description}`);
        } else {
          results.push(`❌ Failed to commit ${change.filePath}: ${commitRes.status}`);
        }
      } catch (err) {
        results.push(`❌ Error applying ${change.filePath}: ${err}`);
      }
    }
  }

  return results;
}

/**
 * Store iOS app fixes in the database for local application.
 * A local script on the Mac reads these and applies them to the iCloud Nimbus folder.
 */
export async function storeIosAppFixes(fixes: CodeFix[]): Promise<string[]> {
  const sql = getDb();
  const results: string[] = [];

  for (const fix of fixes) {
    if (fix.iosAppChanges.length === 0) continue;

    await sql`
      INSERT INTO ai_changelog (category, summary, details, files_changed, diff, status)
      VALUES (
        ${fix.category},
        ${`[iOS] ${fix.summary}`},
        ${fix.details},
        ${fix.iosAppChanges.map(c => c.filePath)},
        ${JSON.stringify(fix.iosAppChanges)},
        'pending_ios'
      )
    `;

    results.push(`📱 Stored iOS fix: ${fix.summary} (${fix.iosAppChanges.length} files)`);
  }

  return results;
}
