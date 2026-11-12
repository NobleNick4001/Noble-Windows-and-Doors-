// Emails brochure PDF links to a client. Logged-in reps only.
// Same mailbox as send-estimate: Gmail API as mgr@noblewandd.com when
// GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN are set.
// Otherwise Resend (RESEND_API_KEY). Reply-To is the signed-in rep.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Do not put any of those values in git. GitHub Pages does not deploy this
// function: supabase functions deploy send-brochures --project-ref nmyatpcjqfokmfbssimc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SENDER_FROM, providerFor, toBase64Url } from '../send-estimate/mail.js';
import {
  validateBrochureRequest, buildBrochureEmail, buildBrochureRaw, replyToHeader, signatureName,
  createRateBucket, takeSendSlot,
} from './mail.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const bucket = createRateBucket();

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

async function sendResend(apiKey: string, message: {
  to: string; replyTo: string; subject: string; html: string; text: string;
}) {
  const payload: Record<string, unknown> = {
    from: SENDER_FROM,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (message.replyTo) payload.reply_to = message.replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

  const rawBody = await req.text();
  if (rawBody.length > 8000) return json(413, { ok: false, error: 'Message is too long.' });
  let payload: unknown = null;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { ok: false, error: 'Expected JSON' }); }

  const parsed = validateBrochureRequest(payload);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
  const message = parsed.value;

  const secrets = envMap();
  const provider = providerFor(secrets);
  if (!provider) return json(500, { ok: false, error: 'Email is not configured' });

  const fingerprint = [message.to, message.note, ...message.links.map((item) => item.fileName)].join('\n');
  const slot = takeSendSlot(bucket, user.id, Date.now(), fingerprint);
  if (!slot.ok) return json(429, { ok: false, error: slot.error, retry_after: slot.retryAfterSec });

  const { data: profile } = await admin.from('profiles').select('email, full_name').eq('id', user.id).maybeSingle();
  const repEmail = String(profile?.email || user.email || '').trim().toLowerCase();
  const repName = signatureName(profile?.full_name, repEmail);
  const replyTo = replyToHeader(repName, repEmail);
  const built = buildBrochureEmail({
    repName,
    customerName: message.customerName,
    note: message.note,
    links: message.links,
  });

  try {
    let providerId = null;
    if (provider === 'gmail') {
      const raw = buildBrochureRaw({
        from: SENDER_FROM,
        to: message.to,
        replyTo,
        subject: built.subject,
        text: built.text,
        html: built.html,
      });
      providerId = await sendGmail(secrets, raw);
    } else {
      providerId = await sendResend(secrets.RESEND_API_KEY, {
        to: message.to,
        replyTo,
        subject: built.subject,
        html: built.html,
        text: built.text,
      });
    }
    const sentAt = new Date().toISOString();
    return json(200, {
      ok: true,
      provider,
      sent_at: sentAt,
      sent_to: message.to,
      files: message.links.map((item) => item.fileName),
      provider_id: providerId,
    });
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'Email failed' });
  }
});
