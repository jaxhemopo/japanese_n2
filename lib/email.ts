/**
 * lib/email.ts — Email send for "today's mock is ready" notification.
 *
 * Server-only — uses Gmail SMTP (App Password) + UNSUBSCRIBE_SECRET from
 * Vercel env. No domain verification required (Gmail handles deliverability).
 *
 * Used by:
 *   - app/api/cron/daily-mock/route.ts (fan-out after success)
 *   - app/api/unsubscribe/route.ts (token verification)
 *
 * Layout:
 *   - renderEmail(...) builds the design.md-matching template
 *   - signUnsubscribeToken / verifyUnsubscribeToken: HMAC-signed tokens for one-click unsub
 *   - sendEmail(...): single Nodemailer send via smtp.gmail.com
 *   - sendEmailWithRetry(...): exponential backoff, max 3 attempts
 *
 * Transport swap (2026-07-22): moved off Resend because Resend's free tier
 * blocks sending to any address other than the account owner without a
 * verified custom domain. Gmail SMTP via App Password is the free
 * alternative — From is `Kaji Gmail <kaji.hemopo@gmail.com>` until/unless
 * a custom domain is added later (just change EMAIL_FROM env var).
 *
 * Gmail rate limit: ~500/day for personal accounts, plenty for the cron.
 * If we ever grow past that, switch EMAIL_FROM to a verified Resend domain
 * (transport code stays the same).
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const UNSUBSCRIBE_SECRET =
  process.env.UNSUBSCRIBE_SECRET || 'dev-only-secret-rotate-this-in-v1';
const FROM_ADDRESS =
  process.env.EMAIL_FROM ||
  (GMAIL_USER ? `N2 Daily Mock <${GMAIL_USER}>` : 'N2 Daily Mock <onboarding@resend.dev>');
const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || 'https://japanese-n2.vercel.app';

// Reused SMTP transporter (avoids recreating TLS connection per send).
// google-gmail config: port 587 + STARTTLS, never 465/SSL (which Google is
// deprecating for app-password SMTP). Socket timeouts capped so a slow
// handshake can't blow past Vercel's 60s function budget silently.
let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // STARTTLS
    requireTLS: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  return transporter;
}

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export type SendResult = {
  ok: boolean;
  // Provider's envelope/message id. Field name preserved for caller
  // compatibility; transport-agnostic (`resendId` would benefit from a
  // rename to `provider_message_id` next schema touch).
  resendId?: string;
  error?: string;
  attempts: number;
};

/* ---------------------------------------------------------- *
 *  Template                                                  *
 * ---------------------------------------------------------- */

export function renderEmail(params: {
  userId: string;
  date: string;        // YYYY-MM-DD (JST day)
  focus: string;       // today's focus label, e.g. "Long Essay" or "Mixed practice"
}): EmailTemplate {
  const { userId, date, focus } = params;

  const unsubToken = signUnsubscribeToken(userId);
  const unsubscribeUrl = `${BASE_URL}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const takeUrl = `${BASE_URL}/today`;
  const settingsUrl = `${BASE_URL}/settings`;

  // Format date as "July 21" in en-US so it matches the JP-style "7月21日" feel
  // without requiring full Japanese locale handling in HTML email clients.
  const dateObj = new Date(`${date}T00:00:00+09:00`);
  const month = dateObj.toLocaleDateString('en-US', { month: 'long', timeZone: 'Asia/Tokyo' });
  const day = dateObj.getUTCDate();
  const dateLabel = `${month} ${day}`;

  const subject = `今日の N2 モック公開 — ${dateLabel}`;

  // Inlined styles only — most email clients block <style> tags and external CSS.
  // Color tokens are inlined here matching design.md: --bg #3A3D2F, --surface
  // #F5F2EA, --surface-2 #ECE8DD, --text #1A1A18, --text-2 #5B5A54, --text-3
  // #8A8880, --accent #2B5B4F. Serif masthead, sans body, accent CTA.
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#3A3D2F;font-family:Georgia,'Times New Roman',serif;color:#1A1A18;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#3A3D2F;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:#F5F2EA;border-radius:8px;padding:36px 32px 28px 32px;">

              <div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#5B5A54;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px 0;">
                N2 Daily Mock Exam
              </div>

              <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:#1A1A18;margin:0 0 4px 0;line-height:1.2;letter-spacing:-0.01em;">
                今日の N2 モック公開
              </h1>

              <div style="font-family:Georgia,serif;font-size:15px;color:#5B5A54;font-style:italic;margin:0 0 20px 0;">
                ${dateLabel} &middot; Today's focus: ${escapeHtml(focus)}
              </div>

              <div style="background:#ECE8DD;border-radius:6px;padding:14px 18px;margin:0 0 24px 0;">
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:500;color:#5B5A54;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 6px 0;">
                  What you'll see
                </div>
                <ul style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1A1A18;margin:0;padding-left:18px;line-height:1.6;">
                  <li>5 questions across reading, grammar, and vocabulary</li>
                  <li>~7 minutes total &middot; score &amp; explanations immediately</li>
                  <li>Streak counts each day you finish</li>
                </ul>
              </div>

              <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1A1A18;margin:0 0 24px 0;">
                Today's mock is ready. Click below when you're set up &mdash; no rush, today's stays open all day.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background:#2B5B4F;border-radius:6px;">
                    <a href="${takeUrl}" target="_blank" style="display:inline-block;padding:14px 28px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.3px;text-decoration:none;border-radius:6px;">
                      今日のモックを受ける &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <div style="border-top:1px solid #C9C2B0;padding-top:16px;margin-top:8px;">
                <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8A8880;line-height:1.6;margin:0;">
                  You're getting this because you subscribed at
                  <a href="${settingsUrl}" style="color:#5B5A54;text-decoration:underline;">your settings</a>.
                  Don't want these? <a href="${unsubscribeUrl}" style="color:#8A8880;text-decoration:underline;">Unsubscribe</a>.
                </p>
              </div>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `今日の N2 モック公開 — ${dateLabel}

Today's focus: ${focus}

Today's mock is ready. ~7 minutes, 5 questions, scored instantly.

Take today's mock: ${takeUrl}

---
You're getting this because you subscribed. Manage: ${settingsUrl}
Unsubscribe: ${unsubscribeUrl}`;

  return { subject, html, text };
}

/* ---------------------------------------------------------- *
 *  Unsubscribe tokens (HMAC-signed)                          *
 * ---------------------------------------------------------- */

export function signUnsubscribeToken(userId: string): string {
  const payload = `${userId}.${Math.floor(Date.now() / 1000)}`;
  const sig = crypto
    .createHmac('sha256', UNSUBSCRIBE_SECRET)
    .update(payload)
    .digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 4) return null; // base64 has 2 dots (payload.encoded has 2 because of the trailing ts)
    const [b64UserId, tsStr, sig] = parts;
    if (!b64UserId || !tsStr || !sig) return null;
    const userId = Buffer.from(b64UserId, 'base64url').toString('utf8');
    const payload = `${userId}.${tsStr}`;
    const expected = crypto
      .createHmac('sha256', UNSUBSCRIBE_SECRET)
      .update(payload)
      .digest('base64url');
    if (sig.length !== expected.length) return null;
    const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return null;
    const ts = parseInt(tsStr, 10);
    if (!Number.isFinite(ts)) return null;
    if (Date.now() / 1000 - ts > 60 * 86400) return null; // 60-day expiry
    return userId;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- *
 *  Send (with retry)                                         *
 * ---------------------------------------------------------- */

export async function sendEmail(
  to: string,
  template: EmailTemplate,
): Promise<{ ok: boolean; resendId?: string; error?: string }> {
  const t = getTransporter();
  if (!t) {
    return {
      ok: false,
      error:
        'Gmail SMTP not configured — GMAIL_USER and/or GMAIL_APP_PASSWORD missing in env',
    };
  }
  try {
    const info = await t.sendMail({
      from: FROM_ADDRESS,
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: {
        'X-Mailer': 'japanese-n2-cron/1.0 (Vercel)',
      },
    });
    // info.messageId is the Gmail SMTP envelope id (looks like
    // "<...@gmail-smtp-msa.l.google.com>"). Stash in `resendId` to keep the
    // caller/n2_email_send_log schema unchanged — column rename can wait.
    return { ok: true, resendId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function sendEmailWithRetry(
  to: string,
  template: EmailTemplate,
  maxAttempts = 3,
): Promise<SendResult> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendEmail(to, template);
    if (result.ok) {
      return { ok: true, resendId: result.resendId, attempts: attempt };
    }
    lastError = result.error;
    if (attempt < maxAttempts) {
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}

/* ---------------------------------------------------------- *
 *  Helpers                                                   *
 * ---------------------------------------------------------- */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
