// Internal HTML mail through the same Gmail / Resend choice as estimate email.
// Addresses come from the caller. This file does not know customer recipients.

import {
  SENDER_FROM, providerFor, encodeSubject, toBase64Url,
} from '../send-estimate/mail.js';

export function buildHtmlRaw({ from = SENDER_FROM, to, cc, subject, html }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
  ];
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    String(html || ''),
  );
  return lines.join('\r\n');
}

async function gmailAccessToken(env, fetchImpl) {
  const body = new URLSearchParams({
    client_id: env.GMAIL_CLIENT_ID,
    client_secret: env.GMAIL_CLIENT_SECRET,
    refresh_token: env.GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Gmail authorization failed');
  }
  return data.access_token;
}

export async function sendHtml({ env, to, cc, subject, html, fetchImpl = fetch }) {
  const provider = providerFor(env);
  if (!provider) throw new Error('Email is not configured');
  const address = String(to || '').trim();
  if (!address || !address.includes('@')) throw new Error('A recipient is required');
  if (provider === 'gmail') {
    const raw = buildHtmlRaw({ to: address, cc, subject, html });
    const access = await gmailAccessToken(env, fetchImpl);
    const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toBase64Url(raw) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Gmail rejected the message');
    return { provider, id: data.id || null };
  }
  const payload = { from: SENDER_FROM, to: [address], subject, html };
  if (cc) payload.cc = [cc];
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Resend rejected the message');
  return { provider, id: data.id || null };
}

export function mailEnv(read) {
  return {
    GMAIL_CLIENT_ID: read('GMAIL_CLIENT_ID'),
    GMAIL_CLIENT_SECRET: read('GMAIL_CLIENT_SECRET'),
    GMAIL_REFRESH_TOKEN: read('GMAIL_REFRESH_TOKEN'),
    RESEND_API_KEY: read('RESEND_API_KEY'),
  };
}
