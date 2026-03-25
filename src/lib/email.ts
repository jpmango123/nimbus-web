// =============================================================================
// Email Service — Resend
// =============================================================================

import { Resend } from 'resend';

export async function sendNightlyReport(subject: string, htmlBody: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.REPORT_EMAIL;

  if (!apiKey || !toEmail) {
    console.warn('[EMAIL] Missing RESEND_API_KEY or REPORT_EMAIL env vars');
    return false;
  }

  const resend = new Resend(apiKey);

  try {
    const result = await resend.emails.send({
      from: 'Nimbus Weather <onboarding@resend.dev>',
      to: toEmail,
      subject,
      html: htmlBody,
    });

    // Check for Resend error response (SDK doesn't always throw)
    if (result.error) {
      throw new Error(`Resend error: ${result.error.message} (name: ${result.error.name})`);
    }
    console.log(`[EMAIL] Sent to ${toEmail}: id=${result.data?.id || 'unknown'}`);

    // Also log to error_logs so we can verify delivery
    try {
      const sql = await import('./db').then(m => m.getDb());
      await sql`INSERT INTO error_logs (device_id, timestamp, level, category, message, context)
        VALUES ('vercel-email', ${new Date().toISOString()}, 'info', 'email',
                ${'Email sent: ' + subject}, ${'to=' + toEmail + ' id=' + (result.data?.id || 'none')})`;
    } catch { /* ignore */ }

    return true;
  } catch (err) {
    console.error('[EMAIL] Failed to send:', err);

    // Log the failure to error_logs
    try {
      const sql = await import('./db').then(m => m.getDb());
      await sql`INSERT INTO error_logs (device_id, timestamp, level, category, message, context)
        VALUES ('vercel-email', ${new Date().toISOString()}, 'error', 'email',
                ${'Email FAILED: ' + String(err)}, ${'to=' + toEmail + ' subject=' + subject})`;
    } catch { /* ignore */ }

    return false;
  }
}
