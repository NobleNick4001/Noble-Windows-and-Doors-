// Email provider choice and the Gmail MIME message. No network.
// Gmail is primary when its OAuth secrets are set. Resend is the fallback.

export const SENDER_EMAIL = 'mgr@noblewandd.com';
export const SENDER_FROM = 'Noble Windows & Doors <mgr@noblewandd.com>';
export const COMPANY_PHONE = '(623) 810-3460';
export const COMPANY_ROC = 'ROC #364772 / #364771';

const GMAIL_KEYS = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];

export function providerFor(env = {}) {
  const gmail = GMAIL_KEYS.every((key) => String(env[key] || '').trim());
  if (gmail) return 'gmail';
  if (String(env.RESEND_API_KEY || '').trim()) return 'resend';
  return null;
}

export function splitPay(total, depositPct = 60) {
  const cents = Math.round((Number(total) || 0) * 100);
  const deposit = Math.round(cents * (Number(depositPct) || 0) / 100);
  return { total: cents / 100, deposit: deposit / 100, balance: (cents - deposit) / 100 };
}

function money(n) {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildHtml({ repName, customerName, number, total, depositPct = 60 }) {
  const pay = splitPay(total, depositPct);
  const who = esc(repName || 'Noble Windows & Doors');
  const customer = esc(customerName || 'there');
  const num = esc(number || '');
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#e7f2fb;font-family:Helvetica,Arial,sans-serif;color:#12283c;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#0e3a63;color:#ffffff;padding:18px 22px;border-bottom:4px solid #f28c28;">
      <div style="font-size:22px;font-weight:700;letter-spacing:.02em;">Noble Windows &amp; Doors</div>
      <div style="color:#d6e6f5;font-size:13px;margin-top:4px;">Estimate ${num}</div>
    </div>
    <div style="background:#ffffff;padding:22px;line-height:1.5;">
      <p style="margin:0 0 12px;">Hello ${customer},</p>
      <p style="margin:0 0 12px;">${who} prepared your window estimate. The PDF is attached.</p>
      <p style="margin:0 0 8px;font-size:20px;"><b>Total ${esc(money(pay.total))}</b></p>
      <p style="margin:0 0 12px;">Deposit (${depositPct}%): ${esc(money(pay.deposit))}<br>Final (${100 - depositPct}%): ${esc(money(pay.balance))}</p>
      <p style="margin:0;">Call us at <a href="tel:6238103460" style="color:#1d75bc;">${COMPANY_PHONE}</a> with any questions.</p>
    </div>
    <div style="padding:14px 22px;color:#4d6478;font-size:12px;line-height:1.45;">
      Noble Windows &amp; Doors LLC<br>
      ${COMPANY_PHONE}<br>
      ${COMPANY_ROC}<br>
      Prepared by ${who}
    </div>
  </div>
</body>
</html>`;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function wrap76(b64) {
  return String(b64 || '').replace(/\s/g, '').replace(/(.{76})/g, '$1\r\n');
}

export function encodeSubject(value) {
  const text = String(value ?? '');
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(text))}?=`;
}

export function safeFilename(number) {
  const clean = String(number || 'estimate').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `Noble-estimate-${clean}.pdf`;
}

export function buildRawMessage({ from, to, subject, html, pdfBase64, filename, boundary = 'nwd-estimate-boundary' }) {
  const pdf = wrap76(pdfBase64);
  const htmlB64 = wrap76(bytesToBase64(new TextEncoder().encode(String(html || ''))));
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
    `--${boundary}`,
    'Content-Type: application/pdf; name="' + filename + '"',
    'Content-Disposition: attachment; filename="' + filename + '"',
    'Content-Transfer-Encoding: base64',
    '',
    pdf,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function toBase64Url(text) {
  const b64 = bytesToBase64(new TextEncoder().encode(String(text || '')));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
