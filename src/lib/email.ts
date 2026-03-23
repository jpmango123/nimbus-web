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
    await resend.emails.send({
      from: 'Nimbus Weather <onboarding@resend.dev>',  // Use your verified domain later
      to: toEmail,
      subject,
      html: htmlBody,
    });
    return true;
  } catch (err) {
    console.error('[EMAIL] Failed to send:', err);
    return false;
  }
}
