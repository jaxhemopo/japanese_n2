import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/email';
import { createServiceRoleSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/unsubscribe?token=<HMAC-signed-token> — one-click unsubscribe.
 *
 * Reachable directly from the unsubscribe link in every daily-mock
 * notification email. Validates the HMAC token (60-day expiry), marks
 * the subscriber row as unsubscribed, returns a simple success page.
 *
 * No login required — this is the standard one-click unsubscribe flow
 * required by CAN-SPAM and recommended by GDPR.
 */

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return new NextResponse('Missing token.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return new NextResponse('This unsubscribe link is invalid or has expired. Please visit your settings page to unsubscribe from there.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Mark unsubscribed
  const service = createServiceRoleSupabase();
  const now = new Date().toISOString();
  await service.from('n2_subscribers').upsert(
    {
      user_id: userId,
      unsubscribed_at: now,
    },
    { onConflict: 'user_id' },
  );

  // Success page (inlined HTML — simple confirmation)
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed &middot; N2 Daily Mock</title>
  <style>
    body { font-family: Georgia, serif; background: #F5F2EA; color: #1A1A18; margin: 0; padding: 60px 24px; text-align: center; }
    .card { max-width: 480px; margin: 0 auto; background: #ECE8DD; border-radius: 8px; padding: 48px 36px; }
    h1 { font-size: 24px; font-weight: 600; margin: 0 0 16px; }
    p { font-size: 14px; color: #5B5A54; line-height: 1.7; margin: 0 0 16px; }
    a { color: #2B5B4F; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribed.</h1>
    <p>You won't receive any more daily-mock notification emails.</p>
    <p><a href="https://japanese-n2.vercel.app/settings">Manage settings</a> &middot; <a href="https://japanese-n2.vercel.app">Home</a></p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
