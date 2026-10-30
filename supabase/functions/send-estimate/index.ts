// Emails an estimate PDF to the client. Authenticated users only, and only for
// an estimate they own (admins may send any). Gmail API as mgr@noblewandd.com
// when GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN are set.
// Otherwise Resend (RESEND_API_KEY). Does not mark the estimate presented.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SENDER_FROM, providerFor, gmailTokenDead, buildHtml, buildRawMessage, safeFilename, toBase64Url,
} from './mail.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function envMap() {
  return {
    GMAIL_CLIENT_ID: Deno.env.get('GMAIL_CLIENT_ID') ?? '',
    GMAIL_CLIENT_SECRET: Deno.env.get('GMAIL_CLIENT_SECRET') ?? '',
    GMAIL_REFRESH_TOKEN: Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
  };
}

async function gmailAccessToken(env: Record<string, string>) {
  const body = new URLSearchParams({
    client_id: env.GMAIL_CLIENT_ID,
    client_secret: env.GMAIL_CLIENT_SECRET,
    refresh_token: env.GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Gmail authorization failed');
  }
  return data.access_token as string;
}

async function sendGmail(env: Record<string, string>, raw: string) {
  const access = await gmailAccessToken(env);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.error_description || 'Gmail rejected the message');
  return data.id || null;
}

async function sendResend(apiKey: string, { to, subject, html, pdfBase64, filename }: {
  to: string; subject: string; html: string; pdfBase64: string; filename: string;
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: SENDER_FROM,
      to: [to],
      subject,
      html,
      attachments: [{ filename, content: pdfBase64 }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Resend rejected the message');
  return data.id || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) return json(500, { ok: false, error: 'Supabase service role is not available' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { ok: false, error: 'Sign in required' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return json(401, { ok: false, error: 'Sign in required' });

  let payload: any = {};
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: 'Expected JSON' }); }
  const estimateId = String(payload.estimateId || '');
  const pdfBase64 = String(payload.pdfBase64 || '').replace(/^data:application\/pdf;base64,/i, '').replace(/\s/g, '');
  if (!estimateId) return json(400, { ok: false, error: 'estimateId is required' });
  if (!pdfBase64.startsWith('JVBERi')) return json(400, { ok: false, error: 'A PDF attachment is required' });

  const { data: profile } = await admin.from('profiles').select('role, email, full_name').eq('id', user.id).maybeSingle();
  const { data: estimate, error: estErr } = await admin.from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (estErr) return json(500, { ok: false, error: estErr.message });
  if (!estimate || estimate.deleted_at) return json(404, { ok: false, error: 'Estimate not found' });
  if (estimate.owner_id !== user.id && profile?.role !== 'admin') return json(403, { ok: false, error: 'Not your estimate' });

  const to = String(estimate.customer_email || '').trim();
  if (!to || !to.includes('@')) return json(400, { ok: false, error: 'Client email is required' });

  const secrets = envMap();
  const provider = providerFor(secrets);
  if (!provider) return json(500, { ok: false, error: 'Email is not configured' });

  const doc = estimate.document || {};
  const number = doc.number || estimate.id;
  const repName = profile?.full_name || profile?.email || 'Noble Windows & Doors';
  const subject = `Noble Windows & Doors — Estimate ${number}`;
  const html = buildHtml({
    repName,
    customerName: estimate.customer_name || doc.customer?.name || '',
    number,
    total: estimate.total_amount,
    depositPct: 60,
  });
  const filename = safeFilename(number);

  try {
    let used = provider;
    let providerId = null;
    const resendArgs = { to, subject, html, pdfBase64, filename };
    if (provider === 'gmail') {
      try {
        const raw = buildRawMessage({ from: SENDER_FROM, to, subject, html, pdfBase64, filename });
        providerId = await sendGmail(secrets, raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!gmailTokenDead(message)) throw err;
        if (!secrets.RESEND_API_KEY.trim()) {
          throw new Error('Company Gmail needs to be reconnected. Signing in again on this iPad will not fix it.');
        }
        used = 'resend';
        providerId = await sendResend(secrets.RESEND_API_KEY, resendArgs);
      }
    } else {
      providerId = await sendResend(secrets.RESEND_API_KEY, resendArgs);
    }
    const sentAt = new Date().toISOString();
    const { error: saveErr } = await admin.from('estimates').update({ sent_at: sentAt, sent_to: to }).eq('id', estimateId);
    if (saveErr) return json(500, { ok: false, error: saveErr.message });
    return json(200, { ok: true, provider: used, sent_at: sentAt, sent_to: to, provider_id: providerId });
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'Email failed' });
  }
});
